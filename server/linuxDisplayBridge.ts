import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { resolveHelperPath } from './terminalManager';

export interface X11StreamConfig {
  fps?: number;
  maxQuality?: number;
  motionQuality?: number;
  dynamicDrop?: boolean;
  settleMs?: number;
}

export interface LinuxAppSessionOptions {
  sessionId: string;
  desktopId: string;
  appId: string;
  appName: string;
  command: string;
  needsNoSandbox?: boolean;
  desktopDataRoot: string;
  width?: number;
  height?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  fps?: number;
  quality?: number;
  maxQuality?: number;
  motionQuality?: number;
  dynamicDrop?: boolean;
  settleMs?: number;
  enableAudio?: boolean;
}

export interface LinuxAppSubscriber {
  onVideoFrame: (jpegBytes: Buffer, done?: () => void) => void;
  onAudioChunk: (pcm16Bytes: Buffer) => void;
  onEvent: (event: { type: string; [key: string]: unknown }) => void;
}

interface ViewStream {
  viewId: string;
  title: string;
  width: number;
  height: number;
  hasGeometry: boolean;
  targetMode: 'root' | 'pixmap';
  targetWid: string | number;
  offsetX: number;
  offsetY: number;
  lastFrame: Buffer | null;
  streamerProc: ChildProcess | null;
  streamerMode: 'xdamage' | 'ffmpeg';
  resizeTimer: ReturnType<typeof setTimeout> | null;
  subscribers: Set<LinuxAppSubscriber>;
}

const DEFAULT_SCREEN_W = 1440;
const DEFAULT_SCREEN_H = 840;

const PROFILE_LOCKED_APPS = new Set([
  'firefox',
  'firefox-esr',
  'chrome',
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'antigravity',
]);

function findFreeDisplay(inUse: Set<number>): number {
  for (let d = 100; d < 250; d++) {
    if (inUse.has(d)) continue;
    if (!fs.existsSync(`/tmp/.X11-unix/X${d}`) && !fs.existsSync(`/tmp/.X${d}-lock`)) {
      return d;
    }
  }
  return 100 + Math.floor(Math.random() * 100);
}

function hasTurboJpegAndXDamage(): boolean {
  const tjCandidates = [
    '/lib/x86_64-linux-gnu/libturbojpeg.so.0',
    '/usr/lib/x86_64-linux-gnu/libturbojpeg.so.0',
    '/lib/aarch64-linux-gnu/libturbojpeg.so.0',
    '/usr/lib/aarch64-linux-gnu/libturbojpeg.so.0',
    '/usr/lib/libturbojpeg.so.0',
  ];
  const dmgCandidates = [
    '/lib/x86_64-linux-gnu/libXdamage.so.1',
    '/usr/lib/x86_64-linux-gnu/libXdamage.so.1',
    '/lib/aarch64-linux-gnu/libXdamage.so.1',
    '/usr/lib/aarch64-linux-gnu/libXdamage.so.1',
    '/usr/lib/libXdamage.so.1',
  ];
  return tjCandidates.some((p) => fs.existsSync(p)) && dmgCandidates.some((p) => fs.existsSync(p));
}

function buildOpenboxRcXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <resistance><strength>0</strength><screen_edge_strength>0</screen_edge_strength></resistance>
  <focus><focusNew>yes</focusNew><followMouse>no</followMouse></focus>
  <placement><policy>Smart</policy><center>no</center></placement>
  <theme><name>Clearlooks</name><titleLayout>NLIMC</titleLayout><keepBorder>no</keepBorder></theme>
  <desktops><number>1</number></desktops>
  <margins><top>0</top><bottom>0</bottom><left>0</left><right>0</right></margins>
  <applications>
    <application class="*">
      <decor>no</decor>
      <maximized>no</maximized>
    </application>
  </applications>
</openbox_config>
`;
}

function clampDim(w: number, h: number, maxW = 1920, maxH = 1080): { width: number; height: number } {
  const cw = Math.max(240, Math.min(maxW, Math.round(w || 720)));
  const ch = Math.max(180, Math.min(maxH, Math.round(h || 480)));
  return {
    width: cw - (cw % 2),
    height: ch - (ch % 2),
  };
}

export class LinuxAppSession {
  public readonly sessionId: string;
  public readonly desktopId: string;
  public readonly appId: string;
  public readonly appName: string;
  public readonly displayNum: number;
  public readonly displayStr: string;
  public title: string;
  public cursor = 'default';
  public width: number;
  public height: number;
  public startedAt = Date.now();

  private readonly screenWidth: number;
  private readonly screenHeight: number;
  private fps: number;
  private quality: number;
  private maxQuality: number;
  private motionQuality: number;
  private dynamicDrop: boolean;
  private settleMs: number;
  private enableAudio: boolean;
  private desktopDataRoot: string;
  private command: string;
  private needsNoSandbox: boolean;
  private tempDir: string;
  private baseEnv: NodeJS.ProcessEnv = {};

  private xvfbProc: ChildProcess | null = null;
  private openboxProc: ChildProcess | null = null;
  private appProc: ChildProcess | null = null;
  private x11BridgeProc: ChildProcess | null = null;
  private parecProc: ChildProcess | null = null;
  private pulseSinkName = '';

  private views = new Map<string, ViewStream>();
  private hadWindow = false;
  private closed = false;
  private onCloseCb: () => void;

  constructor(opts: LinuxAppSessionOptions, displayNum: number, onCloseCb: () => void) {
    this.sessionId = opts.sessionId;
    this.desktopId = opts.desktopId;
    this.appId = opts.appId;
    this.appName = opts.appName;
    this.title = opts.appName;
    this.command = opts.command;
    this.needsNoSandbox = Boolean(opts.needsNoSandbox);
    this.desktopDataRoot = opts.desktopDataRoot;
    this.displayNum = displayNum;
    this.displayStr = `:${displayNum}`;

    const rawScreenW = Math.max(1280, Math.min(1920, Math.round(opts.viewportWidth || DEFAULT_SCREEN_W)));
    const rawScreenH = Math.max(760, Math.min(1080, Math.round(opts.viewportHeight || DEFAULT_SCREEN_H)));
    this.screenWidth = rawScreenW - (rawScreenW % 2);
    this.screenHeight = rawScreenH - (rawScreenH % 2);

    const dims = clampDim(opts.width || 720, opts.height || 480, this.screenWidth, this.screenHeight);
    this.width = dims.width;
    this.height = dims.height;
    this.fps = Math.max(8, Math.min(35, opts.fps || 30));
    this.quality = Math.max(2, Math.min(10, opts.quality || 4));
    this.maxQuality = Math.max(45, Math.min(95, opts.maxQuality ?? Math.max(60, Math.min(88, 92 - this.quality * 4))));
    this.motionQuality = Math.max(30, Math.min(this.maxQuality, opts.motionQuality ?? Math.max(40, this.maxQuality - 24)));
    this.dynamicDrop = opts.dynamicDrop ?? true;
    this.settleMs = Math.max(120, Math.min(1200, opts.settleMs ?? 300));
    this.enableAudio = opts.enableAudio ?? true;
    this.tempDir = path.join(
      os.tmpdir(),
      `tamga-gui-${this.sessionId.replace(/[^a-z0-9_-]/gi, '')}`
    );
    this.onCloseCb = onCloseCb;

    // Seed primary view 'main' (initial native dimensions are populated when app maps)
    this.views.set('main', {
      viewId: 'main',
      title: this.appName,
      width: this.width,
      height: this.height,
      hasGeometry: false,
      targetMode: 'root',
      targetWid: 0,
      offsetX: 0,
      offsetY: 0,
      lastFrame: null,
      streamerProc: null,
      streamerMode: 'xdamage',
      resizeTimer: null,
      subscribers: new Set(),
    });
  }

  public updateStreamConfig(cfg: X11StreamConfig): void {
    if (typeof cfg.fps === 'number' && Number.isFinite(cfg.fps)) {
      this.fps = Math.max(8, Math.min(35, Math.round(cfg.fps)));
    }
    if (typeof cfg.maxQuality === 'number' && Number.isFinite(cfg.maxQuality)) {
      this.maxQuality = Math.max(45, Math.min(95, Math.round(cfg.maxQuality)));
    }
    if (typeof cfg.motionQuality === 'number' && Number.isFinite(cfg.motionQuality)) {
      this.motionQuality = Math.max(30, Math.min(this.maxQuality, Math.round(cfg.motionQuality)));
    }
    if (typeof cfg.dynamicDrop === 'boolean') {
      this.dynamicDrop = cfg.dynamicDrop;
    }
    if (typeof cfg.settleMs === 'number' && Number.isFinite(cfg.settleMs)) {
      this.settleMs = Math.max(120, Math.min(1200, Math.round(cfg.settleMs)));
    }
    const payload =
      JSON.stringify({
        type: 'stream_config',
        fps: this.fps,
        max_quality: this.maxQuality,
        motion_quality: this.motionQuality,
        dynamic_drop: this.dynamicDrop,
        settle_ms: this.settleMs,
      }) + '\n';
    for (const v of this.views.values()) {
      if (v.streamerMode === 'xdamage' && v.streamerProc?.stdin?.writable) {
        try {
          v.streamerProc.stdin.write(payload);
        } catch {}
      }
    }
  }

  public async start(): Promise<void> {
    fs.mkdirSync(this.tempDir, { recursive: true });
    const obRcPath = path.join(this.tempDir, 'rc.xml');
    fs.writeFileSync(obRcPath, buildOpenboxRcXml(), 'utf-8');

    // 1. Start lightweight Xvfb sized to desktop viewport with XComposite for occluded views
    this.xvfbProc = spawn(
      'Xvfb',
      [
        this.displayStr,
        '-screen',
        '0',
        `${this.screenWidth}x${this.screenHeight}x24`,
        '-ac',
        '+extension',
        'RANDR',
        '+extension',
        'DAMAGE',
        '+extension',
        'XFIXES',
        '+extension',
        'Composite',
        '+render',
        '-noreset',
      ],
      { stdio: 'ignore' }
    );

    const xSocket = `/tmp/.X11-unix/X${this.displayNum}`;
    for (let i = 0; i < 40; i++) {
      if (fs.existsSync(xSocket)) break;
      await new Promise((r) => setTimeout(r, 60));
    }

    const baseEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DISPLAY: this.displayStr,
      XDG_RUNTIME_DIR: this.tempDir,
      GDK_SCALE: '1',
      QT_AUTO_SCREEN_SCALE_FACTOR: '0',
      MOZ_ENABLE_WAYLAND: '0',
      GTK_CSD: '0',
      NO_AT_BRIDGE: '1',
      XCURSOR_THEME: 'DMZ-White',
    };
    delete baseEnv.DBUS_SESSION_BUS_ADDRESS;
    this.baseEnv = baseEnv;

    // 2. Start borderless Openbox window manager (~4MB RAM)
    this.openboxProc = spawn('openbox', ['--config-file', obRcPath], {
      env: baseEnv,
      stdio: 'ignore',
    });

    // 3. Optional PulseAudio sink
    if (this.enableAudio) {
      this.setupPulseAudio(baseEnv);
    }

    // 4. Event-driven X11/XTest + XFixes cursor + XComposite bridge
    this.startX11Bridge(baseEnv);

    // 5. Launch real Linux GUI app (native sizing determined by the program)
    this.launchTargetApp(baseEnv);

    // 6. Start zero-idle XDamage+TurboJPEG capture for 'main' view
    const mainView = this.views.get('main')!;
    this.startViewStreamer(mainView);
  }

  private setupPulseAudio(baseEnv: NodeJS.ProcessEnv): void {
    try {
      try {
        execSync('pactl info', { stdio: 'ignore', timeout: 1200 });
      } catch {
        spawn(
          'pulseaudio',
          ['--daemonize=yes', '--exit-idle-time=-1', '--disallow-module-loading=0', '--no-cpu-limit'],
          { stdio: 'ignore' }
        );
      }
      const sinkName = `tamga_${this.sessionId.replace(/[^a-z0-9]/gi, '').slice(-10)}`;
      try {
        execSync(
          `pactl load-module module-null-sink sink_name=${sinkName} sink_properties=device.description=${sinkName}`,
          { stdio: 'ignore', timeout: 1500 }
        );
        this.pulseSinkName = sinkName;
        baseEnv.PULSE_SINK = sinkName;
        this.startAudioCapture(sinkName);
      } catch {}
    } catch {}
  }

  private startAudioCapture(sinkName: string): void {
    try {
      const parec = spawn(
        'parec',
        ['-d', `${sinkName}.monitor`, '--rate=24000', '--channels=1', '--format=s16le', '--latency-msec=45'],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      );
      this.parecProc = parec;

      const CHUNK_BYTES = 2048;
      let pcmBuf = Buffer.alloc(0);

      parec.stdout?.on('data', (chunk: Buffer) => {
        if (this.closed) return;
        const audioView = this.views.get('main') || this.views.values().next().value;
        if (!audioView || audioView.subscribers.size === 0) return;

        pcmBuf = Buffer.concat([pcmBuf, chunk]);
        while (pcmBuf.length >= CHUNK_BYTES) {
          const slice = pcmBuf.subarray(0, CHUNK_BYTES);
          pcmBuf = pcmBuf.subarray(CHUNK_BYTES);

          let peak = 0;
          for (let i = 0; i < slice.length; i += 2) {
            const v = Math.abs(slice.readInt16LE(i));
            if (v > peak) peak = v;
            if (peak > 45) break;
          }
          if (peak > 45) {
            for (const sub of audioView.subscribers) {
              sub.onAudioChunk(slice);
            }
          }
        }
      });
    } catch {}
  }

  private getEventHostView(): ViewStream | undefined {
    const main = this.views.get('main');
    if (main && main.subscribers.size > 0) return main;
    for (const v of this.views.values()) {
      if (v.subscribers.size > 0) return v;
    }
    return main;
  }

  private startX11Bridge(baseEnv: NodeJS.ProcessEnv): void {
    const scriptPath = resolveHelperPath('x11_bridge.py');
    const proc = spawn(
      'python3',
      ['-u', scriptPath, this.displayStr, String(this.screenWidth), String(this.screenHeight)],
      {
        env: baseEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    this.x11BridgeProc = proc;
    proc.stdin?.on('error', () => {});
    proc.stderr?.on('data', (err: Buffer) => {
      const msg = err.toString('utf-8').trim();
      if (msg) console.error(`[x11_bridge ${this.displayStr}]`, msg);
    });

    let lineBuf = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      lineBuf += chunk.toString('utf-8');
      let idx = lineBuf.indexOf('\n');
      while (idx !== -1) {
        const line = lineBuf.slice(0, idx).trim();
        lineBuf = lineBuf.slice(idx + 1);
        if (line) {
          try {
            const msg = JSON.parse(line);
            this.handleBridgeEvent(msg);
          } catch {}
        }
        idx = lineBuf.indexOf('\n');
      }
    });
  }

  private handleBridgeEvent(msg: { type: string; [key: string]: unknown }): void {
    if (this.closed) return;

    if (msg.type === 'title' && typeof msg.title === 'string') {
      this.hadWindow = true;
      const vid = typeof msg.view === 'string' ? msg.view : 'main';
      const v = this.views.get(vid);
      if (v) {
        v.title = msg.title;
        for (const sub of v.subscribers) {
          sub.onEvent({ type: 'title', title: msg.title });
        }
      }
      if (vid === 'main') this.title = msg.title;
      return;
    }

    if (msg.type === 'cursor' && typeof msg.cursor === 'string') {
      this.cursor = msg.cursor;
      for (const v of this.views.values()) {
        for (const sub of v.subscribers) {
          sub.onEvent(msg);
        }
      }
      return;
    }

    if (msg.type === 'window_opened' && typeof msg.view === 'string') {
      this.hadWindow = true;
      const dims = clampDim(
        Number(msg.width) || 900,
        Number(msg.height) || 640,
        this.screenWidth,
        this.screenHeight
      );
      const title = typeof msg.title === 'string' && msg.title ? msg.title : this.appName;

      if (!this.views.has(msg.view)) {
        const view: ViewStream = {
          viewId: msg.view,
          title,
          width: dims.width,
          height: dims.height,
          hasGeometry: true,
          targetMode: 'root',
          targetWid: 0,
          offsetX: 0,
          offsetY: 0,
          lastFrame: null,
          streamerProc: null,
          streamerMode: 'xdamage',
          resizeTimer: null,
          subscribers: new Set(),
        };
        this.views.set(msg.view, view);
        this.startViewStreamer(view);
      }

      const hostView = this.getEventHostView();
      if (hostView) {
        for (const sub of hostView.subscribers) {
          sub.onEvent({
            type: 'window_opened',
            view: msg.view,
            title,
            width: dims.width,
            height: dims.height,
          });
        }
      }
      return;
    }

    if (msg.type === 'view_geometry' && typeof msg.view === 'string') {
      const v = this.views.get(msg.view);
      if (!v) return;
      const dims = clampDim(
        Number(msg.width) || v.width,
        Number(msg.height) || v.height,
        this.screenWidth,
        this.screenHeight
      );
      v.width = dims.width;
      v.height = dims.height;
      v.hasGeometry = true;
      if (v.viewId === 'main') {
        this.width = dims.width;
        this.height = dims.height;
      }
      this.resizeViewCapture(v, dims.width, dims.height);
      for (const sub of v.subscribers) {
        sub.onEvent({
          type: 'view_geometry',
          width: dims.width,
          height: dims.height,
          initial: Boolean(msg.initial),
        });
      }
      return;
    }

    if (msg.type === 'view_targets' && msg.targets && typeof msg.targets === 'object') {
      const targets = msg.targets as Record<
        string,
        { mode?: string; wid?: string | number; off_x?: number; off_y?: number; width?: number; height?: number }
      >;
      for (const [vid, t] of Object.entries(targets)) {
        const v = this.views.get(vid);
        if (!v || !t) continue;
        v.targetMode = t.mode === 'pixmap' ? 'pixmap' : 'root';
        v.targetWid = t.wid ?? 0;
        v.offsetX = Number(t.off_x) || 0;
        v.offsetY = Number(t.off_y) || 0;
        if (v.streamerMode === 'xdamage' && v.streamerProc?.stdin?.writable) {
          v.streamerProc.stdin.write(
            JSON.stringify({
              type: 'target',
              mode: v.targetMode,
              wid: v.targetWid,
              off_x: v.offsetX,
              off_y: v.offsetY,
              width: Number(t.width) || v.width,
              height: Number(t.height) || v.height,
            }) + '\n'
          );
        }
      }
      return;
    }

    if (msg.type === 'view_maximize' && typeof msg.view === 'string') {
      const v = this.views.get(msg.view);
      if (!v) return;
      for (const sub of v.subscribers) {
        sub.onEvent({ type: 'view_maximize' });
      }
      return;
    }

    if (msg.type === 'view_closed' && typeof msg.view === 'string') {
      const v = this.views.get(msg.view);
      if (!v) return;
      for (const sub of v.subscribers) {
        sub.onEvent({ type: 'app_exit', code: 0 });
      }
      this.destroyView(v);
      return;
    }

    if (msg.type === 'all_windows_closed') {
      for (const v of this.views.values()) {
        for (const sub of v.subscribers) {
          sub.onEvent({ type: 'app_exit', code: 0 });
        }
      }
      this.close();
      return;
    }

    // Clipboard / ready / error -> forward to active host view
    const hostView = this.getEventHostView();
    if (hostView) {
      for (const sub of hostView.subscribers) {
        sub.onEvent(msg);
      }
    }
  }

  private getProfileDir(): string {
    const profileDir = path.join(
      this.desktopDataRoot,
      'app-profiles',
      this.appId.replace(/[^a-z0-9_-]/gi, '_')
    );
    fs.mkdirSync(profileDir, { recursive: true });
    return profileDir;
  }

  private prepareDesktopXdgConfig(): { xdgConfigHome: string; downloadsDir: string; desktopFilesDir: string } {
    const vfsRoot = path.join(this.desktopDataRoot, 'vfs');
    const desktopFilesDir = path.join(vfsRoot, 'Desktop');
    const downloadsDir = path.join(vfsRoot, 'Downloads');
    const documentsDir = path.join(vfsRoot, 'Documents');
    const xdgConfigHome = path.join(this.desktopDataRoot, '.config');
    fs.mkdirSync(desktopFilesDir, { recursive: true });
    fs.mkdirSync(downloadsDir, { recursive: true });
    fs.mkdirSync(documentsDir, { recursive: true });
    fs.mkdirSync(path.join(xdgConfigHome, 'gtk-3.0'), { recursive: true });
    fs.mkdirSync(path.join(xdgConfigHome, 'gtk-4.0'), { recursive: true });

    const gtkIni = '[Settings]\ngtk-decoration-layout=:\ngtk-dialogs-use-header=0\n';
    try {
      fs.writeFileSync(path.join(xdgConfigHome, 'gtk-3.0', 'settings.ini'), gtkIni, 'utf-8');
      fs.writeFileSync(path.join(xdgConfigHome, 'gtk-4.0', 'settings.ini'), gtkIni, 'utf-8');
      fs.writeFileSync(
        path.join(xdgConfigHome, 'user-dirs.dirs'),
        [
          `XDG_DESKTOP_DIR="${desktopFilesDir}"`,
          `XDG_DOWNLOAD_DIR="${downloadsDir}"`,
          `XDG_DOCUMENTS_DIR="${documentsDir}"`,
          `XDG_PICTURES_DIR="${desktopFilesDir}"`,
          `XDG_MUSIC_DIR="${documentsDir}"`,
          `XDG_VIDEOS_DIR="${downloadsDir}"`,
        ].join('\n') + '\n',
        'utf-8'
      );
    } catch {}

    return { xdgConfigHome, downloadsDir, desktopFilesDir };
  }

  private buildLaunchCommand(extraNewWindow = false): { cmd: string; cwd: string; xdgConfigHome: string } {
    const profileDir = this.getProfileDir();
    const { xdgConfigHome, downloadsDir, desktopFilesDir } = this.prepareDesktopXdgConfig();

    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    let finalCmd = this.command;
    const baseBin = path.basename(finalCmd.split(/\s+/)[0] || '');

    if (baseBin === 'firefox' || baseBin === 'firefox-esr') {
      if (!extraNewWindow) {
        // Prevent Firefox from silently exiting with code 0 after an unclean shutdown/reboot
        for (const stale of ['.startup-incomplete', '.parentlock', 'lock']) {
          try {
            fs.rmSync(path.join(profileDir, stale), { force: true });
          } catch {}
        }
      }
      const userJsPath = path.join(profileDir, 'user.js');
      fs.writeFileSync(
        userJsPath,
        [
          'user_pref("browser.shell.checkDefaultBrowser", false);',
          'user_pref("browser.aboutwelcome.enabled", false);',
          'user_pref("trailhead.firstrun.didSeeAboutWelcome", true);',
          'user_pref("datareporting.policy.firstRunURL", "");',
          'user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);',
          'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
          'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
          'user_pref("toolkit.startup.max_resumed_crashes", -1);',
          'user_pref("browser.sessionstore.resume_from_crash", false);',
          'user_pref("browser.startup.homepage", "https://www.google.com");',
          'user_pref("browser.tabs.inTitlebar", 0);',
          'user_pref("general.smoothScroll", false);',
          'user_pref("toolkit.cosmeticAnimations.enabled", false);',
          'user_pref("ui.prefersReducedMotion", 1);',
          'user_pref("dom.ipc.processCount", 2);',
          'user_pref("dom.disable_window_move_resize", false);',
          'user_pref("browser.link.open_newwindow.restriction", 0);',
          'user_pref("browser.sessionstore.interval", 60000);',
          'user_pref("browser.newtabpage.activity-stream.feeds.topsites", false);',
          'user_pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);',
          'user_pref("gfx.webrender.software", true);',
          'user_pref("gfx.x11-egl.force-disabled", true);',
          'user_pref("browser.download.dir", ' + JSON.stringify(downloadsDir) + ');',
          'user_pref("browser.download.folderList", 2);',
        ].join('\n') + '\n',
        'utf-8'
      );
      // Omit --no-remote and explicit --width/--height so Firefox picks its own geometry and supports extra windows
      finalCmd = extraNewWindow
        ? `${finalCmd} -profile "${profileDir}" --new-window about:home`
        : `${finalCmd} -profile "${profileDir}"`;
    } else if (
      this.needsNoSandbox ||
      [
        'code',
        'antigravity',
        'chromium',
        'chromium-browser',
        'google-chrome',
        'google-chrome-stable',
        'brave-browser',
        'microsoft-edge',
        'microsoft-edge-stable',
        'opera',
        'vivaldi',
      ].includes(baseBin)
    ) {
      const isChromiumBrowser = [
        'chromium',
        'chromium-browser',
        'google-chrome',
        'google-chrome-stable',
        'brave-browser',
        'microsoft-edge',
        'microsoft-edge-stable',
        'opera',
        'vivaldi',
      ].includes(baseBin);

      if (!extraNewWindow) {
        for (const stale of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
          try {
            fs.rmSync(path.join(profileDir, stale), { force: true });
          } catch {}
        }
      }

      if (isChromiumBrowser) {
        // Ensure Chrome hides duplicate inner min/max/close buttons & routes Downloads straight to VFS/Downloads
        try {
          const defaultDir = path.join(profileDir, 'Default');
          fs.mkdirSync(defaultDir, { recursive: true });
          const firstRunPath = path.join(profileDir, 'First Run');
          if (!fs.existsSync(firstRunPath)) fs.writeFileSync(firstRunPath, '', 'utf-8');

          const prefsPath = path.join(defaultDir, 'Preferences');
          let prefs: Record<string, any> = {};
          if (fs.existsSync(prefsPath)) {
            try {
              prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
            } catch {
              prefs = {};
            }
          }
          prefs.browser = {
            ...(prefs.browser || {}),
            custom_chrome_frame: false,
            has_seen_welcome_page: true,
          };
          prefs.download = {
            ...(prefs.download || {}),
            default_directory: downloadsDir,
            directory_upgrade: true,
            prompt_for_download: false,
          };
          prefs.savefile = {
            ...(prefs.savefile || {}),
            default_directory: downloadsDir,
          };
          prefs.selectfile = {
            ...(prefs.selectfile || {}),
            last_directory: desktopFilesDir,
          };
          fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), 'utf-8');
        } catch {}
      }

      const extraFlags: string[] = [];
      if (isRoot && !finalCmd.includes('--no-sandbox')) {
        extraFlags.push('--no-sandbox');
      }
      if (isChromiumBrowser) {
        if (!finalCmd.includes('--test-type')) {
          extraFlags.push('--test-type');
        }
        if (!finalCmd.includes('--no-first-run')) {
          extraFlags.push('--no-first-run');
        }
        if (!finalCmd.includes('--no-default-browser-check')) {
          extraFlags.push('--no-default-browser-check');
        }
        if (!extraNewWindow && !finalCmd.includes('--window-size')) {
          extraFlags.push(`--window-size=${this.width},${this.height}`);
        }
      }
      if (!finalCmd.includes('--user-data-dir')) {
        extraFlags.push(`--user-data-dir="${profileDir}"`);
      }
      if (!finalCmd.includes('--disable-gpu')) {
        extraFlags.push('--disable-gpu', '--disable-dev-shm-usage');
      }
      if ((baseBin === 'code' || baseBin === 'antigravity') && !finalCmd.includes('--verbose')) {
        extraFlags.push('--verbose');
      }
      if (extraNewWindow && !finalCmd.includes('--new-window')) {
        extraFlags.push('--new-window');
      }
      finalCmd = `${finalCmd} ${extraFlags.join(' ')}`;
    } else if (extraNewWindow && baseBin === 'gimp') {
      finalCmd = `${finalCmd} -n`;
    }

    return { cmd: finalCmd, cwd: desktopFilesDir, xdgConfigHome };
  }

  private launchTargetApp(baseEnv: NodeJS.ProcessEnv): void {
    const { cmd, cwd, xdgConfigHome } = this.buildLaunchCommand(false);
    const downloadsDir = path.join(this.desktopDataRoot, 'vfs', 'Downloads');

    this.appProc = spawn('/bin/bash', ['-c', `exec ${cmd}`], {
      cwd,
      env: {
        ...baseEnv,
        HOME: baseEnv.HOME || os.homedir(),
        XDG_CONFIG_HOME: xdgConfigHome,
        XDG_DOWNLOAD_DIR: downloadsDir,
        DONT_PROMPT_WSL_INSTALL: '1',
      },
      stdio: 'ignore',
    });

    this.appProc.on('exit', (code) => {
      if (this.closed) return;
      setTimeout(() => {
        if (this.closed) return;
        try {
          const out = execSync('wmctrl -l', {
            env: { ...process.env, DISPLAY: this.displayStr },
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 1200,
          })
            .toString('utf-8')
            .trim();
          if (out.length > 0) {
            this.hadWindow = true;
            return;
          }
        } catch {}

        if (!this.hadWindow || code !== 0) {
          for (const v of this.views.values()) {
            for (const sub of v.subscribers) {
              sub.onEvent({ type: 'app_exit', code: code ?? 0 });
            }
          }
          this.close();
        }
      }, 1500);
    });
  }

  public spawnExtraWindow(customCommand?: string): void {
    if (this.closed) return;
    const built = this.buildLaunchCommand(true);
    const cmd = customCommand || built.cmd;
    const cwd = built.cwd;

    const child = spawn('/bin/bash', ['-c', cmd], {
      cwd,
      detached: true,
      env: {
        ...this.baseEnv,
        HOME: this.baseEnv.HOME || os.homedir(),
        XDG_CONFIG_HOME: built.xdgConfigHome,
        XDG_DOWNLOAD_DIR: path.join(this.desktopDataRoot, 'vfs', 'Downloads'),
        DONT_PROMPT_WSL_INSTALL: '1',
      },
      stdio: 'ignore',
    });
    child.unref();
  }

  public openFiles(realPaths: string[]): void {
    if (this.closed || realPaths.length === 0) return;
    const { xdgConfigHome, desktopFilesDir, downloadsDir } = this.prepareDesktopXdgConfig();
    const quotedFiles = realPaths
      .map((p) => `'${p.replace(/'/g, "'\\''")}'`)
      .join(' ');
    const baseBin = path.basename(this.command.split(/\s+/)[0] || '');
    const profileDir = this.getProfileDir();
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

    let cmd = `${this.command} ${quotedFiles}`;
    if (baseBin === 'firefox' || baseBin === 'firefox-esr') {
      cmd = `${this.command} -profile "${profileDir}" ${quotedFiles}`;
    } else if (
      ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'brave-browser'].includes(baseBin)
    ) {
      cmd = `${this.command} ${isRoot ? '--no-sandbox' : ''} --test-type --user-data-dir="${profileDir}" ${quotedFiles}`;
    } else if (baseBin === 'gimp') {
      // GIMP automatically forwards file paths to the already-running instance on the same DISPLAY!
      cmd = `${this.command} ${quotedFiles}`;
    }

    const child = spawn('/bin/bash', ['-c', cmd], {
      cwd: desktopFilesDir,
      detached: true,
      env: {
        ...this.baseEnv,
        HOME: this.baseEnv.HOME || os.homedir(),
        XDG_CONFIG_HOME: xdgConfigHome,
        XDG_DOWNLOAD_DIR: downloadsDir,
        DONT_PROMPT_WSL_INSTALL: '1',
      },
      stdio: 'ignore',
    });
    child.unref();
  }

  private startViewStreamer(view: ViewStream): void {
    if (hasTurboJpegAndXDamage()) {
      this.startViewXDamageStreamer(view);
    } else {
      this.startViewFfmpegCapture(view);
    }
  }

  private startViewXDamageStreamer(view: ViewStream): void {
    view.streamerMode = 'xdamage';
    const scriptPath = resolveHelperPath('x11_streamer.py');
    const jpegQual = this.maxQuality;
    const initTargetWid = view.targetMode === 'pixmap' ? String(view.targetWid || 0) : '0';
    const proc = spawn(
      'python3',
      [
        '-u',
        scriptPath,
        this.displayStr,
        String(view.width),
        String(view.height),
        String(this.fps),
        String(jpegQual),
        String(view.offsetX),
        String(view.offsetY),
        initTargetWid,
      ],
      {
        env: this.baseEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    view.streamerProc = proc;
    proc.stdin?.on('error', () => {});
    if (proc.stdin?.writable) {
      try {
        proc.stdin.write(
          JSON.stringify({
            type: 'stream_config',
            fps: this.fps,
            max_quality: this.maxQuality,
            motion_quality: this.motionQuality,
            dynamic_drop: this.dynamicDrop,
            settle_ms: this.settleMs,
          }) + '\n'
        );
      } catch {}
    }
    proc.stderr?.on('data', (err: Buffer) => {
      const msg = err.toString('utf-8').trim();
      if (msg) console.error(`[x11_streamer ${this.displayStr}/${view.viewId}]`, msg);
    });

    let acc = Buffer.alloc(0);

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (this.closed || !this.views.has(view.viewId)) return;
      acc = Buffer.concat([acc, chunk]);

      while (acc.length >= 4) {
        const frameLen = acc.readUInt32BE(0);
        if (frameLen <= 0 || frameLen > 5 * 1024 * 1024) {
          acc = Buffer.alloc(0);
          break;
        }
        if (acc.length < 4 + frameLen) {
          break;
        }
        const frame = Buffer.from(acc.subarray(4, 4 + frameLen));
        acc = acc.subarray(4 + frameLen);

        if (!view.hasGeometry) {
          // Wait until the X11 app actually maps a window so clients never flash blank black frames
          if (proc.stdin?.writable) {
            try { proc.stdin.write('a\n'); } catch {}
          }
          continue;
        }

        // Only cache full keyframes (0x01) as lastFrame so newly joining clients never start with a partial delta tile
        if (frame[0] === 0x01) {
          view.lastFrame = frame;
        }

        if (view.subscribers.size === 0) {
          if (proc.stdin?.writable) {
            try { proc.stdin.write('a\n'); } catch {}
          }
          continue;
        }

        let ackSent = false;
        const sendAckOnce = () => {
          if (!ackSent) {
            ackSent = true;
            if (!this.closed && proc.stdin?.writable) {
              try { proc.stdin.write('a\n'); } catch {}
            }
          }
        };

        for (const sub of view.subscribers) {
          sub.onVideoFrame(frame, sendAckOnce);
        }
        setTimeout(sendAckOnce, 120).unref();
      }
    });

    proc.on('exit', (code) => {
      if (!this.closed && this.views.has(view.viewId) && code !== 0 && view.streamerProc === proc) {
        this.startViewFfmpegCapture(view);
      }
    });
  }

  private startViewFfmpegCapture(view: ViewStream): void {
    if (this.closed || !this.views.has(view.viewId)) return;
    view.streamerMode = 'ffmpeg';
    if (view.streamerProc) {
      try {
        view.streamerProc.kill('SIGTERM');
      } catch {}
      view.streamerProc = null;
    }

    const args = [
      '-loglevel', 'error',
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-f', 'x11grab',
      '-draw_mouse', '0',
      '-video_size', `${view.width}x${view.height}`,
      '-framerate', String(Math.min(30, this.fps)),
      '-i', `${this.displayStr}.0+${view.offsetX},${view.offsetY}`,
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-pix_fmt', 'yuvj420p',
      '-q:v', String(this.quality + 1),
      '-',
    ];

    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    view.streamerProc = ff;

    let acc = Buffer.alloc(0);
    const SOI = Buffer.from([0xff, 0xd8]);
    const EOI = Buffer.from([0xff, 0xd9]);

    ff.stdout?.on('data', (chunk: Buffer) => {
      if (this.closed || !this.views.has(view.viewId)) return;
      acc = Buffer.concat([acc, chunk]);
      if (acc.length > 4 * 1024 * 1024) {
        acc = acc.subarray(acc.length - 512 * 1024);
      }
      while (true) {
        const start = acc.indexOf(SOI);
        if (start === -1) {
          acc = Buffer.alloc(0);
          break;
        }
        const end = acc.indexOf(EOI, start + 2);
        if (end === -1) {
          if (start > 0) acc = acc.subarray(start);
          break;
        }
        const jpegSlice = acc.subarray(start, end + 2);
        const frame = Buffer.allocUnsafe(1 + jpegSlice.length);
        frame[0] = 0x01;
        jpegSlice.copy(frame, 1);
        acc = acc.subarray(end + 2);
        if (!view.hasGeometry) continue;
        if (view.lastFrame && view.lastFrame.length === frame.length && view.lastFrame.equals(frame)) {
          continue;
        }
        view.lastFrame = frame;
        for (const sub of view.subscribers) {
          sub.onVideoFrame(frame);
        }
      }
    });
  }

  private resizeViewCapture(view: ViewStream, evenW: number, evenH: number): void {
    if (view.streamerMode === 'xdamage' && view.streamerProc?.stdin?.writable) {
      try {
        view.streamerProc.stdin.write(
          JSON.stringify({ type: 'resize', width: evenW, height: evenH }) + '\n'
        );
      } catch {}
      return;
    }

    if (view.resizeTimer) clearTimeout(view.resizeTimer);
    view.resizeTimer = setTimeout(() => {
      if (!this.closed && this.views.has(view.viewId) && view.streamerMode === 'ffmpeg') {
        view.lastFrame = null;
        this.startViewFfmpegCapture(view);
      }
    }, 160);
  }

  private destroyView(view: ViewStream): void {
    this.views.delete(view.viewId);
    if (view.resizeTimer) clearTimeout(view.resizeTimer);
    if (view.streamerProc) {
      try {
        view.streamerProc.kill('SIGTERM');
      } catch {}
      view.streamerProc = null;
    }
    view.subscribers.clear();
  }

  public requestRefresh(viewId = 'main'): void {
    const view = this.views.get(viewId || 'main') || this.views.get('main');
    if (view && view.streamerMode === 'xdamage' && view.streamerProc?.stdin?.writable) {
      try {
        view.streamerProc.stdin.write(JSON.stringify({ type: 'refresh' }) + '\n');
      } catch {}
    }
  }

  public subscribeView(viewId: string, sub: LinuxAppSubscriber): () => void {
    const view = this.views.get(viewId || 'main') || this.views.get('main');
    if (!view) {
      sub.onEvent({ type: 'app_exit', code: 0 });
      return () => {};
    }
    view.subscribers.add(sub);
    sub.onEvent({ type: 'title', title: view.title });
    sub.onEvent({ type: 'cursor', cursor: this.cursor });
    if (view.hasGeometry) {
      sub.onEvent({
        type: 'view_geometry',
        width: view.width,
        height: view.height,
        initial: view.viewId === 'main',
      });
    }
    if (view.lastFrame && view.hasGeometry) {
      sub.onVideoFrame(view.lastFrame);
    }
    // Always request a fresh keyframe so newly attached viewers get exact current pixels before any delta tiles arrive
    this.requestRefresh(view.viewId);
    return () => {
      view.subscribers.delete(sub);
    };
  }

  public sendInput(msg: Record<string, unknown>, viewId = 'main'): void {
    if (this.closed || !this.x11BridgeProc?.stdin?.writable) return;
    try {
      this.x11BridgeProc.stdin.write(JSON.stringify({ ...msg, view: msg.view || viewId }) + '\n');
    } catch {}
  }

  public resizeView(viewId: string, width: number, height: number): void {
    if (this.closed) return;
    const view = this.views.get(viewId || 'main');
    if (!view) return;
    const dims = clampDim(width, height, this.screenWidth, this.screenHeight);
    if (Math.abs(dims.width - view.width) < 4 && Math.abs(dims.height - view.height) < 4) return;

    view.width = dims.width;
    view.height = dims.height;
    if (view.viewId === 'main') {
      this.width = dims.width;
      this.height = dims.height;
    }
    this.sendInput({ type: 'resize', width: dims.width, height: dims.height }, view.viewId);
    this.resizeViewCapture(view, dims.width, dims.height);
  }

  public focusView(viewId: string): void {
    this.sendInput({ type: 'focus_view' }, viewId || 'main');
  }

  public closeView(viewId: string): void {
    if (this.closed) return;
    if (!viewId || this.views.size <= 1) {
      this.close();
      return;
    }
    this.sendInput({ type: 'close_view' }, viewId);
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;

    for (const v of Array.from(this.views.values())) {
      this.destroyView(v);
    }

    const procs = [
      this.parecProc,
      this.x11BridgeProc,
      this.appProc,
      this.openboxProc,
      this.xvfbProc,
    ];
    for (const p of procs) {
      if (p) {
        try {
          p.kill('SIGTERM');
        } catch {}
      }
    }
    setTimeout(() => {
      for (const p of procs) {
        if (p && p.exitCode === null) {
          try {
            p.kill('SIGKILL');
          } catch {}
        }
      }
      try {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      } catch {}
    }, 1200);

    if (this.pulseSinkName) {
      try {
        execSync(
          `pactl list short modules | grep "${this.pulseSinkName}" | awk '{print $1}' | xargs -r -n1 pactl unload-module`,
          { stdio: 'ignore', timeout: 1500 }
        );
      } catch {}
    }

    this.onCloseCb();
  }
}

export class LinuxDisplayBridge {
  private sessions = new Map<string, LinuxAppSession>();
  private usedDisplays = new Set<number>();

  public findActiveProfileSession(desktopId: string, appId: string, command: string): LinuxAppSession | undefined {
    const baseBin = path.basename(command.split(/\s+/)[0] || '');
    const isLocked = PROFILE_LOCKED_APPS.has(appId) || PROFILE_LOCKED_APPS.has(baseBin);
    if (!isLocked) return undefined;

    for (const s of this.sessions.values()) {
      if (s.desktopId === desktopId && (s.appId === appId || path.basename(s.appId) === baseBin)) {
        return s;
      }
    }
    return undefined;
  }

  public async launchApp(
    opts: LinuxAppSessionOptions
  ): Promise<{ session: LinuxAppSession; openedAsExtraWindow: boolean }> {
    const existingById = this.sessions.get(opts.sessionId);
    if (existingById) return { session: existingById, openedAsExtraWindow: false };

    // Avoid profile-lock crash (Firefox/Chrome): spawn extra window inside the existing X11 session!
    const existingProfileSession = this.findActiveProfileSession(
      opts.desktopId,
      opts.appId,
      opts.command
    );
    if (existingProfileSession) {
      existingProfileSession.spawnExtraWindow();
      return { session: existingProfileSession, openedAsExtraWindow: true };
    }

    const displayNum = findFreeDisplay(this.usedDisplays);
    this.usedDisplays.add(displayNum);

    const session = new LinuxAppSession(opts, displayNum, () => {
      this.sessions.delete(opts.sessionId);
      this.usedDisplays.delete(displayNum);
    });
    this.sessions.set(opts.sessionId, session);
    await session.start();
    return { session, openedAsExtraWindow: false };
  }

  public getSession(sessionId: string): LinuxAppSession | undefined {
    return this.sessions.get(sessionId);
  }

  public listSessions(desktopId?: string): Array<{
    sessionId: string;
    desktopId: string;
    appId: string;
    appName: string;
    title: string;
    width: number;
    height: number;
  }> {
    return Array.from(this.sessions.values())
      .filter((s) => !desktopId || s.desktopId === desktopId)
      .map((s) => ({
        sessionId: s.sessionId,
        desktopId: s.desktopId,
        appId: s.appId,
        appName: s.appName,
        title: s.title,
        width: s.width,
        height: s.height,
      }));
  }

  public openFiles(sessionId: string, realPaths: string[]): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.openFiles(realPaths);
    return true;
  }

  public closeSession(sessionId: string, viewId?: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (viewId) {
      s.closeView(viewId);
    } else {
      s.close();
    }
  }

  public updateStreamConfig(desktopId: string, cfg: X11StreamConfig): void {
    for (const s of this.sessions.values()) {
      if (s.desktopId === desktopId) {
        s.updateStreamConfig(cfg);
      }
    }
  }

  public destroyDesktopSessions(desktopId: string): void {
    for (const s of Array.from(this.sessions.values())) {
      if (s.desktopId === desktopId) s.close();
    }
  }

  public destroyAll(): void {
    for (const s of Array.from(this.sessions.values())) {
      s.close();
    }
  }
}
