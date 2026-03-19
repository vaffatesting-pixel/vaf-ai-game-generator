// ─── PMS Gateway (MCP-Style) ───────────────────────────────────
// Exposes PMS operations as "tools" that AI agents can invoke.
// Each tool has: permissions, rate limiting, audit logging.
// Read operations hit the cache. Write operations go through to the PMS adapter.

const { v4: uuidv4 } = require('uuid');
const cache = require('./cacheLayer');

// Audit log (in-memory, would be persistent in production)
const auditLog = [];
const MAX_AUDIT_LOG = 1000;

function logAction(action) {
  auditLog.push({
    ...action,
    timestamp: new Date().toISOString()
  });
  if (auditLog.length > MAX_AUDIT_LOG) auditLog.shift();
}

// ─── TOOL DEFINITIONS ────────────────────────────────────────────
// Each tool is an operation the agent can invoke.
// Permission levels: 'read' (autonomous), 'write' (requires HITL), 'admin'

const TOOLS = {
  // READ tools — agents can call freely
  searchAvailability: {
    name: 'searchAvailability',
    description: 'Search room availability for given dates',
    permission: 'read',
    rateLimit: 30, // per minute
    handler: async ({ hotelId, checkIn, checkOut }) => {
      logAction({ tool: 'searchAvailability', hotelId, checkIn, checkOut });
      return cache.getAvailability(hotelId, checkIn, checkOut);
    }
  },

  getPricing: {
    name: 'getPricing',
    description: 'Get room pricing for given dates',
    permission: 'read',
    rateLimit: 30,
    handler: async ({ hotelId, checkIn, checkOut }) => {
      logAction({ tool: 'getPricing', hotelId, checkIn, checkOut });
      return cache.getPricing(hotelId, checkIn, checkOut);
    }
  },

  getHotelInfo: {
    name: 'getHotelInfo',
    description: 'Get hotel details, amenities, policies',
    permission: 'read',
    rateLimit: 60,
    handler: async ({ hotelId }) => {
      logAction({ tool: 'getHotelInfo', hotelId });
      return cache.getHotelInfo(hotelId);
    }
  },

  getRoomTypes: {
    name: 'getRoomTypes',
    description: 'List available room types and their features',
    permission: 'read',
    rateLimit: 60,
    handler: async ({ hotelId }) => {
      logAction({ tool: 'getRoomTypes', hotelId });
      return cache.getRooms(hotelId);
    }
  },

  getBookingDetails: {
    name: 'getBookingDetails',
    description: 'Retrieve details of an existing booking',
    permission: 'read',
    rateLimit: 20,
    handler: async ({ bookingId }) => {
      logAction({ tool: 'getBookingDetails', bookingId });
      return cache.getCachedBooking(bookingId);
    }
  },

  // WRITE tools — require HITL approval before execution
  createBooking: {
    name: 'createBooking',
    description: 'Create a new reservation in the PMS',
    permission: 'write',
    rateLimit: 5,
    requiresApproval: true,
    handler: async ({ hotelId, guestId, roomType, checkIn, checkOut, guestName, paymentRef }, adapter) => {
      const bookingId = `BK-${uuidv4().substring(0, 8).toUpperCase()}`;

      logAction({
        tool: 'createBooking',
        hotelId, guestId, roomType, checkIn, checkOut, bookingId,
        level: 'write'
      });

      // If a PMS adapter is connected, forward the write
      if (adapter && adapter.createBooking) {
        const pmsResult = await adapter.createBooking({
          bookingId, hotelId, guestId, roomType, checkIn, checkOut, guestName, paymentRef
        });
        // Cache the result
        cache.cacheBooking(bookingId, pmsResult);
        return pmsResult;
      }

      // Demo mode: create booking in cache only
      const booking = {
        bookingId,
        hotelId,
        guestId,
        guestName,
        roomType,
        checkIn,
        checkOut,
        paymentRef,
        status: 'confirmed',
        createdAt: new Date().toISOString()
      };
      cache.cacheBooking(bookingId, booking);
      return booking;
    }
  },

  modifyBooking: {
    name: 'modifyBooking',
    description: 'Modify an existing reservation',
    permission: 'write',
    rateLimit: 5,
    requiresApproval: true,
    handler: async ({ bookingId, updates }, adapter) => {
      logAction({ tool: 'modifyBooking', bookingId, updates, level: 'write' });

      if (adapter && adapter.modifyBooking) {
        const pmsResult = await adapter.modifyBooking(bookingId, updates);
        cache.cacheBooking(bookingId, pmsResult);
        return pmsResult;
      }

      // Demo mode
      const existing = cache.getCachedBooking(bookingId);
      if (!existing) throw new Error('Booking not found');
      const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
      cache.cacheBooking(bookingId, updated);
      return updated;
    }
  },

  cancelBooking: {
    name: 'cancelBooking',
    description: 'Cancel a reservation',
    permission: 'write',
    rateLimit: 5,
    requiresApproval: true,
    handler: async ({ bookingId, reason }, adapter) => {
      logAction({ tool: 'cancelBooking', bookingId, reason, level: 'write' });

      if (adapter && adapter.cancelBooking) {
        return await adapter.cancelBooking(bookingId, reason);
      }

      const existing = cache.getCachedBooking(bookingId);
      if (!existing) throw new Error('Booking not found');
      const cancelled = { ...existing, status: 'cancelled', cancelReason: reason, cancelledAt: new Date().toISOString() };
      cache.cacheBooking(bookingId, cancelled);
      return cancelled;
    }
  }
};

// ─── GATEWAY CLASS ───────────────────────────────────────────────

class PMSGateway {
  constructor(adapter = null) {
    this.adapter = adapter; // PMS-specific adapter (Apaleo, Mews, Cloudbeds...)
    this.rateLimitCounters = {};
  }

  // List available tools (for agent tool discovery)
  listTools() {
    return Object.values(TOOLS).map(t => ({
      name: t.name,
      description: t.description,
      permission: t.permission,
      requiresApproval: t.requiresApproval || false
    }));
  }

  // Invoke a tool by name
  async invoke(toolName, params) {
    const tool = TOOLS[toolName];
    if (!tool) throw new Error(`Unknown PMS tool: ${toolName}`);

    // Rate limiting
    this._checkRateLimit(toolName, tool.rateLimit);

    // For write operations, check if approval was provided
    if (tool.requiresApproval && !params._approved) {
      return {
        status: 'requires_approval',
        tool: toolName,
        params,
        message: `This operation requires human approval before execution.`
      };
    }

    return await tool.handler(params, this.adapter);
  }

  _checkRateLimit(toolName, limit) {
    const now = Date.now();
    const key = toolName;
    if (!this.rateLimitCounters[key]) {
      this.rateLimitCounters[key] = { count: 0, windowStart: now };
    }

    const counter = this.rateLimitCounters[key];
    if (now - counter.windowStart > 60000) {
      counter.count = 0;
      counter.windowStart = now;
    }

    counter.count++;
    if (counter.count > limit) {
      throw new Error(`Rate limit exceeded for tool "${toolName}". Max ${limit}/min.`);
    }
  }

  getAuditLog(limit = 50) {
    return auditLog.slice(-limit);
  }

  setAdapter(adapter) {
    this.adapter = adapter;
  }
}

module.exports = { PMSGateway, TOOLS };
