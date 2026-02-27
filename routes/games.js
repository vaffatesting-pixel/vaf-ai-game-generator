const express = require('express');
const router  = express.Router();
const store   = require('../engine/gameStore');

// ─── GET: List User's Games ───────────────────────────────────
// GET /api/games
router.get('/', (req, res) => {
  const userId = req.headers['x-user-id'] || 'demo-user';
  try {
    const games = store.getUserGames(userId);
    // Return list without full HTML (too large for listing)
    const gameList = games.map(g => ({
      id: g.id,
      concept: g.concept,
      gameType: g.gameType,
      creditCost: g.creditCost,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt || null
    }));
    res.json({ games: gameList, total: gameList.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET: Single Game (with HTML) ────────────────────────────
// GET /api/games/:id
router.get('/:id', (req, res) => {
  const game = store.getGame(req.params.id);
  if (!game) {
    return res.status(404).json({ error: 'Game not found.' });
  }
  res.json(game);
});

// ─── GET: Preview Game as HTML page ──────────────────────────
// GET /api/games/:id/preview
router.get('/:id/preview', (req, res) => {
  const game = store.getGame(req.params.id);
  if (!game) {
    return res.status(404).send('<h1>Game not found</h1>');
  }
  res.setHeader('Content-Type', 'text/html');
  res.send(game.html);
});

// ─── GET: Download Game as HTML file ─────────────────────────
// GET /api/games/:id/download
router.get('/:id/download', (req, res) => {
  const game = store.getGame(req.params.id);
  if (!game) {
    return res.status(404).json({ error: 'Game not found.' });
  }
  const filename = `vaf-game-${game.gameType}-${game.id.substring(0, 8)}.html`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'text/html');
  res.send(game.html);
});

// ─── DELETE: Delete a Game ────────────────────────────────────
// DELETE /api/games/:id
router.delete('/:id', (req, res) => {
  const userId = req.headers['x-user-id'] || 'demo-user';
  const game   = store.getGame(req.params.id);

  if (!game) {
    return res.status(404).json({ error: 'Game not found.' });
  }
  if (game.userId !== userId) {
    return res.status(403).json({ error: 'Not authorized to delete this game.' });
  }

  store.deleteGame(req.params.id);
  res.json({ success: true, message: 'Game deleted.' });
});

module.exports = router;
