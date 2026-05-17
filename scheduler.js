require('dotenv').config();
const cron = require('node-cron');
const { runOutreach } = require('./instagram');

const hour = process.env.CRON_HOUR || '9';
const minute = process.env.CRON_MINUTE || '30';
const dailyLimit = parseInt(process.env.DAILY_LIMIT || '20', 10);

const cronExpression = `${minute} ${hour} * * *`;

console.log(`[scheduler] Agent scheduled at ${hour}:${minute.padStart(2, '0')} every day`);
console.log(`[scheduler] Daily limit: ${dailyLimit} DMs`);

cron.schedule(cronExpression, async () => {
  console.log(`\n[scheduler] Starting outreach run — ${new Date().toISOString()}`);
  try {
    await runOutreach(dailyLimit);
  } catch (err) {
    console.error('[scheduler] Run failed:', err.message);
  }
});
