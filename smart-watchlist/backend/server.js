require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');

const { MarketEngine } = require('./marketEngine');
const store = require('./store');
const { computeChange } = require('./changeDetector');
const { explainStock, chatAboutStock, aiEnabled } = require('./ai');
const { initSchema } = require('./db');
const { signup, login, getUser, signToken, verifyToken, requireAuth } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());

const engine = new MarketEngine();
engine.start();

const { createRateLimiter } = require('./rateLimiter');
const authLimiter = createRateLimiter({ windowMs: 60_000, max: 10 }); // 10 attempts/min per IP

// --- helpers -------------------------------------------------------------

async function buildWatchlistPayload(userId) {
  const symbols = await store.getWatchlist(userId);
  const checkpointAt = await store.getCheckpointTime(userId);
  const hoursSinceCheckpoint = (Date.now() - checkpointAt) / 3_600_000;
  // Read alert thresholds from watchlist_items (the real source of truth,
  // updated instantly) instead of snapshots (only updated on checkpoint).
  const alerts = await store.getWatchlistAlerts(userId);

  const items = [];
  for (const symbol of symbols) {
    const current = engine.getSnapshot(symbol);
    if (!current) continue;
    const lastSnap = await store.getSnapshot(userId, symbol);
    const alertThreshold = alerts[symbol] ?? null;
    const change = computeChange(current, lastSnap, alertThreshold, hoursSinceCheckpoint);
    items.push({ ...current, alertThreshold, change });
  }
  return items;
}

// --- Auth ------------------------------------------------------------------

app.post('/api/auth/signup', authLimiter, async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Email and a password of at least 6 characters are required' });
  }
  try {
    const userId = await signup(email.toLowerCase().trim(), password, name?.trim());
    const token = signToken(userId);
    res.json({ token, userId });
  } catch (err) {
    if (err.code === 'EMAIL_TAKEN') return res.status(409).json({ error: err.message });
    console.error('signup error', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});
 
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const userId = await login(email.toLowerCase().trim(), password);
    if (!userId) return res.status(401).json({ error: 'Invalid email or password' });
    const token = signToken(userId);
    res.json({ token, userId });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/config', (req, res) => {
  res.json({ aiEnabled, appName: 'GoG' });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await getUser(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ email: user.email, name: user.name });
});

// Market-wide movers (not limited to the user's watchlist) — powers the
// header ticker marquee. Computed directly from the simulated engine's
// current state, no auth-scoped data involved.
app.get('/api/market/movers', requireAuth, (req, res) => {
  const movers = engine.getAll()
    .map(s => ({
      symbol: s.symbol,
      name: s.name,
      pctChange: Number((((s.price - s.prevClose) / s.prevClose) * 100).toFixed(2)),
    }))
    .sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange));
  res.json(movers);
});

// --- Watchlist (all routes below require a valid JWT) -----------------------

app.get('/api/symbols', requireAuth, (req, res) => {
  res.json(engine.getAllSymbols());
});

app.get('/api/watchlist', requireAuth, async (req, res) => {
  res.json(await buildWatchlistPayload(req.userId));
});

app.post('/api/watchlist', requireAuth, async (req, res) => {
  const { symbol, alertThreshold } = req.body;
  if (!symbol || !engine.getSnapshot(symbol)) {
    return res.status(404).json({ error: 'Unknown symbol' });
  }
  await store.addToWatchlist(req.userId, symbol, alertThreshold ?? null);
  if (alertThreshold != null) {
    const current = engine.getSnapshot(symbol);
    await store.setSnapshot(req.userId, symbol, { ...current, alertThreshold });
  }
  res.json(await buildWatchlistPayload(req.userId));
});

app.delete('/api/watchlist/:symbol', requireAuth, async (req, res) => {
  await store.removeFromWatchlist(req.userId, req.params.symbol);
  res.json(await buildWatchlistPayload(req.userId));
});

// Called when the user has "seen" their watchlist — snapshots current state
// as the new baseline, which is what makes "what changed since last time"
// possible on the next visit.
app.post('/api/watchlist/checkpoint', requireAuth, async (req, res) => {
  const symbols = await store.getWatchlist(req.userId);
  const snaps = {};
  for (const symbol of symbols) {
    const current = engine.getSnapshot(symbol);
    if (!current) continue;
    const prev = await store.getSnapshot(req.userId, symbol);
    snaps[symbol] = { ...current, alertThreshold: prev?.alertThreshold ?? null };
  }
  await store.setSnapshots(req.userId, snaps);
  await store.setCheckpointTime(req.userId, Date.now());
  res.json({ ok: true, checkpointedAt: Date.now() });
});

app.post('/api/watchlist/:symbol/alert', requireAuth, async (req, res) => {
  const { threshold } = req.body;
  await store.setAlertThreshold(req.userId, req.params.symbol, threshold);
  res.json({ ok: true });
});

app.post('/api/watchlist/:symbol/explain', requireAuth, async (req, res) => {
  const symbol = req.params.symbol;
  const current = engine.getSnapshot(symbol);
  if (!current) return res.status(404).json({ error: 'Unknown symbol' });

  const lastSnap = await store.getSnapshot(req.userId, symbol);
  const alertThreshold = await store.getAlertThreshold(req.userId, symbol);
  const checkpointAt = await store.getCheckpointTime(req.userId);
  const hoursSinceCheckpoint = (Date.now() - checkpointAt) / 3_600_000;
  const change = computeChange(current, lastSnap, alertThreshold, hoursSinceCheckpoint);
  const history = engine.getHistory(symbol, 10);

  try {
    res.json(await explainStock({ current, change, history }));
  } catch (err) {
    console.error('explain error', err.message);
    res.status(500).json({ error: 'AI explanation failed', detail: err.message });
  }
});

app.post('/api/watchlist/:symbol/chat', requireAuth, async (req, res) => {
  const symbol = req.params.symbol;
  const current = engine.getSnapshot(symbol);
  if (!current) return res.status(404).json({ error: 'Unknown symbol' });

  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const lastSnap = await store.getSnapshot(req.userId, symbol);
  const alertThreshold = await store.getAlertThreshold(req.userId, symbol);
  const checkpointAt = await store.getCheckpointTime(req.userId);
  const hoursSinceCheckpoint = (Date.now() - checkpointAt) / 3_600_000;
  const change = computeChange(current, lastSnap, alertThreshold, hoursSinceCheckpoint);
  const history = engine.getHistory(symbol, 10);

  try {
    res.json(await chatAboutStock({ current, change, history, messages }));
  } catch (err) {
    console.error('chat error', err.message);
    res.status(500).json({ error: 'AI chat failed', detail: err.message });
  }
});

// --- WebSocket: live tick push, filtered per-connection to that user's watchlist ---

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Map(); // ws -> userId

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  const userId = token && verifyToken(token);
  if (!userId) {
    ws.close(4001, 'Unauthorized');
    return;
  }
  clients.set(ws, userId);
  ws.on('close', () => clients.delete(ws));
});

// Iterate with for-of (not Map.forEach) so each client's async DB reads are
// properly awaited and one client's failure can't affect delivery to others.

engine.on('tick', (tick) => {
  (async () => {
    for (const [ws, userId] of clients) {
      if (ws.readyState !== 1) continue;
      try {
        const watchlist = await store.getWatchlist(userId);
        if (!watchlist.includes(tick.symbol)) continue;

        const lastSnap = await store.getSnapshot(userId, tick.symbol);
        const alertThreshold = await store.getAlertThreshold(userId, tick.symbol);
        const checkpointAt = await store.getCheckpointTime(userId);
        const hoursSinceCheckpoint = (Date.now() - checkpointAt) / 3_600_000;
        const change = computeChange(tick, lastSnap, alertThreshold, hoursSinceCheckpoint);

        ws.send(JSON.stringify({ type: 'tick', data: { ...tick, change } }));
      } catch (err) {
        // Isolated per-client — a bad read for one user must never break
        // delivery to everyone else, and must never throw inside the
        // event handler (which has no caller to catch it).
        console.error(`Tick delivery failed for user ${userId}, symbol ${tick.symbol}:`, err.message);
      }
    }
  })();
});

const PORT = process.env.PORT || 4000;

initSchema()
  .then(() => {
    server.listen(PORT, () => console.log(`GoG API listening on :${PORT} (Postgres connected)`));
  })
  .catch((err) => {
    console.error('Failed to initialize database schema. Is Postgres running and DATABASE_URL/PG* env vars correct?');
    console.error(err.message);
    process.exit(1);
  });