// ─── Hospitality Agentic Influence Mesh ────────────────────────
// Main module entry point. Mounts all hospitality routes and
// initializes the PMS Gateway with demo data.
//
// Architecture:
//   ┌─────────────────────────────────────────────────┐
//   │              Express Server (existing)           │
//   │                      │                           │
//   │   ┌──────────────────▼──────────────────────┐   │
//   │   │     /api/hospitality/* (this module)     │   │
//   │   │                                          │   │
//   │   │  ┌─────────┐  ┌──────────┐  ┌────────┐ │   │
//   │   │  │ Persona  │  │ Content  │  │Booking │ │   │
//   │   │  │  Agent   │  │  Agent   │  │ Agent  │ │   │
//   │   │  └────┬─────┘  └────┬─────┘  └───┬────┘ │   │
//   │   │       │              │             │      │   │
//   │   │  ┌────▼──────────────▼─────────────▼──┐  │   │
//   │   │  │      Conversation Agent            │  │   │
//   │   │  │   (intent → route → respond)       │  │   │
//   │   │  └────────────────┬───────────────────┘  │   │
//   │   │                   │                       │   │
//   │   │  ┌────────────────▼───────────────────┐  │   │
//   │   │  │         PMS Gateway (MCP)          │  │   │
//   │   │  │    ┌─────────────────────────┐     │  │   │
//   │   │  │    │      Cache Layer        │     │  │   │
//   │   │  │    └──────────┬──────────────┘     │  │   │
//   │   │  │               │ (sync)             │  │   │
//   │   │  │    ┌──────────▼──────────────┐     │  │   │
//   │   │  │    │   Apaleo / Mews / ...   │     │  │   │
//   │   │  │    └─────────────────────────┘     │  │   │
//   │   │  └────────────────────────────────────┘  │   │
//   │   │                                          │   │
//   │   │  ┌────────────────────────────────────┐  │   │
//   │   │  │  Attribution + Analytics Engine    │  │   │
//   │   │  │  (trace_id chains → ROI dashboard) │  │   │
//   │   │  └────────────────────────────────────┘  │   │
//   │   └──────────────────────────────────────────┘   │
//   └─────────────────────────────────────────────────┘

const express = require('express');
const router = express.Router();

// Import routes
const personaRoutes = require('./routes/persona');
const conversationRoutes = require('./routes/conversation');
const bookingRoutes = require('./routes/booking');
const contentRoutes = require('./routes/content');
const dashboardRoutes = require('./routes/dashboard');

// Import PMS Gateway
const { PMSGateway } = require('./pms/pmsGateway');
const cache = require('./pms/cacheLayer');

// ─── INITIALIZE PMS GATEWAY ─────────────────────────────────────

function initializeGateway(app) {
  const gateway = new PMSGateway();

  // If Apaleo credentials are configured, attach the adapter
  if (process.env.APALEO_CLIENT_ID && process.env.APALEO_CLIENT_SECRET) {
    const { ApaleoAdapter } = require('./pms/apaleoAdapter');
    const adapter = new ApaleoAdapter({
      clientId: process.env.APALEO_CLIENT_ID,
      clientSecret: process.env.APALEO_CLIENT_SECRET,
      propertyId: process.env.APALEO_PROPERTY_ID || 'demo'
    });
    gateway.setAdapter(adapter);
    console.log('  [Hospitality] Apaleo PMS adapter connected');
  } else {
    console.log('  [Hospitality] Running in demo mode (no PMS adapter)');
    loadDemoData();
  }

  // Store gateway in app.locals for route access
  app.locals.pmsGateway = gateway;
  return gateway;
}

// ─── DEMO DATA ──────────────────────────────────────────────────
// Pre-populate cache with sample hotel data for testing

function loadDemoData() {
  const DEMO_HOTEL = 'hotel-villa-aurora';

  cache.setHotelInfo(DEMO_HOTEL, {
    id: DEMO_HOTEL,
    name: 'Villa Aurora Boutique Hotel',
    location: 'Amalfi Coast, Italy',
    stars: 5,
    description: 'A luxury boutique hotel perched on the cliffs of the Amalfi Coast, offering breathtaking views of the Mediterranean.',
    amenities: ['spa', 'infinity pool', 'michelin restaurant', 'private beach', 'concierge', 'helipad', 'wine cellar'],
    checkInTime: '15:00',
    checkOutTime: '11:00',
    policies: {
      cancellation: 'Free cancellation up to 48 hours before check-in',
      pets: 'Small dogs allowed (max 10kg), €30/night supplement',
      smoking: 'Non-smoking property',
      children: 'Children welcome, extra bed available'
    }
  });

  cache.setRooms(DEMO_HOTEL, [
    { id: 'classic-sea', type: 'classic-sea', name: 'Classic Sea View', description: 'Elegant room with panoramic sea views', maxOccupancy: 2, size: '28m²', amenities: ['sea view', 'king bed', 'marble bathroom', 'minibar', 'balcony'] },
    { id: 'superior-suite', type: 'superior-suite', name: 'Superior Suite', description: 'Spacious suite with separate living area', maxOccupancy: 3, size: '45m²', amenities: ['sea view', 'king bed', 'living room', 'jacuzzi', 'private terrace'] },
    { id: 'grand-suite', type: 'grand-suite', name: 'Grand Suite Aurora', description: 'Our finest suite with 180° panoramic views', maxOccupancy: 4, size: '75m²', amenities: ['panoramic view', 'king bed', 'living room', 'private pool', 'butler service', 'dining terrace'] },
    { id: 'garden-room', type: 'garden-room', name: 'Garden Room', description: 'Serene ground-floor room with garden access', maxOccupancy: 2, size: '25m²', amenities: ['garden access', 'queen bed', 'rain shower', 'minibar'] }
  ]);

  // Set demo availability and pricing for the next 30 days
  const today = new Date();
  const availData = {};
  const priceData = {};

  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

    availData[dateStr] = {
      'classic-sea': Math.floor(Math.random() * 4) + 1,
      'superior-suite': Math.floor(Math.random() * 3),
      'grand-suite': Math.random() > 0.5 ? 1 : 0,
      'garden-room': Math.floor(Math.random() * 3) + 1
    };

    priceData[dateStr] = {
      'classic-sea': isWeekend ? 380 : 290,
      'superior-suite': isWeekend ? 580 : 450,
      'grand-suite': isWeekend ? 1200 : 950,
      'garden-room': isWeekend ? 280 : 220
    };
  }

  cache.setBulkAvailability(DEMO_HOTEL, availData);
  cache.setBulkPricing(DEMO_HOTEL, priceData);

  console.log('  [Hospitality] Demo data loaded for "Villa Aurora Boutique Hotel"');
}

// ─── MOUNT ROUTES ────────────────────────────────────────────────

router.use('/personas', personaRoutes);
router.use('/conversation', conversationRoutes);
router.use('/booking', bookingRoutes);
router.use('/content', contentRoutes);
router.use('/dashboard', dashboardRoutes);

// PMS Gateway tools endpoint
router.get('/pms/tools', (req, res) => {
  const gateway = req.app.locals.pmsGateway;
  if (!gateway) return res.status(503).json({ error: 'PMS Gateway not initialized' });
  res.json({ tools: gateway.listTools() });
});

// PMS Gateway invoke endpoint
router.post('/pms/invoke', async (req, res) => {
  const { tool, params } = req.body;
  const gateway = req.app.locals.pmsGateway;
  if (!gateway) return res.status(503).json({ error: 'PMS Gateway not initialized' });

  try {
    const result = await gateway.invoke(tool, params || {});
    res.json({ success: true, tool, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PMS audit log
router.get('/pms/audit', (req, res) => {
  const gateway = req.app.locals.pmsGateway;
  if (!gateway) return res.status(503).json({ error: 'PMS Gateway not initialized' });
  const limit = parseInt(req.query.limit) || 50;
  res.json({ auditLog: gateway.getAuditLog(limit) });
});

module.exports = { router, initializeGateway };
