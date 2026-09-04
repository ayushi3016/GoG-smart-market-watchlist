# GoG — Smart Market Watchlist

A watchlist that doesn't just show prices — it tells you what actually
changed since you last looked, and why it matters.

## What's new: real auth + Postgres

The app now has real user accounts (signup/login, bcrypt-hashed passwords,
JWT auth) and a real Postgres backend instead of the original JSON file
store — this was always the documented migration path, now actually built.

**On UI:** this is an original design *inspired by* clean fintech app
conventions (minimal card layout, teal accent), not a clone of any real
company's proprietary screens — deliberately, since this hackathon is
judged by the company whose UI it would be cloning, and "build the version
you believe should exist" is the actual brief.

## Setup

### 1. Postgres
```bash
# create the database (adjust user/password to your local Postgres setup)
createdb gog_watchlist
```

### 2. Backend
```bash
cd backend
npm install
cp .env.example .env   # fill in your Postgres credentials + JWT_SECRET
node server.js
# Creates tables automatically on first run (initSchema()).
# API on http://localhost:4000, WebSocket on ws://localhost:4000/ws
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
# App on http://localhost:5173
```

Sign up with any email/password (6+ chars), add a few symbols, click
"Checkpoint now", then watch prices tick live. Log out and back in (or
open on another device) to confirm your watchlist and password are real —
they're in Postgres, not the browser.

### Enabling real AI explanations
Add `GROQ_API_KEY=gsk_...` to `backend/.env` (free key at
[console.groq.com/keys](https://console.groq.com/keys)). Without it,
`/api/config` reports `aiEnabled: false`, the frontend shows a "template
mode" badge, and explanations fall back to a deterministic template built
from the same signals — the feature degrades gracefully instead of
breaking the demo.

## Why this design

**"Meaningful change" isn't a flat percentage.** A 1% move on a low-volatility
stock is more significant than a 1% move on a volatile one. The change
detector (`backend/changeDetector.js`) scores changes using each symbol's own
volatility, unusual volume, user-set alert crossings, and trend reversals —
then returns `null` when nothing meaningful happened, so the UI stays quiet
by default instead of drowning you in noise.

**State persists server-side per device/user ID**, not in the browser, so the
same watchlist and "last seen" baseline follow you across devices. The
"checkpoint" action is what snapshots current prices as the new baseline for
future diffs — this is deliberately a separate step from just *viewing* the
page, because otherwise every page load would silently erase what you hadn't
actually processed yet.

**Stale, delayed and conflicting data are handled explicitly, not hidden.**
The market engine simulates real feed behavior: independent per-symbol tick
intervals, deliberately delayed ticks, occasional conflicting near-simultaneous
reads. Every price carries an `asOf` timestamp; the UI marks a symbol stale
if it hasn't ticked recently, and conflicting reads are resolved by
last-write-wins on server time (never client-supplied timestamps) with the
conflict surfaced rather than silently discarded.

**Why a simulated feed instead of a real market data API:** free-tier stock
APIs have rate limits and outages that would risk breaking a live demo, and
they give no control over the very edge cases (staleness, delay, conflicts)
the problem statement asks you to handle. Simulating the feed — seeded with
real large-cap symbols and volatility profiles — makes those edge cases
reliably demonstrable on demand.

**Scaling story:** ingestion (`marketEngine.js`) is decoupled from the API/WS
layer via an event emitter, which is a stand-in for pub/sub (Redis in
production). The JSON file store (`store.js`) is deliberately swappable —
its shape (users / watchlists / snapshots as separate maps keyed by user ID)
maps directly onto Postgres tables (`users`, `watchlist_items`,
`snapshots`) if this needed to run across multiple instances. WebSocket
fan-out is filtered per-connection so each client only receives ticks for
symbols it's actually watching, keeping bandwidth flat as watchlists grow.

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

## What's new since v1

- **Time-adjusted significance.** A move is compared against `volatility × √(hours since your last checkpoint)`, not raw volatility — the statistically grounded version of "the bar for what's surprising should depend on how long you've been away," based on how a random walk's expected drift scales with time (see `changeDetector.js` for the reasoning).
- **52-week high/low proximity** as an additional signal — the market engine now tracks and expands a simulated 52-week band per symbol.
- **Tier system** (`stable` / `watch` / `critical`) replacing the old flat highlight, with a summary bar ("🔴 2 Significant · 🟠 1 Watch · 🟢 4 Stable") shown at the top of the app.
- **AI explain + chat, with a hard fallback.** Each ticker has an "Explain this" button that opens a small chat panel. It explains the move using only this app's own computed signals (price/volume/volatility/52-week data) — it does *not* know real-world news, and says so explicitly if asked "why" in the causal sense. Runs on Groq's free-tier inference (`llama-3.3-70b-versatile`) rather than a paid API, specifically so the demo isn't blocked by billing/credits. If `GROQ_API_KEY` isn't set, it degrades to a deterministic template built from the same `reasons` array already shown elsewhere in the UI, so the feature never breaks the demo — it's real graceful degradation, not just a talking point.

### Enabling real AI explanations (superseded — see setup section above; kept here as it documents the reasoning)
The v1 approach used Anthropic's Claude API; it's since been swapped to Groq (`llama-3.3-70b-versatile`) specifically because Groq's free tier means the demo isn't blocked by billing setup — worth mentioning in Q&A as a deliberate "what's simple vs what needs to just work reliably" trade-off. Behavior is unchanged either way: without a key, `/api/config` reports `aiEnabled: false` and the frontend shows a "template mode" badge; with a key, the same UI gets real natural-language answers and follow-ups.

## What I'd add with more time
- Redis for pub/sub across multiple backend instances (Postgres + real auth are already in)
- Score breakdown UI (backend already returns per-factor `factors[]` — see `changeDetector.js` — just needs a frontend panel)
- "Smart catch-up" grouping (winners/losers) for the since-last-visit digest
- Price sparkline per ticker (tick history is already collected via `engine.getHistory`)
- Configurable per-user significance thresholds (currently tuned defaults)
- Load-test numbers for the "how does this scale" story
- Push notifications for alert crossings when the tab isn't open