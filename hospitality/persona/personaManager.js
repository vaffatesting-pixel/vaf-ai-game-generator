// ─── Persona Manager ───────────────────────────────────────────
// Manages AI Influencer personas: creation, consistency, voice/visual identity.
// Each hotel can have multiple personas targeting different audiences.

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const PERSONAS_PATH = path.join(__dirname, '..', '..', 'data', 'hospitality', 'personas.json');

function ensureDir() {
  const dir = path.dirname(PERSONAS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadDB() {
  ensureDir();
  if (!fs.existsSync(PERSONAS_PATH)) {
    fs.writeFileSync(PERSONAS_PATH, JSON.stringify({ personas: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(PERSONAS_PATH, 'utf8'));
}

function saveDB(db) {
  ensureDir();
  fs.writeFileSync(PERSONAS_PATH, JSON.stringify(db, null, 2));
}

// ─── PERSONA SCHEMA ──────────────────────────────────────────────
// A persona is the complete identity of a digital influencer.
// It includes visual, vocal, personality, and operational parameters.

function createPersona({
  hotelId,
  name,
  role = 'concierge',        // 'concierge', 'influencer', 'receptionist', 'sommelier'
  languages = ['en', 'it'],
  personality = {},
  visual = {},
  voice = {},
  contentStrategy = {},
  platforms = ['instagram'],
  active = true
}) {
  const db = loadDB();
  const id = uuidv4();

  const persona = {
    id,
    hotelId,
    name,
    role,
    languages,

    // Personality defines the LLM system prompt behavior
    personality: {
      tone: personality.tone || 'warm, professional, knowledgeable',
      traits: personality.traits || ['friendly', 'detail-oriented', 'culturally-aware'],
      humor: personality.humor || 'subtle',
      formality: personality.formality || 'semi-formal',
      backstory: personality.backstory || null,
      // Brand guardrails: topics to avoid, mandatory mentions
      guardrails: {
        avoid: personality.avoid || ['politics', 'religion', 'competitor mentions'],
        mandatory: personality.mandatory || [],
        maxResponseLength: personality.maxResponseLength || 300
      }
    },

    // Visual consistency parameters (for image generation prompts)
    visual: {
      gender: visual.gender || null,
      ageRange: visual.ageRange || '25-35',
      ethnicity: visual.ethnicity || null,
      hairStyle: visual.hairStyle || null,
      hairColor: visual.hairColor || null,
      eyeColor: visual.eyeColor || null,
      style: visual.style || 'business casual, elegant',
      // Stable Diffusion / Flux prompt fragments for consistency
      sdPromptBase: visual.sdPromptBase || null,
      sdNegativePrompt: visual.sdNegativePrompt || null,
      loraModel: visual.loraModel || null,
      seed: visual.seed || null
    },

    // Voice synthesis parameters
    voice: {
      provider: voice.provider || 'elevenlabs',  // 'elevenlabs', 'xtts', 'azure'
      voiceId: voice.voiceId || null,
      speed: voice.speed || 1.0,
      pitch: voice.pitch || 'medium',
      languageVoiceMap: voice.languageVoiceMap || {}  // { 'it': 'voice-id-it', 'en': 'voice-id-en' }
    },

    // Content strategy for automated posting
    contentStrategy: {
      postingFrequency: contentStrategy.postingFrequency || 'daily',  // 'daily', '2x-daily', '3x-weekly'
      contentMix: contentStrategy.contentMix || {
        roomTour: 20,        // percentage
        foodSpotlight: 20,
        localTips: 20,
        behindTheScenes: 15,
        guestStories: 10,
        promotions: 10,
        qa: 5
      },
      bestPostingTimes: contentStrategy.bestPostingTimes || ['09:00', '13:00', '19:00'],
      hashtags: contentStrategy.hashtags || [],
      targetAudiences: contentStrategy.targetAudiences || ['luxury travelers', 'food lovers', 'couples']
    },

    platforms,
    active,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    // Performance metrics (updated by analytics engine)
    metrics: {
      totalPosts: 0,
      totalEngagements: 0,
      totalConversations: 0,
      totalBookings: 0,
      totalRevenue: 0,
      averageEngagementRate: 0
    }
  };

  db.personas[id] = persona;
  saveDB(db);
  return persona;
}

function getPersona(id) {
  const db = loadDB();
  return db.personas[id] || null;
}

function getHotelPersonas(hotelId) {
  const db = loadDB();
  return Object.values(db.personas).filter(p => p.hotelId === hotelId);
}

function updatePersona(id, updates) {
  const db = loadDB();
  if (!db.personas[id]) throw new Error('Persona not found');

  // Deep merge for nested objects
  const current = db.personas[id];
  if (updates.personality) updates.personality = { ...current.personality, ...updates.personality };
  if (updates.visual) updates.visual = { ...current.visual, ...updates.visual };
  if (updates.voice) updates.voice = { ...current.voice, ...updates.voice };
  if (updates.contentStrategy) updates.contentStrategy = { ...current.contentStrategy, ...updates.contentStrategy };

  db.personas[id] = { ...current, ...updates, updatedAt: new Date().toISOString() };
  saveDB(db);
  return db.personas[id];
}

function updateMetrics(id, metricUpdates) {
  const db = loadDB();
  if (!db.personas[id]) return null;
  db.personas[id].metrics = { ...db.personas[id].metrics, ...metricUpdates };
  saveDB(db);
  return db.personas[id].metrics;
}

function deletePersona(id) {
  const db = loadDB();
  delete db.personas[id];
  saveDB(db);
  return { deleted: true };
}

// Build the system prompt for this persona (used by conversation agent)
function buildSystemPrompt(persona, context = {}) {
  const p = persona.personality;
  const guardrails = p.guardrails;

  let prompt = `You are ${persona.name}, a ${persona.role} at a luxury hotel.

PERSONALITY:
- Tone: ${p.tone}
- Traits: ${p.traits.join(', ')}
- Humor style: ${p.humor}
- Formality: ${p.formality}
${p.backstory ? `- Background: ${p.backstory}` : ''}

COMMUNICATION RULES:
- Respond in the guest's language when possible. You speak: ${persona.languages.join(', ')}.
- Keep responses under ${guardrails.maxResponseLength} characters for social media, longer for chat.
- Never discuss: ${guardrails.avoid.join(', ')}.
${guardrails.mandatory.length > 0 ? `- Always mention: ${guardrails.mandatory.join(', ')}.` : ''}

BEHAVIOR:
- If a guest asks about availability or pricing, provide specific data if available in context.
- If you don't have real-time data, say you'll check and get back shortly.
- Never invent room prices or availability. Only state what is confirmed.
- For complaints, acknowledge empathy first, then offer to escalate to staff.
- For booking requests, guide the guest through the process step by step.`;

  if (context.guestName) prompt += `\n\nYou are speaking with: ${context.guestName}`;
  if (context.preferences) prompt += `\nKnown preferences: ${context.preferences}`;
  if (context.isReturning) prompt += `\nThis is a returning guest — acknowledge their loyalty.`;
  if (context.availability) prompt += `\n\nCURRENT AVAILABILITY DATA:\n${context.availability}`;
  if (context.pricing) prompt += `\n\nCURRENT PRICING:\n${context.pricing}`;

  return prompt;
}

// Build the image generation prompt for visual consistency
function buildImagePrompt(persona, scene = 'hotel lobby portrait') {
  const v = persona.visual;
  const parts = [];

  if (v.sdPromptBase) {
    parts.push(v.sdPromptBase);
  } else {
    parts.push('professional photo');
    if (v.gender) parts.push(v.gender);
    if (v.ageRange) parts.push(`age ${v.ageRange}`);
    if (v.ethnicity) parts.push(v.ethnicity);
    if (v.hairStyle) parts.push(`${v.hairStyle} hair`);
    if (v.hairColor) parts.push(`${v.hairColor} hair`);
    if (v.eyeColor) parts.push(`${v.eyeColor} eyes`);
    if (v.style) parts.push(v.style);
  }

  parts.push(scene);
  parts.push('high quality, 4k, professional lighting');

  return {
    prompt: parts.join(', '),
    negativePrompt: v.sdNegativePrompt || 'blurry, low quality, distorted, multiple faces',
    seed: v.seed
  };
}

module.exports = {
  createPersona,
  getPersona,
  getHotelPersonas,
  updatePersona,
  updateMetrics,
  deletePersona,
  buildSystemPrompt,
  buildImagePrompt
};
