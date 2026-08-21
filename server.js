const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 8080;

app.set('trust proxy', 1);

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
const OFFICE_TZ = process.env.OFFICE_TZ || 'America/New_York';
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS entries (
  date TEXT NOT NULL,
  slot TEXT NOT NULL,
  name TEXT NOT NULL,
  joined_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, slot, name)
)`);
const entryCols = db.prepare('PRAGMA table_info(entries)').all();
if (!entryCols.some((c) => c.name === 'joined_at')) {
  db.exec('ALTER TABLE entries ADD COLUMN joined_at INTEGER NOT NULL DEFAULT 0');
}
db.exec(`CREATE TABLE IF NOT EXISTS users (
  name TEXT PRIMARY KEY,
  created TEXT NOT NULL
)`);

const stmts = {
  insert: db.prepare('INSERT OR IGNORE INTO entries (date, slot, name, joined_at) VALUES (?, ?, ?, ?)'),
  remove: db.prepare('DELETE FROM entries WHERE date = ? AND slot = ? AND LOWER(name) = LOWER(?)'),
  exists: db.prepare('SELECT 1 FROM entries WHERE date = ? AND slot = ? AND LOWER(name) = LOWER(?)'),
  loadDay: db.prepare('SELECT slot, name FROM entries WHERE date = ? ORDER BY joined_at'),
  clearOld: db.prepare('DELETE FROM entries WHERE date != ?'),
  clearAll: db.prepare('DELETE FROM entries'),
  findUser: db.prepare('SELECT 1 FROM users WHERE LOWER(name) = LOWER(?)'),
  registerUser: db.prepare('INSERT OR IGNORE INTO users (name, created) VALUES (?, ?)'),
};

function todayStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: OFFICE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function officeTimeParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: OFFICE_TZ,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  return {
    hour: Number(parts.find((p) => p.type === 'hour').value),
    minute: Number(parts.find((p) => p.type === 'minute').value),
  };
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
  const payload = `data: ${JSON.stringify(loadSlots())}\n\n`;
  for (let i = clients.length - 1; i >= 0; i--) {
    try {
      clients[i].write(payload);
    } catch {
      clients.splice(i, 1);
    }
  }
}

function sseHeartbeat() {
  for (let i = clients.length - 1; i >= 0; i--) {
    try {
      clients[i].write(': heartbeat\n\n');
    } catch {
      clients.splice(i, 1);
    }
  }
}

const SSE_HEARTBEAT_MS = 20_000;
setInterval(sseHeartbeat, SSE_HEARTBEAT_MS);

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
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
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
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const DASHBOARD_URL = process.env.DASHBOARD_URL
  || 'https://ping-pong-pk-individual.apps.rosa.agen-e2e-rhoai2.p5ui.p3.openshiftapps.com';

function formatTime(slot) {
  const [h, m] = slot.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function formatTimeShort(slot) {
  const [h, m] = slot.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  if (m === 0) return `${h12} ${suffix}`;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function isPastSlot(slot) {
  const { hour, minute } = officeTimeParts();
  const [h, m] = slot.split(':').map(Number);
  const slotEnd = h * 60 + m + 30;
  const current = hour * 60 + minute;
  return current >= slotEnd;
}

function formatNameList(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  if (names.length === 4) return `${names[0]}, ${names[1]}, ${names[2]} and ${names[3]}`;
  const last = names[names.length - 1];
  return `${names.slice(0, -1).join(', ')} and ${last}`;
}

function buildToggleMessage(names, slot, actor, removed) {
  if (isPastSlot(slot)) return null;
  const time = formatTime(slot);
  const count = names.length;

  if (count === 0) {
    if (!removed) return null;
    return `${actor} is no longer available at ${time}. Slot empty.`;
  }
  if (count === 1) {
    return `${names[0]} is available at ${time}. Looking for a partner!`;
  }
  if (count === 2) {
    return `Match found! ${names[0]} and ${names[1]} are playing at ${time}. Wanna join?`;
  }
  if (count === 3) {
    return `${names[0]}, ${names[1]} and ${names[2]} are playing at ${time}, looking for another partner to play doubles!`;
  }
  if (count === 4) {
    return `Doubles match on! ${formatNameList(names)} are playing.`;
  }
  return `${formatNameList(names)} are playing at ${time}.`;
}

function buildSummaryBlock() {
  const allSlots = loadSlots();
  const lines = [];
  for (const slot of SLOTS) {
    if (isPastSlot(slot)) continue;
    const names = allSlots[slot] || [];
    if (names.length === 0) continue;
    lines.push(`${formatTimeShort(slot)}: ${names.join(', ')}`);
  }
  const body = lines.length > 0 ? lines.join('\n') : "no one's marked free yet — grab a slot!";
  return `\`\`\`\n${body}\n\`\`\``;
}

function postSlack(text) {
  if (!SLACK_WEBHOOK_URL) return;
  const fullText = `${text}  <${DASHBOARD_URL}|Dashboard>`;
  fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: fullText }),
  }).catch(() => {});
}

function notifyToggle(slot, names, actor, removed) {
  const text = buildToggleMessage(names, slot, actor, removed);
  if (!text) return;
  postSlack(text);
}

// 9am, 11am, 1pm, 3pm, 5pm, 6pm office time (every 2h from 9–5, plus 6pm)
const SUMMARY_HOURS = [9, 11, 13, 15, 17, 18];
let lastSummaryKey = null;

function postSummary() {
  const { hour } = officeTimeParts();
  if (!SUMMARY_HOURS.includes(hour)) return;

  const key = `${todayStr()}-${hour}`;
  if (lastSummaryKey === key) return;
  lastSummaryKey = key;

  ensureToday();
  postSlack(buildSummaryBlock());
}

function msUntilNextSummary() {
  const { hour, minute } = officeTimeParts();
  const currentMins = hour * 60 + minute;

  for (const h of SUMMARY_HOURS) {
    const targetMins = h * 60;
    if (currentMins < targetMins) {
      return (targetMins - currentMins) * 60 * 1000;
    }
  }

  const minsUntilMidnight = 24 * 60 - currentMins;
  return (minsUntilMidnight + SUMMARY_HOURS[0] * 60) * 60 * 1000;
}

function scheduleSummary() {
  const delay = msUntilNextSummary();
  setTimeout(() => {
    postSummary();
    scheduleSummary();
  }, delay);
}

app.post('/api/toggle', (req, res) => {
  const { name, slot } = req.body;
  if (!name || typeof name !== 'string' || !slot || !SLOTS.includes(slot)) {
    return res.status(400).json({ error: 'Invalid name or slot' });
  }

  const sanitized = name.trim().slice(0, 12);
  if (!sanitized) return res.status(400).json({ error: 'Name is empty' });
  if (isPastSlot(slot)) return res.status(400).json({ error: 'Slot is in the past' });

  ensureToday();
  stmts.registerUser.run(sanitized, todayStr());

  const today = todayStr();
  const exists = stmts.exists.get(today, slot, sanitized);
  let removed = false;
  if (exists) {
    stmts.remove.run(today, slot, sanitized);
    removed = true;
    console.log(`toggle ${sanitized} ${slot} remove`);
  } else {
    const currentSlot = loadSlots()[slot] || [];
    if (currentSlot.length >= MAX_NAMES_PER_SLOT) {
      return res.status(409).json({ error: 'Slot is full' });
    }
    stmts.insert.run(today, slot, sanitized, Date.now());
    console.log(`toggle ${sanitized} ${slot} add`);
  }

  const names = loadSlots()[slot] || [];
  notifyToggle(slot, names, sanitized, removed);
  broadcast();
  res.json({ ok: true, slots: loadSlots() });
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
    return res.json({ ok: true, warning: `"${sanitized}" is already registered. If this is you, continue. Otherwise consider adding a last initial to avoid confusion.` });
  }
  stmts.registerUser.run(sanitized, todayStr());
  return res.json({ ok: true });
});

app.post('/api/clear', (req, res) => {
  stmts.clearAll.run();
  const data = JSON.stringify(loadSlots());
  for (const c of clients) {
    c.write(`event: clear\ndata: ${data}\n\n`);
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Ping pong board running on http://localhost:${PORT}`);
  scheduleSummary();
});

process.on('SIGTERM', () => { db.close(); process.exit(0); });
process.on('SIGINT', () => { db.close(); process.exit(0); });
