require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const generateRoute = require('./routes/generate');
const creditsRoute  = require('./routes/credits');
const gamesRoute    = require('./routes/games');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ──────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Security headers — fully permissive for local dev
app.use((req, res, next) => {
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('X-Content-Type-Options');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Serve the main HTML from root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── DIRECT GENERATION ENDPOINT (bypasses route files) ───────
const httpsLib = require('https');
const { v4: uuidv4 } = require('uuid');
const { deductCredits, getUser } = require('./engine/credits');
const store = require('./engine/gameStore');

const FLAT_CREDIT_COST = 10; // single flat price — no more type selection

// Keywords that signal an over-ambitious concept → downscale automatically
const COMPLEX_KEYWORDS = ['gta','grand theft','pokemon','zelda','mario','minecraft','fortnite',
  'call of duty','battlefield','world of warcraft','mmorpg','open world','mondo aperto',
  'multiplayer online','real-time strategy','battle royale','massively','100 player',
  '3d engine','physics engine','procedural world'];

function isOverComplex(concept) {
  const lower = concept.toLowerCase();
  return COMPLEX_KEYWORDS.some(k => lower.includes(k));
}

function claudeRequest(apiKey, body, attempt = 1) {
  return new Promise((resolve, reject) => {
    // Fresh agent per ogni chiamata — nessun keepAlive che interferisce
    const agent = new httpsLib.Agent({ keepAlive: false });
    const buf = Buffer.from(JSON.stringify(body), 'utf8');

    const req = httpsLib.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      agent,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': buf.length,
        'connection': 'close'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode !== 200) return reject(new Error(data?.error?.message || 'API error ' + res.statusCode));
          resolve(data.content[0]?.text || '');
        } catch(e) { reject(new Error('Parse error: ' + e.message)); }
      });
    });

    req.on('error', e => {
      // Retry up to 3 times on socket hang-up / ECONNRESET
      if ((e.code === 'ECONNRESET' || e.message.includes('hang up')) && attempt < 3) {
        console.log(`[VAF] Socket reset — retry ${attempt + 1}/3...`);
        setTimeout(() => {
          claudeRequest(apiKey, body, attempt + 1).then(resolve).catch(reject);
        }, 2000 * attempt);
      } else {
        reject(new Error('HTTPS: ' + e.message));
      }
    });

    req.setTimeout(200000, () => { req.destroy(); reject(new Error('Timeout after 200s')); });
    req.write(buf);
    req.end();
  });
}

app.post('/api/generate', async (req, res) => {
  const { concept, audience, theme, extras } = req.body;
  const userId     = req.headers['x-user-id'] || 'demo-user';
  const creditCost = FLAT_CREDIT_COST;

  if (!concept || concept.trim().length < 10) return res.status(400).json({ error: 'Concept too short.' });

  try { const u = getUser(userId); if (u.credits < creditCost) return res.status(402).json({ error: 'Insufficient credits', required: creditCost, available: u.credits }); } catch(e) { return res.status(500).json({ error: e.message }); }

  // Detect over-complex concepts and add a downscale instruction
  const overComplex = isOverComplex(concept);
  const downscaleNote = overComplex
    ? `IMPORTANT: The user described a very ambitious game (like a AAA title). Do NOT attempt to recreate it fully. Instead, create a fun, PLAYABLE mini-game INSPIRED by the concept — a simplified version that works perfectly in a single HTML file. Prioritise playability over feature count.`
    : '';

  console.log(`[VAF] Generating: "${concept.substring(0,60)}"${overComplex?' [DOWNSCALED]':''}`);
  const t = Date.now();

  // Complex concepts that get downscaled still need more tokens since Claude explains more
  const maxTokens = overComplex ? 16000 : 10000;

  try {
    const html = await claudeRequest(process.env.ANTHROPIC_API_KEY, {
      model: 'claude-opus-4-5',
      max_tokens: maxTokens,
      system: `You generate complete playable HTML5 games as a single self-contained file. Output ONLY raw HTML starting with <!DOCTYPE html>. No markdown. No explanations. Dark professional style. Include title, score, instructions, restart. Small "Made with VAF AI Game Generator" footer. ${downscaleNote}`,
      messages: [{ role: 'user', content: `Create a fun playable HTML5 game based on this idea: ${concept}. Audience: ${audience||'general'}. Theme: ${theme||'dark professional'}. Extra: ${extras||'none'}. Output ONLY the complete HTML file, nothing else.` }]
    });

    const cleanHtml = html.trim().replace(/^```html\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/i,'').trim();
    if (!cleanHtml.includes('<!DOCTYPE html>')) return res.status(500).json({ error: 'Invalid HTML output. Try again.' });

    const elapsed = ((Date.now()-t)/1000).toFixed(2);
    const gameId = uuidv4();
    const creditResult = deductCredits(userId, creditCost, `Generated game`);
    store.saveGame({ id: gameId, userId, concept, html: cleanHtml, creditCost, downscaled: overComplex, createdAt: new Date().toISOString() });

    console.log(`[VAF] Done in ${elapsed}s`);
    res.json({ success: true, gameId, html: cleanHtml, creditCost, downscaled: overComplex, newCreditBalance: creditResult.newBalance, generationTimeSeconds: parseFloat(elapsed) });

  } catch(e) {
    console.error('[VAF ERROR]', e.message);
    res.status(500).json({ error: 'Generation failed.', details: e.message });
  }
});

// ─── API ROUTES ──────────────────────────────────────────────
app.use('/api/generate', generateRoute);
app.use('/api/credits',  creditsRoute);
app.use('/api/games',    gamesRoute);

// ─── HEALTH CHECK ────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    engine: 'VAF AI Game Generator',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ─── 404 ─────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── ERROR HANDLER ───────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[VAF ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// ─── START ───────────────────────────────────────────────────
const http = require('http');

// Do NOT set keepAlive on the global https agent — it interferes with long AI responses
// claudeAgent (above) handles Anthropic connections with keepAlive: false

const server = app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   VAF AI Game Generator — Running   ║
  ║   http://localhost:${PORT}              ║
  ╚══════════════════════════════════════╝
  `);
});

// Give Express 3 minutes to respond (AI generation can take up to 60s)
server.timeout = 180000;
server.keepAliveTimeout = 180000;
