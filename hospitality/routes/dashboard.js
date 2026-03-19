// ─── Dashboard & Analytics API Routes ──────────────────────────
const express = require('express');
const router = express.Router();
const { getHotelFunnel, getPersonaPerformance, getChain } = require('../engine/attribution');
const { getCacheStats } = require('../pms/cacheLayer');
const { runRevenueCrew } = require('../agents/revenueAgent');

// GET /api/hospitality/dashboard/:hotelId — Full dashboard data
router.get('/:hotelId', (req, res) => {
  try {
    const hotelId = req.params.hotelId;
    const funnel = getHotelFunnel(hotelId);
    const personaPerf = getPersonaPerformance(hotelId);
    const cacheStats = getCacheStats();

    res.json({
      hotelId,
      funnel,
      personaPerformance: personaPerf,
      systemHealth: {
        cacheStats,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/hospitality/dashboard/:hotelId/funnel — Conversion funnel only
router.get('/:hotelId/funnel', (req, res) => {
  try {
    const funnel = getHotelFunnel(req.params.hotelId);
    res.json(funnel);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/hospitality/dashboard/:hotelId/personas — Persona performance
router.get('/:hotelId/personas', (req, res) => {
  try {
    const perf = getPersonaPerformance(req.params.hotelId);
    res.json({ personas: perf });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/hospitality/dashboard/chain/:chainId — Full attribution chain
router.get('/chain/:chainId', (req, res) => {
  try {
    const chain = getChain(req.params.chainId);
    if (!chain) return res.status(404).json({ error: 'Attribution chain not found' });
    res.json(chain);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/hospitality/dashboard/:hotelId/revenue-analysis — Run revenue crew
router.post('/:hotelId/revenue-analysis', async (req, res) => {
  const { historicalData, competitorData, socialMetrics } = req.body;

  try {
    const report = await runRevenueCrew({
      hotelId: req.params.hotelId,
      historicalData: historicalData || {},
      competitorData: competitorData || {},
      socialMetrics: socialMetrics || {}
    });
    res.json(report);
  } catch (err) {
    console.error('[REVENUE ERROR]', err.message);
    res.status(500).json({ error: 'Revenue analysis failed', details: err.message });
  }
});

// GET /api/hospitality/dashboard/health — System health check
router.get('/system/health', (req, res) => {
  res.json({
    status: 'ok',
    module: 'hospitality-agentic-mesh',
    version: '0.1.0',
    components: {
      stateGraph: 'active',
      conversationAgent: 'active',
      bookingAgent: 'active',
      contentAgent: 'active',
      revenueAgent: 'active',
      pmsGateway: 'active',
      attributionEngine: 'active'
    },
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
