// ─── Booking API Routes ────────────────────────────────────────
const express = require('express');
const router = express.Router();
const { createBookingGraph } = require('../agents/bookingAgent');

// In-memory store for active booking sessions
const activeSessions = new Map();

// POST /api/hospitality/booking/start — Start a booking flow
router.post('/start', async (req, res) => {
  const { guestId, hotelId, personaId, checkIn, checkOut, guests, roomTypePreference, guestName, channel } = req.body;

  if (!guestId || !hotelId || !checkIn || !checkOut) {
    return res.status(400).json({ error: 'Required: guestId, hotelId, checkIn, checkOut' });
  }

  try {
    const pmsGateway = req.app.locals.pmsGateway;
    if (!pmsGateway) {
      return res.status(503).json({ error: 'PMS Gateway not configured' });
    }

    const graph = createBookingGraph(pmsGateway);
    const result = await graph.run({
      guestId, hotelId, personaId, checkIn, checkOut,
      guests: guests || 2,
      roomTypePreference,
      guestName: guestName || 'Guest',
      channel: channel || 'chat'
    });

    // If paused (HITL checkpoint), store the session
    if (result.status === 'paused') {
      activeSessions.set(result.runId, { graph, state: result.state });
      return res.json({
        status: 'awaiting_confirmation',
        runId: result.runId,
        pausedAt: result.pausedAt,
        state: sanitizeState(result.state)
      });
    }

    res.json({
      status: result.status,
      runId: result.runId,
      state: sanitizeState(result.state)
    });
  } catch (err) {
    console.error('[BOOKING ERROR]', err.message);
    res.status(500).json({ error: 'Booking flow failed', details: err.message });
  }
});

// POST /api/hospitality/booking/select — Guest selects a room
router.post('/select', async (req, res) => {
  const { runId, selectedIndex } = req.body;
  const session = activeSessions.get(runId);

  if (!session) {
    return res.status(404).json({ error: 'Booking session not found or expired' });
  }

  // Update state with selection and continue
  session.state.selectedIndex = selectedIndex || 0;
  session.state.stage = 'select';

  try {
    const result = await session.graph.resume(session.state);

    if (result.status === 'paused') {
      activeSessions.set(runId, { graph: session.graph, state: result.state });
      return res.json({
        status: 'awaiting_confirmation',
        runId,
        message: result.state.message,
        selectedRoom: result.state.selectedRoom,
        totalPrice: result.state.totalPrice
      });
    }

    activeSessions.delete(runId);
    res.json({ status: result.status, state: sanitizeState(result.state) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/hospitality/booking/confirm — Guest confirms booking
router.post('/confirm', async (req, res) => {
  const { runId, confirmed } = req.body;
  const session = activeSessions.get(runId);

  if (!session) {
    return res.status(404).json({ error: 'Booking session not found or expired' });
  }

  if (!confirmed) {
    activeSessions.delete(runId);
    return res.json({ status: 'cancelled', message: 'Booking cancelled by guest.' });
  }

  session.state.guestConfirmed = true;

  try {
    const result = await session.graph.resume(session.state, { confirmed: true });
    activeSessions.delete(runId);

    res.json({
      status: result.status,
      state: sanitizeState(result.state)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/hospitality/booking/session/:runId — Check booking session status
router.get('/session/:runId', (req, res) => {
  const session = activeSessions.get(req.params.runId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({
    runId: req.params.runId,
    status: session.state._status,
    stage: session.state.stage,
    pausedAt: session.state._pausedAt
  });
});

// Remove internal fields from state before sending to client
function sanitizeState(state) {
  const clean = { ...state };
  delete clean._runId;
  delete clean._history;
  delete clean._currentNode;
  delete clean._status;
  delete clean._requiresApproval;
  delete clean._approvalReason;
  delete clean._approval;
  delete clean._pausedAt;
  return clean;
}

module.exports = router;
