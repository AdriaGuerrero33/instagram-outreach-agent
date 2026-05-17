require('dotenv').config();

const required = ['INSTAGRAM_USER', 'INSTAGRAM_PASS', 'OPENROUTER_API_KEY'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[config] Missing env vars: ${missing.join(', ')}`);
  process.exit(1);
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
