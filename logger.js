const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'logs.json');
const MAX_ENTRIES = 300;

let buffer = [];
const listeners = new Set();

try {
  if (fs.existsSync(LOG_FILE)) {
    buffer = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  }
} catch {}

function log(message) {
  const entry = { ts: new Date().toISOString(), msg: message };
  process.stdout.write(`${entry.ts}  ${message}\n`);
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
  try { fs.writeFileSync(LOG_FILE, JSON.stringify(buffer)); } catch {}
  listeners.forEach((fn) => fn(entry));
}

function getLogs(n = 150) {
  return buffer.slice(-n);
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { log, getLogs, subscribe };
