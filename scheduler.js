require('dotenv').config();
const cron = require('node-cron');
const { log } = require('./logger');
const { load: loadConfig } = require('./config');

let task = null;
const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function reschedule(cfg) {
  if (task) { task.stop(); task = null; }
  if (!cfg.enabled) { log('[scheduler] Desactivado — sin cron programado'); return; }

  const expr = `${cfg.cronMinute} ${cfg.cronHour} * * *`;
  const hh = String(cfg.cronHour).padStart(2, '0');
  const mm = String(cfg.cronMinute).padStart(2, '0');
  const days = (cfg.days || []).map((d) => DAY_NAMES[d]).join(', ') || 'ninguno';
  log(`[scheduler] Programado ${hh}:${mm} UTC los días: ${days} (límite: ${cfg.dailyLimit})`);

  task = cron.schedule(expr, async () => {
    const today = new Date().getUTCDay();
    const fresh = loadConfig();
    if (!fresh.enabled) return;
    if (!(fresh.days || []).includes(today)) {
      log(`[scheduler] Hoy (${DAY_NAMES[today]}) no está programado — se omite`);
      return;
    }
    log(`[scheduler] Ejecución diaria — ${new Date().toISOString()}`);
    try {
      await require('./instagram').runOutreach(fresh.dailyLimit, 'scheduled');
    } catch (err) {
      log(`[scheduler] Falló la ejecución: ${err.message}`);
    }
  });
}

function init() {
  reschedule(loadConfig());
}

module.exports = { reschedule, init };
