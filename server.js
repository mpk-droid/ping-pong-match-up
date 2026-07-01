const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

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

let store = createEmptyStore();

function createEmptyStore() {
  const slots = {};
  for (const s of SLOTS) slots[s] = [];
  return { date: todayStr(), slots };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function ensureToday() {
  if (store.date !== todayStr()) {
    store = createEmptyStore();
  }
}

// Clear at 5 PM every day
function scheduleDailyClear() {
  const now = new Date();
  const fivePM = new Date(now);
  fivePM.setHours(17, 0, 0, 0);
  if (fivePM <= now) fivePM.setDate(fivePM.getDate() + 1);
  const ms = fivePM - now;
  setTimeout(() => {
    store = createEmptyStore();
    broadcast();
    scheduleDailyClear();
  }, ms);
}
scheduleDailyClear();

// SSE
const MAX_SSE_CLIENTS = 100;
const MAX_SSE_PER_IP = 5;
const clients = [];

function getClientIp(req) {
  return req.ip || req.socket.remoteAddress;
}

function broadcast() {
  const data = JSON.stringify(store.slots);
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
  res.write(`data: ${JSON.stringify(store.slots)}\n\n`);

  res._sseIp = ip;
  clients.push(res);
  req.on('close', () => {
    const i = clients.indexOf(res);
    if (i !== -1) clients.splice(i, 1);
  });
});

app.get('/api/today', (_req, res) => {
  ensureToday();
  res.json(store.slots);
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

  const arr = store.slots[slot];
  const idx = arr.indexOf(sanitized);
  if (idx === -1) {
    if (arr.length >= MAX_NAMES_PER_SLOT) {
      return res.status(409).json({ error: 'Slot is full' });
    }
    arr.push(sanitized);
  } else {
    arr.splice(idx, 1);
  }

  broadcast();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Ping pong board running on http://localhost:${PORT}`);
});
