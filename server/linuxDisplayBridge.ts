import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { resolveHelperPath } from './terminalManager';

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
  fps?: number;
  quality?: number;
  enableAudio?: boolean;
}

export interface LinuxAppSubscriber {
  onVideoFrame: (jpegBytes: Buffer) => void;
  onAudioChunk: (pcm16Bytes: Buffer) => void;
  onEvent: (event: { type: string; [key: string]: unknown }) => void;
}

function findFreeDisplay(inUse: Set<number>): number {
  for (let d = 100; d < 250; d++) {
    if (inUse.has(d)) continue;
    if (!fs.existsSync(`/tmp/.X11-unix/X${d}`) && !fs.existsSync(`/tmp/.X${d}-lock`)) {
      return d;
    }
  }
  return 100 + Math.floor(Math.random() * 100);
}

function buildOpenboxRcXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <resistance><strength>0</strength><screen_edge_strength>0</screen_edge_strength></resistance>
  <focus><focusNew>yes</focusNew><followMouse>no</followMouse></focus>
  <placement><policy>Smart</policy><center>yes</center></placement>
  <theme><name>Clearlooks</name><titleLayout>NLIMC</titleLayout><keepBorder>no</keepBorder></theme>
  <desktops><number>1</number></desktops>
  <applications>
    <application class="*">
      <decor>no</decor>
      <maximized>no</maximized>
    </application>
  </applications>
</openbox_config>
`;
}

export class LinuxAppSession {
  public readonly sessionId: string;
  public readonly desktopId: string;
  public readonly appId: string;
  public readonly appName: string;
  public readonly displayNum: number;
  public readonly displayStr: string;
  public title: string;
  public width: number;
  public height: number;
  public startedAt = Date.now();

  private fps: number;
  private quality: number;
  private enableAudio: boolean;
  private desktopDataRoot: string;
  private command: string;
  private needsNoSandbox: boolean;
  private tempDir: string;

  private xvfbProc: ChildProcess | null = null;
  private openboxProc: ChildProcess | null = null;
  private appProc: ChildProcess | null = null;
  private x11BridgeProc: ChildProcess | null = null;
  private ffmpegProc: ChildProcess | null = null;
  private parecProc: ChildProcess | null = null;
  private pulseSinkName = '';

  private subscribers = new Set<LinuxAppSubscriber>();
  private lastFrame: Buffer | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.width = Math.max(420, Math.min(1920, Math.round(opts.width || 1100)));
    this.height = Math.max(300, Math.min(1080, Math.round(opts.height || 680)));
    // Keep even dimensions for ffmpeg x11grab
    this.width = this.width - (this.width % 2);
    this.height = this.height - (this.height % 2);
    this.fps = Math.max(8, Math.min(30, opts.fps || 20));
    this.quality = Math.max(2, Math.min(10, opts.quality || 4));
    this.enableAudio = opts.enableAudio ?? true;
    this.tempDir = path.join(os.tmpdir(), `tamga-gui-${this.sessionId.replace(/[^a-z0-9_-]/gi, '')}`);
    this.onCloseCb = onCloseCb;
  }

  public async start(): Promise<void> {
    fs.mkdirSync(this.tempDir, { recursive: true });
    const obRcPath = path.join(this.tempDir, 'rc.xml');
    fs.writeFileSync(obRcPath, buildOpenboxRcXml(), 'utf-8');

    // 1. Start lightweight Xvfb display
    this.xvfbProc = spawn(
      'Xvfb',
      [this.displayStr, '-screen', '0', '1920x1080x24', '-ac', '+extension', 'RANDR', '+render', '-noreset'],
      { stdio: 'ignore' }
    );

    // Wait for X11 socket
    const xSocket = `/tmp/.X11-unix/X${this.displayNum}`;
    for (let i = 0; i < 40; i++) {
      if (fs.existsSync(xSocket)) break;
      await new Promise((r) => setTimeout(r, 80));
    }

    const baseEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DISPLAY: this.displayStr,
      XDG_RUNTIME_DIR: this.tempDir,
      GDK_SCALE: '1',
      QT_AUTO_SCREEN_SCALE_FACTOR: '0',
      MOZ_ENABLE_WAYLAND: '0',
      GTK_CSD: '0',
    };

    // 2. Start borderless Openbox window manager (~4MB RAM)
    this.openboxProc = spawn('openbox', ['--config-file', obRcPath], {
      env: baseEnv,
      stdio: 'ignore',
    });

    // 3. Optional PulseAudio virtual sink for real native Linux app audio -> 24kHz PCM WS
    if (this.enableAudio) {
      this.setupPulseAudio(baseEnv);
    }

    // 4. Start persistent X11/XTest bridge (mouse, keyboard, Turkish UTF-8, clipboard, resize, title)
    this.startX11Bridge(baseEnv);

    // 5. Launch real Linux GUI app with per-desktop isolated profile directory
    this.launchTargetApp(baseEnv);

    // 6. Start ultra-fast MJPEG x11grab stream
    setTimeout(() => {
      if (!this.closed) this.startFfmpegCapture();
    }, 350);
  }

  private setupPulseAudio(baseEnv: NodeJS.ProcessEnv): void {
    try {
      // Ensure PulseAudio daemon is running (works even as root with --disallow-exit)
      try {
        execSync('pactl info', { stdio: 'ignore', timeout: 1500 });
      } catch {
        spawn('pulseaudio', ['--daemonize=yes', '--exit-idle-time=-1', '--disallow-module-loading=0', '--no-cpu-limit'], {
          stdio: 'ignore',
        });
      }
      const sinkName = `tamga_${this.sessionId.replace(/[^a-z0-9]/gi, '').slice(-10)}`;
      try {
        execSync(
          `pactl load-module module-null-sink sink_name=${sinkName} sink_properties=device.description=${sinkName}`,
          { stdio: 'ignore', timeout: 2000 }
        );
        this.pulseSinkName = sinkName;
        baseEnv.PULSE_SINK = sinkName;
        this.startAudioCapture(sinkName);
      } catch {
        // Audio optional; proceed silently if PulseAudio unavailable
      }
    } catch {
      // ignore
    }
  }

  private startAudioCapture(sinkName: string): void {
    try {
      const parec = spawn(
        'parec',
        ['-d', `${sinkName}.monitor`, '--rate=24000', '--channels=1', '--format=s16le', '--latency-msec=45'],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      );
      this.parecProc = parec;

      const CHUNK_BYTES = 2048; // ~42ms of 24kHz 16-bit mono PCM
      let pcmBuf = Buffer.alloc(0);

      parec.stdout?.on('data', (chunk: Buffer) => {
        if (this.closed || this.subscribers.size === 0) return;
        pcmBuf = Buffer.concat([pcmBuf, chunk]);
        while (pcmBuf.length >= CHUNK_BYTES) {
          const slice = pcmBuf.subarray(0, CHUNK_BYTES);
          pcmBuf = pcmBuf.subarray(CHUNK_BYTES);

          // Silence gate: avoid wasting bandwidth when silent
          let peak = 0;
          for (let i = 0; i < slice.length; i += 2) {
            const v = Math.abs(slice.readInt16LE(i));
            if (v > peak) peak = v;
            if (peak > 45) break;
          }
          if (peak > 45) {
            for (const sub of this.subscribers) {
              sub.onAudioChunk(slice);
            }
          }
        }
      });
    } catch {
      // ignore audio capture failure
    }
  }

  private startX11Bridge(baseEnv: NodeJS.ProcessEnv): void {
    const scriptPath = resolveHelperPath('x11_bridge.py');
    const proc = spawn('python3', ['-u', scriptPath, this.displayStr, String(this.width), String(this.height)], {
      env: baseEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.x11BridgeProc = proc;

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
            if (msg.type === 'title' && typeof msg.title === 'string') {
              this.title = msg.title;
            }
            for (const sub of this.subscribers) {
              sub.onEvent(msg);
            }
          } catch {}
        }
        idx = lineBuf.indexOf('\n');
      }
    });
  }

  private launchTargetApp(baseEnv: NodeJS.ProcessEnv): void {
    const profileDir = path.join(this.desktopDataRoot, 'app-profiles', this.appId.replace(/[^a-z0-9_-]/gi, '_'));
    fs.mkdirSync(profileDir, { recursive: true });
    const desktopFilesDir = path.join(this.desktopDataRoot, 'vfs', 'Desktop');
    fs.mkdirSync(desktopFilesDir, { recursive: true });

    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    let finalCmd = this.command;
    const baseBin = path.basename(finalCmd.split(/\s+/)[0] || '');

    if (baseBin === 'firefox' || baseBin === 'firefox-esr') {
      // Pre-seed lightweight user.js for crisp software WebRender and clean startup without first-run dim overlays
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
          'user_pref("browser.startup.homepage", "https://www.google.com");',
          'user_pref("browser.tabs.inTitlebar", 0);',
          'user_pref("gfx.webrender.software", true);',
          'user_pref("gfx.x11-egl.force-disabled", true);',
          'user_pref("browser.download.dir", ' + JSON.stringify(path.join(this.desktopDataRoot, 'vfs', 'Downloads')) + ');',
          'user_pref("browser.download.folderList", 2);',
        ].join('\n') + '\n',
        'utf-8'
      );
      finalCmd = `${finalCmd} --no-remote -profile "${profileDir}" --width=${this.width} --height=${this.height}`;
    } else if (
      this.needsNoSandbox ||
      ['code', 'antigravity', 'chromium', 'chromium-browser', 'google-chrome'].includes(baseBin)
    ) {
      const extraFlags: string[] = [];
      if (isRoot && !finalCmd.includes('--no-sandbox')) {
        extraFlags.push('--no-sandbox');
      }
      if (!finalCmd.includes('--user-data-dir')) {
        extraFlags.push(`--user-data-dir="${profileDir}"`);
      }
      if (!finalCmd.includes('--disable-gpu')) {
        extraFlags.push('--disable-gpu-sandbox', '--disable-dev-shm-usage');
      }
      finalCmd = `${finalCmd} ${extraFlags.join(' ')}`;
    }

    // Wrap with dbus-run-session if available so Electron / Firefox / GTK apps work cleanly headless
    const wrapped = `exec ${finalCmd}`;
    this.appProc = spawn('/bin/bash', ['-c', wrapped], {
      cwd: desktopFilesDir,
      env: {
        ...baseEnv,
        HOME: baseEnv.HOME || os.homedir(),
        XDG_DOWNLOAD_DIR: path.join(this.desktopDataRoot, 'vfs', 'Downloads'),
      },
      stdio: 'ignore',
    });

    this.appProc.on('exit', (code) => {
      if (!this.closed) {
        for (const sub of this.subscribers) {
          sub.onEvent({ type: 'app_exit', code: code ?? 0 });
        }
        this.close();
      }
    });
  }

  private startFfmpegCapture(): void {
    if (this.closed) return;
    if (this.ffmpegProc) {
      try {
        this.ffmpegProc.kill('SIGTERM');
      } catch {}
      this.ffmpegProc = null;
    }

    const args = [
      '-loglevel', 'error',
      '-f', 'x11grab',
      '-draw_mouse', '1',
      '-video_size', `${this.width}x${this.height}`,
      '-framerate', String(this.fps),
      '-i', `${this.displayStr}.0+0,0`,
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-pix_fmt', 'yuvj420p',
      '-q:v', String(this.quality),
      '-',
    ];

    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.ffmpegProc = ff;

    let acc = Buffer.alloc(0);
    const SOI = Buffer.from([0xff, 0xd8]);
    const EOI = Buffer.from([0xff, 0xd9]);

    ff.stdout?.on('data', (chunk: Buffer) => {
      if (this.closed) return;
      acc = Buffer.concat([acc, chunk]);

      // Prevent unbounded growth
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
        const frame = Buffer.from(acc.subarray(start, end + 2));
        acc = acc.subarray(end + 2);

        // Idle frame deduplication: skip broadcasting byte-identical static frames
        if (this.lastFrame && this.lastFrame.length === frame.length && this.lastFrame.equals(frame)) {
          continue;
        }
        this.lastFrame = frame;
        for (const sub of this.subscribers) {
          sub.onVideoFrame(frame);
        }
      }
    });
  }

  public subscribe(sub: LinuxAppSubscriber): () => void {
    this.subscribers.add(sub);
    sub.onEvent({ type: 'title', title: this.title });
    if (this.lastFrame) {
      sub.onVideoFrame(this.lastFrame);
    }
    return () => {
      this.subscribers.delete(sub);
    };
  }

  public sendInput(msg: Record<string, unknown>): void {
    if (this.closed || !this.x11BridgeProc?.stdin?.writable) return;
    this.x11BridgeProc.stdin.write(JSON.stringify(msg) + '\n');
  }

  public resize(width: number, height: number): void {
    if (this.closed) return;
    const w = Math.max(420, Math.min(1920, Math.round(width)));
    const h = Math.max(300, Math.min(1080, Math.round(height)));
    const evenW = w - (w % 2);
    const evenH = h - (h % 2);
    if (Math.abs(evenW - this.width) < 4 && Math.abs(evenH - this.height) < 4) return;

    this.width = evenW;
    this.height = evenH;
    this.sendInput({ type: 'resize', width: evenW, height: evenH });

    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      if (!this.closed) {
        this.lastFrame = null;
        this.startFfmpegCapture();
      }
    }, 150);
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.resizeTimer) clearTimeout(this.resizeTimer);

    const procs = [this.ffmpegProc, this.parecProc, this.x11BridgeProc, this.appProc, this.openboxProc, this.xvfbProc];
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
    }, 600);

    if (this.pulseSinkName) {
      try {
        execSync(`pactl list short modules | grep "${this.pulseSinkName}" | awk '{print $1}' | xargs -r -n1 pactl unload-module`, {
          stdio: 'ignore',
          timeout: 1500,
        });
      } catch {}
    }

    this.subscribers.clear();
    this.onCloseCb();
  }
}

export class LinuxDisplayBridge {
  private sessions = new Map<string, LinuxAppSession>();
  private usedDisplays = new Set<number>();

  public async launchApp(opts: LinuxAppSessionOptions): Promise<LinuxAppSession> {
    const existing = this.sessions.get(opts.sessionId);
    if (existing) return existing;

    const displayNum = findFreeDisplay(this.usedDisplays);
    this.usedDisplays.add(displayNum);

    const session = new LinuxAppSession(opts, displayNum, () => {
      this.sessions.delete(opts.sessionId);
      this.usedDisplays.delete(displayNum);
    });
    this.sessions.set(opts.sessionId, session);
    await session.start();
    return session;
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

  public closeSession(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) s.close();
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
