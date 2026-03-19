// ─── Conversation Memory Engine ─────────────────────────────────
// Persistent memory for guest interactions across sessions.
// Stores conversation history, preferences, and context per guest.

const fs = require('fs');
const path = require('path');

const MEMORY_PATH = path.join(__dirname, '..', '..', 'data', 'hospitality', 'memory.json');

function ensureDir() {
  const dir = path.dirname(MEMORY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadMemory() {
  ensureDir();
  if (!fs.existsSync(MEMORY_PATH)) {
    fs.writeFileSync(MEMORY_PATH, JSON.stringify({ guests: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8'));
}

function saveMemory(db) {
  ensureDir();
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(db, null, 2));
}

// Get or create a guest memory profile
function getGuestMemory(guestId) {
  const db = loadMemory();
  if (!db.guests[guestId]) {
    db.guests[guestId] = {
      id: guestId,
      preferences: {},
      conversationHistory: [],
      bookingHistory: [],
      interactionCount: 0,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      tags: [],       // e.g. ['vip', 'returning', 'influencer']
      language: null,
      sentiment: null  // rolling average sentiment
    };
    saveMemory(db);
  }
  return db.guests[guestId];
}

// Add a conversation turn to memory
function addConversationTurn(guestId, turn) {
  const db = loadMemory();
  const guest = getGuestMemory(guestId);

  guest.conversationHistory.push({
    role: turn.role,       // 'guest' or 'agent'
    content: turn.content,
    intent: turn.intent || null,
    channel: turn.channel || 'chat', // 'instagram', 'whatsapp', 'chat', 'web'
    timestamp: new Date().toISOString()
  });

  // Keep last 100 turns per guest to manage memory size
  if (guest.conversationHistory.length > 100) {
    guest.conversationHistory = guest.conversationHistory.slice(-100);
  }

  guest.interactionCount++;
  guest.lastSeen = new Date().toISOString();

  db.guests[guestId] = guest;
  saveMemory(db);
  return guest;
}

// Update guest preferences (learned from conversations)
function updatePreferences(guestId, prefs) {
  const db = loadMemory();
  const guest = getGuestMemory(guestId);
  guest.preferences = { ...guest.preferences, ...prefs };
  guest.lastSeen = new Date().toISOString();
  db.guests[guestId] = guest;
  saveMemory(db);
  return guest;
}

// Add a tag to a guest profile
function addTag(guestId, tag) {
  const db = loadMemory();
  const guest = getGuestMemory(guestId);
  if (!guest.tags.includes(tag)) {
    guest.tags.push(tag);
  }
  db.guests[guestId] = guest;
  saveMemory(db);
  return guest;
}

// Record a booking in guest memory
function recordBooking(guestId, booking) {
  const db = loadMemory();
  const guest = getGuestMemory(guestId);
  guest.bookingHistory.push({
    ...booking,
    recordedAt: new Date().toISOString()
  });
  db.guests[guestId] = guest;
  saveMemory(db);
  return guest;
}

// Build context summary for LLM prompt injection
function buildContextSummary(guestId) {
  const guest = getGuestMemory(guestId);

  const recentConversation = guest.conversationHistory.slice(-10)
    .map(t => `[${t.role}]: ${t.content}`)
    .join('\n');

  const prefsText = Object.entries(guest.preferences)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  return {
    isReturning: guest.interactionCount > 1,
    interactionCount: guest.interactionCount,
    tags: guest.tags,
    language: guest.language,
    preferences: prefsText || 'none known',
    recentConversation,
    bookingCount: guest.bookingHistory.length,
    lastBooking: guest.bookingHistory.length > 0
      ? guest.bookingHistory[guest.bookingHistory.length - 1]
      : null
  };
}

// GDPR: delete all guest data
function deleteGuestData(guestId) {
  const db = loadMemory();
  delete db.guests[guestId];
  saveMemory(db);
  return { deleted: true, guestId };
}

// List all guest IDs (for admin)
function listGuests() {
  const db = loadMemory();
  return Object.keys(db.guests).map(id => {
    const g = db.guests[id];
    return {
      id,
      interactionCount: g.interactionCount,
      lastSeen: g.lastSeen,
      tags: g.tags
    };
  });
}

module.exports = {
  getGuestMemory,
  addConversationTurn,
  updatePreferences,
  addTag,
  recordBooking,
  buildContextSummary,
  deleteGuestData,
  listGuests
};
