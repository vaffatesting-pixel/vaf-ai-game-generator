const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router  = express.Router();

const { generateGame, refineGame, getCreditCost, getAllGameTypes } = require('../engine/generateGame');
const { requireCredits, deductCredits, getUser } = require('../engine/credits');
const store = require('../engine/gameStore');

// ─── GET: Available Game Types ────────────────────────────────
// GET /api/generate/types
router.get('/types', (req, res) => {
  res.json({ gameTypes: getAllGameTypes() });
});

// ─── POST: Generate a New Game ────────────────────────────────
// POST /api/generate
// Body: { concept, gameType, audience, theme, mechanics, extras }
router.post('/', async (req, res) => {
  const { concept, gameType = 'arcade', audience, theme, mechanics, extras } = req.body;

  if (!concept || concept.trim().length < 10) {
    return res.status(400).json({ error: 'Please provide a game concept (at least 10 characters).' });
  }

  const userId    = req.headers['x-user-id'] || 'demo-user';
  const creditCost = getCreditCost(gameType);

  // Check credits before generating
  try {
    const user = getUser(userId);
    if (user.credits < creditCost) {
      return res.status(402).json({
        error: 'Insufficient credits',
        required: creditCost,
        available: user.credits,
        message: 'Purchase more credits to generate this game type.'
      });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  try {
    // Generate the game
    const result = await generateGame({ concept, gameType, audience, theme, mechanics, extras });

    // Deduct credits after successful generation
    const creditResult = deductCredits(userId, result.creditCost, `Generated ${gameType}: ${concept.substring(0, 40)}`);

    // Store game in local store
    const gameId = uuidv4();
    store.saveGame({
      id: gameId,
      userId,
      concept,
      gameType,
      html: result.html,
      creditCost: result.creditCost,
      tokensUsed: result.tokensUsed,
      generationTimeSeconds: result.generationTimeSeconds,
      createdAt: new Date().toISOString()
    });

    res.json({
      success: true,
      gameId,
      gameType,
      html: result.html,
      creditCost: result.creditCost,
      newCreditBalance: creditResult.newBalance,
      tokensUsed: result.tokensUsed,
      generationTimeSeconds: result.generationTimeSeconds
    });

  } catch (err) {
    console.error('[GENERATE ERROR]', err.message);
    res.status(500).json({ error: 'Game generation failed.', details: err.message });
  }
});

// ─── POST: Refine an Existing Game ───────────────────────────
// POST /api/generate/refine
// Body: { gameId, refinementPrompt }
router.post('/refine', async (req, res) => {
  const { gameId, refinementPrompt } = req.body;
  const userId = req.headers['x-user-id'] || 'demo-user';
  const REFINE_COST = 3;

  if (!gameId || !refinementPrompt) {
    return res.status(400).json({ error: 'gameId and refinementPrompt are required.' });
  }

  // Load existing game
  const game = store.getGame(gameId);
  if (!game) {
    return res.status(404).json({ error: 'Game not found.' });
  }

  // Check credits
  try {
    const user = getUser(userId);
    if (user.credits < REFINE_COST) {
      return res.status(402).json({
        error: 'Insufficient credits',
        required: REFINE_COST,
        available: user.credits
      });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  try {
    const result = await refineGame({ currentHtml: game.html, refinementPrompt });

    // Deduct credits
    const creditResult = deductCredits(userId, REFINE_COST, `Refined game ${gameId}: ${refinementPrompt.substring(0, 40)}`);

    // Update stored game
    store.updateGame(gameId, { html: result.html, updatedAt: new Date().toISOString() });

    res.json({
      success: true,
      gameId,
      html: result.html,
      creditCost: REFINE_COST,
      newCreditBalance: creditResult.newBalance
    });

  } catch (err) {
    console.error('[REFINE ERROR]', err.message);
    res.status(500).json({ error: 'Refinement failed.', details: err.message });
  }
});

module.exports = router;
