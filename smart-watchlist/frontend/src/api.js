const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const WS_BASE = BASE.replace(/^http/, 'ws');

function getToken() {
  return localStorage.getItem('gog_token');
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

export function isLoggedIn() {
  return !!getToken();
}

export function logout() {
  localStorage.removeItem('gog_token');
}

export async function signup(email, password, name) {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Signup failed');
  localStorage.setItem('gog_token', data.token);
  return data;
}

export async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  localStorage.setItem('gog_token', data.token);
  return data;
}

export async function fetchConfig() {
  const res = await fetch(`${BASE}/api/config`);
  return res.json();
}

export async function fetchMe() {
  const res = await fetch(`${BASE}/api/me`, { headers: authHeaders() });
  return res.json();
}

export async function fetchMovers() {
  const res = await fetch(`${BASE}/api/market/movers`, { headers: authHeaders() });
  return res.json();
}

export async function fetchSymbols() {
  const res = await fetch(`${BASE}/api/symbols`, { headers: authHeaders() });
  return res.json();
}

export async function fetchWatchlist() {
  const res = await fetch(`${BASE}/api/watchlist`, { headers: authHeaders() });
  return res.json();
}

export async function addSymbol(symbol, alertThreshold) {
  const res = await fetch(`${BASE}/api/watchlist`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, alertThreshold }),
  });
  return res.json();
}

export async function removeSymbol(symbol) {
  const res = await fetch(`${BASE}/api/watchlist/${symbol}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return res.json();
}

export async function checkpoint() {
  const res = await fetch(`${BASE}/api/watchlist/checkpoint`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return res.json();
}

export async function setAlert(symbol, threshold) {
  const res = await fetch(`${BASE}/api/watchlist/${symbol}/alert`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ threshold }),
  });
  return res.json();
}

export async function explainStock(symbol) {
  const res = await fetch(`${BASE}/api/watchlist/${symbol}/explain`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return res.json();
}

export async function chatAboutStock(symbol, messages) {
  const res = await fetch(`${BASE}/api/watchlist/${symbol}/chat`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
  return res.json();
}

export function connectWebSocket(onTick, onStatusChange) {
  const token = getToken();
  const notify = (status) => onStatusChange && onStatusChange(status);
 
  notify('connecting');
  const ws = new WebSocket(`${WS_BASE}/ws?token=${token}`);
 
  ws.onopen = () => notify('open');
  ws.onclose = () => notify('closed');
  ws.onerror = () => notify('error');
 
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'tick') onTick(msg.data);
  };
 
  return ws;
}
