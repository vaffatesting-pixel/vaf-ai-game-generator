// ─── VAF AI Game Generator — Generation Engine ───────────────
// Uses Node.js native https module — works on all Node versions & Windows

const https = require('https');

const ANTHROPIC_HOST = 'api.anthropic.com';
const ANTHROPIC_PATH = '/v1/messages';
const MODEL = 'claude-opus-4-5';

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

// ─── PROMPTS ──────────────────────────────────────────────────
function buildSystemPrompt(gameType) {
  const config = GAME_TYPE_CONFIGS[gameType] || GAME_TYPE_CONFIGS.arcade;
  return `You are VAF AI Game Generator — a world-class AI game development engine.
Your sole task is to generate complete, fully playable HTML5 games as a single self-contained HTML file.

GAME TYPE: ${gameType.toUpperCase()}
TYPE DESCRIPTION: ${config.description}
REQUIRED MECHANICS: ${config.mechanics}

STRICT REQUIREMENTS:
1. Output ONLY raw HTML — no markdown, no code blocks, no explanations.
2. The entire game must be in one single HTML file.
3. Use only vanilla JavaScript and inline CSS — no external dependencies.
4. The game must be immediately playable in a browser.
5. Include title, instructions, score display, and start/restart logic.
6. Game area must be responsive and centered.
7. Use a dark, professional visual style (dark background, vivid accent colors).
8. Include a small "Made with VAF AI Game Generator" footer credit.
9. The game must have a defined win condition or end state.
10. Code must be clean, commented, and production-quality.

DO NOT output anything except the complete HTML file starting with <!DOCTYPE html>.`;
}

function buildUserPrompt({ concept, gameType, audience, theme, mechanics, extras }) {
  return `Generate a complete playable HTML5 ${gameType} game based on this concept:

GAME CONCEPT: ${concept}
TARGET AUDIENCE: ${audience || 'General audience'}
VISUAL THEME: ${theme || 'Dark professional, modern'}
SPECIFIC MECHANICS: ${mechanics || 'Standard for this game type'}
EXTRA REQUIREMENTS: ${extras || 'None'}

Output ONLY the complete HTML file. Nothing else.`;
}

function cleanHtmlOutput(raw) {
  let c = raw.trim();
  c = c.replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  return c.trim();
}

// ─── GENERATE ─────────────────────────────────────────────────
async function generateGame(params) {
  const { concept, gameType = 'arcade', audience, theme, mechanics, extras } = params;
  if (!concept || concept.trim().length < 10) throw new Error('Concept too short (min 10 chars).');

  const config = GAME_TYPE_CONFIGS[gameType] || GAME_TYPE_CONFIGS.arcade;
  console.log(`[VAF ENGINE] Generating ${gameType}: "${concept.substring(0, 50)}..."`);
  const t = Date.now();

  const result = await callClaude({
    system: buildSystemPrompt(gameType),
    userMessage: buildUserPrompt({ concept, gameType, audience, theme, mechanics, extras }),
    maxTokens: config.maxTokens
  });

  const elapsed = ((Date.now() - t) / 1000).toFixed(2);
  console.log(`[VAF ENGINE] Done in ${elapsed}s — ${result.outputTokens} tokens`);

  const html = cleanHtmlOutput(result.text);
  if (!html.includes('<!DOCTYPE html>')) throw new Error('AI output is not valid HTML. Try again.');

  return { html, gameType, creditCost: config.creditCost, tokensUsed: result.outputTokens, generationTimeSeconds: parseFloat(elapsed), model: MODEL };
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
function getCreditCost(gameType) { return GAME_TYPE_CONFIGS[gameType]?.creditCost || 10; }
function getAllGameTypes() {
  return Object.entries(GAME_TYPE_CONFIGS).map(([type, cfg]) => ({ type, creditCost: cfg.creditCost, description: cfg.description }));
}

module.exports = { generateGame, refineGame, getCreditCost, getAllGameTypes };
