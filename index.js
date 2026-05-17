require('dotenv').config();

if (!process.env.OPENROUTER_API_KEY) {
  console.error('[config] Falta OPENROUTER_API_KEY');
  process.exit(1);
}
if (!process.env.INSTAGRAM_USER || !process.env.INSTAGRAM_PASS) {
  console.warn('[config] Sin INSTAGRAM_USER/PASS — usa la subida de sesión (cookies) desde el panel');
}

require('./server').start();
require('./scheduler').init();

if (process.env.RUN_NOW === 'true') {
  const { log } = require('./logger');
  const { runOutreach } = require('./instagram');
  const { load } = require('./config');
  const cfg = load();
  log('[index] RUN_NOW=true — starting immediately');
  runOutreach(cfg.dailyLimit).catch((err) => {
    log(`[index] Fatal: ${err.message}`);
    process.exit(1);
  });
}
