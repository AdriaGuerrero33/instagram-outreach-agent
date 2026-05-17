require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { log, getLogs, subscribe } = require('./logger');
const { load: loadConfig, save: saveConfig, DEFAULT_PROMPT } = require('./config');
const store = require('./storage');

const app = express();
app.use(express.json({ limit: '5mb' }));

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
app.get('/api/config', (req, res) => res.json({ ...loadConfig(), defaultPrompt: DEFAULT_PROMPT }));
app.post('/api/config', (req, res) => {
  const cur = loadConfig();
  const b = req.body || {};
  const cfg = {
    ...cur,
    cronHour:    parseInt(b.cronHour ?? cur.cronHour, 10),
    cronMinute:  parseInt(b.cronMinute ?? cur.cronMinute, 10),
    dailyLimit:  parseInt(b.dailyLimit ?? cur.dailyLimit, 10),
    intervalMin: parseInt(b.intervalMin ?? cur.intervalMin, 10),
    intervalMax: parseInt(b.intervalMax ?? cur.intervalMax, 10),
    days:        Array.isArray(b.days) ? b.days.map(Number) : cur.days,
    enabled:     b.enabled ?? cur.enabled,
    recordVideo: b.recordVideo ?? cur.recordVideo,
    dmPrompt:    b.dmPrompt ?? cur.dmPrompt,
  };
  saveConfig(cfg);
  log(`[panel] Config guardada → ${cfg.cronHour}:${String(cfg.cronMinute).padStart(2,'0')} UTC, días [${cfg.days}], límite ${cfg.dailyLimit}`);
  require('./scheduler').reschedule(cfg);
  res.json(cfg);
});

// ── CRM / Leads ───────────────────────────────────────────────
app.get('/api/leads', (req, res) => {
  let leads = store.loadLeads().slice().reverse();
  const { q, status } = req.query;
  if (status && status !== 'all') leads = leads.filter((l) => l.status === status);
  if (q) {
    const s = String(q).toLowerCase();
    leads = leads.filter((l) =>
      l.username.toLowerCase().includes(s) ||
      (l.bio || '').toLowerCase().includes(s) ||
      (l.notes || '').toLowerCase().includes(s));
  }
  res.json(leads);
});
app.patch('/api/leads/:id', (req, res) => {
  const allowed = {};
  if ('notes' in req.body)   allowed.notes = String(req.body.notes);
  if ('replied' in req.body) allowed.replied = !!req.body.replied;
  if ('status' in req.body)  allowed.status = String(req.body.status);
  const updated = store.updateLead(req.params.id, allowed);
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(updated);
});
app.get('/api/leads.csv', (req, res) => {
  const rows = [['username', 'name', 'status', 'replied', 'notes', 'timestamp', 'message']];
  for (const l of store.loadLeads()) {
    rows.push([l.username, l.name, l.status, l.replied, (l.notes || '').replace(/\n/g, ' '),
      l.timestamp, (l.message || '').replace(/\n/g, ' ')]);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="leads.csv"');
  res.send(csv);
});

// ── Stats ─────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const leads = store.loadLeads();
  const today = new Date().toDateString();
  const sentAll   = leads.filter((l) => l.status === 'sent');
  const sentToday = sentAll.filter((l) => new Date(l.timestamp).toDateString() === today);
  const replied   = leads.filter((l) => l.replied);
  const last = leads.length ? leads[leads.length - 1].timestamp : null;
  res.json({
    total: leads.length,
    sent: sentAll.length,
    today: sentToday.length,
    replied: replied.length,
    replyRate: sentAll.length ? Math.round((replied.length / sentAll.length) * 100) : 0,
    lastRun: last,
  });
});

// ── Calendar & runs ───────────────────────────────────────────
app.get('/api/calendar', (req, res) => res.json(store.calendarData()));
app.get('/api/runs', (req, res) => res.json(store.loadRuns().slice().reverse().slice(0, 100)));

// ── Recordings ────────────────────────────────────────────────
app.get('/api/recordings', (req, res) => {
  const dir = path.join(__dirname, 'public', 'recordings');
  let files = [];
  try {
    files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.webm'))
      .map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size, url: `/recordings/${f}` }))
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch {}
  res.json(files);
});

// ── Session (Instagram cookies) ───────────────────────────────
app.get('/api/session', (req, res) => res.json({ active: store.hasSession() }));
app.post('/api/session', (req, res) => {
  let cookies = req.body && req.body.cookies;
  try {
    if (typeof cookies === 'string') cookies = JSON.parse(cookies);
    if (!Array.isArray(cookies) || !cookies.length) throw new Error('formato inválido');
    cookies = cookies.map((c) => ({
      name: c.name, value: c.value,
      domain: c.domain || '.instagram.com',
      path: c.path || '/',
      httpOnly: !!c.httpOnly, secure: c.secure !== false,
      sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax',
      expires: c.expires && c.expires > 0 ? c.expires : undefined,
    }));
    store.saveSessionCookies(cookies);
    log(`[sesión] Sesión subida (${cookies.length} cookies)`);
    res.json({ active: true, count: cookies.length });
  } catch (e) {
    res.status(400).json({ error: 'JSON de cookies inválido: ' + e.message });
  }
});
app.delete('/api/session', (req, res) => { store.clearSession(); log('[sesión] Sesión borrada'); res.json({ active: false }); });

// ── Run now ───────────────────────────────────────────────────
let running = false;
app.get('/api/status', (req, res) => res.json({ running }));
app.post('/api/run', (req, res) => {
  if (running) return res.status(409).json({ error: 'Ya está en ejecución' });
  const cfg = loadConfig();
  running = true;
  log('[panel] Ejecución manual lanzada');
  res.json({ started: true });
  require('./instagram').runOutreach(cfg.dailyLimit, 'manual')
    .catch((err) => log(`[panel] Error: ${err.message}`))
    .finally(() => { running = false; });
});

// ── Live screenshot ───────────────────────────────────────────
const SHOT_FILE = path.join(__dirname, 'public', 'screenshot.png');
app.get('/api/screenshot', async (req, res) => {
  const { getActivePage, snap } = require('./instagram');
  const page = getActivePage();
  if (page) { try { await snap(page); } catch {} }
  if (fs.existsSync(SHOT_FILE)) {
    res.set('Cache-Control', 'no-store');
    return res.sendFile(SHOT_FILE);
  }
  res.status(204).end();
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
  app.listen(port, () => log(`[server] Panel → http://localhost:${port}`));
}

module.exports = { start };
