const fs = require('fs');
const path = require('path');

const DATA_DIR     = path.join(__dirname, 'data');
const LEADS_FILE   = path.join(DATA_DIR, 'leads.json');
const RUNS_FILE    = path.join(DATA_DIR, 'runs.json');
const SESSION_FILE = path.join(DATA_DIR, 'session.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  return fallback;
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Leads / CRM ───────────────────────────────────────────────
function loadLeads() {
  return readJSON(LEADS_FILE, []);
}
function saveLeads(leads) {
  writeJSON(LEADS_FILE, leads);
}
function getLead(username) {
  return loadLeads().find((l) => l.username === username) || null;
}
function hasContacted(username) {
  return loadLeads().some((l) => l.username === username);
}
function addLead(lead) {
  const leads = loadLeads();
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    username: lead.username,
    name: lead.name || lead.username,
    bio: lead.bio || '',
    message: lead.message || '',
    status: lead.status || 'pending',     // pending | sent | skipped | error
    replied: false,
    notes: '',
    timestamp: lead.timestamp || new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
  leads.push(entry);
  saveLeads(leads);
  return entry;
}
function updateLead(id, patch) {
  const leads = loadLeads();
  const i = leads.findIndex((l) => l.id === id);
  if (i === -1) return null;
  leads[i] = { ...leads[i], ...patch, lastUpdated: new Date().toISOString() };
  saveLeads(leads);
  return leads[i];
}

// ── Runs history (for calendar) ───────────────────────────────
function loadRuns() {
  return readJSON(RUNS_FILE, []);
}
function saveRuns(runs) {
  writeJSON(RUNS_FILE, runs);
}
function startRun(trigger) {
  const runs = loadRuns();
  const run = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    trigger,                       // 'manual' | 'scheduled'
    startedAt: new Date().toISOString(),
    finishedAt: null,
    sent: 0,
    skipped: 0,
    errors: 0,
    video: null,
    note: '',
  };
  runs.push(run);
  saveRuns(runs);
  return run.id;
}
function updateRun(id, patch) {
  const runs = loadRuns();
  const i = runs.findIndex((r) => r.id === id);
  if (i === -1) return;
  runs[i] = { ...runs[i], ...patch };
  saveRuns(runs);
}
function finishRun(id, patch) {
  updateRun(id, { ...patch, finishedAt: new Date().toISOString() });
}

// ── Session (Instagram cookies) ───────────────────────────────
function normalizeCookies(cookies) {
  const sameSiteMap = { strict: 'Strict', lax: 'Lax', none: 'None', no_restriction: 'None' };
  return cookies.map((c) => {
    const rawSS = (c.sameSite || '').toLowerCase();
    const sameSite = sameSiteMap[rawSS] || 'Lax';
    const exp = c.expirationDate || c.expires || 0;
    return {
      name: c.name,
      value: c.value,
      domain: c.domain || '.instagram.com',
      path: c.path || '/',
      httpOnly: !!c.httpOnly,
      secure: c.secure !== false,
      sameSite,
      expires: exp > 0 ? Math.floor(exp) : undefined,
    };
  });
}
function saveSessionCookies(cookies) {
  writeJSON(SESSION_FILE, cookies);
}
function loadSessionCookies() {
  const fromFile = readJSON(SESSION_FILE, null);
  if (Array.isArray(fromFile) && fromFile.length) return fromFile;
  // Fallback: variable de entorno (sobrevive redeploys de Railway sin Volume)
  if (process.env.IG_SESSION_JSON) {
    try {
      const parsed = JSON.parse(process.env.IG_SESSION_JSON);
      if (Array.isArray(parsed) && parsed.length) return normalizeCookies(parsed);
    } catch {}
  }
  return null;
}
function hasSession() {
  if (fs.existsSync(SESSION_FILE)) return true;
  if (process.env.IG_SESSION_JSON) {
    try { return JSON.parse(process.env.IG_SESSION_JSON).length > 0; } catch {}
  }
  return false;
}
function clearSession() {
  try { fs.unlinkSync(SESSION_FILE); } catch {}
}

// ── Calendar aggregation ──────────────────────────────────────
function calendarData() {
  const byDay = {};
  for (const l of loadLeads()) {
    const day = (l.timestamp || '').slice(0, 10);
    if (!day) continue;
    if (!byDay[day]) byDay[day] = { date: day, sent: 0, skipped: 0, error: 0, total: 0, replied: 0 };
    byDay[day].total++;
    if (l.status === 'sent') byDay[day].sent++;
    else if (l.status === 'skipped') byDay[day].skipped++;
    else if (l.status === 'error') byDay[day].error++;
    if (l.replied) byDay[day].replied++;
  }
  return byDay;
}

module.exports = {
  DATA_DIR, SESSION_FILE,
  loadLeads, saveLeads, getLead, hasContacted, addLead, updateLead,
  loadRuns, startRun, updateRun, finishRun,
  normalizeCookies, saveSessionCookies, loadSessionCookies, hasSession, clearSession,
  calendarData,
};
