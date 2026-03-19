// ─── Apaleo PMS Adapter ────────────────────────────────────────
// Adapter for Apaleo's API-first PMS (MACH architecture).
// Translates gateway calls into Apaleo REST API requests.
// Uses OAuth2 client credentials for authentication.
//
// Apaleo API docs: https://api.apaleo.com
// This adapter is designed for the Apaleo sandbox environment.

const https = require('https');

class ApaleoAdapter {
  constructor({ clientId, clientSecret, propertyId, environment = 'sandbox' }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.propertyId = propertyId;
    this.baseUrl = environment === 'production'
      ? 'api.apaleo.com'
      : 'api.apaleo.com'; // Apaleo uses same URL, sandbox is per-account
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  // ─── AUTH ────────────────────────────────────────────────────────

  async authenticate() {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret
    }).toString();

    const response = await this._request({
      hostname: 'identity.apaleo.com',
      path: '/connect/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, body);

    this.accessToken = response.access_token;
    this.tokenExpiry = Date.now() + (response.expires_in * 1000) - 60000; // 1 min buffer
    return this.accessToken;
  }

  // ─── AVAILABILITY ──────────────────────────────────────────────

  async getAvailability(checkIn, checkOut, adults = 2) {
    await this.authenticate();

    const params = new URLSearchParams({
      propertyId: this.propertyId,
      from: checkIn,
      to: checkOut,
      adults: adults.toString()
    });

    return this._apiGet(`/availability/v1/properties/${this.propertyId}?${params}`);
  }

  // ─── RATE PLANS ────────────────────────────────────────────────

  async getRatePlans() {
    await this.authenticate();
    return this._apiGet(`/rateplan/v1/rate-plans?propertyId=${this.propertyId}`);
  }

  // ─── RESERVATIONS ──────────────────────────────────────────────

  async createBooking({ roomType, checkIn, checkOut, guestName, adults = 2 }) {
    await this.authenticate();

    const body = {
      propertyId: this.propertyId,
      arrival: checkIn,
      departure: checkOut,
      adults,
      primaryGuest: {
        firstName: guestName.split(' ')[0] || 'Guest',
        lastName: guestName.split(' ').slice(1).join(' ') || 'Unknown'
      },
      unitGroup: { id: roomType },
      channelCode: 'Direct',
      guaranteeType: 'CreditCard'
    };

    return this._apiPost('/booking/v1/reservations', body);
  }

  async getReservation(reservationId) {
    await this.authenticate();
    return this._apiGet(`/booking/v1/reservations/${reservationId}`);
  }

  async modifyBooking(reservationId, updates) {
    await this.authenticate();
    return this._apiPatch(`/booking/v1/reservations/${reservationId}`, updates);
  }

  async cancelBooking(reservationId, reason) {
    await this.authenticate();
    return this._apiPatch(`/booking/v1/reservations/${reservationId}`, {
      status: 'Canceled',
      comment: reason
    });
  }

  // ─── PROPERTY INFO ─────────────────────────────────────────────

  async getProperty() {
    await this.authenticate();
    return this._apiGet(`/inventory/v1/properties/${this.propertyId}`);
  }

  async getUnitGroups() {
    await this.authenticate();
    return this._apiGet(`/inventory/v1/unit-groups?propertyId=${this.propertyId}`);
  }

  // ─── HTTP HELPERS ──────────────────────────────────────────────

  async _apiGet(path) {
    return this._request({
      hostname: this.baseUrl,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json'
      }
    });
  }

  async _apiPost(path, body) {
    const bodyStr = JSON.stringify(body);
    return this._request({
      hostname: this.baseUrl,
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'Accept': 'application/json'
      }
    }, bodyStr);
  }

  async _apiPatch(path, body) {
    const bodyStr = JSON.stringify(body);
    return this._request({
      hostname: this.baseUrl,
      path,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'Accept': 'application/json'
      }
    }, bodyStr);
  }

  _request(options, body = null) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) return resolve({});
            const data = JSON.parse(raw);
            if (res.statusCode >= 400) {
              return reject(new Error(`Apaleo API error ${res.statusCode}: ${JSON.stringify(data)}`));
            }
            resolve(data);
          } catch (e) {
            reject(new Error('Apaleo parse error: ' + e.message));
          }
        });
      });

      req.on('error', e => reject(new Error('Apaleo connection error: ' + e.message)));
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Apaleo timeout')); });

      if (body) req.write(body);
      req.end();
    });
  }
}

module.exports = { ApaleoAdapter };
