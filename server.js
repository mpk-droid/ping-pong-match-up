const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
    },
  },
}));

app.use(express.json({ limit: '1kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const toggleLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later' },
});
app.use('/api/toggle', toggleLimiter);

const SLOTS = [];
for (let h = 9; h < 18; h++) {
  SLOTS.push(`${String(h).padStart(2, '0')}:00`);
  SLOTS.push(`${String(h).padStart(2, '0')}:30`);
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'pingpong.db');
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS entries (
  date TEXT NOT NULL,
  slot TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (date, slot, name)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS users (
  name TEXT PRIMARY KEY,
  created TEXT NOT NULL
)`);

const stmts = {
  insert: db.prepare('INSERT OR IGNORE INTO entries (date, slot, name) VALUES (?, ?, ?)'),
  remove: db.prepare('DELETE FROM entries WHERE date = ? AND slot = ? AND name = ?'),
  exists: db.prepare('SELECT 1 FROM entries WHERE date = ? AND slot = ? AND name = ?'),
  loadDay: db.prepare('SELECT slot, name FROM entries WHERE date = ?'),
  clearOld: db.prepare('DELETE FROM entries WHERE date != ?'),
  clearAll: db.prepare('DELETE FROM entries'),
  findUser: db.prepare('SELECT 1 FROM users WHERE name = ?'),
  registerUser: db.prepare('INSERT OR IGNORE INTO users (name, created) VALUES (?, ?)'),
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function loadSlots() {
  const slots = {};
  for (const s of SLOTS) slots[s] = [];
  const rows = stmts.loadDay.all(todayStr());
  for (const row of rows) {
    if (slots[row.slot]) slots[row.slot].push(row.name);
  }
  return slots;
}

function ensureToday() {
  stmts.clearOld.run(todayStr());
}


// SSE
const MAX_SSE_CLIENTS = 100;
const MAX_SSE_PER_IP = 5;
const clients = [];

function getClientIp(req) {
  return req.ip || req.socket.remoteAddress;
}

function broadcast() {
  const data = JSON.stringify(loadSlots());
  for (const res of clients) {
    res.write(`data: ${data}\n\n`);
  }
}

app.get('/api/events', (req, res) => {
  if (clients.length >= MAX_SSE_CLIENTS) {
    return res.status(503).json({ error: 'Too many connections' });
  }

  const ip = getClientIp(req);
  const ipCount = clients.filter(c => c._sseIp === ip).length;
  if (ipCount >= MAX_SSE_PER_IP) {
    return res.status(429).json({ error: 'Too many connections from this IP' });
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  ensureToday();
  res.write(`data: ${JSON.stringify(loadSlots())}\n\n`);

  res._sseIp = ip;
  clients.push(res);
  req.on('close', () => {
    const i = clients.indexOf(res);
    if (i !== -1) clients.splice(i, 1);
  });
});

app.get('/api/today', (_req, res) => {
  ensureToday();
  res.json(loadSlots());
});

const MAX_NAMES_PER_SLOT = 20;

app.post('/api/toggle', (req, res) => {
  const { name, slot } = req.body;
  if (!name || typeof name !== 'string' || !slot || !SLOTS.includes(slot)) {
    return res.status(400).json({ error: 'Invalid name or slot' });
  }

  const sanitized = name.trim().slice(0, 12);
  if (!sanitized) return res.status(400).json({ error: 'Name is empty' });

  ensureToday();

  const today = todayStr();
  const exists = stmts.exists.get(today, slot, sanitized);
  if (exists) {
    stmts.remove.run(today, slot, sanitized);
  } else {
    const currentSlot = loadSlots()[slot] || [];
    if (currentSlot.length >= MAX_NAMES_PER_SLOT) {
      return res.status(409).json({ error: 'Slot is full' });
    }
    stmts.insert.run(today, slot, sanitized);
  }

  broadcast();
  res.json({ ok: true });
});

app.post('/api/register', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Invalid name' });
  }
  const sanitized = name.trim().slice(0, 12);
  if (!sanitized) return res.status(400).json({ error: 'Name is empty' });

  const existing = stmts.findUser.get(sanitized);
  if (existing) {
    return res.json({ ok: true, warning: `"${sanitized}" is already taken. Consider adding a last initial to avoid confusion.` });
  }
  stmts.registerUser.run(sanitized, todayStr());
  return res.json({ ok: true });
});

app.post('/api/clear', (req, res) => {
  stmts.clearAll.run();
  broadcast();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Ping pong board running on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => { db.close(); process.exit(0); });
process.on('SIGINT', () => { db.close(); process.exit(0); });
