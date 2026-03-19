// ─── Conversation Agent ────────────────────────────────────────
// Handles guest messages across all channels (DM, chat, WhatsApp).
// Uses the persona's identity + guest memory + PMS cache to respond.
// Classifies intent and routes to the appropriate flow.

const https = require('https');
const { buildContextSummary, addConversationTurn, updatePreferences } = require('../engine/memory');
const { buildSystemPrompt, getPersona } = require('../persona/personaManager');
const { createTrace, TRACE_TYPES } = require('../engine/attribution');

// ─── INTENT CLASSIFICATION ──────────────────────────────────────

const INTENTS = {
  GREETING: 'greeting',
  INFO_GENERAL: 'info_general',      // hotel info, amenities, location
  INFO_PRICING: 'info_pricing',      // price inquiry
  INFO_AVAILABILITY: 'info_availability', // availability check
  BOOKING_REQUEST: 'booking_request', // wants to book
  BOOKING_MODIFY: 'booking_modify',   // modify existing booking
  BOOKING_CANCEL: 'booking_cancel',   // cancel booking
  COMPLAINT: 'complaint',
  COMPLIMENT: 'compliment',
  ROOM_STATUS: 'room_status',        // "is my room ready?"
  SERVICE_REQUEST: 'service_request', // housekeeping, room service, etc.
  LOCAL_TIPS: 'local_tips',          // restaurant/activity recommendations
  CHITCHAT: 'chitchat',
  GDPR_DELETE: 'gdpr_delete',        // data deletion request
  UNKNOWN: 'unknown'
};

// Simple keyword-based intent classifier (would be replaced by LLM classifier in production)
function classifyIntent(message) {
  const lower = message.toLowerCase();

  // GDPR
  if (lower.includes('delete my data') || lower.includes('cancella i miei dati') || lower.includes('gdpr')) {
    return INTENTS.GDPR_DELETE;
  }

  // Booking
  if (lower.match(/\b(book|reserve|prenot|disponib|available|verfügbar)\b/) && lower.match(/\b(room|camera|stanza|zimmer|suite)\b/)) {
    return INTENTS.BOOKING_REQUEST;
  }
  if (lower.match(/\b(cancel|annull|storn)\b/) && lower.match(/\b(book|reserv|prenot)\b/)) {
    return INTENTS.BOOKING_CANCEL;
  }
  if (lower.match(/\b(change|modify|modific|cambiar|änder)\b/) && lower.match(/\b(book|reserv|prenot|date)\b/)) {
    return INTENTS.BOOKING_MODIFY;
  }

  // Pricing
  if (lower.match(/\b(price|cost|quanto|prezzo|tariff|rate|how much|costo)\b/)) {
    return INTENTS.INFO_PRICING;
  }

  // Availability
  if (lower.match(/\b(available|availability|disponib|free|libero|frei)\b/)) {
    return INTENTS.INFO_AVAILABILITY;
  }

  // Room status
  if (lower.match(/\b(room ready|camera pronta|check.?in|ready)\b/)) {
    return INTENTS.ROOM_STATUS;
  }

  // Service
  if (lower.match(/\b(housekeeping|pulizia|towel|asciugaman|room service|minibar|maintenance)\b/)) {
    return INTENTS.SERVICE_REQUEST;
  }

  // Complaint
  if (lower.match(/\b(problem|issue|complain|reclam|broken|rotto|noisy|rumore|dirty|sporco|disappointed)\b/)) {
    return INTENTS.COMPLAINT;
  }

  // Local tips
  if (lower.match(/\b(restaurant|ristorante|recommend|consiglio|visit|vedere|museum|museo|beach|spiaggia|bar)\b/)) {
    return INTENTS.LOCAL_TIPS;
  }

  // Greeting
  if (lower.match(/^(hi|hello|hey|ciao|buongiorno|buonasera|hola|guten tag|salve)\b/)) {
    return INTENTS.GREETING;
  }

  // Compliment
  if (lower.match(/\b(thank|grazi|amazing|beautiful|wonderful|fantasti|excellent|perfett|love)\b/)) {
    return INTENTS.COMPLIMENT;
  }

  return INTENTS.CHITCHAT;
}

// ─── ESCALATION LEVELS ──────────────────────────────────────────

const ESCALATION_LEVELS = {
  AUTONOMOUS: 'autonomous',   // agent handles fully
  ASSISTED: 'assisted',       // agent drafts, human reviews
  ESCALATED: 'escalated'      // human takes over with context
};

function determineEscalation(intent, confidence) {
  // Complaints always get human review
  if (intent === INTENTS.COMPLAINT) return ESCALATION_LEVELS.ASSISTED;
  // Booking modifications need review
  if (intent === INTENTS.BOOKING_MODIFY || intent === INTENTS.BOOKING_CANCEL) return ESCALATION_LEVELS.ASSISTED;
  // GDPR is always escalated
  if (intent === INTENTS.GDPR_DELETE) return ESCALATION_LEVELS.ESCALATED;
  // Everything else is autonomous
  return ESCALATION_LEVELS.AUTONOMOUS;
}

// ─── MAIN CONVERSATION HANDLER ──────────────────────────────────

async function handleMessage({
  message,
  guestId,
  personaId,
  hotelId,
  channel = 'chat', // 'instagram', 'whatsapp', 'chat', 'web'
  pmsGateway = null,
  parentTraceId = null
}) {
  // 1. Get persona
  const persona = getPersona(personaId);
  if (!persona) throw new Error(`Persona "${personaId}" not found`);

  // 2. Classify intent
  const intent = classifyIntent(message);

  // 3. Get guest context from memory
  const context = buildContextSummary(guestId);

  // 4. Create attribution trace
  const traceType = intent === INTENTS.BOOKING_REQUEST ? TRACE_TYPES.DM_INTENT : TRACE_TYPES.DM_START;
  const trace = createTrace({
    type: traceType,
    guestId,
    personaId,
    hotelId,
    channel,
    data: { intent, message: message.substring(0, 100) },
    parentTraceId
  });

  // 5. Determine escalation level
  const escalation = determineEscalation(intent);

  // 6. Build context for LLM
  let pmsContext = {};
  if (pmsGateway && (intent === INTENTS.INFO_PRICING || intent === INTENTS.INFO_AVAILABILITY || intent === INTENTS.BOOKING_REQUEST)) {
    try {
      // Extract dates from message (simplified — in production use NER)
      const dates = extractDates(message);
      if (dates) {
        const availability = await pmsGateway.invoke('searchAvailability', {
          hotelId, checkIn: dates.checkIn, checkOut: dates.checkOut
        });
        const pricing = await pmsGateway.invoke('getPricing', {
          hotelId, checkIn: dates.checkIn, checkOut: dates.checkOut
        });
        pmsContext = {
          availability: JSON.stringify(availability),
          pricing: JSON.stringify(pricing)
        };
      }
    } catch (err) {
      console.error('[CONVERSATION] PMS query failed:', err.message);
    }
  }

  // 7. Build system prompt with full context
  const systemPrompt = buildSystemPrompt(persona, {
    guestName: context.lastBooking?.guestName || null,
    preferences: context.preferences,
    isReturning: context.isReturning,
    ...pmsContext
  });

  // 8. Build conversation history for LLM
  const recentHistory = context.recentConversation || '';

  // 9. Call LLM
  const response = await callLLM(systemPrompt, recentHistory, message, intent);

  // 10. Save to memory
  addConversationTurn(guestId, { role: 'guest', content: message, intent, channel });
  addConversationTurn(guestId, { role: 'agent', content: response, intent, channel });

  // 11. Extract and store any preferences mentioned
  const prefs = extractPreferences(message);
  if (Object.keys(prefs).length > 0) {
    updatePreferences(guestId, prefs);
  }

  return {
    response,
    intent,
    escalation,
    traceId: trace.traceId,
    chainId: trace.chainId,
    personaName: persona.name,
    language: detectLanguage(message),
    metadata: {
      isReturning: context.isReturning,
      interactionCount: context.interactionCount + 1,
      guestTags: context.tags
    }
  };
}

// ─── LLM CALL ───────────────────────────────────────────────────

async function callLLM(systemPrompt, history, userMessage, intent) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const messages = [];
  if (history) {
    messages.push({ role: 'user', content: `[Previous conversation context]\n${history}` });
    messages.push({ role: 'assistant', content: 'I understand the context. I\'ll continue the conversation naturally.' });
  }
  messages.push({ role: 'user', content: userMessage });

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages
  });

  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, 'utf8');
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': buf.length
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode !== 200) {
            return reject(new Error(data?.error?.message || `API error ${res.statusCode}`));
          }
          resolve(data.content[0]?.text || '');
        } catch (e) {
          reject(new Error('LLM parse error: ' + e.message));
        }
      });
    });
    req.on('error', e => reject(e));
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('LLM timeout')); });
    req.write(buf);
    req.end();
  });
}

// ─── HELPERS ────────────────────────────────────────────────────

function extractDates(message) {
  // Simple date extraction (YYYY-MM-DD format)
  const datePattern = /(\d{4}-\d{2}-\d{2})/g;
  const dates = message.match(datePattern);
  if (dates && dates.length >= 2) {
    return { checkIn: dates[0], checkOut: dates[1] };
  }

  // Try "15-17 luglio" style (simplified)
  const monthMap = {
    'january': '01', 'february': '02', 'march': '03', 'april': '04', 'may': '05', 'june': '06',
    'july': '07', 'august': '08', 'september': '09', 'october': '10', 'november': '11', 'december': '12',
    'gennaio': '01', 'febbraio': '02', 'marzo': '03', 'aprile': '04', 'maggio': '05', 'giugno': '06',
    'luglio': '07', 'agosto': '08', 'settembre': '09', 'ottobre': '10', 'novembre': '11', 'dicembre': '12'
  };

  for (const [monthName, monthNum] of Object.entries(monthMap)) {
    const rangePattern = new RegExp(`(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\s+${monthName}`, 'i');
    const match = message.match(rangePattern);
    if (match) {
      const year = new Date().getFullYear();
      const checkIn = `${year}-${monthNum}-${match[1].padStart(2, '0')}`;
      const checkOut = `${year}-${monthNum}-${match[2].padStart(2, '0')}`;
      return { checkIn, checkOut };
    }
  }

  return null;
}

function extractPreferences(message) {
  const prefs = {};
  const lower = message.toLowerCase();

  if (lower.match(/\b(vegetarian|vegan|vegano|vegetariano|gluten.free|senza glutine)\b/)) {
    const match = lower.match(/(vegetarian|vegan|vegano|vegetariano|gluten.free|senza glutine)/);
    prefs.dietary = match[0];
  }
  if (lower.match(/\b(sea view|vista mare|pool view|garden view|city view)\b/i)) {
    const match = lower.match(/(sea view|vista mare|pool view|garden view|city view)/i);
    prefs.viewPreference = match[0];
  }
  if (lower.match(/\b(high floor|piano alto|low floor|ground floor|piano terra)\b/i)) {
    const match = lower.match(/(high floor|piano alto|low floor|ground floor|piano terra)/i);
    prefs.floorPreference = match[0];
  }
  if (lower.match(/budget.*?(\d+)/)) {
    prefs.budget = lower.match(/budget.*?(\d+)/)[1];
  }

  return prefs;
}

function detectLanguage(message) {
  const italianWords = ['ciao', 'buongiorno', 'come', 'stai', 'vorrei', 'camera', 'prenotare', 'grazie', 'quanto', 'costa'];
  const germanWords = ['hallo', 'guten', 'wie', 'möchte', 'zimmer', 'buchen', 'danke', 'wieviel', 'kostet'];
  const spanishWords = ['hola', 'buenos', 'cómo', 'quiero', 'habitación', 'reservar', 'gracias', 'cuánto', 'cuesta'];

  const lower = message.toLowerCase();
  const itScore = italianWords.filter(w => lower.includes(w)).length;
  const deScore = germanWords.filter(w => lower.includes(w)).length;
  const esScore = spanishWords.filter(w => lower.includes(w)).length;

  if (itScore > deScore && itScore > esScore && itScore > 0) return 'it';
  if (deScore > itScore && deScore > esScore && deScore > 0) return 'de';
  if (esScore > itScore && esScore > deScore && esScore > 0) return 'es';
  return 'en';
}

module.exports = {
  handleMessage,
  classifyIntent,
  INTENTS,
  ESCALATION_LEVELS
};
