// ─── Conversation API Routes ───────────────────────────────────
const express = require('express');
const router = express.Router();
const { handleMessage, INTENTS } = require('../agents/conversationAgent');
const { getGuestMemory, deleteGuestData, listGuests, buildContextSummary } = require('../engine/memory');

// POST /api/hospitality/conversation — Send a message to the AI concierge
router.post('/', async (req, res) => {
  const { message, guestId, personaId, hotelId, channel, parentTraceId } = req.body;

  if (!message || !guestId || !personaId || !hotelId) {
    return res.status(400).json({
      error: 'Required: message, guestId, personaId, hotelId'
    });
  }

  try {
    const pmsGateway = req.app.locals.pmsGateway || null;
    const result = await handleMessage({
      message, guestId, personaId, hotelId,
      channel: channel || 'chat',
      pmsGateway,
      parentTraceId
    });
    res.json(result);
  } catch (err) {
    console.error('[CONVERSATION ERROR]', err.message);
    res.status(500).json({ error: 'Conversation failed', details: err.message });
  }
});

// GET /api/hospitality/conversation/guest/:guestId — Get guest memory/profile
router.get('/guest/:guestId', (req, res) => {
  try {
    const memory = getGuestMemory(req.params.guestId);
    res.json(memory);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/hospitality/conversation/guest/:guestId/context — Get guest context summary
router.get('/guest/:guestId/context', (req, res) => {
  try {
    const context = buildContextSummary(req.params.guestId);
    res.json(context);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/hospitality/conversation/guest/:guestId — GDPR delete
router.delete('/guest/:guestId', (req, res) => {
  try {
    const result = deleteGuestData(req.params.guestId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/hospitality/conversation/guests — List all guests (admin)
router.get('/guests', (req, res) => {
  try {
    const guests = listGuests();
    res.json({ guests, total: guests.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/hospitality/conversation/intents — List supported intents
router.get('/intents', (req, res) => {
  res.json({ intents: Object.values(INTENTS) });
});

module.exports = router;
