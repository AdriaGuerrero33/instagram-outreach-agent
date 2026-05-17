require('dotenv').config();
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const fs = require('fs');
const path = require('path');
const { log } = require('./logger');
const store = require('./storage');
const { load: loadConfig } = require('./config');

const SCREENSHOT_FILE = path.join(__dirname, 'public', 'screenshot.png');
const RECORDINGS_DIR  = path.join(__dirname, 'public', 'recordings');
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let _activePage = null;
function getActivePage() { return _activePage; }

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = (min = 500, max = 2000) => sleep(randomInt(min, max));

async function humanType(page, selector, text) {
  await page.click(selector);
  for (const ch of text) await page.keyboard.type(ch, { delay: randomInt(80, 200) });
}
async function smoothScroll(page, distance = 300) {
  await page.evaluate((d) => window.scrollBy({ top: d, behavior: 'smooth' }), distance);
  await sleep(randomInt(400, 800));
}
async function snap(page) {
  try { await page.screenshot({ path: SCREENSHOT_FILE, type: 'png' }); } catch {}
}

async function launchBrowser() {
  return chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--lang=es-ES',
    ],
  });
}

async function applySession(context) {
  const cookies = store.loadSessionCookies();
  if (cookies && Array.isArray(cookies) && cookies.length) {
    await context.addCookies(cookies);
    log('[sesión] Cookies de Instagram cargadas');
    return true;
  }
  return false;
}
async function persistSession(context) {
  try {
    const cookies = await context.cookies();
    store.saveSessionCookies(cookies);
    log('[sesión] Sesión guardada');
  } catch {}
}

async function dismissCookies(page) {
  try {
    const btn = await page.$(
      'button:has-text("Allow all cookies"), button:has-text("Accept All"), button:has-text("Aceptar todo"), button:has-text("Permitir todas")'
    );
    if (btn) { await btn.click(); await randomDelay(800, 1500); }
  } catch {}
}

async function isLoggedIn(page) {
  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await dismissCookies(page);
    await randomDelay(1500, 2500);
    await snap(page);
    const loginInput = await page.$('input[name="username"]');
    return !loginInput && page.url().includes('instagram.com');
  } catch { return false; }
}

async function login(page, context) {
  log('[login] Abriendo página de login...');
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(1500, 3000);
  await dismissCookies(page);
  await randomDelay(500, 1000);
  await snap(page);

  let userField = null;
  try { userField = await page.waitForSelector('input[name="username"]', { timeout: 12000 }); } catch {}

  if (!userField) {
    if (!page.url().includes('accounts/login')) {
      log('[login] Redirigido fuera del login — sesión válida');
      await persistSession(context);
      return;
    }
    await snap(page);
    throw new Error('[login] Instagram bloqueó el acceso desde esta IP. Sube tu sesión desde la pestaña "Sesión IG".');
  }

  log('[login] Introduciendo credenciales...');
  await humanType(page, 'input[name="username"]', process.env.INSTAGRAM_USER);
  await randomDelay(400, 900);
  await humanType(page, 'input[name="password"]', process.env.INSTAGRAM_PASS);
  await randomDelay(600, 1200);
  await snap(page);
  await page.keyboard.press('Enter');
  try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}
  await randomDelay(2000, 4000);
  await snap(page);

  const url = page.url();
  if (url.includes('/challenge/') || url.includes('/two_factor') || url.includes('/checkpoint/')) {
    throw new Error('[login] Instagram pide verificación (2FA/email). Sube tu sesión desde "Sesión IG".');
  }
  if (url.includes('accounts/login')) {
    throw new Error('[login] Login fallido — revisa INSTAGRAM_USER / INSTAGRAM_PASS o sube tu sesión.');
  }

  log('[login] Login correcto');
  await persistSession(context);
}

async function ensureLoggedIn(page, context) {
  const hasCookies = await applySession(context);
  if (hasCookies && await isLoggedIn(page)) {
    log('[sesión] Sesión válida, login omitido');
    return;
  }
  if (hasCookies) log('[sesión] Sesión caducada, reintentando login...');
  await login(page, context);
}

async function fetchProfileBio(page, username) {
  try {
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
    await randomDelay(1000, 2000);
    return await page.evaluate(() => {
      const el = document.querySelector('span._ap3a') ||
        document.querySelector('h1 + div span') ||
        document.querySelector('div[class*="x7a106z"] span');
      return el ? el.innerText.trim() : '';
    });
  } catch { return ''; }
}

async function extractSuggestedProfiles(page, limit = 10) {
  log('[scrape] Explorando perfiles sugeridos...');
  await page.goto('https://www.instagram.com/explore/people/', { waitUntil: 'domcontentloaded' });
  await randomDelay(2000, 4000);
  for (let i = 0; i < 4; i++) await smoothScroll(page, 500);
  await randomDelay(1000, 2000);
  await snap(page);

  const profiles = await page.evaluate((max) => {
    const results = [], seen = new Set();
    const cards = document.querySelectorAll('div[class*="x1lliihq"] a[href^="/"]');
    for (const card of cards) {
      const href = card.getAttribute('href');
      if (!href || !href.match(/^\/[a-zA-Z0-9._]+\/$/) || seen.has(href)) continue;
      seen.add(href);
      const username = href.replace(/\//g, '');
      const c = card.closest('div[class]');
      const texts = c ? [...c.querySelectorAll('span, div')].map((e) => e.innerText?.trim()).filter(Boolean) : [];
      results.push({ username, name: texts[0] || username, bio: texts.slice(1).find((t) => t.length > 10 && t !== username) || '' });
      if (results.length >= max) break;
    }
    return results;
  }, limit);

  const enriched = [];
  for (const p of profiles) {
    if (!p.bio) enriched.push({ ...p, bio: await fetchProfileBio(page, p.username) });
    else enriched.push(p);
    await randomDelay(800, 1500);
  }
  log(`[scrape] ${enriched.length} perfiles encontrados`);
  return enriched;
}

async function sendDM(page, username, message) {
  log(`[dm] Abriendo perfil: @${username}`);
  await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
  await randomDelay(1500, 3000);
  await smoothScroll(page, 200);
  await randomDelay(500, 1000);
  await snap(page);

  const msgBtn = await page.$('div[role="button"]:has-text("Message"), button:has-text("Message"), div[role="button"]:has-text("Enviar mensaje")');
  if (!msgBtn) { log(`[dm] Sin botón Mensaje para @${username}, se omite`); return false; }

  await msgBtn.click();
  await randomDelay(2000, 4000);
  const notNow = await page.$('button:has-text("Not Now"), button:has-text("Ahora no")');
  if (notNow) { await notNow.click(); await randomDelay(800, 1500); }
  await snap(page);

  const input = await page.waitForSelector(
    'div[contenteditable="true"][role="textbox"], textarea[placeholder*="Message"], textarea[placeholder*="Mensaje"]',
    { timeout: 10000 }
  );
  await input.click();
  await randomDelay(500, 1000);
  for (const ch of message) await page.keyboard.type(ch, { delay: randomInt(80, 200) });
  await snap(page);
  await randomDelay(800, 1500);
  await page.keyboard.press('Enter');
  await randomDelay(1500, 3000);
  await snap(page);
  log(`[dm] Mensaje enviado a @${username}`);
  return true;
}

async function runOutreach(dailyLimit, trigger = 'manual') {
  const cfg = loadConfig();
  dailyLimit = dailyLimit || cfg.dailyLimit;
  const runId = store.startRun(trigger);
  log(`[outreach] Iniciando ejecución (${trigger}, límite ${dailyLimit})`);

  const browser = await launchBrowser();
  const ctxOpts = {
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 800 },
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
  };
  let videoName = null;
  if (cfg.recordVideo) {
    ctxOpts.recordVideo = { dir: RECORDINGS_DIR, size: { width: 1280, height: 800 } };
  }
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  _activePage = page;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  let sent = 0, skipped = 0, errors = 0;
  try {
    await ensureLoggedIn(page, context);
    const profiles = await extractSuggestedProfiles(page, dailyLimit + 10);
    const fresh = profiles.filter((p) => !store.hasContacted(p.username));
    log(`[outreach] ${fresh.length} perfiles nuevos (límite ${dailyLimit})`);

    const { generateDM } = require('./llm');
    let count = 0;
    for (const profile of fresh) {
      if (count >= dailyLimit) break;
      log(`[outreach] Procesando @${profile.username}`);
      let message = '', status = 'error';
      try {
        message = await generateDM(profile.bio || 'emprendedor en Instagram');
        log(`[llm] DM: ${message.substring(0, 55)}...`);
        const ok = await sendDM(page, profile.username, message);
        status = ok ? 'sent' : 'skipped';
      } catch (err) {
        log(`[outreach] Error @${profile.username}: ${err.message}`);
      }
      if (status === 'sent') sent++;
      else if (status === 'skipped') skipped++;
      else errors++;

      store.addLead({ ...profile, message, status, timestamp: new Date().toISOString() });
      store.updateRun(runId, { sent, skipped, errors });
      count++;

      if (count < dailyLimit && status === 'sent') {
        const wait = randomInt(cfg.intervalMin * 60000, cfg.intervalMax * 60000);
        log(`[outreach] Esperando ${Math.round(wait / 60000)} min...`);
        await sleep(wait);
      }
    }
    log(`[outreach] Terminado. ${sent} enviados, ${skipped} omitidos, ${errors} errores.`);
  } catch (err) {
    log(`[outreach] Error inesperado: ${err.message}`);
    try { await snap(page); } catch {}
    errors++;
  } finally {
    _activePage = null;
    try {
      const video = page.video();
      await context.close();
      if (video) {
        const orig = await video.path();
        videoName = `rec-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
        fs.renameSync(orig, path.join(RECORDINGS_DIR, videoName));
      }
    } catch {}
    await browser.close();
    store.finishRun(runId, { sent, skipped, errors, video: videoName });
  }
}

module.exports = { runOutreach, getActivePage, snap };
