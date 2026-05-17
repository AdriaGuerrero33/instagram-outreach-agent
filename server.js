require('dotenv').config();
const express = require('express');
const path = require('path');
const { log, getLogs, subscribe } = require('./logger');
const { load: loadConfig, save: saveConfig } = require('./config');

const app = express();
app.use(express.json());

// Auth middleware — protects everything
const PASS = process.env.DASHBOARD_PASSWORD;
function requireAuth(req, res, next) {
  if (!PASS) return next();
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Agent Panel"');
    return res.status(401).send('Panel protegido — introduce la contraseña');
  }
  const [, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  if (pass !== PASS) {
    res.set('WWW-Authenticate', 'Basic realm="Agent Panel"');
    return res.status(401).send('Contraseña incorrecta');
  }
  next();
}

app.use(requireAuth);
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'panel.html')));
app.use(express.static(path.join(__dirname, 'public')));

// ── Config ────────────────────────────────────────────────────
app.get('/api/config', (req, res) => res.json(loadConfig()));

app.post('/api/config', (req, res) => {
  const cfg = { ...loadConfig(), ...req.body };
  cfg.cronHour    = parseInt(cfg.cronHour, 10);
  cfg.cronMinute  = parseInt(cfg.cronMinute, 10);
  cfg.dailyLimit  = parseInt(cfg.dailyLimit, 10);
  cfg.intervalMin = parseInt(cfg.intervalMin, 10);
  cfg.intervalMax = parseInt(cfg.intervalMax, 10);
  saveConfig(cfg);
  log(`[dashboard] Config saved → ${cfg.cronHour}:${String(cfg.cronMinute).padStart(2,'0')} UTC, limit ${cfg.dailyLimit}, interval ${cfg.intervalMin}-${cfg.intervalMax}min`);
  require('./scheduler').reschedule(cfg);
  res.json(cfg);
});

// ── Leads ─────────────────────────────────────────────────────
app.get('/api/leads', (req, res) => {
  const { loadLeads } = require('./instagram');
  const leads = loadLeads().reverse().slice(0, 200);
  res.json(leads);
});

// ── Stats ─────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const { loadLeads } = require('./instagram');
  const leads = loadLeads();
  const today = new Date().toDateString();
  const sentAll   = leads.filter((l) => l.status === 'sent');
  const sentToday = sentAll.filter((l) => new Date(l.timestamp).toDateString() === today);
  const last = leads.length ? leads[leads.length - 1].timestamp : null;
  res.json({ total: leads.length, sent: sentAll.length, today: sentToday.length, lastRun: last });
});

// ── Run now ───────────────────────────────────────────────────
let running = false;

app.get('/api/status', (req, res) => res.json({ running }));

app.post('/api/run', (req, res) => {
  if (running) return res.status(409).json({ error: 'Already running' });
  const cfg = loadConfig();
  running = true;
  log('[dashboard] Manual run triggered');
  res.json({ started: true });
  const { runOutreach } = require('./instagram');
  runOutreach(cfg.dailyLimit)
    .catch((err) => log(`[dashboard] Run error: ${err.message}`))
    .finally(() => { running = false; });
});

// ── Log stream (SSE) ──────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();

  getLogs().forEach((e) => res.write(`data:${JSON.stringify(e)}\n\n`));

  const unsub = subscribe((e) => res.write(`data:${JSON.stringify(e)}\n\n`));
  req.on('close', unsub);
});

function start() {
  const port = process.env.PORT || 3000;
  app.listen(port, () => log(`[server] Dashboard → http://localhost:${port}`));
}

module.exports = { start };
