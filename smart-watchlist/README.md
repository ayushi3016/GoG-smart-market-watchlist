# GoG — Smart Market Watchlist

A watchlist that tells you what changed since you last looked, and why it matters, instead of just showing prices.

**Live app:** https://go-g-smart-market-watchlist.vercel.app/

**API:** https://gog-smart-market-watchlist.onrender.com

Note: the backend is on Render's free tier, which spins down after inactivity. The first request after a period of idle time can take 30–60 seconds to respond while it wakes up.

## Setup

### 1. Postgres

```bash
createdb gog_watchlist
```

Adjust the user/password below to match your local Postgres setup.

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in Postgres credentials, JWT_SECRET, and (optionally) GROQ_API_KEY
node server.js
```

Tables are created automatically on first run (`initSchema()`).
API runs on `http://localhost:4000`, WebSocket on `ws://localhost:4000/ws`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs on `http://localhost:5173`.

Sign up with any email and a password of 6+ characters, add a few symbols, and click "Checkpoint now" to see prices tick live. Logging out and back in (or opening on another device) confirms the watchlist and account are stored server-side in Postgres, not in the browser.

### Enabling AI explanations

Add `GROQ_API_KEY` to `backend/.env` — get a free key at [console.groq.com/keys](https://console.groq.com/keys). `ANTHROPIC_API_KEY` also works as a fallback if you'd rather use Claude; Groq is used first if both are set (see `backend/ai.js`).

Without either key, `/api/config` reports `aiEnabled: false`, the frontend shows a "template mode" badge, and explanations fall back to a deterministic template built from the same signals shown elsewhere in the UI. The AI panel is an enhancement, not a dependency — the app works fully without it.

## Design notes

**What counts as a meaningful change.** A flat percentage threshold doesn't work: a 1% move on a low-volatility stock is more surprising than a 1% move on a volatile one. `backend/changeDetector.js` scores each price change against the symbol's own volatility, recent volume, user-set alert thresholds, and trend reversals, and returns `null` when nothing meaningful happened. The UI stays quiet by default instead of highlighting every tick.

The threshold also scales with time: a move is compared against `volatility × √(hours since your last checkpoint)`, not raw volatility. This follows from how a random walk's expected drift grows with the square root of elapsed time — the longer you've been away, the bigger a move needs to be before it's actually surprising. See `changeDetector.js` for the calculation.

**State and the checkpoint model.** Watchlists and price baselines are stored server-side per user, not in the browser, so they follow you across devices. "Checkpoint" is a separate, explicit action that snapshots current prices as the new baseline — a page load alone doesn't do this, otherwise every visit would silently erase whatever you hadn't actually looked at yet.

**Staleness and conflicting data.** The market engine simulates realistic feed behavior: independent per-symbol tick intervals, occasional delayed ticks, and near-simultaneous conflicting reads. Every price carries an `asOf` timestamp. The UI marks a symbol stale if it hasn't ticked recently, and conflicts are resolved by last-write-wins on server time — never on a client-supplied timestamp — with the conflict shown rather than silently dropped.

**Why a simulated feed instead of a live market data API.** Free-tier market data APIs come with rate limits and occasional outages that could break a live demo, and they don't give any control over staleness, delay, or conflicting reads — the exact edge cases this problem asks for. A simulated feed, seeded with real large-cap symbols and realistic volatility profiles, makes those edge cases reproducible on demand instead of hoping they happen to occur during a demo.

**Scaling.** `marketEngine.js` publishes ticks through an event emitter, decoupling data ingestion from the API/WebSocket layer — this is a single-process stand-in for a pub/sub layer like Redis, which is the natural next step for running multiple backend instances. The Postgres schema (`users`, `watchlist_items`, `snapshots`) already reflects that separation of concerns; scaling out is a matter of adding pub/sub in front of it, not restructuring the data model. WebSocket fan-out is filtered per connection, so each client only receives ticks for symbols it's actually watching — bandwidth stays flat as watchlists grow rather than scaling with total users.

## Architecture

```
┌─────────────┐      REST (CRUD, checkpoint)      ┌──────────────┐
│   React SPA │ ─────────────────────────────────▶│ Express API  │
│  (frontend) │◀──────────── WebSocket (live ticks)│  (backend)   │
└─────────────┘                                     └──────┬───────┘
                                                            │
                                          ┌─────────────────┴────────────┐
                                          │      MarketEngine (sim)      │
                                          │  per-symbol tick loop, ─────►│ emits 'tick'
                                          │  staleness + delay/conflict  │
                                          └───────────────┬──────────────┘
                                                           │
                                                  ┌────────┴────────┐
                                                  │  ChangeDetector  │
                                                  │ (volatility-     │
                                                  │  normalized diff)│
                                                  └──────────────────┘
```

## Feature notes

- **52-week high/low proximity** is tracked per symbol by the market engine and factored into the significance score.
- **Tier system** (`stable` / `watch` / `critical`) replaces a flat highlight, with a summary bar ("🔴 2 Significant · 🟠 1 Watch · 🟢 4 Stable") at the top of the app.
- **AI explain and chat.** Each ticker has an "Explain this" button that opens a small chat panel. It explains price moves using only the app's own computed signals — price, volume, volatility, 52-week range — and says explicitly that it doesn't have access to real-world news if asked a causal "why" question. Runs on Groq (`openai/gpt-oss-120b`) by default, since Groq's free tier means the demo isn't gated on billing setup; falls back to Claude (`claude-sonnet-5`) if `ANTHROPIC_API_KEY` is set instead, and to a deterministic template if neither key is present.

## What I'd add with more time

- Redis for pub/sub across multiple backend instances
- A score breakdown UI (the backend already returns per-factor `factors[]` in `changeDetector.js`; it just needs a frontend panel)
- Winners/losers grouping in the since-last-visit digest
- Per-ticker sparklines (tick history is already collected via `engine.getHistory`)
- Configurable per-user significance thresholds (currently fixed defaults)
- Load-test numbers to back up the scaling story with real data
- Push notifications for alert crossings when the tab isn't open