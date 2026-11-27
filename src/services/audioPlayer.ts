const AUDIO_SAMPLE_RATE = 24000;

class RemoteAudioPlayer {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private nextStartTime = 0;
  private volume = 0.8;
  private muted = false;
  private unlocked = false;
  private sinkId = 'default';

  constructor() {
    if (typeof window !== 'undefined') {
      const unlock = () => this.ensureContext();
      window.addEventListener('pointerdown', unlock, { passive: true });
      window.addEventListener('keydown', unlock, { passive: true });
      window.addEventListener('touchstart', unlock, { passive: true });
    }
  }

  public ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC({ sampleRate: AUDIO_SAMPLE_RATE });
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = this.muted ? 0 : this.volume;
      this.gainNode.connect(this.ctx.destination);
      if (this.sinkId && this.sinkId !== 'default') {
        this.applySinkId(this.sinkId).catch(() => {});
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.unlocked && this.ctx.state === 'running') {
      this.unlocked = true;
    }
    return this.ctx;
  }

  private async applySinkId(deviceId: string): Promise<boolean> {
    if (!this.ctx) return false;
    const anyCtx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (typeof anyCtx.setSinkId !== 'function') return false;
    try {
      await anyCtx.setSinkId(deviceId === 'default' ? '' : deviceId);
      return true;
    } catch {
      return false;
    }
  }

  public async setOutputDevice(deviceId: string): Promise<boolean> {
    this.sinkId = deviceId || 'default';
    this.ensureContext();
    return this.applySinkId(this.sinkId);
  }

  public supportsOutputSelection(): boolean {
    if (typeof window === 'undefined') return false;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    return Boolean(AC && typeof (AC.prototype as { setSinkId?: unknown }).setSinkId === 'function');
  }

  public async playTestTone(): Promise<void> {
    const ctx = this.ensureContext();
    if (!ctx || !this.gainNode) return;
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime + 0.02;
    const notes = [523.25, 659.25];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);
      env.gain.setValueAtTime(0.0001, now + idx * 0.14);
      env.gain.exponentialRampToValueAtTime(0.24, now + idx * 0.14 + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 0.22);
      osc.connect(env);
      env.connect(this.gainNode!);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.24);
    });
  }

  public setVolume(percent: number, muted: boolean) {
    this.volume = Math.max(0, Math.min(1, percent / 100));
    this.muted = muted;
    if (this.gainNode && this.ctx) {
      const target = this.muted ? 0 : this.volume;
      this.gainNode.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
    }
  }

  public pushPcm16(pcmBuffer: ArrayBuffer) {
    if (this.muted || this.volume <= 0) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.gainNode || ctx.state !== 'running') return;

    const sampleCount = Math.floor(pcmBuffer.byteLength / 2);
    if (sampleCount <= 0) return;

    const int16 = new Int16Array(pcmBuffer, 0, sampleCount);
    const audioBuf = ctx.createBuffer(1, sampleCount, AUDIO_SAMPLE_RATE);
    const channel = audioBuf.getChannelData(0);

    for (let i = 0; i < sampleCount; i++) {
      channel[i] = int16[i] / 32768;
    }

    const now = ctx.currentTime;
    // Keep tight ~35ms jitter buffer and drop stale drift if > 260ms
    if (this.nextStartTime < now || this.nextStartTime > now + 0.26) {
      this.nextStartTime = now + 0.035;
    }

    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(this.gainNode);
    src.start(this.nextStartTime);
    this.nextStartTime += audioBuf.duration;
  }
}

export const remoteAudio = new RemoteAudioPlayer();
