require('dotenv').config();
const cron = require('node-cron');
const { log } = require('./logger');
const { load: loadConfig } = require('./config');

let task = null;

function reschedule(cfg) {
  if (task) { task.stop(); task = null; }
  if (!cfg.enabled) { log('[scheduler] Disabled — no cron scheduled'); return; }
  const expr = `${cfg.cronMinute} ${cfg.cronHour} * * *`;
  const hh = String(cfg.cronHour).padStart(2, '0');
  const mm = String(cfg.cronMinute).padStart(2, '0');
  log(`[scheduler] Scheduled at ${hh}:${mm} UTC daily (limit: ${cfg.dailyLimit})`);
  task = cron.schedule(expr, async () => {
    log(`[scheduler] Starting daily run — ${new Date().toISOString()}`);
    try {
      await require('./instagram').runOutreach(cfg.dailyLimit);
    } catch (err) {
      log(`[scheduler] Run failed: ${err.message}`);
    }
  });
}

function init() {
  reschedule(loadConfig());
}

module.exports = { reschedule, init };
