const { EventEmitter } = require('events');

// Seed symbols styled after real NSE large-caps, each with its own volatility
// profile so "meaningful change" can be relative, not a flat % for everyone.
const SEED_SYMBOLS = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', price: 2945.50, volatility: 0.006 },
  { symbol: 'TCS',      name: 'Tata Consultancy Services', price: 4120.10, volatility: 0.004 },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', price: 1685.30, volatility: 0.005 },
  { symbol: 'INFY',     name: 'Infosys', price: 1912.75, volatility: 0.007 },
  { symbol: 'ICICIBANK',name: 'ICICI Bank', price: 1245.60, volatility: 0.005 },
  { symbol: 'GROWW',    name: 'Groww Financial (mock)', price: 512.00, volatility: 0.02 },
  { symbol: 'TATAMOTORS',name:'Tata Motors', price: 987.40, volatility: 0.018 },
  { symbol: 'ZOMATO',   name: 'Zomato', price: 268.90, volatility: 0.025 },
  { symbol: 'ADANIENT', name: 'Adani Enterprises', price: 3120.00, volatility: 0.03 },
  { symbol: 'SUNPHARMA',name: 'Sun Pharma', price: 1755.20, volatility: 0.006 },
  { symbol: 'BAJFINANCE',name:'Bajaj Finance', price: 7210.00, volatility: 0.012 },
  { symbol: 'ITC',      name: 'ITC Ltd', price: 462.15, volatility: 0.004 },
];

/**
 * MarketEngine simulates a live tick feed.
 *
 * Design notes (this is the part meant to demonstrate handling of
 * stale / delayed / conflicting data, per the problem statement):
 *  - Each symbol ticks on its own independent interval (not a global tick),
 *    so symbols realistically go stale relative to each other.
 *  - A small fraction of ticks are deliberately delayed (queued, then
 *    delivered late) to simulate network/exchange lag.
 *  - Occasionally two ticks for the same symbol are generated close together
 *    with different values ("conflicting" reads) — resolved by
 *    last-write-wins on server timestamp, never client-supplied timestamps.
 *  - Every symbol's last-known-good state carries `asOf` so consumers
 *    (API + UI) can independently decide "is this stale for my purposes"
 *    rather than the engine deciding for everyone.
 */
class MarketEngine extends EventEmitter {
  constructor() {
    super();
    this.state = new Map();
    this._history = new Map(); // symbol -> capped array of {price, asOf}, used for AI context
    SEED_SYMBOLS.forEach(s => {
      // Seed a plausible 52-week band around the current price so the
      // "near 52-week high/low" signal has something real to compare against.
      const week52High = Number((s.price * (1 + (0.08 + Math.random() * 0.20))).toFixed(2));
      const week52Low = Number((s.price * (1 - (0.08 + Math.random() * 0.20))).toFixed(2));
      this.state.set(s.symbol, {
        symbol: s.symbol,
        name: s.name,
        price: s.price,
        prevClose: s.price,
        volatility: s.volatility,
        volume: Math.floor(50000 + Math.random() * 500000),
        avgVolume: 250000,
        dayHigh: s.price,
        dayLow: s.price,
        week52High,
        week52Low,
        asOf: Date.now(),
        stale: false,
      });
      this._history.set(s.symbol, [{ price: s.price, asOf: Date.now() }]);
    });
    this._timers = [];
  }

  start() {
    SEED_SYMBOLS.forEach(s => {
      const baseIntervalMs = 1500 + Math.random() * 2500;
      const tick = () => {
        this._generateTick(s.symbol);
        // jitter next interval per-symbol so feeds desync realistically
        const next = baseIntervalMs * (0.7 + Math.random() * 0.6);
        this._timers.push(setTimeout(tick, next));
      };
      this._timers.push(setTimeout(tick, Math.random() * 1000));
    });

    // periodically mark symbols with no recent tick as stale
    this._staleChecker = setInterval(() => this._checkStale(), 2000);
  }

  stop() {
    this._timers.forEach(clearTimeout);
    clearInterval(this._staleChecker);
  }

  _generateTick(symbol, delayed = false) {
    const cur = this.state.get(symbol);
    if (!cur) return;

    // ~6% chance this tick is delayed in transit; queue it and stop —
    // the delayed delivery is what actually mutates state, later.
    if (!delayed && Math.random() < 0.06) {
      const delayMs = 3000 + Math.random() * 5000;
      setTimeout(() => this._generateTick(symbol, true), delayMs);
      return;
    }

    const drift = (Math.random() - 0.5) * 2 * cur.volatility;
    const newPrice = Math.max(0.5, cur.price * (1 + drift));
    const volumeDelta = Math.floor(Math.random() * 8000);

    const updated = {
      ...cur,
      price: Number(newPrice.toFixed(2)),
      volume: cur.volume + volumeDelta,
      dayHigh: Math.max(cur.dayHigh, newPrice),
      dayLow: Math.min(cur.dayLow, newPrice),
      week52High: Math.max(cur.week52High, newPrice),
      week52Low: Math.min(cur.week52Low, newPrice),
      asOf: Date.now(),
      stale: false,
      lastTickDelayed: delayed,
    };

    // ~3% chance of a near-simultaneous conflicting second source;
    // resolve by latest server timestamp (this write just wins naturally
    // because it's applied last), but we log it so it's inspectable.
    if (Math.random() < 0.03) {
      const conflictPrice = Number((newPrice * (1 + (Math.random() - 0.5) * 0.01)).toFixed(2));
      updated.conflictNote = `secondary feed briefly reported ${conflictPrice}`;
    }

    this.state.set(symbol, updated);

    const hist = this._history.get(symbol) || [];
    hist.push({ price: updated.price, asOf: updated.asOf });
    if (hist.length > 30) hist.shift();
    this._history.set(symbol, hist);

    this.emit('tick', updated);
  }

  getHistory(symbol, n = 10) {
    const hist = this._history.get(symbol) || [];
    return hist.slice(-n);
  }

  _checkStale() {
    const now = Date.now();
    this.state.forEach((v, symbol) => {
      const isStale = now - v.asOf > 8000;
      if (isStale !== v.stale) {
        const updated = { ...v, stale: isStale };
        this.state.set(symbol, updated);
        this.emit('tick', updated);
      }
    });
  }

  getSnapshot(symbol) {
    return this.state.get(symbol) || null;
  }

  getAllSymbols() {
    return Array.from(this.state.values()).map(s => ({ symbol: s.symbol, name: s.name }));
  }

  getAll() {
    return Array.from(this.state.values());
  }
}

module.exports = { MarketEngine, SEED_SYMBOLS };
