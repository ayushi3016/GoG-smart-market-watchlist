const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'gog_watchlist',
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres error on idle client', err);
});

// Schema is deliberately normalized into 4 tables, one per concern, which is
// the direct Postgres equivalent of the JSON-file store's shape from v1 —
// this was the migration path documented in the original README, now built.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_checkpoint_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchlist_items (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  alert_threshold NUMERIC,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, symbol)
);

CREATE TABLE IF NOT EXISTS snapshots (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  price NUMERIC NOT NULL,
  prev_close NUMERIC,
  volume BIGINT,
  avg_volume BIGINT,
  day_high NUMERIC,
  day_low NUMERIC,
  week52_high NUMERIC,
  week52_low NUMERIC,
  volatility NUMERIC,
  alert_threshold NUMERIC,
  as_of TIMESTAMPTZ,
  PRIMARY KEY (user_id, symbol)
);

-- Indexes for the two access patterns that matter as watchlists/users grow:
-- "give me this user's whole watchlist" and "give me this user's snapshots".
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist_items(user_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_user ON snapshots(user_id);
`;

async function initSchema() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;'); // for gen_random_uuid()
  await pool.query(SCHEMA);
  // Lightweight migration for databases created before the `name` column existed.
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;');
}

module.exports = { pool, initSchema };
