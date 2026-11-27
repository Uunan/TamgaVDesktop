import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright-core');

const BASE = (process.env.TAMGA_URL || 'http://127.0.0.1:4800').replace(/\/$/, '');
const USER = process.env.TAMGA_USER || 'admin';
const PASS = process.env.TAMGA_PASS || '';
const ART_DIR = process.env.OUT_DIR || '/tmp/tamga-verify';

function findLocalBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  for (const msRoot of [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ]) {
    if (fs.existsSync(msRoot)) {
      for (const entry of fs.readdirSync(msRoot)) {
        candidates.push(
          path.join(msRoot, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
          path.join(msRoot, entry, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
          path.join(msRoot, entry, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
          path.join(msRoot, entry, 'chrome-linux', 'chrome'),
          path.join(msRoot, entry, 'chrome-mac', 'headless_shell')
        );
      }
    }
  }
  return candidates.find((c) => c && fs.existsSync(c));
}

async function main() {
  fs.mkdirSync(ART_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: findLocalBrowser() });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  if (PASS) {
    await page.evaluate(
      async ({ username, password }) => {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        if (!res.ok) throw new Error('Login failed: ' + res.status);
      },
      { username: USER, password: PASS }
    );
    await page.reload({ waitUntil: 'networkidle' });
  }
  await page.waitForSelector('[data-testid="desktop-canvas"]', { timeout: 15000 });
  await page.waitForTimeout(800);

  const laterBtn = page.locator('button:has-text("Şimdi Değil")');
  if (await laterBtn.isVisible().catch(() => false)) {
    await laterBtn.click();
    await page.waitForTimeout(250);
  }

  // 1. Desktop system icons + drag + persistence + drop guards
  const hasSysApps = await page.locator('[data-testid="desktop-icon-sys-apps"]').count();
  const hasSysBrowser = await page.locator('[data-testid="desktop-icon-sys-browser"]').count();
  const hasSysTerminal = await page.locator('[data-testid="desktop-icon-sys-terminal"]').count();
  const hasSysCompute = await page.locator('[data-testid="desktop-icon-sys-compute"]').count();
  const hasSysTrash = await page.locator('[data-testid="desktop-icon-sys-trash"]').count();
  console.log('ICONS_PRESENCE:', { hasSysApps, hasSysBrowser, hasSysTerminal, hasSysCompute, hasSysTrash });
  if (hasSysApps !== 0) throw new Error('FAIL: Uygulamalar (sys-apps) should not be on desktop');
  if (!hasSysBrowser || !hasSysTerminal || !hasSysCompute || !hasSysTrash) {
    throw new Error('FAIL: Missing one of the 4 system icons');
  }

  await page.evaluate(async () => {
    await fetch('/api/vfs/reset-positions?desktop=main', { method: 'POST' });
    await fetch('/api/vfs/meta?desktop=main', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { autoArrange: false, wallpaper: 'mono-peaks', theme: 'dark' } }),
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="desktop-icon-sys-trash"]', { timeout: 10000 });
  await page.waitForTimeout(450);
  if (await laterBtn.isVisible().catch(() => false)) await laterBtn.click();

  const trashEl = page.locator('[data-testid="desktop-icon-sys-trash"]');
  const trashBoxBefore = await trashEl.boundingBox();
  await page.mouse.move(trashBoxBefore.x + trashBoxBefore.width / 2, trashBoxBefore.y + trashBoxBefore.height / 2);
  await page.mouse.down();
  await page.mouse.move(480, 280, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const trashBoxAfter = await trashEl.boundingBox();
  console.log('TRASH_DRAG:', { before: `${Math.round(trashBoxBefore.x)},${Math.round(trashBoxBefore.y)}`, after: `${Math.round(trashBoxAfter.x)},${Math.round(trashBoxAfter.y)}` });
  if (Math.abs(trashBoxAfter.x - trashBoxBefore.x) < 120) {
    throw new Error('FAIL: Trash icon did not drag cleanly');
  }

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="desktop-icon-sys-trash"]', { timeout: 10000 });
  await page.waitForTimeout(450);
  if (await laterBtn.isVisible().catch(() => false)) await laterBtn.click();
  const trashBoxReloaded = await page.locator('[data-testid="desktop-icon-sys-trash"]').boundingBox();
  if (Math.abs(trashBoxReloaded.x - trashBoxAfter.x) > 10) {
    throw new Error('FAIL: Trash position did not persist across reload');
  }

  const computeEl = page.locator('[data-testid="desktop-icon-sys-compute"]');
  const projelerEl = page.locator('[data-testid="desktop-node-Projeler"]');
  const computeBefore = await computeEl.boundingBox();
  const projBox = await projelerEl.boundingBox();
  if (projBox) {
    await page.mouse.move(computeBefore.x + computeBefore.width / 2, computeBefore.y + computeBefore.height / 2);
    await page.mouse.down();
    await page.mouse.move(projBox.x + projBox.width / 2, projBox.y + projBox.height / 2, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const computeAfter = await computeEl.boundingBox();
    if (Math.abs(computeAfter.x - computeBefore.x) > 5 || Math.abs(computeAfter.y - computeBefore.y) > 5) {
      throw new Error('FAIL: System icon dropped onto Projeler folder');
    }
  }
  console.log('SYSTEM_ICON_DROP_GUARDS: PASS');

  await page.evaluate(async () => {
    await fetch('/api/vfs/reset-positions?desktop=main', { method: 'POST' });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="desktop-canvas"]', { timeout: 10000 });
  await page.waitForTimeout(400);
  if (await laterBtn.isVisible().catch(() => false)) await laterBtn.click();

  // 2. Motionless desktop wallpapers & animated screensaver check
  const setWp = async (wp, theme = 'dark') => {
    await page.evaluate(
      async ({ wp, theme }) => {
        await fetch('/api/vfs/meta?desktop=main', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferences: { wallpaper: wp, theme } }),
        });
      },
      { wp, theme }
    );
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-wallpaper-id]', { timeout: 10000 });
    await page.waitForTimeout(450);
    if (await laterBtn.isVisible().catch(() => false)) await laterBtn.click();
    return page.evaluate(() => {
      const el = document.querySelector('[data-wallpaper-id]');
      const anims = document.getAnimations().filter((a) => {
        const t = a.effect?.target;
        return t && el?.contains(t);
      });
      return {
        id: el?.getAttribute('data-wallpaper-id'),
        attrAnimated: el?.getAttribute('data-wallpaper-animated'),
        runningAnims: anims.length,
      };
    });
  };

  for (const [wpId, theme, file] of [
    ['mono-peaks', 'dark', 'v250_wp_mono_peaks.png'],
    ['geo-aurora', 'dark', 'v250_wp_aurora.png'],
    ['silk-flow', 'dark', 'v250_wp_silk.png'],
    ['wheat-field', 'dark', 'v250_wp_wheat.png'],
    ['glass-orbs', 'dark', 'v250_wp_glass_orbs.png'],
    ['prism-spectrum', 'dark', 'v250_wp_prism.png'],
    ['mono-peaks', 'light', 'v250_wp_light_peaks.png'],
  ]) {
    const info = await setWp(wpId, theme);
    console.log('WP_CHECK:', wpId, theme, info);
    if (info.attrAnimated !== 'false' || info.runningAnims > 0) {
      throw new Error(`Desktop wallpaper ${wpId} (${theme}) MUST be motionless: ${JSON.stringify(info)}`);
    }
    await page.screenshot({ path: path.join(ART_DIR, file) });
  }

  await setWp('mono-peaks', 'dark');
  await page.mouse.click(720, 420, { button: 'right' });
  await page.waitForSelector('[data-testid="ctx-open-settings"]', { timeout: 5000 });
  await page.locator('[data-testid="ctx-open-settings"]').click();
  await page.waitForTimeout(450);
  await page.locator('button:has-text("Görünüm")').first().click();
  await page.waitForTimeout(450);
  const allCards = await page.locator('[data-testid^="wp-card-"]').count();
  const animBadges = await page.locator('[data-testid^="wp-badge-animated-"]').count();
  const filterTabs = await page.locator('[data-testid^="wp-filter-"]').count();
  const ssBadge = await page.locator('[data-testid="screensaver-badge-animated"]').count();
  console.log('SETTINGS_WP_GALLERY:', { allCards, animBadges, filterTabs, ssBadge });
  if (allCards !== 26 || animBadges !== 0 || filterTabs !== 0 || ssBadge !== 1) {
    throw new Error(`Settings gallery mismatch: ${JSON.stringify({ allCards, animBadges, filterTabs, ssBadge })}`);
  }
  await page.screenshot({ path: path.join(ART_DIR, 'v250_settings_wallpapers.png') });

  const ssCard = page.locator('[data-testid="screensaver-settings-card"]');
  await ssCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(ART_DIR, 'v250_settings_screensaver.png') });

  await page.locator('[data-testid="screensaver-scene-select"]').selectOption('wallpaper');
  await page.waitForTimeout(200);
  await page.locator('[data-testid="screensaver-preview-btn"]').click();
  await page.waitForSelector('[data-testid="screensaver-overlay"]', { timeout: 5000 });
  await page.waitForTimeout(550);
  const ssLive = await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="screensaver-overlay"]');
    const wpEl = overlay?.querySelector('[data-wallpaper-id]');
    const anims = document.getAnimations().filter((a) => {
      const t = a.effect?.target;
      return t && wpEl?.contains(t);
    });
    return {
      id: wpEl?.getAttribute('data-wallpaper-id'),
      attrAnimated: wpEl?.getAttribute('data-wallpaper-animated'),
      runningAnims: anims.length,
    };
  });
  console.log('SCREENSAVER_LIVE:', ssLive);
  if (ssLive.id !== 'mono-peaks' || ssLive.attrAnimated !== 'true' || ssLive.runningAnims === 0) {
    throw new Error(`Expected animated screensaver: ${JSON.stringify(ssLive)}`);
  }
  await page.screenshot({ path: path.join(ART_DIR, 'v250_screensaver_live.png') });
  await page.mouse.click(200, 200);
  await page.waitForTimeout(300);

  await page.keyboard.press('Escape');
  const closeWinBtn = page.locator('button[title="Kapat"]').first();
  if (await closeWinBtn.isVisible().catch(() => false)) await closeWinBtn.click();
  await page.waitForTimeout(300);

  // 3. GIMP launch & dialog check
  await page.locator('button[title="Uygulamalar"], button:has-text("Uygulamalar")').first().click();
  await page.waitForTimeout(900);
  await page.locator('input[placeholder*="ara"], input[placeholder*="Ara"]').first().fill('GIMP');
  await page.waitForTimeout(400);

  const gimpEvents = [];
  page.on('websocket', (ws) => {
    if (ws.url().includes('/ws/app')) {
      ws.on('framereceived', (f) => {
        if (typeof f.payload === 'string') gimpEvents.push(f.payload);
      });
    }
  });

  await page.locator('button:has-text("Aç")').first().click();
  const waitStart = Date.now();
  while (Date.now() - waitStart < 25000) {
    const ready = await page.evaluate(() =>
      Array.from(document.querySelectorAll('canvas')).some((c) => c.width > 400 && c.height > 400)
    );
    if (ready) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(2500);
  const gimpState = await page.evaluate(() => ({
    canvases: Array.from(document.querySelectorAll('canvas')).map((c) => ({ w: c.width, h: c.height })),
  }));
  const hadSplashTitle = gimpEvents.some((e) => e.includes('GIMP Startup'));
  console.log('GIMP_CHECK:', { gimpState, hadSplashTitle });
  if (hadSplashTitle) throw new Error('GIMP displayed startup splash screen');
  if (!gimpState.canvases.some((c) => c.w > 400 && c.h > 400)) {
    throw new Error('GIMP canvas did not finish painting');
  }
  await page.screenshot({ path: path.join(ART_DIR, 'v250_gimp_live.png') });

  const cBox = await page.locator('canvas').last().boundingBox();
  if (cBox) {
    await page.mouse.click(cBox.x + cBox.width / 2, cBox.y + cBox.height / 2);
    await page.waitForTimeout(300);
    await page.keyboard.down('Control');
    await page.keyboard.press('n');
    await page.keyboard.up('Control');
    await page.waitForTimeout(1600);
    await page.screenshot({ path: path.join(ART_DIR, 'v250_gimp_dialog.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  const closeBtns = page.locator('button[title="Kapat"]');
  const cnt = await closeBtns.count();
  for (let i = cnt - 1; i >= 0; i--) {
    await closeBtns.nth(i).click().catch(() => {});
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1200);

  await page.evaluate(async () => {
    await fetch('/api/vfs/reset-positions?desktop=main', { method: 'POST' });
    await fetch('/api/vfs/meta?desktop=main', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { wallpaper: 'mono-peaks', theme: 'dark' } }),
    });
  });

  await browser.close();
  if (pageErrors.length > 0) throw new Error('Page errors occurred: ' + pageErrors.join('; '));
  console.log('ALL_UI_AND_GIMP_CHECKS_PASSED');
}

main().catch((e) => {
  console.error('VERIFY_ERROR:', e);
  process.exit(1);
});
