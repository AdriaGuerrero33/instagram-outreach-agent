const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const LOG_FILE = path.join(DATA_DIR, 'logs.json');
const MAX_ENTRIES = 500;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let buffer = [];
const listeners = new Set();

try {
  if (fs.existsSync(LOG_FILE)) buffer = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
} catch {}

function log(message) {
  const entry = { ts: new Date().toISOString(), msg: String(message) };
  process.stdout.write(`${entry.ts}  ${entry.msg}\n`);
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
  try { fs.writeFileSync(LOG_FILE, JSON.stringify(buffer)); } catch {}
  listeners.forEach((fn) => { try { fn(entry); } catch {} });
}

function getLogs(n = 200) {
  return buffer.slice(-n);
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { log, getLogs, subscribe };
