const express = require('express');
const router  = express.Router();
const store   = require('../engine/gameStore');

// GET /api/games — List User's Games
router.get('/', (req, res) => {
  const userId = req.headers['x-user-id'] || 'demo-user';
  try {
    const games = store.getUserGames(userId);
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

// GET /api/games/public — Public Gallery (MUST be before /:id)
router.get('/public', (req, res) => {
  try {
    const all = store.getAllGames();
    const published = all
      .filter(g => g.published === true)
      .sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt))
      .slice(0, 50)
      .map(g => ({
        id: g.id,
        name: g.publishName || g.concept.substring(0, 60),
        description: g.publishDesc || '',
        concept: g.concept,
        createdAt: g.createdAt,
        publishedAt: g.publishedAt,
        downscaled: g.downscaled || false
      }));
    res.json({ games: published, total: published.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/games/:id — Single Game (with HTML)
router.get('/:id', (req, res) => {
  const game = store.getGame(req.params.id);
  if (!game) {
    return res.status(404).json({ error: 'Game not found.' });
  }
  res.json(game);
});

// GET /api/games/:id/preview — Serve game as HTML page
router.get('/:id/preview', (req, res) => {
  const game = store.getGame(req.params.id);
  if (!game) {
    return res.status(404).send('<h1>Game not found</h1>');
  }
  res.setHeader('Content-Type', 'text/html');
  res.send(game.html);
});

// GET /api/games/:id/download — Download game as HTML file
router.get('/:id/download', (req, res) => {
  const game = store.getGame(req.params.id);
  if (!game) {
    return res.status(404).json({ error: 'Game not found.' });
  }
  const filename = `vaf-game-${game.id.substring(0, 8)}.html`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'text/html');
  res.send(game.html);
});

// PATCH /api/games/:id/publish — Publish a game to the gallery
router.patch('/:id/publish', (req, res) => {
  const userId = req.headers['x-user-id'] || 'demo-user';
  const game   = store.getGame(req.params.id);

  if (!game) {
    return res.status(404).json({ error: 'Game not found.' });
  }
  if (game.userId !== userId) {
    return res.status(403).json({ error: 'Not authorized to publish this game.' });
  }

  const { name, description } = req.body;
  const updated = store.updateGame(req.params.id, {
    published: true,
    publishName: name || game.concept.substring(0, 60),
    publishDesc: description || '',
    publishedAt: new Date().toISOString()
  });

  res.json({
    success: true,
    gameId: req.params.id,
    previewUrl: `/api/games/${req.params.id}/preview`,
    publishName: updated.publishName
  });
});

// DELETE /api/games/:id — Delete a game
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
