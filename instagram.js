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

// Búsquedas de emprendedores (personas, no marcas)
const DEFAULT_QUERIES = [
  'emprendedora', 'emprendedor', 'emprendimiento',
  'coach negocios', 'mentora negocios', 'infoproductos',
  'marca personal', 'freelance', 'negocios online',
];

// Palabras que indican perfil de empresa/marca (se descartan)
const COMPANY_RED_FLAGS = [
  's.l.', ' sl ', ' sa ', 's.a.', ' ltd', ' inc', ' corp',
  'tienda', 'shop', 'store', 'official', 'oficial',
  'agencia', 'agency', 'studio', 'estudio', 'soluciones',
  'marketing digital', 'diseño web', 'ecommerce',
];

// Palabras que confirman persona emprendedora (suma puntos)
const ENTREPRENEUR_KEYWORDS = [
  'emprendedor', 'emprendedora', 'emprendimiento',
  'fundador', 'fundadora', 'founder', 'ceo', 'coach',
  'freelance', 'negocio', 'startup', 'entrepreneur',
  'dueño', 'dueña', 'infoemprendedor', 'infoproducto',
  'consultor', 'consultora', 'mentor', 'mentora',
  'creador', 'creadora', 'creator',
];

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

async function dismissPopups(page) {
  // Textos de botones "No gracias" en cualquier idioma
  const noThanks = [
    'Not Now', 'Ahora no', 'No ahora', 'Skip', 'Cancel', 'Cancelar',
    'Close', 'Cerrar', 'Maybe Later', 'Quizás más tarde',
  ];
  for (const txt of noThanks) {
    try {
      const btn = await page.$(`button:has-text("${txt}"), [role="button"]:has-text("${txt}")`);
      if (btn) { await btn.click(); await randomDelay(300, 600); }
    } catch {}
  }
  // Cookies / GDPR
  try {
    const btn = await page.$(
      'button:has-text("Allow all cookies"), button:has-text("Accept All"), button:has-text("Aceptar todo"), button:has-text("Permitir todas")'
    );
    if (btn) { await btn.click(); await randomDelay(500, 900); }
  } catch {}
}

// Mantiene como alias por compatibilidad
const dismissCookies = dismissPopups;

async function isLoggedIn(page) {
  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await dismissPopups(page);
    await randomDelay(1500, 2500);
    await dismissPopups(page);
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

// ── Perfil ────────────────────────────────────────────────────
function isCompanyAccount(username, bio, name) {
  const text = ((username || '') + ' ' + (bio || '') + ' ' + (name || '')).toLowerCase();
  return COMPANY_RED_FLAGS.some((f) => text.includes(f));
}
function entrepreneurScore(bio) {
  const b = (bio || '').toLowerCase();
  return ENTREPRENEUR_KEYWORDS.filter((k) => b.includes(k)).length;
}

async function fetchProfileBio(page, username) {
  try {
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(800, 1500);
    return await page.evaluate(() => {
      const el =
        document.querySelector('span._ap3a') ||
        document.querySelector('h1 + div span') ||
        document.querySelector('div[class*="x7a106z"] span') ||
        document.querySelector('div.-vDIg span') ||
        [...document.querySelectorAll('span')].find((s) => s.innerText && s.innerText.length > 20 && s.innerText.length < 200);
      return el ? el.innerText.trim() : '';
    });
  } catch { return ''; }
}

function isContextClosedError(e) {
  return /closed|crash|detached|Navigation/i.test(e && e.message || '');
}

// Búsqueda rápida vía API interna de Instagram (usa las cookies del contexto)
async function searchUsers(page, query) {
  try {
    const result = await page.evaluate(async (q) => {
      try {
        const r = await fetch(
          `https://www.instagram.com/web/search/topsearch/?context=blended&query=${encodeURIComponent(q)}&include_reel=false`,
          { headers: { 'X-IG-App-ID': '936619743392459' }, credentials: 'include' }
        );
        if (!r.ok) return { httpError: r.status };
        return await r.json();
      } catch (err) { return { fetchError: String(err) }; }
    }, query);

    if (result.httpError) { log(`[scrape] "${query}" → HTTP ${result.httpError}`); return []; }
    if (result.fetchError) { log(`[scrape] "${query}" → ${result.fetchError}`); return []; }

    return (result.users || []).map((u) => ({
      username: u.user.username,
      name: u.user.full_name || u.user.username,
      isPrivate: !!u.user.is_private,
    }));
  } catch (e) {
    if (isContextClosedError(e)) throw e;
    log(`[scrape] Error buscando "${query}": ${e.message}`);
    return [];
  }
}

// Extrae perfiles de emprendedores vía búsqueda, filtrando empresas/privados
async function extractEntrepreneurProfiles(page, limit = 10) {
  const cfg = loadConfig();
  const queries = cfg.searchQueries && cfg.searchQueries.length ? cfg.searchQueries : DEFAULT_QUERIES;
  const seen = new Set();
  const candidates = [];

  for (const q of queries) {
    if (candidates.length >= limit * 4) break;
    log(`[scrape] Buscando "${q}"...`);
    const users = await searchUsers(page, q);
    for (const u of users) {
      if (seen.has(u.username) || u.isPrivate) continue;
      if (store.hasContacted(u.username)) continue;
      if (isCompanyAccount(u.username, '', u.name)) continue;
      seen.add(u.username);
      candidates.push(u);
    }
    await randomDelay(1500, 3000);
  }

  log(`[scrape] ${candidates.length} candidatos de búsqueda`);

  // Visitar cada perfil UNA vez para leer la bio y puntuar
  const profiles = [];
  for (const c of candidates) {
    if (profiles.length >= limit * 2) break;
    if (page.isClosed()) { log('[scrape] Navegador cerrado, deteniendo scrape'); break; }
    if (store.hasContacted(c.username)) continue;

    try {
      await page.goto(`https://www.instagram.com/${c.username}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) {
      if (isContextClosedError(e)) { log('[scrape] Navegador cerrado, deteniendo scrape'); break; }
      continue;
    }
    await randomDelay(700, 1300);

    const info = await page.evaluate(() => {
      const bioEl =
        document.querySelector('span._ap3a') ||
        document.querySelector('h1 + div span') ||
        document.querySelector('div[class*="x7a106z"] span') ||
        [...document.querySelectorAll('span')].find((s) => s.innerText && s.innerText.length > 15 && s.innerText.length < 200);
      const isPrivate = !!document.querySelector('h2[class*="x1lliihq"] + p, article p');
      return { bio: bioEl ? bioEl.innerText.trim() : '', isPrivate };
    });

    if (info.isPrivate) { log(`[scrape] @${c.username} privada, omitida`); continue; }
    if (isCompanyAccount(c.username, info.bio, c.name)) { log(`[scrape] @${c.username} parece empresa, omitida`); continue; }

    const score = entrepreneurScore(`${info.bio} ${c.name}`);
    if (score < 1) { log(`[scrape] @${c.username} sin keywords de emprendimiento, omitida`); continue; }
    profiles.push({ username: c.username, name: c.name, bio: info.bio, _score: score });
    await randomDelay(500, 1100);
  }

  profiles.sort((a, b) => b._score - a._score);
  log(`[scrape] ${profiles.length} emprendedores válidos`);
  return profiles;
}

// ── DM ────────────────────────────────────────────────────────
async function findMessageButton(page) {
  // Estrategia 1: selectores de texto directo
  const textSelectors = [
    '[role="button"]:has-text("Message")',
    '[role="button"]:has-text("Mensaje")',
    '[role="button"]:has-text("Enviar mensaje")',
    'button:has-text("Message")',
    'button:has-text("Mensaje")',
  ];
  for (const sel of textSelectors) {
    try { const el = await page.$(sel); if (el) return el; } catch {}
  }

  // Estrategia 2: buscar por texto en todos los botones via evaluate
  try {
    const handle = await page.evaluateHandle(() => {
      const all = [...document.querySelectorAll('[role="button"], button')];
      return all.find((el) => /^(message|mensaje|enviar mensaje)$/i.test(el.innerText?.trim())) || null;
    });
    if (handle && (await handle.asElement())) return handle.asElement();
  } catch {}

  // Estrategia 3: aria-label
  try {
    const el = await page.$('[aria-label*="essage"], [aria-label*="ensaje"]');
    if (el) return el;
  } catch {}

  return null;
}

async function sendDM(page, username, message) {
  log(`[dm] Abriendo perfil: @${username}`);
  await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await randomDelay(1200, 2500);
  await dismissPopups(page);
  await smoothScroll(page, 200);
  await randomDelay(400, 900);
  await snap(page);

  const msgBtn = await findMessageButton(page);
  if (!msgBtn) {
    log(`[dm] Sin botón Mensaje para @${username} (privada o sin DMs), se omite`);
    return false;
  }

  await msgBtn.click();
  await randomDelay(1500, 3000);
  await dismissPopups(page);   // Elimina "Turn on Notifications", "Save login", etc.
  await randomDelay(500, 1000);
  await dismissPopups(page);   // Segunda pasada por si tarda en aparecer
  await snap(page);

  // Esperar el campo de texto del DM
  let input = null;
  try {
    input = await page.waitForSelector(
      'div[contenteditable="true"][role="textbox"], textarea[placeholder*="essage"], textarea[placeholder*="ensaje"], div[aria-label*="essage"], div[aria-label*="ensaje"]',
      { timeout: 12000 }
    );
  } catch {
    // Último intento: puede que un popup bloqueara el selector
    await dismissPopups(page);
    await randomDelay(800, 1500);
    try {
      input = await page.waitForSelector(
        'div[contenteditable="true"][role="textbox"], textarea[placeholder*="essage"], textarea[placeholder*="ensaje"]',
        { timeout: 6000 }
      );
    } catch {
      log(`[dm] No apareció el cuadro de texto para @${username}, se omite`);
      await snap(page);
      return false;
    }
  }

  await input.click();
  await randomDelay(400, 900);
  for (const ch of message) await page.keyboard.type(ch, { delay: randomInt(60, 160) });
  await snap(page);
  await randomDelay(700, 1400);
  await page.keyboard.press('Enter');
  await randomDelay(1200, 2500);
  await dismissPopups(page);   // Por si aparece algo tras enviar
  await snap(page);
  log(`[dm] ✓ Mensaje enviado a @${username}`);
  return true;
}

// ── Outreach principal ────────────────────────────────────────
async function runOutreach(dailyLimit, trigger = 'manual', stopSignal = {}) {
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
    const profiles = await extractEntrepreneurProfiles(page, dailyLimit + 5);
    const fresh = profiles.filter((p) => !store.hasContacted(p.username));
    log(`[outreach] ${fresh.length} perfiles de emprendedores listos`);

    const { generateDM } = require('./llm');
    let count = 0;
    for (const profile of fresh) {
      if (count >= dailyLimit) break;
      if (stopSignal.stop) { log('[outreach] ⏹ Parada solicitada — detenido'); break; }
      if (page.isClosed()) { log('[outreach] Navegador cerrado (redeploy) — detenido'); break; }

      // Doble comprobación anti-duplicado justo antes de enviar
      if (store.hasContacted(profile.username)) {
        log(`[outreach] @${profile.username} ya contactado, se salta`);
        continue;
      }

      log(`[outreach] Procesando @${profile.username} (score: ${profile._score || 0})`);

      // Registrar ANTES de enviar para evitar duplicados aunque el proceso crashee
      const { _score, ...profileData } = profile;
      const leadEntry = store.addLead({ ...profileData, message: '', status: 'pending', timestamp: new Date().toISOString() });

      let message = '', status = 'error';
      try {
        message = await generateDM(profile.bio || 'emprendedor en Instagram');
        log(`[llm] DM: ${message.substring(0, 60)}...`);
        const ok = await sendDM(page, profile.username, message);
        status = ok ? 'sent' : 'skipped';
      } catch (err) {
        log(`[outreach] Error @${profile.username}: ${err.message}`);
        status = 'error';
      }
      if (status === 'sent') sent++;
      else if (status === 'skipped') skipped++;
      else errors++;

      // Actualizar el lead con el resultado real
      store.updateLead(leadEntry.id, { message, status });
      store.updateRun(runId, { sent, skipped, errors });
      count++;

      if (count < dailyLimit && status === 'sent') {
        const wait = randomInt(cfg.intervalMin * 60000, cfg.intervalMax * 60000);
        log(`[outreach] Esperando ${Math.round(wait / 60000)} min...`);
        // Navegar a home durante la espera para que Instagram no muestre popups raros
        try {
          await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
          await dismissPopups(page);
        } catch {}
        await sleep(wait);
        if (!page.isClosed()) await dismissPopups(page);
      }
    }
    log(`[outreach] Terminado. ${sent} enviados, ${skipped} omitidos, ${errors} errores.`);
  } catch (err) {
    if (isContextClosedError(err)) {
      log('[outreach] Navegador cerrado (probablemente un redeploy de Railway). Se reintentará en la próxima ejecución.');
    } else {
      log(`[outreach] Error inesperado: ${err.message}`);
      try { await snap(page); } catch {}
      errors++;
    }
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
