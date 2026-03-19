// ─── Content Pipeline API Routes ───────────────────────────────
const express = require('express');
const router = express.Router();
const {
  planContent, generateContent,
  addToQueue, getQueue, approveContent, rejectContent,
  CONTENT_TYPES, PLATFORMS
} = require('../agents/contentAgent');
const { getPersona } = require('../persona/personaManager');

// POST /api/hospitality/content/plan — Generate a content plan
router.post('/plan', (req, res) => {
  const { personaId, recentPerformance, upcomingEvents, season } = req.body;

  const persona = getPersona(personaId);
  if (!persona) return res.status(404).json({ error: 'Persona not found' });

  try {
    const plan = planContent(persona, { recentPerformance, upcomingEvents, season });
    res.json({ success: true, plan, totalPosts: plan.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/hospitality/content/generate — Generate a single content piece
router.post('/generate', async (req, res) => {
  const { personaId, contentType, platform, context } = req.body;

  if (!personaId || !contentType) {
    return res.status(400).json({ error: 'Required: personaId, contentType' });
  }

  try {
    const content = await generateContent({
      personaId,
      contentType,
      platform: platform || PLATFORMS.INSTAGRAM_POST,
      context: context || {}
    });

    // Auto-queue for HITL review
    const queued = addToQueue(content);

    res.json({ success: true, content: queued });
  } catch (err) {
    console.error('[CONTENT ERROR]', err.message);
    res.status(500).json({ error: 'Content generation failed', details: err.message });
  }
});

// GET /api/hospitality/content/queue — Get pending content for review
router.get('/queue', (req, res) => {
  const personaId = req.query.personaId || null;
  const queue = getQueue(personaId);
  res.json({ queue, total: queue.length });
});

// POST /api/hospitality/content/approve/:id — Approve content for publishing
router.post('/approve/:id', (req, res) => {
  try {
    const content = approveContent(req.params.id);
    res.json({ success: true, content });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// POST /api/hospitality/content/reject/:id — Reject content
router.post('/reject/:id', (req, res) => {
  const { reason } = req.body;
  try {
    const content = rejectContent(req.params.id, reason || 'No reason provided');
    res.json({ success: true, content });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// GET /api/hospitality/content/types — List content types
router.get('/types', (req, res) => {
  res.json({ contentTypes: Object.values(CONTENT_TYPES), platforms: Object.values(PLATFORMS) });
});

module.exports = router;
