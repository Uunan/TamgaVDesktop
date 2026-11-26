import express from 'express';
import cors from 'cors';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import {
  DesktopRegistry,
  sanitizeDesktopId,
  setStorageRoot,
  VFSManager,
} from './vfsManager';
import { ChromiumCluster, PACKET_AUDIO_PCM, PACKET_VIDEO_JPEG } from './chromiumManager';
import { hashPassword, loadConfig, saveConfig, type TamgaConfig } from './config';
import { AuthManager } from './authManager';
import { TerminalManager } from './terminalManager';
import { LinuxAppManager } from './linuxAppManager';
import { LinuxDisplayBridge } from './linuxDisplayBridge';
import { VSCodeServerManager } from './vscodeManager';

export const TAMGA_VERSION = '1.7.0';

const MIME_MAP: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  zip: 'application/zip',
};

function resolveClientDistDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, 'client'),
    path.resolve(here, '../dist/client'),
    path.resolve(here, '../client'),
    path.resolve(process.cwd(), 'dist/client'),
    path.resolve(process.cwd(), 'dist'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }
  return null;
}

export interface StartServerOptions {
  config?: TamgaConfig;
  configPath?: string;
  host?: string;
  port?: number;
}

export async function startTamgaServer(opts: StartServerOptions = {}) {
  const loaded = opts.config
    ? { config: opts.config, configPath: opts.configPath || '' }
    : loadConfig(opts.configPath);
  const config: TamgaConfig = {
    ...loaded.config,
    host: opts.host || loaded.config.host,
    port: opts.port || loaded.config.port,
  };
  const configPath = loaded.configPath;

  setStorageRoot(config.dataDir);

  const authManager = new AuthManager(config);
  const vscodeManager = new VSCodeServerManager(config.dataDir);

  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.use(cors({ origin: true, credentials: true }));

  // Reverse-proxy 100% Web-Native VS Code BEFORE express.json() so raw request streams stay intact
  app.use('/vscode-web', (req, res) => {
    if (!authManager.isRequestAuthorized(req.headers.cookie, req.headers.authorization)) {
      res.status(401).send('Oturum açmanız gerekiyor.');
      return;
    }
    vscodeManager.proxyHttp(req, res);
  });

  app.use(express.json({ limit: '25mb' }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  const registry = new DesktopRegistry();
  const vfsInstances = new Map<string, VFSManager>();
  const chromiumCluster = new ChromiumCluster();
  const terminalManager = new TerminalManager();
  const linuxAppManager = new LinuxAppManager();
  const linuxDisplayBridge = new LinuxDisplayBridge();
  const bootStartedAt = Date.now();

  const vfsWatchers = new Map<string, fs.FSWatcher[]>();
  const vfsWatchTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function getDesktopContext(rawId: unknown) {
    const id = sanitizeDesktopId(typeof rawId === 'string' ? rawId : 'main');
    const desktopInfo = registry.ensureDesktop(id);
    let vfs = vfsInstances.get(desktopInfo.id);
    if (!vfs) {
      const hostOverride =
        config.desktop.filesystemMode === 'host' && desktopInfo.id === 'main'
          ? config.desktop.hostRootPath
          : undefined;
      vfs = new VFSManager(desktopInfo.id, hostOverride);
      vfsInstances.set(desktopInfo.id, vfs);

      // Watch Desktop & Downloads so Chrome/Firefox downloads and GIMP exports appear live immediately
      const targetVfs = vfs;
      const watchers: fs.FSWatcher[] = [];
      for (const rel of ['/Downloads', '/Desktop']) {
        try {
          const dirPath = targetVfs.resolveDiskPath(rel);
          fs.mkdirSync(dirPath, { recursive: true });
          const w = fs.watch(dirPath, () => {
            const prev = vfsWatchTimers.get(desktopInfo.id);
            if (prev) clearTimeout(prev);
            vfsWatchTimers.set(
              desktopInfo.id,
              setTimeout(() => {
                vfsWatchTimers.delete(desktopInfo.id);
                try {
                  targetVfs.notifyChange();
                } catch {}
              }, 450)
            );
          });
          watchers.push(w);
        } catch {}
      }
      vfsWatchers.set(desktopInfo.id, watchers);
    }
    const browserSession = chromiumCluster.getOrCreateSession(desktopInfo.id, vfs);
    return { desktopInfo, vfs, browserSession };
  }

  function extractReqDesktopId(req: express.Request): string {
    return String(
      req.headers['x-desktop-id'] || req.query.desktop || req.body?.desktopId || 'main'
    );
  }

  let prevCpuInfo = os.cpus();
  function sampleCpuPercent(): number {
    const current = os.cpus();
    let idleDiff = 0;
    let totalDiff = 0;
    for (let i = 0; i < current.length; i++) {
      const prev = prevCpuInfo[i] || current[i];
      const curr = current[i];
      const prevTotal = Object.values(prev.times).reduce((a, b) => a + b, 0);
      const currTotal = Object.values(curr.times).reduce((a, b) => a + b, 0);
      idleDiff += curr.times.idle - prev.times.idle;
      totalDiff += currTotal - prevTotal;
    }
    prevCpuInfo = current;
    if (totalDiff <= 0) return 5;
    return Math.max(1, Math.min(100, Math.round(((totalDiff - idleDiff) / totalDiff) * 100)));
  }

  function getTelemetrySnapshot(desktopId: string) {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpuPercent = sampleCpuPercent();
    const { vfs, browserSession } = getDesktopContext(desktopId);
    const cluster = chromiumCluster.getClusterInfo();
    const sessionStats = browserSession.getSessionStats();
    const runtime = linuxAppManager.getRuntimeStatus();
    const activeStreamFps = vfs.getMeta().preferences.stream?.x11Fps || config.linuxApps.fps;

    return {
      desktopId,
      cpuCores: os.cpus().length,
      cpuPercent,
      ramTotalGB: Number((totalMem / 1024 ** 3).toFixed(1)),
      ramUsedGB: Number((usedMem / 1024 ** 3).toFixed(1)),
      ramPercent: Math.round((usedMem / totalMem) * 100),
      uptimeSeconds: Math.floor((Date.now() - bootStartedAt) / 1000),
      desktopsCount: registry.list().length,
      hostname: os.hostname(),
      distro: runtime.distro,
      linuxGuiReady: runtime.guiReady,
      engine: {
        ready: cluster.ready || runtime.guiReady,
        executable: runtime.guiReady ? 'Linux Native X11' : cluster.executable,
        activeTabs: sessionStats.activeTabs,
        webPagesCount: sessionStats.webPagesCount,
        fps: runtime.guiReady ? activeStreamFps : sessionStats.fps,
      },
    };
  }

  // --- Auth & Health Routes (Unauthenticated) ---

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      name: config.name,
      version: TAMGA_VERSION,
      uptimeSeconds: Math.floor((Date.now() - bootStartedAt) / 1000),
    });
  });

  app.get('/api/auth/status', (req, res) => {
    const enabled = authManager.isEnabled();
    const authenticated = authManager.isRequestAuthorized(
      req.headers.cookie,
      req.headers.authorization
    );
    res.json({
      enabled,
      authenticated,
      username: authenticated ? authManager.getUsername() : undefined,
      serverName: config.name,
      version: TAMGA_VERSION,
      hostname: os.hostname(),
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const username = String(req.body?.username || '');
    const password = String(req.body?.password || '');
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const result = authManager.authenticate(username, password, clientIp);
    if (!result.ok || !result.token) {
      res.status(401).json({ error: result.error || 'Giriş başarısız.' });
      return;
    }
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    authManager.setSessionCookie(res, result.token, isSecure);
    res.json({ ok: true, username: authManager.getUsername() });
  });

  app.post('/api/auth/logout', (_req, res) => {
    authManager.clearSessionCookie(res);
    res.json({ ok: true });
  });

  // Protect all subsequent /api/* routes when auth is enabled
  app.use(authManager.requireAuth);

  app.post('/api/auth/password', (req, res) => {
    const newPassword = String(req.body?.password || '');
    if (newPassword.length < 4) {
      res.status(400).json({ error: 'Parola en az 4 karakter olmalıdır.' });
      return;
    }
    config.auth.passwordHash = hashPassword(newPassword);
    config.auth.enabled = true;
    if (configPath) saveConfig(configPath, config);
    res.json({ ok: true });
  });

  app.get('/api/system/info', (_req, res) => {
    let disk: { totalGB: number; usedGB: number; availGB: number; percent: number } | undefined;
    try {
      const dfOut = execSync(`df -k "${config.dataDir || '/'}" 2>/dev/null || df -k /`, {
        timeout: 1500,
      })
        .toString('utf-8')
        .trim()
        .split('\n');
      const parts = (dfOut[dfOut.length - 1] || '').trim().split(/\s+/);
      if (parts.length >= 5) {
        const totalKB = Number(parts[1]) || 0;
        const usedKB = Number(parts[2]) || 0;
        const availKB = Number(parts[3]) || 0;
        const pct = Number(String(parts[4]).replace('%', '')) || (totalKB ? Math.round((usedKB / totalKB) * 100) : 0);
        if (totalKB > 0) {
          disk = {
            totalGB: Number((totalKB / (1024 * 1024)).toFixed(1)),
            usedGB: Number((usedKB / (1024 * 1024)).toFixed(1)),
            availGB: Number((availKB / (1024 * 1024)).toFixed(1)),
            percent: pct,
          };
        }
      }
    } catch {}

    res.json({
      name: config.name,
      version: TAMGA_VERSION,
      hostname: os.hostname(),
      port: config.port,
      dataDir: config.dataDir,
      filesystemMode: config.desktop.filesystemMode,
      authEnabled: config.auth.enabled,
      runtime: linuxAppManager.getRuntimeStatus(),
      disk,
    });
  });

  // --- Linux Native Apps & Installer Endpoints ---

  app.get('/api/apps', (req, res) => {
    const desktopId = sanitizeDesktopId(extractReqDesktopId(req));
    res.json({
      runtime: linuxAppManager.getRuntimeStatus(),
      apps: linuxAppManager.listApps(),
      runningSessions: linuxDisplayBridge.listSessions(desktopId),
      allowInstall: config.linuxApps.allowInstall,
    });
  });

  app.get('/api/apps/icon', (req, res) => {
    const name = String(req.query.name || '');
    const iconPath = linuxAppManager.resolveIconPath(name);
    if (!iconPath) {
      res.status(404).end();
      return;
    }
    const ext = path.extname(iconPath).slice(1).toLowerCase();
    res.setHeader('Content-Type', MIME_MAP[ext] || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(iconPath).pipe(res);
  });

  app.post('/api/apps/launch', async (req, res) => {
    try {
      const runtime = linuxAppManager.getRuntimeStatus();
      if (!runtime.guiReady) {
        res.status(400).json({
          error: runtime.isLinux
            ? `Eksik Linux GUI bağımlılıkları: ${runtime.missingDeps.join(', ')}. Sunucuda 'tamga-vdesktop setup-linux' çalıştırın.`
            : 'Yerel Linux GUI uygulamaları yalnızca Linux sunucularda çalıştırılabilir.',
        });
        return;
      }

      const desktopId = sanitizeDesktopId(extractReqDesktopId(req));
      const { vfs } = getDesktopContext(desktopId);
      const streamPrefs = vfs.getMeta().preferences.stream;
      const appId = String(req.body?.appId || 'custom');
      const found = linuxAppManager.getApp(appId);
      const command = String(req.body?.command || found?.command || '').trim();
      const appName = String(req.body?.appName || found?.name || command.split(' ')[0] || 'Uygulama');
      if (!command) {
        res.status(400).json({ error: 'Başlatılacak uygulama komutu belirtilmedi.' });
        return;
      }
      if (found && !found.installed && !req.body?.command) {
        res.status(400).json({ error: `${found.name} sunucuda kurulu değil. Uygulamalar penceresinden kurabilirsiniz.` });
        return;
      }

      const sessionId =
        String(req.body?.sessionId || '') ||
        `app-${appId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const { session, openedAsExtraWindow } = await linuxDisplayBridge.launchApp({
        sessionId,
        desktopId,
        appId,
        appName,
        command,
        needsNoSandbox: Boolean(req.body?.needsNoSandbox ?? found?.needsNoSandbox),
        desktopDataRoot: vfs.getInstanceRoot(),
        width: Number(req.body?.width) || 720,
        height: Number(req.body?.height) || 480,
        viewportWidth: Number(req.body?.viewportWidth) || undefined,
        viewportHeight: Number(req.body?.viewportHeight) || undefined,
        fps: streamPrefs?.x11Fps ?? config.linuxApps.fps,
        quality: config.linuxApps.quality,
        maxQuality: streamPrefs?.x11MaxQuality ?? 85,
        motionQuality: streamPrefs?.x11MotionQuality ?? 58,
        dynamicDrop: streamPrefs?.dynamicQualityDrop ?? true,
        settleMs: streamPrefs?.settleDelayMs ?? 300,
        enableAudio: (streamPrefs?.audioEnabled ?? config.linuxApps.audio) && runtime.hasAudio,
      });

      res.json({
        sessionId: session.sessionId,
        appId: session.appId,
        appName: session.appName,
        title: session.title,
        width: session.width,
        height: session.height,
        openedAsExtraWindow,
      });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/apps/close', (req, res) => {
    const sessionId = String(req.body?.sessionId || '');
    const viewId = req.body?.viewId ? String(req.body.viewId) : undefined;
    if (sessionId) linuxDisplayBridge.closeSession(sessionId, viewId);
    res.json({ ok: true });
  });

  app.post('/api/apps/install', (req, res) => {
    try {
      if (!config.linuxApps.allowInstall) {
        res.status(403).json({ error: 'Bu sunucuda arayüzden uygulama kurulumu kapalı.' });
        return;
      }
      const appId = String(req.body?.appId || '');
      const aptPackage = req.body?.aptPackage ? String(req.body.aptPackage) : undefined;
      const result = linuxAppManager.startInstall(appId, aptPackage);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/apps/install/:jobId', (req, res) => {
    const job = linuxAppManager.getInstallJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Kurulum kaydı bulunamadı.' });
      return;
    }
    res.json(job);
  });

  app.get('/api/apps/search', (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const results = q.length >= 2 ? linuxAppManager.searchApt(q) : [];
      res.json({ results });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/apps/uninstall', (req, res) => {
    try {
      if (!config.linuxApps.allowInstall) {
        res.status(403).json({ error: 'Bu sunucuda arayüzden uygulama yönetimi kapalı.' });
        return;
      }
      const appId = req.body?.appId ? String(req.body.appId) : undefined;
      const aptPackage = req.body?.aptPackage ? String(req.body.aptPackage) : undefined;
      const result = linuxAppManager.startUninstall(appId, aptPackage);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/apps/open-files', (req, res) => {
    try {
      const desktopId = sanitizeDesktopId(extractReqDesktopId(req));
      const { vfs } = getDesktopContext(desktopId);
      const sessionId = String(req.body?.sessionId || '');
      const vfsPaths: string[] = Array.isArray(req.body?.vfsPaths)
        ? req.body.vfsPaths.map((x: unknown) => String(x))
        : [];
      if (!sessionId || vfsPaths.length === 0) {
        res.status(400).json({ error: 'Oturum kimliği ve dosya yolu gereklidir.' });
        return;
      }
      const realPaths = vfsPaths
        .map((vp: string) => {
          try {
            return vfs.resolveDiskPath(vp);
          } catch {
            return null;
          }
        })
        .filter((p: string | null): p is string => Boolean(p && fs.existsSync(p)));

      if (realPaths.length === 0) {
        res.status(404).json({ error: 'Açılacak dosya bulunamadı.' });
        return;
      }
      const ok = linuxDisplayBridge.openFiles(sessionId, realPaths);
      if (!ok) {
        res.status(404).json({ error: 'Uygulama oturumu bulunamadı.' });
        return;
      }
      res.json({ ok: true, count: realPaths.length });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/apps/vscode-status', (_req, res) => {
    res.json(vscodeManager.getStatus());
  });

  app.post('/api/apps/vscode-start', async (req, res) => {
    try {
      const desktopId = sanitizeDesktopId(extractReqDesktopId(req));
      const { vfs } = getDesktopContext(desktopId);
      await vscodeManager.ensureStarted();
      const targetVPath = String(req.body?.folderPath || '/Projects');
      const theme = req.body?.theme === 'light' ? 'light' : 'dark';
      const diskFolder = vfs.resolveDiskPath(targetVPath);
      fs.mkdirSync(diskFolder, { recursive: true });
      res.json({
        url: `/vscode-web/?folder=${encodeURIComponent(diskFolder)}&tamgaTheme=${theme}`,
      });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // --- Multi-Desktop Management Endpoints ---

  app.get('/api/desktops', (_req, res) => {
    res.json({ desktops: registry.list() });
  });

  app.post('/api/desktops', (req, res) => {
    try {
      const created = registry.createNewDesktop(req.body?.name);
      getDesktopContext(created.id);
      res.json({ desktop: created, desktops: registry.list() });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.patch('/api/desktops/:id', (req, res) => {
    try {
      const updated = registry.renameDesktop(req.params.id, String(req.body?.name || ''));
      res.json({ desktop: updated, desktops: registry.list() });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.delete('/api/desktops/:id', async (req, res) => {
    try {
      const id = sanitizeDesktopId(req.params.id);
      await chromiumCluster.destroySession(id);
      terminalManager.destroyDesktopSessions(id);
      linuxDisplayBridge.destroyDesktopSessions(id);
      vfsInstances.delete(id);
      const remaining = registry.deleteDesktop(id);
      res.json({ desktops: remaining });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // --- Scoped VFS & Telemetry Endpoints ---

  app.get('/api/telemetry', (req, res) => {
    res.json(getTelemetrySnapshot(extractReqDesktopId(req)));
  });

  app.get('/api/vfs/snapshot', (req, res) => {
    try {
      const { vfs, desktopInfo } = getDesktopContext(extractReqDesktopId(req));
      res.json({ ...vfs.getSnapshot(), desktop: desktopInfo, desktops: registry.list() });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/vfs/folder', (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      const { parentPath = '/Desktop', name = 'Yeni Klasör', pos } = req.body;
      const node = vfs.createFolder(parentPath, name, pos);
      res.json({ node, snapshot: vfs.getSnapshot() });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/vfs/file', (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      const { parentPath = '/Desktop', name = 'yeni-dosya.txt', content, pos } = req.body;
      const node = vfs.createFile(parentPath, name, content, pos);
      res.json({ node, snapshot: vfs.getSnapshot() });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/vfs/rename', (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      const { path: targetPath, newName } = req.body;
      const node = vfs.renameNode(targetPath, newName);
      res.json({ node, snapshot: vfs.getSnapshot() });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/vfs/move', (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      const { paths, targetDir } = req.body;
      const moved = vfs.moveNodes(paths || [], targetDir);
      res.json({ moved, snapshot: vfs.getSnapshot() });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/vfs/copy', (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      const { paths, targetDir } = req.body;
      const copied = vfs.copyNodes(paths || [], targetDir);
      res.json({ copied, snapshot: vfs.getSnapshot() });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/vfs/trash', (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      vfs.trashNodes(req.body.paths || []);
      res.json({ snapshot: vfs.getSnapshot() });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/vfs/restore', (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      const restored = vfs.restoreNodes(req.body.paths || []);
      res.json({ restored, snapshot: vfs.getSnapshot() });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/vfs/delete', (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      vfs.deletePermanently(req.body.paths || []);
      res.json({ snapshot: vfs.getSnapshot() });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/vfs/empty-trash', (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      vfs.emptyTrash();
      res.json({ snapshot: vfs.getSnapshot() });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/vfs/zip', (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      const { paths, targetDir, zipName } = req.body;
      const node = vfs.compressToZip(paths || [], targetDir || '/Desktop', zipName);
      res.json({ node, snapshot: vfs.getSnapshot() });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/vfs/unzip', (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      const { path: zipPath, targetDir } = req.body;
      const node = vfs.extractZip(zipPath, targetDir);
      res.json({ node, snapshot: vfs.getSnapshot() });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/vfs/content', (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      const vPath = String(req.query.path || '');
      res.json(vfs.readTextFile(vPath));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.put('/api/vfs/content', (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      const { path: vPath, content } = req.body;
      const node = vfs.writeTextFile(vPath, String(content ?? ''));
      res.json({ node, snapshot: vfs.getSnapshot() });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/vfs/raw', (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      const vPath = String(req.query.path || '');
      const diskPath = vfs.resolveDiskPath(vPath);
      if (!fs.existsSync(diskPath) || fs.statSync(diskPath).isDirectory()) {
        res.status(404).send('Dosya bulunamadı');
        return;
      }
      const ext = path.extname(diskPath).slice(1).toLowerCase();
      const mime = MIME_MAP[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      if (req.query.download === '1') {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(diskPath))}`
        );
      }
      fs.createReadStream(diskPath).pipe(res);
    } catch (e) {
      res.status(400).send((e as Error).message);
    }
  });

  app.post('/api/vfs/upload', upload.array('files'), (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      const parentPath = String(req.body.parentPath || '/Desktop');
      const files = (req.files as Express.Multer.File[]) || [];
      const saved = files.map((file) => {
        const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        return vfs.saveUploadedBuffer(parentPath, decodedName, file.buffer);
      });
      res.json({ saved, snapshot: vfs.getSnapshot() });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/vfs/wallpaper', upload.single('file'), (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Arka plan resmi seçilmedi.' });
        return;
      }
      const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const meta = vfs.saveCustomWallpaper(decodedName, file.buffer);
      res.json({ meta });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/vfs/wallpaper-from-vfs', (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      const vPath = String(req.body?.path || '');
      const meta = vfs.setWallpaperFromVfs(vPath);
      res.json({ meta });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/vfs/wallpaper/:fileName', (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      const diskPath = vfs.resolveWallpaperPath(req.params.fileName);
      if (!fs.existsSync(diskPath) || fs.statSync(diskPath).isDirectory()) {
        res.status(404).send('Arka plan bulunamadı');
        return;
      }
      const ext = path.extname(diskPath).slice(1).toLowerCase();
      res.setHeader('Content-Type', MIME_MAP[ext] || 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      fs.createReadStream(diskPath).pipe(res);
    } catch (e) {
      res.status(400).send((e as Error).message);
    }
  });

  app.patch('/api/vfs/meta', (req, res) => {
    try {
      const desktopId = sanitizeDesktopId(extractReqDesktopId(req));
      const { vfs, browserSession } = getDesktopContext(desktopId);
      const meta = vfs.updateMeta(req.body || {});
      const prefs = req.body?.preferences;
      if (prefs?.stream) {
        const s = meta.preferences.stream;
        browserSession
          .setStreamConfig({
            dynamicQualityDrop: s.dynamicQualityDrop,
            motionQuality: s.motionQuality,
            motionScale: s.motionScale,
            maxDpr: s.maxDpr,
            settlePng: s.settlePng,
            settleDelayMs: s.settleDelayMs,
          })
          .catch(() => {});
        linuxDisplayBridge.updateStreamConfig(desktopId, {
          fps: s.x11Fps,
          maxQuality: s.x11MaxQuality,
          motionQuality: s.x11MotionQuality,
          dynamicDrop: s.dynamicQualityDrop,
          settleMs: s.settleDelayMs,
        });
      }
      if (prefs?.browser?.defaultUrl) {
        browserSession.setDefaultUrl(meta.preferences.browser.defaultUrl);
      }
      res.json({ meta });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/vfs/reset-positions', (req, res) => {
    try {
      const { vfs } = getDesktopContext(extractReqDesktopId(req));
      const meta = vfs.clearPositions();
      res.json({ meta });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // --- Serve Compiled Frontend with In-Memory Brotli / Gzip Compression (4x faster boot over WAN) ---
  const clientDist = resolveClientDistDir();
  if (clientDist) {
    const staticCompCache = new Map<string, { br: Buffer; gz: Buffer; mime: string }>();
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/ws')) {
        next();
        return;
      }
      const ext = path.extname(req.path).slice(1).toLowerCase();
      if (!['js', 'mjs', 'css', 'svg', 'json'].includes(ext)) {
        next();
        return;
      }
      const accept = String(req.headers['accept-encoding'] || '');
      const enc: 'br' | 'gzip' | null = accept.includes('br')
        ? 'br'
        : accept.includes('gzip')
        ? 'gzip'
        : null;
      if (!enc) {
        next();
        return;
      }
      const safeRel = path.normalize(req.path).replace(/^(\.\.[/\\])+/, '');
      const fullPath = path.join(clientDist, safeRel);
      if (!fullPath.startsWith(clientDist) || !fs.existsSync(fullPath)) {
        next();
        return;
      }
      try {
        let entry = staticCompCache.get(fullPath);
        if (!entry) {
          const raw = fs.readFileSync(fullPath);
          entry = {
            br: zlib.brotliCompressSync(raw, {
              params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 },
            }),
            gz: zlib.gzipSync(raw, { level: 6 }),
            mime: MIME_MAP[ext] || 'application/octet-stream',
          };
          staticCompCache.set(fullPath, entry);
        }
        const payload = enc === 'br' ? entry.br : entry.gz;
        const isHashedAsset = req.path.startsWith('/assets/');
        res.writeHead(200, {
          'Content-Type': entry.mime,
          'Content-Encoding': enc,
          'Content-Length': String(payload.length),
          'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
          Vary: 'Accept-Encoding',
        });
        res.end(payload);
        return;
      } catch {
        next();
      }
    });

    app.use(express.static(clientDist, { maxAge: '1h', index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) {
        next();
        return;
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  const server = http.createServer(app);
  // Disable TCP Nagle's algorithm globally so small mouse/key/frame packets leave with 0ms delay
  server.on('connection', (sock) => {
    sock.setNoDelay(true);
  });

  // --- Multi-Channel WebSocket Upgrade Router (perMessageDeflate disabled for zero-overhead binary streaming) ---
  const desktopWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const terminalWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const appWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  function sendJson(ws: WebSocket, payload: Record<string, unknown>) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  function sendBinary(ws: WebSocket, packet: Buffer, cb?: () => void, onDrop?: () => void) {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 262_144) {
      ws.send(packet, { binary: true, compress: false }, () => cb?.());
    } else {
      onDrop?.();
      cb?.();
    }
  }

  server.on('upgrade', (req, socket, head) => {
    if (socket instanceof net.Socket) {
      socket.setNoDelay(true);
    }
    if (!authManager.isRequestAuthorized(req.headers.cookie, req.headers.authorization)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const reqUrl = new URL(req.url || '/ws', 'http://localhost');
    if (reqUrl.pathname.startsWith('/vscode-web')) {
      vscodeManager.proxyUpgrade(req, socket, head);
    } else if (reqUrl.pathname === '/ws') {
      desktopWss.handleUpgrade(req, socket, head, (ws) => {
        desktopWss.emit('connection', ws, req);
      });
    } else if (reqUrl.pathname === '/ws/terminal') {
      terminalWss.handleUpgrade(req, socket, head, (ws) => {
        terminalWss.emit('connection', ws, req);
      });
    } else if (reqUrl.pathname === '/ws/app') {
      appWss.handleUpgrade(req, socket, head, (ws) => {
        appWss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  // 1. Desktop Control + VFS + Fallback Playwright Chromium WS
  type TrackedSocket = WebSocket & { desktopId?: string };

  desktopWss.on('connection', (ws: TrackedSocket, req) => {
    const reqUrl = new URL(req.url || '/ws', 'http://localhost');
    const desktopId = sanitizeDesktopId(reqUrl.searchParams.get('desktop') || 'main');
    ws.desktopId = desktopId;

    const { vfs, browserSession } = getDesktopContext(desktopId);

    const unsubBrowser = browserSession.subscribe(
      (msg) => sendJson(ws, msg),
      (packet) => sendBinary(ws, packet)
    );
    const unsubVfs = vfs.onChange(() => {
      sendJson(ws, { type: 'vfs_snapshot', snapshot: vfs.getSnapshot() });
    });

    sendJson(ws, { type: 'telemetry', data: getTelemetrySnapshot(desktopId) });
    sendJson(ws, { type: 'vfs_snapshot', snapshot: vfs.getSnapshot() });

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString('utf-8'));
        switch (msg.type) {
          case 'ping':
            sendJson(ws, { type: 'pong', ts: msg.ts });
            break;
          case 'browser_new_tab':
            await browserSession.createTab(msg.url);
            break;
          case 'browser_activate_tab':
          case 'browser_switch_tab':
            await browserSession.activateTab(msg.tabId);
            break;
          case 'browser_close_tab':
            await browserSession.closeTab(msg.tabId);
            break;
          case 'browser_navigate':
            await browserSession.navigate(msg.tabId, msg.url);
            break;
          case 'browser_back':
            await browserSession.goBack(msg.tabId);
            break;
          case 'browser_forward':
            await browserSession.goForward(msg.tabId);
            break;
          case 'browser_reload':
            await browserSession.reload(msg.tabId);
            break;
          case 'browser_viewport':
            await browserSession.setViewport(
              Number(msg.width),
              Number(msg.height),
              typeof msg.devicePixelRatio === 'number' ? msg.devicePixelRatio : undefined
            );
            break;
          case 'browser_input':
            browserSession.handleInput(msg);
            break;
          case 'browser_visibility':
            await browserSession.setViewerVisible(Boolean(msg.visible));
            break;
          case 'browser_reset':
            await browserSession.resetSession();
            break;
          case 'stream_config':
            if (msg.stream) {
              const updated = vfs.updateMeta({ preferences: { stream: msg.stream } });
              const s = updated.preferences.stream;
              await browserSession.setStreamConfig({
                dynamicQualityDrop: s.dynamicQualityDrop,
                motionQuality: s.motionQuality,
                motionScale: s.motionScale,
                maxDpr: s.maxDpr,
                settlePng: s.settlePng,
                settleDelayMs: s.settleDelayMs,
              });
              linuxDisplayBridge.updateStreamConfig(desktopId, {
                fps: s.x11Fps,
                maxQuality: s.x11MaxQuality,
                motionQuality: s.x11MotionQuality,
                dynamicDrop: s.dynamicQualityDrop,
                settleMs: s.settleDelayMs,
              });
            }
            break;
        }
      } catch {
        // ignore malformed message
      }
    });

    ws.on('close', () => {
      unsubBrowser();
      unsubVfs();
    });
  });

  // 2. Real Linux PTY Terminal WS
  terminalWss.on('connection', (ws, req) => {
    const reqUrl = new URL(req.url || '/ws/terminal', 'http://localhost');
    const desktopId = sanitizeDesktopId(reqUrl.searchParams.get('desktop') || 'main');
    const sessionId =
      reqUrl.searchParams.get('sessionId') || `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const cols = Number(reqUrl.searchParams.get('cols')) || 100;
    const rows = Number(reqUrl.searchParams.get('rows')) || 30;
    const requestedCwd = reqUrl.searchParams.get('cwd') || '/Desktop';

    const { vfs } = getDesktopContext(desktopId);
    let startDir = vfs.resolveDiskPath('/Desktop');
    try {
      const candidate = vfs.resolveDiskPath(requestedCwd);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        startDir = candidate;
      }
    } catch {
      // fallback to /Desktop
    }
    const session = terminalManager.createSession(sessionId, desktopId, startDir, cols, rows);

    const listener = (ev: { type: 'output' | 'exit'; data?: string; code?: number }) => {
      sendJson(ws, ev);
    };
    session.listeners.add(listener);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString('utf-8'));
        if (msg.type === 'input' && typeof msg.data === 'string') {
          session.write(msg.data);
        } else if (msg.type === 'resize') {
          session.resize(Number(msg.cols) || 100, Number(msg.rows) || 30);
        }
      } catch {}
    });

    ws.on('close', () => {
      session.listeners.delete(listener);
      // Close PTY if no clients remain attached
      if (session.listeners.size === 0) {
        session.close();
      }
    });
  });

  // 3. Real Native Linux GUI App Stream WS (Binary 0x01 Video + 0x02 Audio + JSON Input/Title/Cursor/Window)
  appWss.on('connection', (ws, req) => {
    const reqUrl = new URL(req.url || '/ws/app', 'http://localhost');
    const sessionId = reqUrl.searchParams.get('sessionId') || '';
    const viewId = reqUrl.searchParams.get('view') || 'main';
    const session = linuxDisplayBridge.getSession(sessionId);
    if (!session) {
      sendJson(ws, { type: 'error', message: 'Uygulama oturumu bulunamadı.' });
      ws.close();
      return;
    }

    let dropRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = session.subscribeView(viewId, {
      onVideoFrame: (framedPkt, done) => {
        sendBinary(ws, framedPkt, done, () => {
          if (!dropRefreshTimer) {
            dropRefreshTimer = setTimeout(() => {
              dropRefreshTimer = null;
              session.requestRefresh(viewId);
            }, 90);
          }
        });
      },
      onAudioChunk: (pcm) => {
        const pkt = Buffer.allocUnsafe(1 + pcm.length);
        pkt[0] = PACKET_AUDIO_PCM;
        pcm.copy(pkt, 1);
        sendBinary(ws, pkt);
      },
      onEvent: (ev) => sendJson(ws, ev),
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString('utf-8'));
        if (msg.type === 'resize') {
          session.resizeView(viewId, Number(msg.width), Number(msg.height));
        } else if (msg.type === 'focus') {
          session.focusView(viewId);
        } else {
          session.sendInput(msg, viewId);
        }
      } catch {}
    });

    ws.on('close', () => {
      unsub();
    });
  });

  const telemetryTimer = setInterval(() => {
    if (desktopWss.clients.size === 0) return;
    const cache = new Map<string, ReturnType<typeof getTelemetrySnapshot>>();
    for (const client of desktopWss.clients as Set<TrackedSocket>) {
      const dId = client.desktopId || 'main';
      let snap = cache.get(dId);
      if (!snap) {
        snap = getTelemetrySnapshot(dId);
        cache.set(dId, snap);
      }
      sendJson(client, { type: 'telemetry', data: snap });
    }
  }, 2500);

  const shutdown = () => {
    clearInterval(telemetryTimer);
    terminalManager.destroyAll();
    linuxDisplayBridge.destroyAll();
    vscodeManager.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      const displayHost = config.host === '0.0.0.0' ? 'localhost' : config.host;
      console.log(
        `[TamgaVDesktop v${TAMGA_VERSION}] Hazır -> http://${displayHost}:${config.port} (bind: ${config.host}, data: ${config.dataDir})`
      );
      if (clientDist) {
        console.log(`[TamgaVDesktop] Arayüz sunumu aktif -> ${clientDist}`);
      }
      resolve();
    });
  });

  return { server, config };
}

// Auto-start when invoked directly (e.g., `tsx server/index.ts` or `node dist/server.js`), never when bundled inside cli.js
const selfPath = fileURLToPath(import.meta.url);
const isDirectRun =
  Boolean(process.argv[1]) &&
  !selfPath.endsWith('cli.js') &&
  path.resolve(process.argv[1]) === path.resolve(selfPath);

if (isDirectRun) {
  const devPort = Number(process.env.PORT || 3001);
  startTamgaServer({ host: '127.0.0.1', port: devPort }).catch((err) => {
    console.error('[TamgaVDesktop] Başlatma hatası:', err);
    process.exit(1);
  });
}
