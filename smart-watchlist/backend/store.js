const { pool } = require('./db');

async function getWatchlist(userId) {
  const res = await pool.query(
    'SELECT symbol FROM watchlist_items WHERE user_id = $1 ORDER BY added_at',
    [userId]
  );
  return res.rows.map(r => r.symbol);
}

async function addToWatchlist(userId, symbol, alertThreshold = null) {
  await pool.query(
    `INSERT INTO watchlist_items (user_id, symbol, alert_threshold)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, symbol) DO NOTHING`,
    [userId, symbol, alertThreshold]
  );
  return getWatchlist(userId);
}

async function removeFromWatchlist(userId, symbol) {
  await pool.query('DELETE FROM watchlist_items WHERE user_id = $1 AND symbol = $2', [userId, symbol]);
  await pool.query('DELETE FROM snapshots WHERE user_id = $1 AND symbol = $2', [userId, symbol]);
  return getWatchlist(userId);
}

function rowToSnapshot(row) {
  if (!row) return null;
  return {
    price: Number(row.price),
    prevClose: row.prev_close != null ? Number(row.prev_close) : undefined,
    volume: row.volume != null ? Number(row.volume) : undefined,
    avgVolume: row.avg_volume != null ? Number(row.avg_volume) : undefined,
    dayHigh: row.day_high != null ? Number(row.day_high) : undefined,
    dayLow: row.day_low != null ? Number(row.day_low) : undefined,
    week52High: row.week52_high != null ? Number(row.week52_high) : undefined,
    week52Low: row.week52_low != null ? Number(row.week52_low) : undefined,
    volatility: row.volatility != null ? Number(row.volatility) : undefined,
    alertThreshold: row.alert_threshold != null ? Number(row.alert_threshold) : null,
    asOf: row.as_of ? new Date(row.as_of).getTime() : undefined,
  };
}

async function getSnapshot(userId, symbol) {
  const res = await pool.query(
    'SELECT * FROM snapshots WHERE user_id = $1 AND symbol = $2',
    [userId, symbol]
  );
  return rowToSnapshot(res.rows[0]);
}

async function setSnapshot(userId, symbol, snap) {
  await pool.query(
    `INSERT INTO snapshots
       (user_id, symbol, price, prev_close, volume, avg_volume, day_high, day_low,
        week52_high, week52_low, volatility, alert_threshold, as_of)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, to_timestamp($13 / 1000.0))
     ON CONFLICT (user_id, symbol) DO UPDATE SET
       price = EXCLUDED.price, prev_close = EXCLUDED.prev_close, volume = EXCLUDED.volume,
       avg_volume = EXCLUDED.avg_volume, day_high = EXCLUDED.day_high, day_low = EXCLUDED.day_low,
       week52_high = EXCLUDED.week52_high, week52_low = EXCLUDED.week52_low,
       volatility = EXCLUDED.volatility, alert_threshold = EXCLUDED.alert_threshold, as_of = EXCLUDED.as_of`,
    [
      userId, symbol, snap.price, snap.prevClose ?? null, snap.volume ?? null, snap.avgVolume ?? null,
      snap.dayHigh ?? null, snap.dayLow ?? null, snap.week52High ?? null, snap.week52Low ?? null,
      snap.volatility ?? null, snap.alertThreshold ?? null, snap.asOf ?? Date.now(),
    ]
  );
}

async function setSnapshots(userId, symbolSnapMap) {
  // Small watchlists (this app's realistic scale) don't need a bulk-insert
  // optimization; sequential upserts keep this readable. Noted in the
  // scaling section of the README as the first thing to batch if it matters.
  for (const [symbol, snap] of Object.entries(symbolSnapMap)) {
    await setSnapshot(userId, symbol, snap);
  }
}

async function setAlertThreshold(userId, symbol, threshold) {
  await pool.query(
    'UPDATE watchlist_items SET alert_threshold = $3 WHERE user_id = $1 AND symbol = $2',
    [userId, symbol, threshold]
  );
  await pool.query(
    'UPDATE snapshots SET alert_threshold = $3 WHERE user_id = $1 AND symbol = $2',
    [userId, symbol, threshold]
  );
}

async function getCheckpointTime(userId) {
  const res = await pool.query('SELECT last_checkpoint_at FROM users WHERE id = $1', [userId]);
  return res.rows[0] ? new Date(res.rows[0].last_checkpoint_at).getTime() : Date.now();
}

async function setCheckpointTime(userId, ts) {
  await pool.query('UPDATE users SET last_checkpoint_at = to_timestamp($2 / 1000.0) WHERE id = $1', [userId, ts]);
}

module.exports = {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getSnapshot,
  setSnapshot,
  setSnapshots,
  setAlertThreshold,
  getCheckpointTime,
  setCheckpointTime,
};
