import fs from 'node:fs';
import { execSync, spawn, type ChildProcess } from 'node:child_process';

export interface MediaDeviceEntry {
  id: string;
  name: string;
  state: string;
}

export interface MediaHardwareStatus {
  pulseRunning: boolean;
  sinks: MediaDeviceEntry[];
  sources: MediaDeviceEntry[];
  virtualMicName: string;
  virtualMicReady: boolean;
  virtualMicActiveClients: number;
  videoDevices: string[];
  v4l2LoopbackReady: boolean;
  cameraNote: string;
}

export class LinuxMediaBridge {
  private micFds = new Map<string, number>();
  private micClientCounts = new Map<string, number>();
  private cameraProc: ChildProcess | null = null;
  private cameraTargetDev: string | null = null;
  private lastCameraErr = '';

  private activePulseEnv: NodeJS.ProcessEnv | null = null;

  public isLinux(): boolean {
    return process.platform === 'linux';
  }

  public getPulseEnv(): NodeJS.ProcessEnv {
    return this.activePulseEnv ? { ...process.env, ...this.activePulseEnv } : { ...process.env };
  }

  public ensurePulseRunning(): boolean {
    if (!this.isLinux()) return false;
    try {
      execSync('pactl info', { env: this.getPulseEnv(), stdio: 'ignore', timeout: 1200 });
      return true;
    } catch {
      const pulseDir = '/tmp/tamga-pulse';
      const pulseSock = `${pulseDir}/native`;
      const clientEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PULSE_RUNTIME_PATH: pulseDir,
        PULSE_STATE_PATH: pulseDir,
        PULSE_SERVER: `unix:${pulseSock}`,
      };
      // IMPORTANT: Never pass PULSE_SERVER or --no-cpu-limit into the pulseaudio daemon's own env!
      const daemonEnv: NodeJS.ProcessEnv = { ...process.env };
      delete daemonEnv.PULSE_SERVER;
      daemonEnv.PULSE_RUNTIME_PATH = pulseDir;
      daemonEnv.PULSE_STATE_PATH = pulseDir;

      try {
        fs.mkdirSync(pulseDir, { recursive: true, mode: 0o777 });
      } catch {}

      try {
        execSync('pactl info', { env: clientEnv, stdio: 'ignore', timeout: 1200 });
        this.activePulseEnv = {
          PULSE_RUNTIME_PATH: pulseDir,
          PULSE_STATE_PATH: pulseDir,
          PULSE_SERVER: `unix:${pulseSock}`,
        };
        return true;
      } catch {}

      try {
        execSync(
          `pulseaudio -n --fail=false --daemonize=yes --exit-idle-time=-1 --disallow-module-loading=0 -L "module-native-protocol-unix socket=${pulseSock} auth-anonymous=1" -L "module-null-sink sink_name=tamga_default"`,
          { env: daemonEnv, stdio: 'ignore', timeout: 4000 }
        );
      } catch {}

      for (let i = 0; i < 6; i++) {
        try {
          execSync('pactl info', { env: clientEnv, stdio: 'ignore', timeout: 1200 });
          this.activePulseEnv = {
            PULSE_RUNTIME_PATH: pulseDir,
            PULSE_STATE_PATH: pulseDir,
            PULSE_SERVER: `unix:${pulseSock}`,
          };
          return true;
        } catch {
          try {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
          } catch {}
        }
      }
      return false;
    }
  }

  private listPactlShort(kind: 'sinks' | 'sources'): MediaDeviceEntry[] {
    if (!this.ensurePulseRunning()) return [];
    try {
      const out = execSync(`pactl list short ${kind}`, {
        env: this.getPulseEnv(),
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1500,
      }).toString('utf8');
      return out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const cols = line.split(/\t+|\s{2,}/);
          return {
            id: cols[0] || '',
            name: cols[1] || line,
            state: cols[4] || cols[cols.length - 1] || 'READY',
          };
        });
    } catch {
      return [];
    }
  }

  public getVirtualMicName(desktopId: string): string {
    const clean = (desktopId || 'main').replace(/[^a-z0-9_]/gi, '_').slice(-16);
    return `tamga_mic_${clean}`;
  }

  public ensureVirtualMic(desktopId: string): { ready: boolean; sourceName: string } {
    const sourceName = this.getVirtualMicName(desktopId);
    if (!this.ensurePulseRunning()) {
      return { ready: false, sourceName };
    }
    const fifoPath = `/tmp/${sourceName}.pcm`;
    try {
      const sources = this.listPactlShort('sources');
      const existsInPulse = sources.some((s) => s.name === sourceName);
      if (!existsInPulse) {
        const oldFd = this.micFds.get(desktopId);
        if (oldFd !== undefined) {
          try { fs.closeSync(oldFd); } catch {}
          this.micFds.delete(desktopId);
        }
        try { fs.unlinkSync(fifoPath); } catch {}
        execSync(
          `pactl load-module module-pipe-source source_name=${sourceName} file=${fifoPath} rate=24000 channels=1 format=s16le source_properties=device.description=Tamga_Virtual_Microphone`,
          { env: this.getPulseEnv(), stdio: 'ignore', timeout: 2200 }
        );
      }
      if (!this.micFds.has(desktopId) && fs.existsSync(fifoPath)) {
        const fd = fs.openSync(fifoPath, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
        this.micFds.set(desktopId, fd);
      }
      return { ready: true, sourceName };
    } catch {
      return { ready: false, sourceName };
    }
  }

  public setMicClientActive(desktopId: string, active: boolean): void {
    const cur = this.micClientCounts.get(desktopId) || 0;
    const next = Math.max(0, cur + (active ? 1 : -1));
    this.micClientCounts.set(desktopId, next);
  }

  public pushMicPcm16(desktopId: string, pcmBuf: Buffer, gainPercent = 100): void {
    if (!this.isLinux() || !pcmBuf || pcmBuf.length < 2) return;
    const { ready } = this.ensureVirtualMic(desktopId);
    if (!ready) return;
    const fd = this.micFds.get(desktopId);
    if (fd === undefined) return;

    const gain = Math.max(0, Math.min(2.0, (Number(gainPercent) || 100) / 100));
    let outBuf = pcmBuf;
    if (Math.abs(gain - 1) > 0.02) {
      outBuf = Buffer.allocUnsafe(pcmBuf.length);
      for (let i = 0; i + 1 < pcmBuf.length; i += 2) {
        const s = Math.round(pcmBuf.readInt16LE(i) * gain);
        outBuf.writeInt16LE(Math.max(-32768, Math.min(32767, s)), i);
      }
    }
    try {
      fs.writeSync(fd, outBuf, 0, outBuf.length, null);
    } catch {
      // Drop if pipe buffer momentarily full (EAGAIN under non-blocking)
    }
  }

  public listVideoDevices(): string[] {
    if (!this.isLinux()) return [];
    try {
      return fs
        .readdirSync('/dev')
        .filter((f) => /^video\d+$/.test(f))
        .map((f) => `/dev/${f}`)
        .sort();
    } catch {
      return [];
    }
  }

  public setupVirtualCamera(installDriver = false): {
    ready: boolean;
    videoDevices: string[];
    note: string;
  } {
    if (!this.isLinux()) {
      return {
        ready: false,
        videoDevices: [],
        note: 'Sanal kamera aygıtı yalnızca Linux sunucularda kullanılabilir.',
      };
    }

    let devs = this.listVideoDevices();
    if (devs.length > 0) {
      this.cameraTargetDev = devs[0];
      return { ready: true, videoDevices: devs, note: `Sanal kamera hazır (${devs[0]})` };
    }

    const tryModprobe = () => {
      try {
        try {
          execSync('modprobe videodev', { stdio: 'ignore', timeout: 2000 });
        } catch {}
        execSync(
          'modprobe v4l2loopback devices=1 video_nr=0 card_label="Tamga_Virtual_Camera" exclusive_caps=1',
          { stdio: 'pipe', timeout: 3000 }
        );
        return true;
      } catch (e) {
        this.lastCameraErr = (e as Error).message;
        return false;
      }
    };

    tryModprobe();
    devs = this.listVideoDevices();
    if (devs.length > 0) {
      this.cameraTargetDev = devs[0];
      return { ready: true, videoDevices: devs, note: `v4l2loopback yüklendi (${devs[0]})` };
    }

    if (installDriver) {
      try {
        const kver = execSync('uname -r', { stdio: ['ignore', 'pipe', 'ignore'] })
          .toString('utf8')
          .trim();
        execSync(
          `DEBIAN_FRONTEND=noninteractive apt-get update -y && apt-get install -y linux-modules-extra-${kver} v4l2loopback-dkms`,
          { stdio: 'pipe', timeout: 120_000 }
        );
        tryModprobe();
        devs = this.listVideoDevices();
        if (devs.length > 0) {
          this.cameraTargetDev = devs[0];
          return {
            ready: true,
            videoDevices: devs,
            note: `Sanal kamera sürücüsü kuruldu ve etkin (${devs[0]})`,
          };
        }
      } catch (e) {
        this.lastCameraErr = (e as Error).message;
      }
    }

    return {
      ready: false,
      videoDevices: [],
      note: this.lastCameraErr.includes('videodev') || !installDriver
        ? 'Çekirdek videodev/v4l2loopback sürücüsü henüz yüklü değil ("Sürücüyü Kur" ile etkinleştirilebilir).'
        : 'Bu sunucu çekirdeğinde v4l2loopback modülü yüklenemedi.',
    };
  }

  public pushCameraFrame(jpegBuf: Buffer, width = 1280, height = 720): void {
    if (!this.isLinux() || !jpegBuf || jpegBuf.length < 32) return;
    if (!this.cameraTargetDev) {
      const devs = this.listVideoDevices();
      if (devs.length === 0) return;
      this.cameraTargetDev = devs[0];
    }

    if (!this.cameraProc || this.cameraProc.killed || this.cameraProc.exitCode !== null) {
      try {
        this.cameraProc = spawn(
          'ffmpeg',
          [
            '-loglevel',
            'error',
            '-f',
            'image2pipe',
            '-vcodec',
            'mjpeg',
            '-r',
            '15',
            '-i',
            'pipe:0',
            '-vf',
            `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
            '-pix_fmt',
            'yuv420p',
            '-f',
            'v4l2',
            this.cameraTargetDev,
          ],
          { stdio: ['pipe', 'ignore', 'ignore'] }
        );
        this.cameraProc.on('exit', () => {
          this.cameraProc = null;
        });
      } catch {
        this.cameraProc = null;
        return;
      }
    }

    try {
      if (this.cameraProc.stdin && !this.cameraProc.stdin.destroyed && this.cameraProc.stdin.writable) {
        this.cameraProc.stdin.write(jpegBuf);
      }
    } catch {}
  }

  public stopCameraFeed(): void {
    if (this.cameraProc) {
      try {
        this.cameraProc.kill('SIGTERM');
      } catch {}
      this.cameraProc = null;
    }
  }

  public getStatus(desktopId: string): MediaHardwareStatus {
    const pulseRunning = this.ensurePulseRunning();
    const sinks = this.listPactlShort('sinks');
    const sources = this.listPactlShort('sources');
    const virtualMicName = this.getVirtualMicName(desktopId);
    const virtualMicReady = sources.some((s) => s.name === virtualMicName);
    const videoDevices = this.listVideoDevices();
    return {
      pulseRunning,
      sinks,
      sources,
      virtualMicName,
      virtualMicReady,
      virtualMicActiveClients: this.micClientCounts.get(desktopId) || 0,
      videoDevices,
      v4l2LoopbackReady: videoDevices.length > 0,
      cameraNote:
        videoDevices.length > 0
          ? `Linux sanal kamera etkin (${videoDevices[0]})`
          : 'v4l2loopback /dev/video0 pasif (İstemci önizleme aktif)',
    };
  }
}

export const mediaBridge = new LinuxMediaBridge();
