// ─── PMS Cache Layer ───────────────────────────────────────────
// In-memory + file-backed cache that sits between AI agents and the PMS.
// Agents NEVER query the PMS directly — they read from cache.
// Cache syncs periodically with the PMS via adapters.
// This isolates the PMS from AI bugs and reduces latency.

const fs = require('fs');
const path = require('path');

const CACHE_PATH = path.join(__dirname, '..', '..', 'data', 'hospitality', 'pms_cache.json');

// In-memory cache for fast reads
let memoryCache = null;
let lastSyncTimestamps = {};

function ensureDir() {
  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getDefaultCache() {
  return {
    hotels: {},      // hotelId -> hotel info
    rooms: {},       // hotelId -> [room objects]
    availability: {}, // hotelId -> date -> room type -> availability
    pricing: {},     // hotelId -> date -> room type -> price
    bookings: {},    // bookingId -> booking object
    lastSync: null
  };
}

function loadCache() {
  if (memoryCache) return memoryCache;
  ensureDir();
  if (!fs.existsSync(CACHE_PATH)) {
    const defaultCache = getDefaultCache();
    fs.writeFileSync(CACHE_PATH, JSON.stringify(defaultCache, null, 2));
    memoryCache = defaultCache;
    return memoryCache;
  }
  memoryCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  return memoryCache;
}

function persistCache() {
  ensureDir();
  fs.writeFileSync(CACHE_PATH, JSON.stringify(memoryCache, null, 2));
}

// ─── HOTEL INFO ──────────────────────────────────────────────────

function setHotelInfo(hotelId, info) {
  const cache = loadCache();
  cache.hotels[hotelId] = {
    ...info,
    cachedAt: new Date().toISOString()
  };
  persistCache();
}

function getHotelInfo(hotelId) {
  const cache = loadCache();
  return cache.hotels[hotelId] || null;
}

// ─── ROOMS ──────────────────────────────────────────────────────

function setRooms(hotelId, rooms) {
  const cache = loadCache();
  cache.rooms[hotelId] = rooms.map(r => ({
    ...r,
    cachedAt: new Date().toISOString()
  }));
  persistCache();
}

function getRooms(hotelId) {
  const cache = loadCache();
  return cache.rooms[hotelId] || [];
}

// ─── AVAILABILITY ────────────────────────────────────────────────

function setAvailability(hotelId, date, roomType, available) {
  const cache = loadCache();
  if (!cache.availability[hotelId]) cache.availability[hotelId] = {};
  if (!cache.availability[hotelId][date]) cache.availability[hotelId][date] = {};
  cache.availability[hotelId][date][roomType] = {
    available,
    cachedAt: new Date().toISOString()
  };
  persistCache();
}

function getAvailability(hotelId, checkIn, checkOut) {
  const cache = loadCache();
  const hotelAvail = cache.availability[hotelId] || {};

  const results = {};
  const start = new Date(checkIn);
  const end = new Date(checkOut);

  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    results[dateStr] = hotelAvail[dateStr] || {};
  }

  return results;
}

// Bulk set availability for a date range
function setBulkAvailability(hotelId, availabilityData) {
  const cache = loadCache();
  if (!cache.availability[hotelId]) cache.availability[hotelId] = {};

  for (const [date, rooms] of Object.entries(availabilityData)) {
    if (!cache.availability[hotelId][date]) cache.availability[hotelId][date] = {};
    for (const [roomType, count] of Object.entries(rooms)) {
      cache.availability[hotelId][date][roomType] = {
        available: count,
        cachedAt: new Date().toISOString()
      };
    }
  }
  persistCache();
}

// ─── PRICING ─────────────────────────────────────────────────────

function setPricing(hotelId, date, roomType, price) {
  const cache = loadCache();
  if (!cache.pricing[hotelId]) cache.pricing[hotelId] = {};
  if (!cache.pricing[hotelId][date]) cache.pricing[hotelId][date] = {};
  cache.pricing[hotelId][date][roomType] = {
    price,
    currency: 'EUR',
    cachedAt: new Date().toISOString()
  };
  persistCache();
}

function getPricing(hotelId, checkIn, checkOut) {
  const cache = loadCache();
  const hotelPricing = cache.pricing[hotelId] || {};

  const results = {};
  const start = new Date(checkIn);
  const end = new Date(checkOut);

  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    results[dateStr] = hotelPricing[dateStr] || {};
  }

  return results;
}

function setBulkPricing(hotelId, pricingData) {
  const cache = loadCache();
  if (!cache.pricing[hotelId]) cache.pricing[hotelId] = {};

  for (const [date, rooms] of Object.entries(pricingData)) {
    if (!cache.pricing[hotelId][date]) cache.pricing[hotelId][date] = {};
    for (const [roomType, price] of Object.entries(rooms)) {
      cache.pricing[hotelId][date][roomType] = {
        price,
        currency: 'EUR',
        cachedAt: new Date().toISOString()
      };
    }
  }
  persistCache();
}

// ─── BOOKINGS ────────────────────────────────────────────────────

function cacheBooking(bookingId, booking) {
  const cache = loadCache();
  cache.bookings[bookingId] = {
    ...booking,
    cachedAt: new Date().toISOString()
  };
  persistCache();
}

function getCachedBooking(bookingId) {
  const cache = loadCache();
  return cache.bookings[bookingId] || null;
}

// ─── SYNC MANAGEMENT ────────────────────────────────────────────

function recordSync(hotelId, syncType) {
  lastSyncTimestamps[`${hotelId}:${syncType}`] = new Date().toISOString();
  const cache = loadCache();
  cache.lastSync = new Date().toISOString();
  persistCache();
}

function getLastSyncTime(hotelId, syncType) {
  return lastSyncTimestamps[`${hotelId}:${syncType}`] || null;
}

function isCacheStale(hotelId, syncType, maxAgeMs = 300000) { // default 5 min
  const last = lastSyncTimestamps[`${hotelId}:${syncType}`];
  if (!last) return true;
  return (Date.now() - new Date(last).getTime()) > maxAgeMs;
}

// ─── CACHE STATS ─────────────────────────────────────────────────

function getCacheStats() {
  const cache = loadCache();
  return {
    hotels: Object.keys(cache.hotels).length,
    roomSets: Object.keys(cache.rooms).length,
    availabilityEntries: Object.keys(cache.availability).length,
    pricingEntries: Object.keys(cache.pricing).length,
    cachedBookings: Object.keys(cache.bookings).length,
    lastSync: cache.lastSync,
    syncTimestamps: { ...lastSyncTimestamps }
  };
}

// Clear the in-memory cache (for testing or forced refresh)
function invalidateCache(hotelId = null) {
  if (hotelId) {
    const cache = loadCache();
    delete cache.hotels[hotelId];
    delete cache.rooms[hotelId];
    delete cache.availability[hotelId];
    delete cache.pricing[hotelId];
    persistCache();
  } else {
    memoryCache = getDefaultCache();
    persistCache();
  }
}

module.exports = {
  setHotelInfo, getHotelInfo,
  setRooms, getRooms,
  setAvailability, getAvailability, setBulkAvailability,
  setPricing, getPricing, setBulkPricing,
  cacheBooking, getCachedBooking,
  recordSync, getLastSyncTime, isCacheStale,
  getCacheStats, invalidateCache
};
