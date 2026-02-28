# VAF AI Game Generator

**From Prompt to Playable — in Minutes.**

---

## SETUP IN 4 STEPS

### Step 1 — Install Node.js
If you don't have Node.js installed:
- Go to: https://nodejs.org
- Download the **LTS** version
- Install it (just click Next → Next → Finish)

To check it's installed, open a terminal and type:
```
node --version
```
You should see something like `v20.x.x`

---

### Step 2 — Get Your Claude API Key
1. Go to: https://console.anthropic.com/settings/api-keys
2. Sign up or log in
3. Click **"Create Key"**
4. Copy the key (starts with `sk-ant-...`)

---

### Step 3 — Add Your API Key
Open the file `.env` in this folder and replace:
```
ANTHROPIC_API_KEY=your_api_key_here
```
with your actual key:
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
```

---

### Step 4 — Install & Run

Open a terminal in this folder and run:

```bash
npm install
npm start
```

Then open your browser and go to:
```
http://localhost:3000
```

Click **"Open Studio"** in the nav bar and generate your first game.

---

## PROJECT STRUCTURE

```
vaf-ai-game-generator/
├── index.html          ← Frontend website + Studio UI
├── server.js           ← Express server entry point
├── package.json        ← Dependencies
├── .env                ← API keys and config
├── engine/
│   ├── generateGame.js ← Claude AI game generation engine
│   ├── credits.js      ← Credit system logic
│   └── gameStore.js    ← Local game storage
├── routes/
│   ├── generate.js     ← POST /api/generate
│   ├── credits.js      ← GET  /api/credits/balance
│   └── games.js        ← GET  /api/games/:id
└── data/               ← Auto-created: stores users and games
    ├── users.json
    └── games.json
```

---

## API ENDPOINTS

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | /api/health | Server health check |
| POST   | /api/generate | Generate a new game |
| POST   | /api/generate/refine | Refine an existing game |
| GET    | /api/generate/types | List game types and credit costs |
| GET    | /api/credits/balance | Get user credit balance |
| GET    | /api/credits/history | Get transaction history |
| POST   | /api/credits/add | Add credits (dev/test) |
| GET    | /api/games | List user's games |
| GET    | /api/games/:id | Get single game with HTML |
| GET    | /api/games/:id/preview | Preview game in browser |
| GET    | /api/games/:id/download | Download game as HTML file |

---

## CREDIT COSTS

| Game Type | Credits |
|-----------|---------|
| Quiz      | 8       |
| Arcade    | 10      |
| Puzzle    | 12      |
| Marketing | 15      |
| Web3      | 20      |
| Simulator | 25      |
| Serious Game | 30   |
| Refinement | 3      |

New demo users start with **20 free credits**.

To add more credits during development:
```bash
curl -X POST http://localhost:3000/api/credits/add \
  -H "Content-Type: application/json" \
  -H "x-user-id: demo-user" \
  -d '{"amount": 100, "reason": "Top up"}'
```

---

## NEXT STEPS (roadmap)

- [ ] Real user authentication (JWT or Supabase Auth)
- [ ] Stripe payment integration for credit purchases
- [ ] PostgreSQL / Supabase database (replace JSON files)
- [ ] Telegram Mini-App export pipeline
- [ ] Multi-user dashboard
- [ ] Game marketplace

---

© VAF AI Game Generator

