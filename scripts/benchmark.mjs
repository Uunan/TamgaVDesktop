import fs from 'node:fs';
import httpMod from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright-core');

const BASE = (process.env.TAMGA_URL || 'http://127.0.0.1:4800').replace(/\/$/, '');
const USER = process.env.TAMGA_USER || 'admin';
const PASS = process.env.TAMGA_PASS || '';
const LABEL = process.argv[2] || 'current';
const OUT_FILE = process.argv[3] || `/tmp/tamga-bench-${LABEL}.json`;

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
      for (const e of fs.readdirSync(msRoot)) {
        candidates.push(
          path.join(msRoot, e, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
          path.join(msRoot, e, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
          path.join(msRoot, e, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
          path.join(msRoot, e, 'chrome-linux', 'chrome'),
          path.join(msRoot, e, 'chrome-mac', 'headless_shell')
        );
      }
    }
  }
  return candidates.find((c) => c && fs.existsSync(c));
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
}

function measureLocalDist() {
  const distDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../dist');
  const assetsDir = path.join(distDir, 'client', 'assets');
  const assetFiles = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
  const jsFiles = assetFiles
    .filter((f) => f.endsWith('.js'))
    .map((f) => {
      const buf = fs.readFileSync(path.join(assetsDir, f));
      return {
        file: f,
        rawBytes: buf.length,
        gzipBytes: zlib.gzipSync(buf).length,
        brBytes: zlib.brotliCompressSync(buf).length,
      };
    });
  jsFiles.sort((a, b) => b.rawBytes - a.rawBytes);
  const indexJs = jsFiles.find((j) => j.file.startsWith('index-')) || jsFiles[0] || null;
  return {
    jsChunkCount: jsFiles.length,
    entryJs: indexJs,
    topChunks: jsFiles.slice(0, 6),
    totalClientJsRaw: jsFiles.reduce((s, j) => s + j.rawBytes, 0),
    totalClientJsBr: jsFiles.reduce((s, j) => s + j.brBytes, 0),
    serverSize: fs.existsSync(path.join(distDir, 'server.js'))
      ? fs.statSync(path.join(distDir, 'server.js')).size
      : 0,
    cliSize: fs.existsSync(path.join(distDir, 'cli.js'))
      ? fs.statSync(path.join(distDir, 'cli.js')).size
      : 0,
  };
}

function rawHttpGet(urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = httpMod.request(
      BASE + urlPath,
      { method: 'GET', headers: { 'Accept-Encoding': 'br, gzip', ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const rawBuf = Buffer.concat(chunks);
          const enc = res.headers['content-encoding'] || 'identity';
          let decodedLen = rawBuf.length;
          try {
            if (enc === 'br') decodedLen = zlib.brotliDecompressSync(rawBuf).length;
            else if (enc === 'gzip') decodedLen = zlib.gunzipSync(rawBuf).length;
          } catch {}
          resolve({
            status: res.statusCode,
            enc,
            cacheCtrl: res.headers['cache-control'] || '',
            wireBytes: rawBuf.length,
            decodedBytes: decodedLen,
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function benchHttp(urlPath, headers = {}, runs = 5) {
  await rawHttpGet(urlPath, headers).catch(() => {});
  const times = [];
  let last = { wireBytes: 0, decodedBytes: 0, enc: 'identity', cacheCtrl: '' };
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    last = await rawHttpGet(urlPath, headers);
    times.push(Math.round((performance.now() - t0) * 10) / 10);
  }
  return {
    medianMs: median(times),
    runs: times,
    enc: last.enc,
    wireBytes: last.wireBytes,
    decodedBytes: last.decodedBytes,
    cacheCtrl: last.cacheCtrl,
  };
}

async function main() {
  const distStats = measureLocalDist();
  const healthRes = await fetch(BASE + '/api/health').then((r) => r.json());
  let cookiePair = '';
  let cookieName = '';
  let cookieVal = '';
  if (PASS) {
    const loginRes = await fetch(BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }),
    });
    const setCookie = loginRes.headers.get('set-cookie') || '';
    cookiePair = setCookie.split(';')[0];
    cookieName = cookiePair.split('=')[0];
    cookieVal = cookiePair.split('=').slice(1).join('=');
  }

  const hdrs = cookiePair ? { Cookie: cookiePair } : {};
  const htmlText = await fetch(BASE + '/', { headers: hdrs }).then((r) => r.text());
  const entryMatch = htmlText.match(/\/assets\/index-[^"']+\.js/);
  const entryAssetPath = entryMatch ? entryMatch[0] : null;

  const http = {
    health: await benchHttp('/api/health', {}, 7),
    systemInfo: await benchHttp('/api/system/info', hdrs, 5),
    indexHtml: await benchHttp('/', hdrs, 5),
    entryAsset: entryAssetPath ? await benchHttp(entryAssetPath, {}, 5) : null,
    appsList: await benchHttp('/api/apps', hdrs, 6),
    aptSearch: await benchHttp('/api/apps/search?q=python', hdrs, 4),
    vfsSnapshot: await benchHttp('/api/vfs/snapshot?desktop=main', hdrs, 6),
  };

  const browser = await chromium.launch({ headless: true, executablePath: findLocalBrowser() });
  const coldRuns = [];
  let warmMetrics = null;

  for (let run = 0; run < 3; run++) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
    if (cookieName) {
      await ctx.addCookies([{ name: cookieName, value: cookieVal, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    }
    const page = await ctx.newPage();
    const client = await ctx.newCDPSession(page);
    await client.send('Network.enable');
    let totalTransferBytes = 0;
    let jsTransferBytes = 0;
    let reqCount = 0;
    const reqTypes = new Map();
    client.on('Network.requestWillBeSent', (e) => {
      reqCount++;
      reqTypes.set(e.requestId, e.type);
    });
    client.on('Network.responseReceived', (e) => {
      if (e.type === 'Script') reqTypes.set(e.requestId, 'Script');
    });
    client.on('Network.loadingFinished', (e) => {
      totalTransferBytes += e.encodedDataLength || 0;
      if (reqTypes.get(e.requestId) === 'Script') jsTransferBytes += e.encodedDataLength || 0;
    });

    const t0 = performance.now();
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('[data-testid="desktop-canvas"]', { timeout: 20000 });
    const desktopReadyMs = Math.round(performance.now() - t0);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const perf = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      const resources = performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'script');
      const decodedJsBytes = resources.reduce((s, r) => s + (r.decodedBodySize || 0), 0);
      return {
        ttfbMs: nav ? Math.round(nav.responseStart - nav.requestStart) : 0,
        domInteractiveMs: nav ? Math.round(nav.domInteractive) : 0,
        loadMs: nav ? Math.round(nav.loadEventEnd) : 0,
        fcpMs: fcp ? Math.round(fcp.startTime) : 0,
        scriptCount: resources.length,
        decodedJsBytes,
      };
    });
    coldRuns.push({
      desktopReadyMs,
      ...perf,
      totalTransferBytes,
      jsTransferBytes,
      jsDecodedBytes: perf.decodedJsBytes,
      reqCount,
    });

    if (run === 2) {
      totalTransferBytes = 0;
      jsTransferBytes = 0;
      reqCount = 0;
      const w0 = performance.now();
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('[data-testid="desktop-canvas"]', { timeout: 20000 });
      const warmDesktopReadyMs = Math.round(performance.now() - w0);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const warmPerf = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const fcp = performance.getEntriesByName('first-contentful-paint')[0];
        return {
          ttfbMs: nav ? Math.round(nav.responseStart - nav.requestStart) : 0,
          loadMs: nav ? Math.round(nav.loadEventEnd) : 0,
          fcpMs: fcp ? Math.round(fcp.startTime) : 0,
        };
      });
      warmMetrics = { warmDesktopReadyMs, ...warmPerf, totalTransferBytes, jsTransferBytes, reqCount };
    }
    await ctx.close();
  }

  const uiCtx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  if (cookieName) {
    await uiCtx.addCookies([{ name: cookieName, value: cookieVal, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  }
  const uiPage = await uiCtx.newPage();
  await uiPage.goto(BASE, { waitUntil: 'networkidle' });
  await uiPage.waitForSelector('[data-testid="desktop-canvas"]');
  const laterBtn = uiPage.locator('button:has-text("Şimdi Değil")');
  if (await laterBtn.isVisible().catch(() => false)) await laterBtn.click();

  await uiPage.mouse.click(720, 420, { button: 'right' });
  await uiPage.waitForSelector('[data-testid="ctx-open-settings"]');
  const st0 = performance.now();
  await uiPage.locator('[data-testid="ctx-open-settings"]').click();
  await uiPage.locator('button:has-text("Görünüm")').first().click();
  await uiPage.waitForSelector('[data-testid="wp-card-prism-spectrum"] svg', { timeout: 10000 });
  await uiPage.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const settingsAppearanceMs = Math.round(performance.now() - st0);
  const svgStats = await uiPage.evaluate(() => ({
    wpCardCount: document.querySelectorAll('[data-testid^="wp-card-"]').length,
    blurFiltersInThumbs: document.querySelectorAll('[data-testid^="wp-card-"] feGaussianBlur').length,
    svgPrimitivesInThumbs: document.querySelectorAll('[data-testid^="wp-card-"] svg *').length,
  }));
  await uiPage.locator('button[title="Kapat"]').first().click();
  await uiPage.waitForTimeout(250);

  const as0 = performance.now();
  await uiPage.locator('button[title="Uygulamalar"], button:has-text("Uygulamalar")').first().click();
  await uiPage.locator('input[placeholder*="ara"], input[placeholder*="Ara"]').first().fill('GIMP');
  await uiPage.waitForSelector('button:has-text("Aç")', { timeout: 10000 });
  const appStoreReadyMs = Math.round(performance.now() - as0);

  let binFrames = 0;
  let binBytes = 0;
  uiPage.on('websocket', (ws) => {
    if (ws.url().includes('/ws/app')) {
      ws.on('framereceived', (f) => {
        if (Buffer.isBuffer(f.payload)) {
          binFrames++;
          binBytes += f.payload.length;
        }
      });
    }
  });
  const g0 = performance.now();
  await uiPage.locator('button:has-text("Aç")').first().click();
  while (performance.now() - g0 < 25000) {
    const ready = await uiPage.evaluate(() =>
      Array.from(document.querySelectorAll('canvas')).some((c) => c.width > 400 && c.height > 400)
    );
    if (ready) break;
    await uiPage.waitForTimeout(100);
  }
  const gimpFirstCanvasMs = Math.round(performance.now() - g0);
  const fBefore = binFrames;
  const bBefore = binBytes;
  await uiPage.waitForTimeout(1500);
  const cBox = await uiPage.locator('canvas').last().boundingBox();
  if (cBox) {
    await uiPage.mouse.click(cBox.x + cBox.width / 2, cBox.y + cBox.height / 2);
    await uiPage.keyboard.down('Control');
    await uiPage.keyboard.press('n');
    await uiPage.keyboard.up('Control');
    await uiPage.waitForTimeout(1200);
    await uiPage.keyboard.press('Escape');
    await uiPage.waitForTimeout(500);
  }
  const activeStreamFrames = binFrames - fBefore;
  const activeStreamKB = Math.round((binBytes - bBefore) / 1024);

  const closeBtns = uiPage.locator('button[title="Kapat"]');
  const cnt = await closeBtns.count();
  for (let i = cnt - 1; i >= 0; i--) {
    await closeBtns.nth(i).click().catch(() => {});
    await uiPage.waitForTimeout(200);
  }
  await uiPage.waitForTimeout(1000);
  await browser.close();

  const summary = {
    label: LABEL,
    measuredAt: new Date().toISOString(),
    serverVersion: healthRes.version,
    dist: distStats,
    http,
    coldBoot: {
      medianDesktopReadyMs: median(coldRuns.map((r) => r.desktopReadyMs)),
      medianFcpMs: median(coldRuns.map((r) => r.fcpMs)),
      medianLoadMs: median(coldRuns.map((r) => r.loadMs)),
      medianTtfbMs: median(coldRuns.map((r) => r.ttfbMs)),
      medianJsTransferBytes: median(coldRuns.map((r) => r.jsTransferBytes)),
      medianTotalTransferBytes: median(coldRuns.map((r) => r.totalTransferBytes)),
      runs: coldRuns,
    },
    warmReload: warmMetrics,
    ui: {
      settingsAppearanceMs,
      svgStats,
      appStoreReadyMs,
      gimpFirstCanvasMs,
      activeStreamFrames,
      activeStreamKB,
    },
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
