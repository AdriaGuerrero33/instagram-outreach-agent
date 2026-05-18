#!/usr/bin/env node
/**
 * get-session.js — extrae cookies de Instagram desde tu propio Chrome
 *
 * Requisitos: Node.js + npx (no necesitas instalar nada más, usa playwright que ya está)
 * Uso:  node get-session.js
 *
 * 1. Abre Chrome
 * 2. Entra en Instagram como siempre
 * 3. El script detecta el login y guarda session.json
 * 4. Sube ese JSON en la pestaña "Sesión IG" del panel
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('\n🔐 Instagram Session Extractor');
  console.log('─────────────────────────────────────────');
  console.log('Abriendo Chrome… entra en Instagram con tu cuenta.');
  console.log('El script detectará el login automáticamente.\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  const ctx = await browser.newContext({
    viewport: null,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-ES',
  });

  const page = await ctx.newPage();
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });

  console.log('⏳ Esperando que inicies sesión…');

  // Poll until we detect a logged-in state (no login form visible)
  let loggedIn = false;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(1000);
    const url = page.url();
    const isHome =
      url.includes('instagram.com') &&
      !url.includes('/accounts/login') &&
      !url.includes('/accounts/signup');
    if (isHome) {
      // Double-check: wait a bit more for full load
      await page.waitForTimeout(2000);
      const stillLogged = !page.url().includes('/accounts/login');
      if (stillLogged) { loggedIn = true; break; }
    }
  }

  if (!loggedIn) {
    console.error('\n❌ Timeout: no se detectó el login en 2 minutos. Vuelve a intentarlo.');
    await browser.close();
    process.exit(1);
  }

  console.log('\n✅ Login detectado! Extrayendo cookies…');

  const rawCookies = await ctx.cookies(['https://www.instagram.com']);

  // Filter to only IG-relevant cookies
  const cookies = rawCookies
    .filter((c) => c.domain.includes('instagram.com'))
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax',
      expires: c.expires && c.expires > 0 ? c.expires : undefined,
    }));

  const outFile = path.join(process.cwd(), 'session.json');
  fs.writeFileSync(outFile, JSON.stringify(cookies, null, 2));

  console.log(`✅ ${cookies.length} cookies guardadas en: ${outFile}`);
  console.log('\n📋 Próximos pasos:');
  console.log('   1. Abre el panel de tu agente en Railway');
  console.log('   2. Ve a la pestaña "Sesión IG"');
  console.log('   3. Pega el contenido de session.json en el campo de texto');
  console.log('   4. Pulsa "Guardar sesión"');
  console.log('\n   O usa este comando curl (reemplaza TU_URL y TU_PASS):');
  console.log(`   curl -u :TU_PASS -X POST https://TU_URL/api/session \\`);
  console.log(`        -H "Content-Type: application/json" \\`);
  console.log(`        -d @session.json\n`);

  await browser.close();
})();
