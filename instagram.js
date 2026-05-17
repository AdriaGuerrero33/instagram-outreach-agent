require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

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
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function appendLead(lead) {
  const leads = loadLeads();
  leads.push(lead);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

async function launchBrowser() {
  return chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });
}

async function loadSession(context) {
  if (fs.existsSync(SESSION_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    await context.addCookies(cookies);
    console.log('[session] Cookies loaded from session.json');
    return true;
  }
  return false;
}

async function saveSession(context) {
  const cookies = await context.cookies();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
  console.log('[session] session.json saved');
}

async function isLoggedIn(page) {
  await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle' });
  await randomDelay(1000, 2000);
  return page.url().includes('instagram.com') && !(await page.$('input[name="username"]'));
}

async function login(page, context) {
  console.log('[login] Starting login flow...');
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle' });
  await randomDelay(1500, 3000);

  const usernameField = await page.$('input[name="username"]');
  if (!usernameField) {
    throw new Error('[login] Login form not found — session may already be valid');
  }

  await humanType(page, 'input[name="username"]', process.env.INSTAGRAM_USER);
  await randomDelay(400, 900);
  await humanType(page, 'input[name="password"]', process.env.INSTAGRAM_PASS);
  await randomDelay(600, 1200);

  await page.keyboard.press('Enter');
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
  await randomDelay(2000, 4000);

  const currentUrl = page.url();

  if (
    currentUrl.includes('/challenge/') ||
    currentUrl.includes('/two_factor') ||
    currentUrl.includes('/checkpoint/')
  ) {
    throw new Error(
      '[login] Instagram requested verification (email/SMS/2FA). ' +
        'Run locally with headless:false to complete verification, save session.json, and upload it.'
    );
  }

  if (currentUrl.includes('accounts/login')) {
    throw new Error('[login] Login failed — check INSTAGRAM_USER and INSTAGRAM_PASS');
  }

  console.log('[login] Login successful');
  await saveSession(context);
}

async function ensureLoggedIn(page, context) {
  const sessionLoaded = await loadSession(context);

  if (sessionLoaded) {
    const loggedIn = await isLoggedIn(page);
    if (loggedIn) {
      console.log('[session] Session valid, skipping login');
      return;
    }
    console.log('[session] Session expired, logging in again...');
  }

  await login(page, context);
}

async function extractSuggestedProfiles(page, limit = 10) {
  console.log('[scrape] Navigating to explore/people...');
  await page.goto('https://www.instagram.com/explore/people/', { waitUntil: 'networkidle' });
  await randomDelay(2000, 4000);

  // Scroll to load more profiles
  for (let i = 0; i < 4; i++) {
    await smoothScroll(page, 500);
  }
  await randomDelay(1000, 2000);

  const profiles = await page.evaluate((maxProfiles) => {
    const results = [];
    // Profile cards in explore/people
    const cards = document.querySelectorAll('div[class*="x1lliihq"] a[href^="/"]');
    const seen = new Set();

    for (const card of cards) {
      const href = card.getAttribute('href');
      if (!href || !href.match(/^\/[a-zA-Z0-9._]+\/$/) || seen.has(href)) continue;
      seen.add(href);

      const username = href.replace(/\//g, '');
      // Try to grab name and bio from surrounding container
      const container = card.closest('div[class]');
      const texts = container ? [...container.querySelectorAll('span, div')].map((el) => el.innerText?.trim()).filter(Boolean) : [];
      const name = texts[0] || username;
      const bio = texts.slice(1).find((t) => t.length > 10 && t !== username) || '';

      results.push({ username, name, bio });
      if (results.length >= maxProfiles) break;
    }
    return results;
  }, limit);

  // Fallback: visit profile pages directly to get bio if scraping yielded empty bios
  const enriched = [];
  for (const profile of profiles) {
    if (!profile.bio) {
      const bio = await fetchProfileBio(page, profile.username);
      enriched.push({ ...profile, bio });
    } else {
      enriched.push(profile);
    }
    await randomDelay(800, 1500);
  }

  console.log(`[scrape] Found ${enriched.length} profiles`);
  return enriched;
}

async function fetchProfileBio(page, username) {
  try {
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'networkidle' });
    await randomDelay(1000, 2000);

    const bio = await page.evaluate(() => {
      const bioEl = document.querySelector('span._ap3a') || document.querySelector('h1 + div span') || document.querySelector('div[class*="x7a106z"] span');
      return bioEl ? bioEl.innerText.trim() : '';
    });
    return bio;
  } catch {
    return '';
  }
}

async function sendDM(page, username, message) {
  console.log(`[dm] Navigating to profile: ${username}`);
  await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'networkidle' });
  await randomDelay(1500, 3000);

  await smoothScroll(page, 200);
  await randomDelay(500, 1000);

  // Click "Message" button
  const msgButton = await page.$(
    'div[role="button"]:has-text("Message"), a[href*="direct"]:has-text("Message"), button:has-text("Message")'
  );

  if (!msgButton) {
    console.log(`[dm] No Message button found for ${username}, skipping`);
    return false;
  }

  await msgButton.click();
  await randomDelay(2000, 4000);

  // Handle any "Not Now" popup (notifications dialog)
  const notNow = await page.$('button:has-text("Not Now"), button:has-text("Ahora no")');
  if (notNow) {
    await notNow.click();
    await randomDelay(800, 1500);
  }

  // Focus the DM input
  const dmInput = await page.waitForSelector(
    'div[contenteditable="true"][role="textbox"], textarea[placeholder*="Message"]',
    { timeout: 10000 }
  );

  await dmInput.click();
  await randomDelay(500, 1000);

  // Type character by character
  for (const char of message) {
    await page.keyboard.type(char, { delay: randomInt(80, 200) });
  }

  await randomDelay(800, 1500);
  await page.keyboard.press('Enter');
  await randomDelay(1500, 3000);

  console.log(`[dm] Message sent to ${username}`);
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

  // Hide automation signals
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    await ensureLoggedIn(page, context);

    const profiles = await extractSuggestedProfiles(page, dailyLimit + 10);
    const fresh = profiles.filter((p) => !alreadyContacted.has(p.username));

    console.log(`[outreach] ${fresh.length} new profiles to contact (limit: ${dailyLimit})`);

    const { generateDM } = require('./llm');
    let count = 0;

    for (const profile of fresh) {
      if (count >= dailyLimit) break;

      console.log(`\n[outreach] Processing: @${profile.username}`);
      let message = '';
      let status = 'error';

      try {
        const bio = profile.bio || 'emprendedor en Instagram';
        message = await generateDM(bio);
        console.log(`[llm] Generated DM: ${message.substring(0, 60)}...`);

        const sent = await sendDM(page, profile.username, message);
        status = sent ? 'sent' : 'skipped';
      } catch (err) {
        console.error(`[outreach] Error with @${profile.username}: ${err.message}`);
        status = 'error';
      }

      appendLead({
        username: profile.username,
        name: profile.name,
        bio: profile.bio,
        message,
        timestamp: new Date().toISOString(),
        status,
      });

      count++;

      if (count < dailyLimit && status === 'sent') {
        // Wait 3-8 minutes between DMs
        const waitMs = randomInt(3 * 60 * 1000, 8 * 60 * 1000);
        console.log(`[outreach] Waiting ${Math.round(waitMs / 60000)} min before next DM...`);
        await sleep(waitMs);
      }
    }

    console.log(`\n[outreach] Done. Sent ${count} DMs today.`);
  } catch (err) {
    if (err.message.includes('verification') || err.message.includes('2FA')) {
      console.error('\n[FATAL] ' + err.message);
      console.error('[FATAL] Stopping agent — manual action required.');
      process.exit(1);
    }
    console.error('[outreach] Unexpected error:', err.message);
  } finally {
    await browser.close();
  }
}

module.exports = { runOutreach };
