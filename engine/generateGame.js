// ─── VAF AI Game Generator — Generation Engine ───────────────
// Uses Node.js native https module — works on all Node versions & Windows

const https = require('https');

const ANTHROPIC_HOST = 'api.anthropic.com';
const ANTHROPIC_PATH = '/v1/messages';
const MODEL = 'claude-opus-4-5';

// GENERATION TIERS
const TIERS = {
  quick:    { label: 'Quick Game',    creditCost: 5,  maxTokens: 6000,  emoji: '⚡', description: 'Fast generation, simple graphics',                     badge: 'QUICK'     },
  enhanced: { label: 'Enhanced Game', creditCost: 20, maxTokens: 14000, emoji: '🎮', description: 'Polished graphics, animations, sound effects, full UX', badge: 'ENHANCED'  },
  full:     { label: 'Full Game',     creditCost: 60, maxTokens: 40000, emoji: '🚀', description: 'Shop, levels, leaderboard, sharing, ads',               badge: 'FULL GAME' }
};

// ─── GAME TYPE CONFIGS ────────────────────────────────────────
const GAME_TYPE_CONFIGS = {
  arcade:         { creditCost: 10, maxTokens:  9000, description: 'Fast-paced action game with score and lives system', mechanics: 'player movement, collision detection, enemy AI, scoring, lives' },
  simulator:      { creditCost: 25, maxTokens: 16000, description: 'Realistic simulation with complex state management', mechanics: 'scenario phases, decision trees, scoring rubrics, progress tracking, knowledge checkpoints' },
  puzzle:         { creditCost: 12, maxTokens: 10000, description: 'Logic-based challenge with progressive difficulty', mechanics: 'grid/tile mechanics, move validation, win condition detection, hints system' },
  quiz:           { creditCost: 8,  maxTokens:  8000, description: 'Knowledge-based game with questions and feedback', mechanics: 'question bank, timer, scoring, feedback system, difficulty levels' },
  'serious-game': { creditCost: 30, maxTokens: 16000, description: 'Educational/training game with learning objectives', mechanics: 'branching scenarios, performance metrics, compliance tracking, certification logic' },
  marketing:      { creditCost: 15, maxTokens: 10000, description: 'Branded interactive experience with lead capture', mechanics: 'brand integration, engagement hooks, reward triggers, share mechanics' },
  web3:           { creditCost: 20, maxTokens: 12000, description: 'Token-integrated competitive mini-game', mechanics: 'wallet display, token rewards, on-chain leaderboard hooks, NFT gate logic' }
};

// ─── HTTPS REQUEST TO ANTHROPIC ───────────────────────────────
function callClaude({ system, userMessage, maxTokens = 8192 }) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return reject(new Error('ANTHROPIC_API_KEY not set.'));

    const bodyObj = {
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }]
    };
    const bodyStr = JSON.stringify(bodyObj);

    const bodyBuffer = Buffer.from(bodyStr, 'utf8');

    const options = {
      hostname: ANTHROPIC_HOST,
      path: ANTHROPIC_PATH,
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': bodyBuffer.length
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const data = JSON.parse(raw);
          if (res.statusCode !== 200) {
            return reject(new Error(data?.error?.message || `HTTP ${res.statusCode}`));
          }
          resolve({
            text: data.content[0]?.text || '',
            inputTokens: data.usage?.input_tokens || 0,
            outputTokens: data.usage?.output_tokens || 0
          });
        } catch (e) {
          reject(new Error('Failed to parse response: ' + e.message));
        }
      });
    });

    req.on('error', e => reject(new Error('HTTPS error: ' + e.message)));
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('Timed out after 180s')); });
    req.write(bodyBuffer);
    req.end();
  });
}

// ─── PROMPTS PER TIER ─────────────────────────────────────────
function buildSystemPrompt(gameType, tier) {
  const config = GAME_TYPE_CONFIGS[gameType] || GAME_TYPE_CONFIGS.arcade;

  if (tier === 'enhanced') {
    return `You are VAF AI Game Generator ENHANCED — premium HTML5 game engine.
Generate a polished, visually impressive HTML5 ${gameType} game as a single self-contained HTML file.

GAME TYPE: ${gameType.toUpperCase()} — ${config.description}
MECHANICS: ${config.mechanics}

REQUIREMENTS:
1. Output ONLY raw HTML — no markdown, no code blocks.
2. Single file, vanilla JS + inline CSS. Zero external dependencies.
3. VISUAL EXCELLENCE:
   - Canvas 60fps with requestAnimationFrame
   - Rich gradients, glow effects, atmospheric depth
   - Particle systems: explosions, sparkles, trails
   - Screen shake and flash effects on all interactions
4. AUDIO: Web Audio API procedural sound effects (jump, hit, collect, game-over)
5. Animated title screen with glowing logo effect
6. Game over screen with score and high score stored in localStorage
7. Subtle "⚡ VAF AI Game Generator" badge bottom-right.

Start with <!DOCTYPE html>.`;
  }

  if (tier === 'full') {
    return `You are VAF AI Game Generator FULL — professional HTML5 game studio.
Generate a complete, shippable HTML5 ${gameType} game as a single self-contained HTML file.

GAME TYPE: ${gameType.toUpperCase()} — ${config.description}
MECHANICS: ${config.mechanics}

ALL MANDATORY FEATURES:
1. CORE GAMEPLAY: 3+ levels with transitions, score multipliers, combo system, HP bar, 2+ power-ups
2. VISUAL EXCELLENCE: Canvas 60fps, parallax layers, particles, level transitions, Google Fonts via @import
3. AUDIO: Web Audio music loop, SFX for all events, mute/unmute button
4. IN-GAME SHOP: coins earned in play, shop modal from pause+between levels, 4 upgrades, localStorage inventory
5. SOCIAL SHARING: Twitter share button (window.open intent), copy-to-clipboard score
6. AD SLOTS: <div id="ad-banner-top" style="display:none"></div> and <div id="ad-interstitial" style="display:none"></div>, plus window.VAF_SHOW_AD = function(){} hook
7. LEADERBOARD: top-10 localStorage leaderboard, name entry on new high score
8. PAUSE + SETTINGS: ESC/P pause overlay with menu, volume slider, difficulty selector
9. POLISH: animated main menu with particles, level-complete fireworks, achievement toasts, mobile+desktop, VAF badge bottom-right

OUTPUT: ONLY complete raw HTML starting with <!DOCTYPE html>. All inline. Single file.`;
  }

  // default: quick
  return `You are VAF AI Game Generator. Generate a complete playable HTML5 ${gameType} game as a single self-contained HTML file.

GAME TYPE: ${gameType.toUpperCase()} — ${config.description}
MECHANICS: ${config.mechanics}

REQUIREMENTS:
1. Output ONLY raw HTML — no markdown, no code blocks.
2. Single file, vanilla JS + inline CSS. No external dependencies.
3. Start screen, score display, win/lose condition, restart logic.
4. Dark background with colorful accents. Clean readable layout.
5. Small "Made with VAF AI" footer credit.

Start with <!DOCTYPE html>.`;
}

function buildUserPrompt({ concept, gameType, audience, theme, mechanics, extras, tier }) {
  const tierLabels = { quick: 'QUICK (functional, simple)', enhanced: 'ENHANCED (polished visuals, audio)', full: 'FULL GAME (shop, levels, leaderboard, sharing)' };
  return `Generate a ${tierLabels[tier] || tierLabels.quick} HTML5 ${gameType} game:

CONCEPT: ${concept}
AUDIENCE: ${audience || 'General'}
VISUAL THEME: ${theme || 'Dark professional, modern'}
CUSTOM MECHANICS: ${mechanics || 'Standard for this game type'}
EXTRAS: ${extras || 'None'}

Output ONLY the complete HTML file. Nothing else.`;
}

function cleanHtmlOutput(raw) {
  let c = raw.trim();
  c = c.replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  return c.trim();
}

// ─── GENERATE ─────────────────────────────────────────────────
async function generateGame(params) {
  const { concept, gameType = 'arcade', audience, theme, mechanics, extras, tier = 'quick' } = params;
  if (!concept || concept.trim().length < 10) throw new Error('Concept too short (min 10 chars).');

  const tierConfig = TIERS[tier] || TIERS.quick;
  console.log(`[VAF ENGINE] Generating [${tier.toUpperCase()}] ${gameType}: "${concept.substring(0, 50)}..."`);
  const t = Date.now();

  const result = await callClaude({
    system: buildSystemPrompt(gameType, tier),
    userMessage: buildUserPrompt({ concept, gameType, audience, theme, mechanics, extras, tier }),
    maxTokens: tierConfig.maxTokens
  });

  const elapsed = ((Date.now() - t) / 1000).toFixed(2);
  console.log(`[VAF ENGINE] Done in ${elapsed}s — ${result.outputTokens} tokens — Tier: ${tier}`);

  const html = cleanHtmlOutput(result.text);
  if (!html.includes('<!DOCTYPE html>')) throw new Error('AI output is not valid HTML. Try again.');

  return { html, gameType, tier, tierLabel: tierConfig.label, creditCost: tierConfig.creditCost, tokensUsed: result.outputTokens, generationTimeSeconds: parseFloat(elapsed), model: MODEL };
}

// ─── REFINE ───────────────────────────────────────────────────
async function refineGame({ currentHtml, refinementPrompt }) {
  if (!currentHtml || !refinementPrompt) throw new Error('HTML and refinement prompt required.');
  console.log(`[VAF ENGINE] Refining: "${refinementPrompt.substring(0, 50)}..."`);

  const result = await callClaude({
    system: `You are VAF AI Game Generator refining an existing HTML5 game.
Return ONLY the complete updated HTML file. No explanations. No markdown. Raw HTML only.`,
    userMessage: `CURRENT GAME HTML:\n\n${currentHtml}\n\n---\nAPPLY THIS CHANGE:\n${refinementPrompt}\n\nReturn ONLY the complete updated HTML.`
  });

  const html = cleanHtmlOutput(result.text);
  if (!html.includes('<!DOCTYPE html>')) throw new Error('Refinement output invalid. Try again.');
  return { html, creditCost: 3, tokensUsed: result.outputTokens };
}

// ─── HELPERS ──────────────────────────────────────────────────
function getCreditCost(gameType, tier = 'quick') { return (TIERS[tier] || TIERS.quick).creditCost; }
function getAllGameTypes() {
  return Object.entries(GAME_TYPE_CONFIGS).map(([type, cfg]) => ({ type, description: cfg.description }));
}
function getAllTiers() {
  return Object.entries(TIERS).map(([id, cfg]) => ({ id, label: cfg.label, creditCost: cfg.creditCost, emoji: cfg.emoji, description: cfg.description, badge: cfg.badge }));
}

module.exports = { generateGame, refineGame, getCreditCost, getAllGameTypes, getAllTiers, TIERS };
