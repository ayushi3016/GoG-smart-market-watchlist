const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const TOKEN_TTL = '30d';

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET).userId;
  } catch {
    return null;
  }
}

async function signup(email, password, name) {
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    const err = new Error('An account with this email already exists');
    err.code = 'EMAIL_TAKEN';
    throw err;
  }
  const hash = await bcrypt.hash(password, 10);
  const res = await pool.query(
    'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
    [email, hash, name || null]
  );
  return res.rows[0].id;
}

async function getUser(userId) {
  const res = await pool.query('SELECT id, email, name FROM users WHERE id = $1', [userId]);
  return res.rows[0] || null;
}

async function login(email, password) {
  const res = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
  if (res.rows.length === 0) return null;
  const match = await bcrypt.compare(password, res.rows[0].password_hash);
  return match ? res.rows[0].id : null;
}

// Express middleware: expects "Authorization: Bearer <token>", sets req.userId.
function requireAuth(req, res, next) {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const userId = token && verifyToken(token);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  req.userId = userId;
  next();
}

module.exports = { signup, login, getUser, signToken, verifyToken, requireAuth };
