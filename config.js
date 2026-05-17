const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.json');

function defaults() {
  return {
    cronHour: parseInt(process.env.CRON_HOUR || '9', 10),
    cronMinute: parseInt(process.env.CRON_MINUTE || '30', 10),
    dailyLimit: parseInt(process.env.DAILY_LIMIT || '20', 10),
    enabled: true,
  };
}

function load() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return { ...defaults(), ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
  } catch {}
  return defaults();
}

function save(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

module.exports = { load, save };
