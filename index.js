require('dotenv').config();

const required = ['INSTAGRAM_USER', 'INSTAGRAM_PASS', 'OPENROUTER_API_KEY'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[config] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

// Run once immediately if RUN_NOW=true (useful for testing)
if (process.env.RUN_NOW === 'true') {
  const { runOutreach } = require('./instagram');
  const dailyLimit = parseInt(process.env.DAILY_LIMIT || '20', 10);
  console.log('[index] RUN_NOW=true — starting outreach immediately');
  runOutreach(dailyLimit).catch((err) => {
    console.error('[index] Fatal error:', err.message);
    process.exit(1);
  });
} else {
  require('./scheduler');
}
