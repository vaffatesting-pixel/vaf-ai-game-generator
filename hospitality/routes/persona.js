// ─── Persona API Routes ────────────────────────────────────────
const express = require('express');
const router = express.Router();
const {
  createPersona, getPersona, getHotelPersonas,
  updatePersona, deletePersona, buildImagePrompt
} = require('../persona/personaManager');

// POST /api/hospitality/personas — Create a new persona
router.post('/', (req, res) => {
  try {
    const persona = createPersona(req.body);
    res.status(201).json({ success: true, persona });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/hospitality/personas/:id — Get a persona
router.get('/:id', (req, res) => {
  const persona = getPersona(req.params.id);
  if (!persona) return res.status(404).json({ error: 'Persona not found' });
  res.json(persona);
});

// GET /api/hospitality/personas/hotel/:hotelId — List hotel personas
router.get('/hotel/:hotelId', (req, res) => {
  const personas = getHotelPersonas(req.params.hotelId);
  res.json({ personas, total: personas.length });
});

// PATCH /api/hospitality/personas/:id — Update a persona
router.patch('/:id', (req, res) => {
  try {
    const persona = updatePersona(req.params.id, req.body);
    res.json({ success: true, persona });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/hospitality/personas/:id — Delete a persona
router.delete('/:id', (req, res) => {
  try {
    deletePersona(req.params.id);
    res.json({ success: true, deleted: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/hospitality/personas/:id/image-prompt — Get image generation prompt
router.get('/:id/image-prompt', (req, res) => {
  const persona = getPersona(req.params.id);
  if (!persona) return res.status(404).json({ error: 'Persona not found' });
  const scene = req.query.scene || 'hotel lobby portrait';
  const prompt = buildImagePrompt(persona, scene);
  res.json(prompt);
});

module.exports = router;
