require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

const SESSION_FILE = path.join(__dirname, 'session.json');
const LEADS_FILE = path.join(__dirname, 'leads.json');

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function randomDelay(min = 500, max = 2000) {
  await sleep(randomInt(min, max));
}

async function humanType(page, selector, text) {
  await page.click(selector);
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomInt(80, 200) });
  }
}

async function smoothScroll(page, distance = 300) {
  await page.evaluate((d) => window.scrollBy({ top: d, behavior: 'smooth' }), distance);
  await sleep(randomInt(400, 800));
}

function loadLeads() {
  if (!fs.existsSync(LEADS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')); }
  catch { return []; }
}

function appendLead(lead) {
  const leads = loadLeads();
  leads.push(lead);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

async function launchBrowser() {
  return chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  });
}

async function loadSession(context) {
  if (fs.existsSync(SESSION_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    await context.addCookies(cookies);
    log('[session] Cookies loaded from session.json');
    return true;
  }
  return false;
}

async function saveSession(context) {
  const cookies = await context.cookies();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
  log('[session] session.json saved');
}

async function isLoggedIn(page) {
  await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle' });
  await randomDelay(1000, 2000);
  return page.url().includes('instagram.com') && !(await page.$('input[name="username"]'));
}

async function login(page, context) {
  log('[login] Starting login flow...');
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle' });
  await randomDelay(1500, 3000);

  const usernameField = await page.$('input[name="username"]');
  if (!usernameField) throw new Error('[login] Login form not found — session may already be valid');

  await humanType(page, 'input[name="username"]', process.env.INSTAGRAM_USER);
  await randomDelay(400, 900);
  await humanType(page, 'input[name="password"]', process.env.INSTAGRAM_PASS);
  await randomDelay(600, 1200);
  await page.keyboard.press('Enter');
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
  await randomDelay(2000, 4000);

  const url = page.url();

  if (url.includes('/challenge/') || url.includes('/two_factor') || url.includes('/checkpoint/')) {
    throw new Error(
      '[login] Instagram requested verification (email/SMS/2FA). ' +
      'Run locally with headless:false, complete verification, save session.json, upload to Railway volume.'
    );
  }

  if (url.includes('accounts/login')) {
    throw new Error('[login] Login failed — check INSTAGRAM_USER and INSTAGRAM_PASS');
  }

  log('[login] Login successful');
  await saveSession(context);
}

async function ensureLoggedIn(page, context) {
  const loaded = await loadSession(context);
  if (loaded) {
    const ok = await isLoggedIn(page);
    if (ok) { log('[session] Session valid, skipping login'); return; }
    log('[session] Session expired, logging in again...');
  }
  await login(page, context);
}

async function fetchProfileBio(page, username) {
  try {
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'networkidle' });
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
  log('[scrape] Navigating to explore/people...');
  await page.goto('https://www.instagram.com/explore/people/', { waitUntil: 'networkidle' });
  await randomDelay(2000, 4000);
  for (let i = 0; i < 4; i++) await smoothScroll(page, 500);
  await randomDelay(1000, 2000);

  const profiles = await page.evaluate((max) => {
    const results = [], seen = new Set();
    const cards = document.querySelectorAll('div[class*="x1lliihq"] a[href^="/"]');
    for (const card of cards) {
      const href = card.getAttribute('href');
      if (!href || !href.match(/^\/[a-zA-Z0-9._]+\/$/) || seen.has(href)) continue;
      seen.add(href);
      const username = href.replace(/\//g, '');
      const container = card.closest('div[class]');
      const texts = container
        ? [...container.querySelectorAll('span, div')].map(el => el.innerText?.trim()).filter(Boolean)
        : [];
      results.push({ username, name: texts[0] || username, bio: texts.slice(1).find(t => t.length > 10 && t !== username) || '' });
      if (results.length >= max) break;
    }
    return results;
  }, limit);

  const enriched = [];
  for (const p of profiles) {
    if (!p.bio) {
      const bio = await fetchProfileBio(page, p.username);
      enriched.push({ ...p, bio });
    } else {
      enriched.push(p);
    }
    await randomDelay(800, 1500);
  }

  log(`[scrape] Found ${enriched.length} profiles`);
  return enriched;
}

async function sendDM(page, username, message) {
  log(`[dm] Opening profile: @${username}`);
  await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'networkidle' });
  await randomDelay(1500, 3000);
  await smoothScroll(page, 200);
  await randomDelay(500, 1000);

  const msgBtn = await page.$('div[role="button"]:has-text("Message"), button:has-text("Message")');
  if (!msgBtn) { log(`[dm] No Message button for @${username}, skipping`); return false; }

  await msgBtn.click();
  await randomDelay(2000, 4000);

  const notNow = await page.$('button:has-text("Not Now"), button:has-text("Ahora no")');
  if (notNow) { await notNow.click(); await randomDelay(800, 1500); }

  const input = await page.waitForSelector(
    'div[contenteditable="true"][role="textbox"], textarea[placeholder*="Message"]',
    { timeout: 10000 }
  );
  await input.click();
  await randomDelay(500, 1000);

  for (const char of message) {
    await page.keyboard.type(char, { delay: randomInt(80, 200) });
  }

  await randomDelay(800, 1500);
  await page.keyboard.press('Enter');
  await randomDelay(1500, 3000);
  log(`[dm] Message sent to @${username}`);
  return true;
}

async function runOutreach(dailyLimit = 20) {
  const alreadyContacted = new Set(loadLeads().map((l) => l.username));
  const browser = await launchBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 800 },
    locale: 'es-ES',
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    await ensureLoggedIn(page, context);
    const profiles = await extractSuggestedProfiles(page, dailyLimit + 10);
    const fresh = profiles.filter((p) => !alreadyContacted.has(p.username));
    log(`[outreach] ${fresh.length} new profiles (limit: ${dailyLimit})`);

    const { generateDM } = require('./llm');
    let count = 0;

    for (const profile of fresh) {
      if (count >= dailyLimit) break;
      log(`[outreach] Processing @${profile.username}`);
      let message = '', status = 'error';
      try {
        const bio = profile.bio || 'emprendedor en Instagram';
        message = await generateDM(bio);
        log(`[llm] DM: ${message.substring(0, 55)}...`);
        const sent = await sendDM(page, profile.username, message);
        status = sent ? 'sent' : 'skipped';
      } catch (err) {
        log(`[outreach] Error @${profile.username}: ${err.message}`);
      }

      appendLead({ username: profile.username, name: profile.name, bio: profile.bio, message, timestamp: new Date().toISOString(), status });
      count++;

      if (count < dailyLimit && status === 'sent') {
        const wait = randomInt(3 * 60000, 8 * 60000);
        log(`[outreach] Waiting ${Math.round(wait / 60000)} min before next DM...`);
        await sleep(wait);
      }
    }

    log(`[outreach] Done. Sent ${count} DMs.`);
  } catch (err) {
    if (err.message.includes('verification') || err.message.includes('2FA')) {
      log(`[FATAL] ${err.message}`);
      log('[FATAL] Stopping — manual verification required.');
      process.exit(1);
    }
    log(`[outreach] Unexpected error: ${err.message}`);
  } finally {
    await browser.close();
  }
}

module.exports = { runOutreach, loadLeads };
