// ─── Attribution & Trace Engine ─────────────────────────────────
// Tracks the full journey: content impression → DM → booking → revenue.
// Every touchpoint generates a linked trace_id for ROI measurement.

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const TRACES_PATH = path.join(__dirname, '..', '..', 'data', 'hospitality', 'traces.json');

function ensureDir() {
  const dir = path.dirname(TRACES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadTraces() {
  ensureDir();
  if (!fs.existsSync(TRACES_PATH)) {
    fs.writeFileSync(TRACES_PATH, JSON.stringify({ traces: {}, chains: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(TRACES_PATH, 'utf8'));
}

function saveTraces(db) {
  ensureDir();
  fs.writeFileSync(TRACES_PATH, JSON.stringify(db, null, 2));
}

// Trace types in the funnel
const TRACE_TYPES = {
  IMPRESSION: 'impression',       // content viewed
  ENGAGEMENT: 'engagement',       // like, comment, share
  DM_START: 'dm_start',           // DM conversation initiated
  DM_INTENT: 'dm_intent',         // booking intent detected
  SEARCH: 'search',               // availability search performed
  BOOKING_START: 'booking_start', // booking flow entered
  PAYMENT: 'payment',             // payment completed
  BOOKING_CONFIRM: 'booking_confirm', // booking confirmed in PMS
  CHECKIN: 'checkin',             // guest checked in
  UPSELL: 'upsell',              // additional purchase during stay
  REVIEW: 'review'               // post-stay review
};

// Create a new trace point
function createTrace({ type, guestId, personaId, hotelId, channel, data = {}, parentTraceId = null }) {
  const db = loadTraces();
  const traceId = uuidv4();

  const trace = {
    id: traceId,
    type,
    guestId,
    personaId,
    hotelId,
    channel,       // 'instagram', 'tiktok', 'whatsapp', 'web', 'chat'
    data,
    parentTraceId,
    createdAt: new Date().toISOString()
  };

  db.traces[traceId] = trace;

  // Build/extend the attribution chain
  const chainId = parentTraceId
    ? findChainId(db, parentTraceId)
    : traceId; // new chain starts with this trace

  if (!db.chains[chainId]) {
    db.chains[chainId] = {
      id: chainId,
      guestId,
      personaId,
      hotelId,
      traces: [],
      totalRevenue: 0,
      startedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      converted: false
    };
  }

  db.chains[chainId].traces.push(traceId);
  db.chains[chainId].lastActivity = new Date().toISOString();

  // Mark chain as converted if a payment trace is added
  if (type === TRACE_TYPES.PAYMENT || type === TRACE_TYPES.BOOKING_CONFIRM) {
    db.chains[chainId].converted = true;
    if (data.amount) {
      db.chains[chainId].totalRevenue += data.amount;
    }
  }

  if (type === TRACE_TYPES.UPSELL && data.amount) {
    db.chains[chainId].totalRevenue += data.amount;
  }

  saveTraces(db);

  return { traceId, chainId, trace };
}

// Find which chain a trace belongs to
function findChainId(db, traceId) {
  for (const [chainId, chain] of Object.entries(db.chains)) {
    if (chain.traces.includes(traceId) || chainId === traceId) {
      return chainId;
    }
  }
  return traceId; // fallback: create a new chain
}

// Get full attribution chain
function getChain(chainId) {
  const db = loadTraces();
  const chain = db.chains[chainId];
  if (!chain) return null;

  const traceDetails = chain.traces.map(tId => db.traces[tId]).filter(Boolean);

  return {
    ...chain,
    traceDetails,
    funnelStage: determineFunnelStage(traceDetails)
  };
}

function determineFunnelStage(traces) {
  const types = traces.map(t => t.type);
  if (types.includes(TRACE_TYPES.REVIEW)) return 'post-stay';
  if (types.includes(TRACE_TYPES.UPSELL)) return 'in-stay';
  if (types.includes(TRACE_TYPES.CHECKIN)) return 'checked-in';
  if (types.includes(TRACE_TYPES.BOOKING_CONFIRM)) return 'booked';
  if (types.includes(TRACE_TYPES.PAYMENT)) return 'paid';
  if (types.includes(TRACE_TYPES.BOOKING_START)) return 'booking';
  if (types.includes(TRACE_TYPES.DM_INTENT)) return 'intent';
  if (types.includes(TRACE_TYPES.DM_START)) return 'conversation';
  if (types.includes(TRACE_TYPES.ENGAGEMENT)) return 'engaged';
  return 'awareness';
}

// Analytics: conversion funnel for a hotel
function getHotelFunnel(hotelId) {
  const db = loadTraces();
  const chains = Object.values(db.chains).filter(c => c.hotelId === hotelId);

  const funnel = {
    total: chains.length,
    awareness: 0,
    engaged: 0,
    conversation: 0,
    intent: 0,
    booking: 0,
    paid: 0,
    booked: 0,
    totalRevenue: 0,
    conversionRate: 0,
    averageRevenuePerChain: 0
  };

  for (const chain of chains) {
    const traceDetails = chain.traces.map(tId => db.traces[tId]).filter(Boolean);
    const stage = determineFunnelStage(traceDetails);
    if (funnel[stage] !== undefined) funnel[stage]++;
    funnel.totalRevenue += chain.totalRevenue;
  }

  const converted = chains.filter(c => c.converted).length;
  funnel.conversionRate = chains.length > 0 ? (converted / chains.length * 100).toFixed(2) : 0;
  funnel.averageRevenuePerChain = converted > 0 ? (funnel.totalRevenue / converted).toFixed(2) : 0;

  return funnel;
}

// Analytics: persona performance comparison
function getPersonaPerformance(hotelId) {
  const db = loadTraces();
  const chains = Object.values(db.chains).filter(c => c.hotelId === hotelId);

  const byPersona = {};
  for (const chain of chains) {
    const pid = chain.personaId || 'unknown';
    if (!byPersona[pid]) {
      byPersona[pid] = { personaId: pid, chains: 0, conversions: 0, revenue: 0 };
    }
    byPersona[pid].chains++;
    if (chain.converted) byPersona[pid].conversions++;
    byPersona[pid].revenue += chain.totalRevenue;
  }

  return Object.values(byPersona).map(p => ({
    ...p,
    conversionRate: p.chains > 0 ? (p.conversions / p.chains * 100).toFixed(2) : 0
  }));
}

module.exports = {
  TRACE_TYPES,
  createTrace,
  getChain,
  getHotelFunnel,
  getPersonaPerformance
};
