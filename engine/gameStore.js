const fs   = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'games.json');

// ─── LOAD / SAVE ──────────────────────────────────────────────
function load() {
  if (!fs.existsSync(STORE_PATH)) {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify({ games: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

function save(db) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(db, null, 2));
}

// ─── OPERATIONS ───────────────────────────────────────────────
function saveGame(game) {
  const db = load();
  db.games[game.id] = game;
  save(db);
  return game;
}

function getGame(id) {
  const db = load();
  return db.games[id] || null;
}

function updateGame(id, updates) {
  const db = load();
  if (!db.games[id]) throw new Error('Game not found');
  db.games[id] = { ...db.games[id], ...updates };
  save(db);
  return db.games[id];
}

function deleteGame(id) {
  const db = load();
  delete db.games[id];
  save(db);
}

function getUserGames(userId) {
  const db = load();
  return Object.values(db.games)
    .filter(g => g.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getAllGames() {
  const db = load();
  return Object.values(db.games);
}

module.exports = { saveGame, getGame, updateGame, deleteGame, getUserGames, getAllGames };
