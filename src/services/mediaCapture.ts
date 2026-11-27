export interface EnumeratedMediaDevices {
  speakers: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  secureContext: boolean;
  permissionError?: string;
}

class MediaCaptureService {
  private micStream: MediaStream | null = null;
  private micCtx: AudioContext | null = null;
  private micProc: ScriptProcessorNode | null = null;
  private micGain = 100;
  private camStream: MediaStream | null = null;
  private camVideo: HTMLVideoElement | null = null;
  private camCanvas: HTMLCanvasElement | null = null;
  private camTimer: ReturnType<typeof setInterval> | null = null;
  private micLevelListeners = new Set<(level: number) => void>();
  private camStreamListeners = new Set<(stream: MediaStream | null) => void>();

  public isSecureMediaAvailable(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices) &&
      typeof navigator.mediaDevices.enumerateDevices === 'function' &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    );
  }

  public async enumerate(requestPermission = false): Promise<EnumeratedMediaDevices> {
    const secureContext = typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false;
    if (!this.isSecureMediaAvailable()) {
      return {
        speakers: [],
        microphones: [],
        cameras: [],
        secureContext,
        permissionError: !secureContext
          ? 'Tarayıcı güvenli bağlam (HTTPS / localhost) dışında canlı mikrofon/kamera donanımını engeller.'
          : 'Bu tarayıcı mediaDevices API desteklemiyor.',
      };
    }

    let permissionError: string | undefined;
    if (requestPermission) {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        tmp.getTracks().forEach((t) => t.stop());
      } catch (e) {
        try {
          const tmpA = await navigator.mediaDevices.getUserMedia({ audio: true });
          tmpA.getTracks().forEach((t) => t.stop());
        } catch (errA) {
          permissionError = (errA as Error).message || (e as Error).message;
        }
      }
    }

    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      return {
        speakers: list.filter((d) => d.kind === 'audiooutput'),
        microphones: list.filter((d) => d.kind === 'audioinput'),
        cameras: list.filter((d) => d.kind === 'videoinput'),
        secureContext,
        permissionError,
      };
    } catch (e) {
      return {
        speakers: [],
        microphones: [],
        cameras: [],
        secureContext,
        permissionError: (e as Error).message,
      };
    }
  }

  public subscribeMicLevel(cb: (level: number) => void): () => void {
    this.micLevelListeners.add(cb);
    return () => this.micLevelListeners.delete(cb);
  }

  public subscribeCameraStream(cb: (stream: MediaStream | null) => void): () => void {
    this.camStreamListeners.add(cb);
    cb(this.camStream);
    return () => this.camStreamListeners.delete(cb);
  }

  public setMicGain(gain: number): void {
    this.micGain = Math.max(0, Math.min(200, Number(gain) || 100));
  }

  public async startMic(
    deviceId: string,
    gain: number,
    sendWs: (msg: Record<string, unknown>) => void
  ): Promise<boolean> {
    this.stopMic(sendWs);
    this.micGain = gain;
    if (!this.isSecureMediaAvailable()) return false;
    try {
      const constraints: MediaStreamConstraints = {
        audio:
          deviceId && deviceId !== 'default'
            ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true }
            : { echoCancellation: true, noiseSuppression: true },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.micStream = stream;
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC({ sampleRate: 24000 });
      this.micCtx = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(1024, 1, 1);
      this.micProc = proc;

      proc.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        let peak = 0;
        const int16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const v = Math.max(-1, Math.min(1, input[i]));
          const abs = Math.abs(v);
          if (abs > peak) peak = abs;
          int16[i] = Math.round(v * 32767);
        }
        const scaledLevel = Math.min(100, Math.round(peak * 140));
        this.micLevelListeners.forEach((cb) => cb(scaledLevel));

        const bytes = new Uint8Array(int16.buffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        sendWs({
          type: 'mic_audio',
          data: btoa(bin),
          gain: this.micGain,
        });
      };

      const zeroGain = ctx.createGain();
      zeroGain.gain.value = 0;
      src.connect(proc);
      proc.connect(zeroGain);
      zeroGain.connect(ctx.destination);
      sendWs({ type: 'mic_state', active: true });
      return true;
    } catch {
      this.stopMic(sendWs);
      return false;
    }
  }

  public stopMic(sendWs?: (msg: Record<string, unknown>) => void): void {
    if (this.micProc) {
      try {
        this.micProc.disconnect();
      } catch {}
      this.micProc = null;
    }
    if (this.micCtx) {
      try {
        this.micCtx.close();
      } catch {}
      this.micCtx = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    this.micLevelListeners.forEach((cb) => cb(0));
    sendWs?.({ type: 'mic_state', active: false });
  }

  public async startCamera(
    deviceId: string,
    resolution: '480p' | '720p',
    mirror: boolean,
    sendWs: (msg: Record<string, unknown>) => void
  ): Promise<boolean> {
    this.stopCamera(sendWs);
    if (!this.isSecureMediaAvailable()) return false;
    const width = resolution === '720p' ? 1280 : 640;
    const height = resolution === '720p' ? 720 : 480;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video:
          deviceId && deviceId !== 'default'
            ? { deviceId: { exact: deviceId }, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 15 } }
            : { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 15 } },
      });
      this.camStream = stream;
      this.camStreamListeners.forEach((cb) => cb(stream));

      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play().catch(() => {});
      this.camVideo = video;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      this.camCanvas = canvas;
      const ctx = canvas.getContext('2d');

      this.camTimer = setInterval(() => {
        if (!ctx || !this.camVideo || this.camVideo.readyState < 2) return;
        ctx.save();
        if (mirror) {
          ctx.translate(width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(this.camVideo, 0, 0, width, height);
        ctx.restore();
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
        const comma = dataUrl.indexOf(',');
        if (comma !== -1) {
          sendWs({
            type: 'camera_frame',
            data: dataUrl.slice(comma + 1),
            width,
            height,
          });
        }
      }, 90);
      return true;
    } catch {
      this.stopCamera(sendWs);
      return false;
    }
  }

  public stopCamera(sendWs?: (msg: Record<string, unknown>) => void): void {
    if (this.camTimer) {
      clearInterval(this.camTimer);
      this.camTimer = null;
    }
    if (this.camStream) {
      this.camStream.getTracks().forEach((t) => t.stop());
      this.camStream = null;
    }
    this.camVideo = null;
    this.camCanvas = null;
    this.camStreamListeners.forEach((cb) => cb(null));
    sendWs?.({ type: 'camera_stop' });
  }
}

export const mediaCapture = new MediaCaptureService();
