const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');

const DEFAULT_PROMPT = `Eres un emprendedor que quiere conectar genuinamente con otros emprendedores en Instagram.
Escribe un DM corto (3-4 líneas) basado en la bio de esta persona: "{bio}".
El mensaje debe sonar humano y natural, mencionar algo específico de su bio,
y terminar con una pregunta abierta. Sin emojis excesivos. En español.`;

function defaults() {
  return {
    cronHour:    parseInt(process.env.CRON_HOUR || '9', 10),
    cronMinute:  parseInt(process.env.CRON_MINUTE || '30', 10),
    days:        [1, 2, 3, 4, 5],          // 0=Dom .. 6=Sáb
    dailyLimit:  parseInt(process.env.DAILY_LIMIT || '20', 10),
    intervalMin: parseInt(process.env.INTERVAL_MIN || '3', 10),
    intervalMax: parseInt(process.env.INTERVAL_MAX || '8', 10),
    enabled:     true,
    recordVideo: true,
    dmPrompt:    DEFAULT_PROMPT,
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
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

module.exports = { load, save, DEFAULT_PROMPT };
