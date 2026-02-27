const express = require('express');
const router  = express.Router();
const { getBalance, addCredits, getHistory, PLANS } = require('../engine/credits');

// ─── GET: Credit Balance ──────────────────────────────────────
// GET /api/credits/balance
router.get('/balance', (req, res) => {
  const userId = req.headers['x-user-id'] || 'demo-user';
  try {
    const balance = getBalance(userId);
    res.json(balance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET: Transaction History ─────────────────────────────────
// GET /api/credits/history
router.get('/history', (req, res) => {
  const userId = req.headers['x-user-id'] || 'demo-user';
  try {
    const history = getHistory(userId);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET: Available Plans ─────────────────────────────────────
// GET /api/credits/plans
router.get('/plans', (req, res) => {
  res.json({ plans: PLANS });
});

// ─── POST: Add Credits (Dev/Test endpoint) ────────────────────
// POST /api/credits/add
// Body: { amount, reason }
// NOTE: In production this would be triggered by a payment webhook (Stripe, etc.)
router.post('/add', (req, res) => {
  const userId = req.headers['x-user-id'] || 'demo-user';
  const { amount, reason } = req.body;

  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number.' });
  }

  try {
    const result = addCredits(userId, amount, reason || 'Manual top-up');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
