const fs   = require('fs');
const path = require('path');

// ─── STORAGE ──────────────────────────────────────────────────
// Simple JSON file-based store — replace with a real DB later.
const DB_PATH = path.join(__dirname, '..', 'data', 'users.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ─── PLANS ───────────────────────────────────────────────────
const PLANS = {
  free: {
    name: 'Free',
    startingCredits: 20,
    description: 'Try VAF with 20 free credits'
  },
  starter: {
    name: 'Starter',
    startingCredits: 200,
    price: 19,
    description: 'Entry-level for creators and independents'
  },
  growth: {
    name: 'Growth',
    startingCredits: 750,
    price: 59,
    description: 'Expanded credits for studios and teams'
  },
  enterprise: {
    name: 'Enterprise',
    startingCredits: 5000,
    price: null,
    description: 'Custom allocation for organizations'
  }
};

// ─── GET OR CREATE USER ───────────────────────────────────────
function getUser(userId) {
  const db = loadDB();
  if (!db.users[userId]) {
    db.users[userId] = {
      id: userId,
      plan: 'free',
      credits: PLANS.free.startingCredits,
      gamesGenerated: 0,
      createdAt: new Date().toISOString(),
      transactions: []
    };
    saveDB(db);
  }
  return db.users[userId];
}

// ─── GET BALANCE ──────────────────────────────────────────────
function getBalance(userId) {
  const user = getUser(userId);
  return {
    userId,
    credits: user.credits,
    plan: user.plan,
    gamesGenerated: user.gamesGenerated
  };
}

// ─── DEDUCT CREDITS ───────────────────────────────────────────
function deductCredits(userId, amount, reason = 'Game generation') {
  const db   = loadDB();
  const user = getUser(userId);

  if (user.credits < amount) {
    throw new Error(`Insufficient credits. Required: ${amount}, Available: ${user.credits}`);
  }

  db.users[userId].credits -= amount;
  db.users[userId].gamesGenerated += 1;
  db.users[userId].transactions.push({
    type: 'debit',
    amount,
    reason,
    balanceAfter: db.users[userId].credits,
    timestamp: new Date().toISOString()
  });

  saveDB(db);
  return { success: true, creditsUsed: amount, newBalance: db.users[userId].credits };
}

// ─── ADD CREDITS ──────────────────────────────────────────────
function addCredits(userId, amount, reason = 'Credit purchase') {
  const db   = loadDB();
  const user = getUser(userId);

  db.users[userId].credits += amount;
  db.users[userId].transactions.push({
    type: 'credit',
    amount,
    reason,
    balanceAfter: db.users[userId].credits,
    timestamp: new Date().toISOString()
  });

  saveDB(db);
  return { success: true, creditsAdded: amount, newBalance: db.users[userId].credits };
}

// ─── CHECK CREDITS MIDDLEWARE ────────────────────────────────
function requireCredits(creditCost) {
  return (req, res, next) => {
    // For now, use a userId from header or default to 'demo-user'
    const userId = req.headers['x-user-id'] || 'demo-user';
    req.userId   = userId;

    try {
      const user = getUser(userId);
      if (user.credits < creditCost) {
        return res.status(402).json({
          error: 'Insufficient credits',
          required: creditCost,
          available: user.credits,
          message: 'Purchase more credits to continue generating games.'
        });
      }
      req.creditCost = creditCost;
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

// ─── GET TRANSACTION HISTORY ──────────────────────────────────
function getHistory(userId) {
  const user = getUser(userId);
  return {
    userId,
    plan: user.plan,
    credits: user.credits,
    gamesGenerated: user.gamesGenerated,
    transactions: user.transactions.slice(-20).reverse()
  };
}

module.exports = {
  getUser,
  getBalance,
  deductCredits,
  addCredits,
  requireCredits,
  getHistory,
  PLANS
};
