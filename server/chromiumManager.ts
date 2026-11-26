import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import type {
  Browser,
  BrowserContext,
  CDPSession,
  Page,
} from 'playwright-core';
import type { VFSManager } from './vfsManager.js';

const require = createRequire(import.meta.url);

async function loadPlaywrightChromium() {
  try {
    const pw = await import('playwright-core');
    return pw.chromium;
  } catch {
    throw new Error('Yerleşik Playwright Chromium yüklü değil.');
  }
}

export interface TabSummary {
  id: string;
  url: string;
  title: string;
  favicon: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isSecure: boolean;
  isPlayingAudio: boolean;
  mode: 'newtab' | 'file' | 'web';
  filePath?: string;
}

interface InternalTab {
  id: string;
  mode: 'newtab' | 'file' | 'web';
  filePath?: string;
  url: string;
  title: string;
  favicon: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  lastAudioAt: number;
  page?: Page;
  cdp?: CDPSession;
  lastFrameBuffer?: Buffer;
  lastScreencastData?: string;
  streaming: boolean;
  settleTimer?: ReturnType<typeof setTimeout>;
  suppressSettleUntil?: number;
  lastUserInputAt?: number;
  lastPngAt?: number;
}

export type JsonEventCallback = (msg: Record<string, unknown>) => void;
export type BinaryEventCallback = (packet: Buffer) => void;

// Binary packet headers:
// 0x01 = Screencast/Snapshot Image Frame (JPEG during motion, lossless PNG when settled)
// 0x02 = 24000Hz Mono Int16 PCM Audio Frame
export const PACKET_VIDEO_JPEG = 0x01;
export const PACKET_AUDIO_PCM = 0x02;

function collectPlaywrightRoots(): string[] {
  const home = os.homedir();
  return Array.from(
    new Set(
      [
        process.env.PLAYWRIGHT_BROWSERS_PATH || '',
        path.join(home, 'Library', 'Caches', 'ms-playwright'),
        path.join(home, '.cache', 'ms-playwright'),
        '/root/.cache/ms-playwright',
        '/var/cache/tamga-playwright',
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : '',
      ].filter(Boolean)
    )
  );
}

export function findChromiumExecutable(chromiumRef?: { executablePath: () => string }): string | undefined {
  try {
    const defaultPath = chromiumRef?.executablePath();
    if (defaultPath && fs.existsSync(defaultPath)) {
      return defaultPath;
    }
  } catch {
    // check ms-playwright cache & fallback paths
  }

  for (const root of collectPlaywrightRoots()) {
    if (!fs.existsSync(root)) continue;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }

    const shellDirs = entries
      .filter((d) => d.startsWith('chromium_headless_shell-'))
      .sort()
      .reverse();
    for (const dir of shellDirs) {
      const shellCandidates = [
        path.join(root, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
        path.join(root, dir, 'chrome-linux', 'headless_shell'),
        path.join(root, dir, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
        path.join(root, dir, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
        path.join(root, dir, 'chrome-mac', 'headless_shell'),
        path.join(root, dir, 'chrome-mac-arm64', 'headless_shell'),
        path.join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
        path.join(root, dir, 'chrome-win', 'headless_shell.exe'),
      ];
      for (const candidate of shellCandidates) {
        if (fs.existsSync(candidate)) return candidate;
      }
    }

    const fullDirs = entries
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .reverse();
    for (const dir of fullDirs) {
      const fullCandidates = [
        path.join(root, dir, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        path.join(root, dir, 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        path.join(root, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        path.join(root, dir, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        path.join(root, dir, 'chrome-linux', 'chrome'),
        path.join(root, dir, 'chrome-linux64', 'chrome'),
        path.join(root, dir, 'chrome-win', 'chrome.exe'),
      ];
      for (const candidate of fullCandidates) {
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }

  const systemCandidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
  ];
  for (const candidate of systemCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return undefined;
}

export function findPlaywrightManagedBrowser(chromiumRef?: { executablePath: () => string }): string | undefined {
  try {
    const defaultPath = chromiumRef?.executablePath();
    if (defaultPath && fs.existsSync(defaultPath)) return defaultPath;
  } catch {}
  for (const root of collectPlaywrightRoots()) {
    if (!fs.existsSync(root)) continue;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const dir of entries.filter((d) => d.startsWith('chromium_headless_shell-') || d.startsWith('chromium-')).sort().reverse()) {
      const cands = [
        path.join(root, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
        path.join(root, dir, 'chrome-linux', 'headless_shell'),
        path.join(root, dir, 'chrome-linux', 'chrome'),
        path.join(root, dir, 'chrome-linux64', 'chrome'),
        path.join(root, dir, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
        path.join(root, dir, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
        path.join(root, dir, 'chrome-mac', 'headless_shell'),
        path.join(root, dir, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        path.join(root, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      ];
      for (const c of cands) {
        if (fs.existsSync(c)) return c;
      }
    }
  }
  return undefined;
}

export function resolvePlaywrightCliPath(): string | null {
  try {
    const pkgPath = require.resolve('playwright-core/package.json');
    const cliPath = path.join(path.dirname(pkgPath), 'cli.js');
    if (fs.existsSync(cliPath)) return cliPath;
  } catch {
    // fallback paths for bundled environments
  }
  const moduleDir = path.dirname(new URL(import.meta.url).pathname);
  const candidates = [
    path.resolve(moduleDir, '..', 'node_modules', 'playwright-core', 'cli.js'),
    path.resolve(moduleDir, '..', '..', 'playwright-core', 'cli.js'),
    path.resolve(process.cwd(), 'node_modules', 'playwright-core', 'cli.js'),
    '/usr/lib/node_modules/tamga-vdesktop/node_modules/playwright-core/cli.js',
    '/usr/lib/node_modules/playwright-core/cli.js',
    '/usr/local/lib/node_modules/tamga-vdesktop/node_modules/playwright-core/cli.js',
    '/usr/local/lib/node_modules/playwright-core/cli.js',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function installPlaywrightBrowserSync(opts?: { quiet?: boolean; withDeps?: boolean }): boolean {
  const existing = findPlaywrightManagedBrowser();
  if (existing && !opts?.withDeps) return true;

  const cliPath = resolvePlaywrightCliPath();
  if (!cliPath) {
    if (existing) return true;
    if (!opts?.quiet) {
      console.error('[TamgaVDesktop] playwright-core/cli.js bulunamadı.');
    }
    return false;
  }

  const shouldWithDeps = Boolean(
    opts?.withDeps && process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0
  );
  const hosts = process.env.PLAYWRIGHT_DOWNLOAD_HOST
    ? [process.env.PLAYWRIGHT_DOWNLOAD_HOST]
    : ['', 'https://cdn.npmmirror.com/binaries/playwright'];

  if (!opts?.quiet) {
    console.log('[TamgaVDesktop] Yerleşik Playwright Chromium tarayıcısı kuruluyor...');
  }

  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i];
    const args = [cliPath, 'install', 'chromium-headless-shell'];
    if (i === 0 && shouldWithDeps) args.push('--with-deps');
    if (opts?.quiet) args.push('--no-progress');

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PLAYWRIGHT_SKIP_BROWSER_GC: '1',
    };
    if (host) env.PLAYWRIGHT_DOWNLOAD_HOST = host;

    const res = spawnSync(process.execPath, args, {
      stdio: opts?.quiet ? 'ignore' : 'inherit',
      env,
    });
    if (res.status === 0 && findPlaywrightManagedBrowser()) {
      return true;
    }

    // Fallback for Playwright versions without chromium-headless-shell target alias
    const fallbackArgs = [cliPath, 'install', '--only-shell', 'chromium'];
    if (i === 0 && shouldWithDeps) fallbackArgs.push('--with-deps');
    if (opts?.quiet) fallbackArgs.push('--no-progress');
    const res2 = spawnSync(process.execPath, fallbackArgs, {
      stdio: opts?.quiet ? 'ignore' : 'inherit',
      env,
    });
    if (res2.status === 0 && findPlaywrightManagedBrowser()) {
      return true;
    }
  }
  return Boolean(findPlaywrightManagedBrowser());
}

async function installPlaywrightBrowserAsync(): Promise<void> {
  if (findPlaywrightManagedBrowser()) return;
  const cliPath = resolvePlaywrightCliPath();
  if (!cliPath) return;

  const hosts = process.env.PLAYWRIGHT_DOWNLOAD_HOST
    ? [process.env.PLAYWRIGHT_DOWNLOAD_HOST]
    : ['', 'https://cdn.npmmirror.com/binaries/playwright'];

  for (const host of hosts) {
    if (findPlaywrightManagedBrowser()) return;
    const env: NodeJS.ProcessEnv = { ...process.env, PLAYWRIGHT_SKIP_BROWSER_GC: '1' };
    if (host) env.PLAYWRIGHT_DOWNLOAD_HOST = host;
    await new Promise<void>((resolve) => {
      const child = spawn(
        process.execPath,
        [cliPath, 'install', 'chromium-headless-shell', '--no-progress'],
        { stdio: 'ignore', env }
      );
      child.on('exit', () => resolve());
      child.on('error', () => resolve());
    });
  }
}

function normalizeUserUrl(rawInput: string): {
  mode: 'newtab' | 'file' | 'web';
  url: string;
  filePath?: string;
} {
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed === 'compute://newtab' || trimmed === 'about:blank') {
    return { mode: 'newtab', url: 'compute://newtab' };
  }
  if (trimmed.startsWith('file://')) {
    const rawPath = decodeURIComponent(trimmed.replace(/^file:\/\/\/?/, '/'));
    const normPath = ('/' + rawPath).replace(/\/+/g, '/');
    return { mode: 'file', url: `file://${normPath}`, filePath: normPath };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { mode: 'web', url: trimmed };
  }
  if (
    /^(localhost(:\d+)?|(\d{1,3}\.){3}\d{1,3}(:\d+)?|([a-z0-9-]+\.)+[a-z]{2,})(\/.*)?$/i.test(
      trimmed
    ) &&
    !trimmed.includes(' ')
  ) {
    const proto =
      trimmed.startsWith('localhost') || /^\d+\.\d+/.test(trimmed) ? 'http://' : 'https://';
    return { mode: 'web', url: proto + trimmed };
  }
  return {
    mode: 'web',
    url: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}&hl=tr`,
  };
}

// Audio capture + anti-detection + pointer cursor sync injected into every Chromium page
const PAGE_ENHANCEMENT_INIT_SCRIPT = `
(() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  } catch {}

  if (!window.__rcCursorHooked) {
    window.__rcCursorHooked = true;
    let lastCursor = '';
    let lastCheck = 0;
    window.addEventListener('mousemove', (ev) => {
      const now = performance.now();
      if (now - lastCheck < 75) return;
      lastCheck = now;
      try {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const cur = el ? getComputedStyle(el).cursor || 'default' : 'default';
        if (cur !== lastCursor && typeof window.__rcCursorChange === 'function') {
          lastCursor = cur;
          window.__rcCursorChange(cur).catch(() => {});
        }
      } catch {}
    }, { passive: true, capture: true });
  }

  if (window.__rcAudioHooked) return;
  window.__rcAudioHooked = true;

  let mixCtx = null;
  let mixGain = null;
  let mixProcessor = null;
  const retainedNodes = [];
  const hookedElements = new WeakSet();
  const hookedContexts = new WeakSet();

  function sendFloatBufferAsPcm(ch0, ch1) {
    if (typeof window.__rcPushAudioBase64 !== 'function') return;
    const len = ch0.length;
    let peak = 0;
    for (let i = 0; i < len; i += 4) {
      const a = Math.abs(ch0[i]);
      if (a > peak) peak = a;
    }
    if (peak < 0.00035) return;

    const pcm16 = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      const mono = ch1 ? (ch0[i] + ch1[i]) * 0.5 : ch0[i];
      const clamped = mono < -1 ? -1 : mono > 1 ? 1 : mono;
      pcm16[i] = clamped * 32767;
    }
    const bytes = new Uint8Array(pcm16.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    window.__rcPushAudioBase64(btoa(binary)).catch(() => {});
  }

  function ensurePipeline() {
    if (mixCtx) {
      if (mixCtx.state === 'suspended') mixCtx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      mixCtx = new AC({ sampleRate: 24000 });
      hookedContexts.add(mixCtx);
      mixGain = mixCtx.createGain();
      mixProcessor = mixCtx.createScriptProcessor(2048, 2, 2);
      mixGain.connect(mixProcessor);
      mixProcessor.connect(mixCtx.destination);

      mixProcessor.onaudioprocess = (ev) => {
        const ch0 = ev.inputBuffer.getChannelData(0);
        const ch1 = ev.inputBuffer.numberOfChannels > 1 ? ev.inputBuffer.getChannelData(1) : null;
        sendFloatBufferAsPcm(ch0, ch1);
      };
    } catch {}
  }

  function attachMediaElement(el) {
    if (!el || hookedElements.has(el)) return;
    ensurePipeline();
    if (!mixCtx || !mixGain) return;
    if (mixCtx.state === 'suspended') mixCtx.resume().catch(() => {});

    try {
      const src = mixCtx.createMediaElementSource(el);
      const volGain = mixCtx.createGain();
      const syncVol = () => {
        volGain.gain.value = el.muted ? 0 : el.volume;
      };
      syncVol();
      el.addEventListener('volumechange', syncVol);
      src.connect(volGain);
      volGain.connect(mixGain);
      retainedNodes.push(src, volGain);
      hookedElements.add(el);
    } catch {}
  }

  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const result = origConnect.call(this, dest, ...rest);
    try {
      if (
        dest &&
        this.context &&
        dest === this.context.destination &&
        !hookedContexts.has(this.context)
      ) {
        hookedContexts.add(this.context);
        const ctx = this.context;
        const tap = ctx.createScriptProcessor(2048, 2, 2);
        origConnect.call(this, tap);
        origConnect.call(tap, ctx.destination);
        const ratio = ctx.sampleRate / 24000;
        tap.onaudioprocess = (ev) => {
          const in0 = ev.inputBuffer.getChannelData(0);
          const outLen = Math.floor(in0.length / ratio);
          const resampled = new Float32Array(outLen);
          for (let i = 0; i < outLen; i++) {
            resampled[i] = in0[Math.min(in0.length - 1, Math.round(i * ratio))];
          }
          sendFloatBufferAsPcm(resampled, null);
        };
      }
    } catch {}
    return result;
  };

  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    attachMediaElement(this);
    return origPlay.apply(this, args);
  };

  setInterval(() => {
    const els = document.querySelectorAll('video, audio');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el.paused && !el.muted) {
        attachMediaElement(el);
      }
    }
  }, 600);
})();
`;

export class ChromiumCluster {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private sessions: Map<string, ChromiumDesktopSession> = new Map();
  private executableUsed = 'Chromium';

  public async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }
    if (this.launching) {
      return this.launching;
    }
    this.launching = (async () => {
      const chromiumApi = await loadPlaywrightChromium();
      // Prefer Playwright's own managed Chromium binary, downloading on demand if absent
      let executablePath = findPlaywrightManagedBrowser(chromiumApi);
      if (!executablePath) {
        await installPlaywrightBrowserAsync();
        executablePath = findChromiumExecutable(chromiumApi);
      }
      if (!executablePath) {
        throw new Error(
          "Playwright Chromium ikilisi bulunamadı. Sunucuda 'tamga-vdesktop install-browser' çalıştırın."
        );
      }
      this.executableUsed = executablePath;

      const launched = await chromiumApi.launch({
        executablePath,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--autoplay-policy=no-user-gesture-required',
          '--font-render-hinting=medium',
          '--enable-font-antialiasing',
          '--force-color-profile=srgb',
          '--use-gl=angle',
          '--use-angle=swiftshader-webgl',
          '--enable-webgl',
          '--ignore-gpu-blocklist',
        ],
      });
      this.browser = launched;
      return launched;
    })();

    try {
      return await this.launching;
    } finally {
      this.launching = null;
    }
  }

  public getOrCreateSession(desktopId: string, vfs: VFSManager): ChromiumDesktopSession {
    let session = this.sessions.get(desktopId);
    if (!session) {
      session = new ChromiumDesktopSession(desktopId, vfs, this);
      this.sessions.set(desktopId, session);
    }
    return session;
  }

  public async destroySession(desktopId: string): Promise<void> {
    const session = this.sessions.get(desktopId);
    if (!session) return;
    this.sessions.delete(desktopId);
    await session.dispose();
  }

  public getClusterInfo() {
    let totalTabs = 0;
    let totalWebPages = 0;
    for (const s of this.sessions.values()) {
      const info = s.getSessionStats();
      totalTabs += info.activeTabs;
      totalWebPages += info.webPagesCount;
    }
    return {
      ready: Boolean(this.browser?.isConnected()),
      installed: Boolean(findChromiumExecutable()),
      executable: path.basename(this.executableUsed),
      isolatedDesktopsLoaded: this.sessions.size,
      totalTabs,
      totalWebPages,
    };
  }
}

export class ChromiumDesktopSession {
  public readonly desktopId: string;
  private vfs: VFSManager;
  private cluster: ChromiumCluster;
  private context: BrowserContext | null = null;
  private contextCreating: Promise<BrowserContext> | null = null;

  private tabs: Map<string, InternalTab> = new Map();
  private tabOrder: string[] = [];
  private activeTabId: string | null = null;
  private viewport = { width: 1160, height: 700 };
  private dpr = 1;

  private jsonListeners: Set<JsonEventCallback> = new Set();
  private binaryListeners: Set<BinaryEventCallback> = new Set();
  private internalPageCreating = 0;
  private frameCounter = 0;
  private lastFpsCheck = Date.now();
  public currentFps = 0;

  constructor(desktopId: string, vfs: VFSManager, cluster: ChromiumCluster) {
    this.desktopId = desktopId;
    this.vfs = vfs;
    this.cluster = cluster;
    this.createTabInternal('compute://newtab', true);
  }

  public getSessionStats() {
    return {
      activeTabs: this.tabs.size,
      webPagesCount: Array.from(this.tabs.values()).filter((t) => Boolean(t.page)).length,
      fps: this.currentFps,
    };
  }

  public subscribe(onJson: JsonEventCallback, onBinary: BinaryEventCallback): () => void {
    this.jsonListeners.add(onJson);
    this.binaryListeners.add(onBinary);

    onJson({
      type: 'tabs_state',
      tabs: this.getTabsSummary(),
      activeTabId: this.activeTabId,
    });

    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (active?.mode === 'web' && active.lastFrameBuffer) {
      onBinary(active.lastFrameBuffer);
    }

    return () => {
      this.jsonListeners.delete(onJson);
      this.binaryListeners.delete(onBinary);
    };
  }

  private broadcastJson(msg: Record<string, unknown>) {
    for (const cb of this.jsonListeners) {
      try {
        cb(msg);
      } catch {
        // ignore
      }
    }
  }

  private broadcastBinary(packet: Buffer) {
    for (const cb of this.binaryListeners) {
      try {
        cb(packet);
      } catch {
        // ignore
      }
    }
  }

  private broadcastTabs() {
    this.broadcastJson({
      type: 'tabs_state',
      tabs: this.getTabsSummary(),
      activeTabId: this.activeTabId,
    });
  }

  public getTabsSummary(): TabSummary[] {
    const now = Date.now();
    return this.tabOrder
      .map((id) => this.tabs.get(id))
      .filter((t): t is InternalTab => Boolean(t))
      .map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        favicon: t.favicon,
        isLoading: t.isLoading,
        canGoBack: t.canGoBack,
        canGoForward: t.canGoForward,
        isSecure:
          t.url.startsWith('https://') ||
          t.url.startsWith('compute://') ||
          t.url.startsWith('file://'),
        isPlayingAudio: now - t.lastAudioAt < 1500,
        mode: t.mode,
        filePath: t.filePath,
      }));
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    if (this.contextCreating) return this.contextCreating;

    this.contextCreating = (async () => {
      const browser = await this.cluster.getBrowser();
      const majorVer = browser.version().split('.')[0] || '134';
      const ctx = await browser.newContext({
        viewport: this.viewport,
        deviceScaleFactor: this.dpr,
        locale: 'tr-TR',
        userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVer}.0.0.0 Safari/537.36`,
        acceptDownloads: true,
      });

      await ctx.exposeBinding('__rcPushAudioBase64', (source, b64: string) => {
        if (this.binaryListeners.size === 0 || !b64) return;
        const matchingTab = Array.from(this.tabs.values()).find((t) => t.page === source.page);
        if (!matchingTab) return;
        matchingTab.lastAudioAt = Date.now();
        if (matchingTab.id !== this.activeTabId || matchingTab.mode !== 'web') return;

        const pcmBuf = Buffer.from(b64, 'base64');
        const packet = Buffer.allocUnsafe(1 + pcmBuf.length);
        packet[0] = PACKET_AUDIO_PCM;
        pcmBuf.copy(packet, 1);
        this.broadcastBinary(packet);
      });

      await ctx.exposeBinding('__rcCursorChange', (source, cursor: string) => {
        const matchingTab = Array.from(this.tabs.values()).find((t) => t.page === source.page);
        if (!matchingTab || matchingTab.id !== this.activeTabId || matchingTab.mode !== 'web') return;
        this.broadcastJson({ type: 'browser_cursor', cursor: String(cursor || 'default') });
      });

      await ctx.addInitScript(PAGE_ENHANCEMENT_INIT_SCRIPT);

      ctx.on('page', async (newPage) => {
        if (this.internalPageCreating > 0) return;
        const alreadyTracked = Array.from(this.tabs.values()).some((t) => t.page === newPage);
        if (alreadyTracked) return;

        const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const tab: InternalTab = {
          id,
          mode: 'web',
          url: newPage.url() || 'about:blank',
          title: 'Yeni Sekme...',
          favicon: '',
          isLoading: true,
          canGoBack: false,
          canGoForward: false,
          lastAudioAt: 0,
          page: newPage,
          streaming: false,
        };
        this.tabs.set(id, tab);
        this.tabOrder.push(id);
        await this.attachPageHandlers(tab, newPage);
        await this.activateTab(id);
      });

      this.context = ctx;
      return ctx;
    })();

    try {
      return await this.contextCreating;
    } finally {
      this.contextCreating = null;
    }
  }

  private createTabInternal(initialInput = 'compute://newtab', makeActive = true): InternalTab {
    const parsed = normalizeUserUrl(initialInput);
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const tab: InternalTab = {
      id,
      mode: parsed.mode,
      filePath: parsed.filePath,
      url: parsed.url,
      title:
        parsed.mode === 'newtab'
          ? 'Yeni Sekme'
          : parsed.mode === 'file'
          ? path.posix.basename(parsed.filePath || 'Dosya')
          : parsed.url,
      favicon: '',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      lastAudioAt: 0,
      streaming: false,
    };
    this.tabs.set(id, tab);
    this.tabOrder.push(id);
    if (makeActive) this.activeTabId = id;
    return tab;
  }

  public async createTab(initialUrl = 'compute://newtab'): Promise<string> {
    const tab = this.createTabInternal(initialUrl, false);
    await this.activateTab(tab.id);
    if (tab.mode === 'web') {
      await this.navigate(tab.id, tab.url);
    }
    this.broadcastTabs();
    return tab.id;
  }

  private async applyTabMetrics(tab: InternalTab) {
    if (!tab.page || tab.page.isClosed()) return;
    try {
      await tab.page.setViewportSize(this.viewport);
    } catch {}
    if (tab.cdp) {
      try {
        await tab.cdp.send('Emulation.setDeviceMetricsOverride', {
          width: this.viewport.width,
          height: this.viewport.height,
          deviceScaleFactor: this.dpr,
          mobile: false,
        });
      } catch {}
    }
  }

  public async activateTab(tabId: string): Promise<void> {
    const next = this.tabs.get(tabId);
    if (!next) return;

    if (this.activeTabId && this.activeTabId !== tabId) {
      const prev = this.tabs.get(this.activeTabId);
      if (prev) await this.stopScreencast(prev);
    }

    this.activeTabId = tabId;
    this.broadcastTabs();

    if (next.mode === 'web' && next.page) {
      await this.applyTabMetrics(next);
      if (next.lastFrameBuffer) {
        this.broadcastBinary(next.lastFrameBuffer);
      }
      await this.startScreencast(next);
      await this.captureImmediateFrame(next);
    }
  }

  public async closeTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    await this.cleanupTabPage(tab);
    this.tabs.delete(tabId);
    const idx = this.tabOrder.indexOf(tabId);
    if (idx !== -1) this.tabOrder.splice(idx, 1);

    if (this.tabOrder.length === 0) {
      const fresh = this.createTabInternal('compute://newtab', true);
      this.activeTabId = fresh.id;
      this.broadcastTabs();
      return;
    }

    if (this.activeTabId === tabId) {
      const nextIdx = Math.min(idx, this.tabOrder.length - 1);
      await this.activateTab(this.tabOrder[nextIdx]);
    } else {
      this.broadcastTabs();
    }
  }

  private async cleanupTabPage(tab: InternalTab) {
    if (tab.settleTimer) {
      clearTimeout(tab.settleTimer);
      tab.settleTimer = undefined;
    }
    await this.stopScreencast(tab);
    if (tab.cdp) {
      try {
        await tab.cdp.detach();
      } catch {}
      tab.cdp = undefined;
    }
    if (tab.page && !tab.page.isClosed()) {
      try {
        await tab.page.close();
      } catch {}
    }
    tab.page = undefined;
  }

  private async attachPageHandlers(tab: InternalTab, page: Page) {
    const cdp = await page.context().newCDPSession(page);
    tab.cdp = cdp;
    await this.applyTabMetrics(tab);

    cdp.on('Page.screencastFrame', (payload) => {
      cdp.send('Page.screencastFrameAck', { sessionId: payload.sessionId }).catch(() => {});

      const now = Date.now();
      if (payload.data === tab.lastScreencastData) {
        return;
      }
      if (now < (tab.suppressSettleUntil || 0) && (tab.lastUserInputAt || 0) <= (tab.lastPngAt || 0)) {
        tab.lastScreencastData = payload.data;
        return;
      }
      tab.lastScreencastData = payload.data;

      const jpegBuf = Buffer.from(payload.data, 'base64');
      const packet = Buffer.allocUnsafe(1 + jpegBuf.length);
      packet[0] = PACKET_VIDEO_JPEG;
      jpegBuf.copy(packet, 1);

      tab.lastFrameBuffer = packet;
      this.recordFrameTick();

      if (this.activeTabId === tab.id && tab.mode === 'web') {
        this.broadcastBinary(packet);

        // Send a lossless PNG frame shortly after motion settles for native Retina text clarity
        if (tab.settleTimer) clearTimeout(tab.settleTimer);
        tab.settleTimer = setTimeout(() => {
          if (this.activeTabId === tab.id && tab.mode === 'web') {
            this.captureImmediateFrame(tab).catch(() => {});
          }
        }, 220);
      }
    });

    const syncPageMeta = async () => {
      if (page.isClosed() || tab.mode !== 'web') return;
      try {
        const currentUrl = page.url();
        if (currentUrl && currentUrl !== 'about:blank') tab.url = currentUrl;
        const title = await page.title().catch(() => '');
        if (title) {
          tab.title = title;
        } else {
          try {
            tab.title = new URL(tab.url).hostname || tab.url;
          } catch {
            tab.title = tab.url;
          }
        }
        try {
          const u = new URL(tab.url);
          tab.favicon = `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`;
        } catch {
          tab.favicon = '';
        }
        if (tab.cdp) {
          const hist = await tab.cdp.send('Page.getNavigationHistory').catch(() => null);
          if (hist) {
            tab.canGoBack = hist.currentIndex > 0;
            tab.canGoForward = hist.currentIndex < hist.entries.length - 1;
          }
        }
      } catch {}
      this.broadcastTabs();
    };

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) syncPageMeta();
    });
    page.on('domcontentloaded', () => {
      tab.isLoading = false;
      syncPageMeta();
      this.captureImmediateFrame(tab).catch(() => {});
    });
    page.on('load', () => {
      tab.isLoading = false;
      syncPageMeta();
      this.captureImmediateFrame(tab).catch(() => {});
    });

    page.on('download', async (download) => {
      try {
        const suggested = download.suggestedFilename() || `indirilen-${Date.now()}`;
        const downloadsDir = this.vfs.resolveDiskPath('/Downloads');
        fs.mkdirSync(downloadsDir, { recursive: true });
        let finalName = suggested;
        let counter = 2;
        while (fs.existsSync(path.join(downloadsDir, finalName))) {
          const extIdx = suggested.lastIndexOf('.');
          finalName =
            extIdx > 0
              ? `${suggested.slice(0, extIdx)} (${counter})${suggested.slice(extIdx)}`
              : `${suggested} (${counter})`;
          counter++;
        }
        await download.saveAs(path.join(downloadsDir, finalName));
        this.vfs.notifyChange();
        this.broadcastJson({
          type: 'download_complete',
          fileName: finalName,
          virtualPath: `/Downloads/${finalName}`,
        });
      } catch (err) {
        this.broadcastJson({
          type: 'browser_error',
          message: `İndirme başarısız oldu: ${(err as Error).message}`,
        });
      }
    });
  }

  private recordFrameTick() {
    this.frameCounter++;
    const now = Date.now();
    const elapsed = now - this.lastFpsCheck;
    if (elapsed >= 1000) {
      this.currentFps = Math.round((this.frameCounter * 1000) / elapsed);
      this.frameCounter = 0;
      this.lastFpsCheck = now;
    }
  }

  private async startScreencast(tab: InternalTab) {
    if (!tab.cdp || tab.streaming || tab.mode !== 'web') return;
    try {
      await tab.cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 92,
        maxWidth: Math.round(this.viewport.width * this.dpr),
        maxHeight: Math.round(this.viewport.height * this.dpr),
        everyNthFrame: 1,
      });
      tab.streaming = true;
    } catch {
      tab.streaming = false;
    }
  }

  private async stopScreencast(tab: InternalTab) {
    if (tab.settleTimer) {
      clearTimeout(tab.settleTimer);
      tab.settleTimer = undefined;
    }
    if (!tab.cdp || !tab.streaming) return;
    try {
      await tab.cdp.send('Page.stopScreencast');
    } catch {}
    tab.streaming = false;
  }

  private async captureImmediateFrame(tab: InternalTab) {
    if (!tab.page || tab.page.isClosed() || tab.mode !== 'web') return;
    try {
      tab.suppressSettleUntil = Date.now() + 900;
      let pngBuf: Buffer;
      if (tab.cdp) {
        const res = await tab.cdp.send('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
        });
        pngBuf = Buffer.from(res.data, 'base64');
      } else {
        pngBuf = await tab.page.screenshot({ type: 'png', scale: 'device' });
      }
      tab.lastPngAt = Date.now();
      tab.suppressSettleUntil = tab.lastPngAt + 550;
      const packet = Buffer.allocUnsafe(1 + pngBuf.length);
      packet[0] = PACKET_VIDEO_JPEG;
      pngBuf.copy(packet, 1);
      if (tab.lastFrameBuffer && tab.lastFrameBuffer.length === packet.length && tab.lastFrameBuffer.equals(packet)) {
        return;
      }
      tab.lastFrameBuffer = packet;
      if (this.activeTabId === tab.id) {
        this.broadcastBinary(packet);
      }
    } catch {}
  }

  public async navigate(tabId: string, rawInput: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const parsed = normalizeUserUrl(rawInput);
    tab.mode = parsed.mode;
    tab.filePath = parsed.filePath;
    tab.url = parsed.url;
    tab.lastScreencastData = undefined;
    tab.suppressSettleUntil = 0;

    if (parsed.mode === 'newtab') {
      await this.stopScreencast(tab);
      tab.title = 'Yeni Sekme';
      tab.favicon = '';
      tab.isLoading = false;
      this.broadcastTabs();
      return;
    }

    if (parsed.mode === 'file') {
      await this.stopScreencast(tab);
      tab.title = path.posix.basename(parsed.filePath || 'Dosya');
      tab.favicon = '';
      tab.isLoading = false;
      this.broadcastTabs();
      return;
    }

    tab.isLoading = true;
    try {
      tab.title = new URL(parsed.url).hostname || parsed.url;
    } catch {
      tab.title = parsed.url;
    }
    this.broadcastTabs();

    try {
      const ctx = await this.ensureContext();
      if (!tab.page || tab.page.isClosed()) {
        this.internalPageCreating++;
        try {
          const page = await ctx.newPage();
          tab.page = page;
          await this.attachPageHandlers(tab, page);
        } finally {
          this.internalPageCreating--;
        }
      }

      if (this.activeTabId === tab.id) {
        await this.startScreencast(tab);
      }

      await tab.page.goto(parsed.url, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });
      tab.isLoading = false;
      this.broadcastTabs();
      await this.captureImmediateFrame(tab);
    } catch (err) {
      tab.isLoading = false;
      this.broadcastTabs();
      this.broadcastJson({
        type: 'browser_error',
        tabId: tab.id,
        message: `Sayfa yüklenemedi: ${(err as Error).message}`,
      });
    }
  }

  public async goBack(tabId: string) {
    const tab = this.tabs.get(tabId);
    if (!tab?.page || tab.mode !== 'web') return;
    tab.isLoading = true;
    this.broadcastTabs();
    await tab.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    tab.isLoading = false;
    this.broadcastTabs();
    await this.captureImmediateFrame(tab);
  }

  public async goForward(tabId: string) {
    const tab = this.tabs.get(tabId);
    if (!tab?.page || tab.mode !== 'web') return;
    tab.isLoading = true;
    this.broadcastTabs();
    await tab.page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {});
    tab.isLoading = false;
    this.broadcastTabs();
    await this.captureImmediateFrame(tab);
  }

  public async reload(tabId: string) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    if (tab.mode === 'web' && tab.page) {
      tab.isLoading = true;
      this.broadcastTabs();
      await tab.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      tab.isLoading = false;
      this.broadcastTabs();
      await this.captureImmediateFrame(tab);
    } else {
      this.broadcastTabs();
    }
  }

  public async setViewport(width: number, height: number, dpr?: number) {
    const w = Math.max(360, Math.min(1920, Math.round(width)));
    const h = Math.max(260, Math.min(1200, Math.round(height)));
    const nextDpr = dpr && Number.isFinite(dpr) ? Math.max(1, Math.min(2, Number(dpr))) : this.dpr;

    const sizeChanged = Math.abs(this.viewport.width - w) >= 4 || Math.abs(this.viewport.height - h) >= 4;
    const dprChanged = Math.abs(this.dpr - nextDpr) >= 0.05;
    if (!sizeChanged && !dprChanged) return;

    this.viewport = { width: w, height: h };
    this.dpr = nextDpr;

    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (active?.mode === 'web' && active.page && !active.page.isClosed()) {
      try {
        active.lastScreencastData = undefined;
        active.suppressSettleUntil = 0;
        await this.stopScreencast(active);
        await this.applyTabMetrics(active);
        await this.startScreencast(active);
        await this.captureImmediateFrame(active);
      } catch {}
    }
  }

  public handleInput(payload: Record<string, unknown>) {
    const tabId = (payload.tabId as string) || this.activeTabId;
    if (!tabId) return;
    const tab = this.tabs.get(tabId);
    if (!tab || tab.mode !== 'web' || !tab.page || !tab.cdp || tab.page.isClosed()) return;
    tab.lastUserInputAt = Date.now();

    const kind = payload.kind as string;
    if (kind === 'mouse') {
      const eventType = payload.eventType as
        | 'mousePressed'
        | 'mouseReleased'
        | 'mouseMoved'
        | 'mouseWheel';
      tab.cdp
        .send('Input.dispatchMouseEvent', {
          type: eventType,
          x: Number(payload.x) || 0,
          y: Number(payload.y) || 0,
          button: (payload.button as 'left' | 'middle' | 'right' | 'none') || 'none',
          clickCount: Number(payload.clickCount) || 1,
          modifiers: Number(payload.modifiers) || 0,
          deltaX: Number(payload.deltaX) || 0,
          deltaY: Number(payload.deltaY) || 0,
        })
        .catch(() => {});
      return;
    }

    if (kind === 'key') {
      const key = String(payload.key || '');
      const ctrlOrMeta = Boolean(payload.ctrlKey || payload.metaKey);
      const shiftKey = Boolean(payload.shiftKey);
      const altKey = Boolean(payload.altKey);
      const modPrefix = process.platform === 'darwin' ? 'Meta' : 'Control';

      if (ctrlOrMeta && key.length === 1) {
        const lower = key.toLowerCase();
        if (['a', 'c', 'x', 'z', 'y', 'f'].includes(lower)) {
          tab.page.keyboard
            .press(`${modPrefix}+${shiftKey ? 'Shift+' : ''}${lower}`)
            .catch(() => {});
          return;
        }
      }

      const specialKeys = new Set([
        'Enter',
        'Backspace',
        'Tab',
        'Escape',
        'Delete',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
        'PageUp',
        'PageDown',
        'F5',
      ]);

      if (specialKeys.has(key)) {
        const mods: string[] = [];
        if (ctrlOrMeta) mods.push(modPrefix);
        if (altKey) mods.push('Alt');
        if (shiftKey) mods.push('Shift');
        tab.page.keyboard.press([...mods, key].join('+')).catch(() => {});
      } else if (key.length === 1 && !ctrlOrMeta) {
        tab.page.keyboard.insertText(key).catch(() => {});
      }
      return;
    }

    if (kind === 'paste') {
      const text = String(payload.text || '');
      if (text) tab.page.keyboard.insertText(text).catch(() => {});
    }
  }

  public async dispose() {
    for (const tab of this.tabs.values()) {
      await this.cleanupTabPage(tab);
    }
    this.tabs.clear();
    this.tabOrder = [];
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
  }
}
