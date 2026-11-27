import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, RefreshCw, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import type { MediaHardwareStatus, MediaPreferences } from '../../types/os';
import { mediaApi } from '../../services/osBridge';
import { remoteAudio } from '../../services/audioPlayer';
import { mediaCapture, type EnumeratedMediaDevices } from '../../services/mediaCapture';

interface MediaSettingsSectionProps {
  media: MediaPreferences;
  volume: number;
  muted: boolean;
  audioEnabled: boolean;
  onUpdateMedia: (partial: Partial<MediaPreferences>) => void;
  onChangeVolume: (v: number) => void;
  onToggleMute: () => void;
  onToggleAudioStream: (v: boolean) => void;
  onSendWs: (msg: Record<string, unknown>) => void;
  onNotify: (title: string, message: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const MediaSettingsSection: React.FC<MediaSettingsSectionProps> = ({
  media,
  volume,
  muted,
  audioEnabled,
  onUpdateMedia,
  onChangeVolume,
  onToggleMute,
  onToggleAudioStream,
  onSendWs,
  onNotify,
}) => {
  const [hwStatus, setHwStatus] = useState<MediaHardwareStatus | null>(null);
  const [devices, setDevices] = useState<EnumeratedMediaDevices>({
    speakers: [],
    microphones: [],
    cameras: [],
    secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
  });
  const [micLevel, setMicLevel] = useState(0);
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const [installingDriver, setInstallingDriver] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  const refreshHardware = async (askPermission = false) => {
    mediaApi
      .status()
      .then((s) => setHwStatus(s))
      .catch(() => {});
    const devs = await mediaCapture.enumerate(askPermission);
    setDevices(devs);
  };

  useEffect(() => {
    refreshHardware(false);
    const unsubMic = mediaCapture.subscribeMicLevel(setMicLevel);
    const unsubCam = mediaCapture.subscribeCameraStream(setCamStream);
    return () => {
      unsubMic();
      unsubCam();
    };
  }, []);

  useEffect(() => {
    const vid = previewVideoRef.current;
    if (!vid) return;
    if (camStream) {
      vid.srcObject = camStream;
      vid.play().catch(() => {});
    } else {
      vid.srcObject = null;
    }
  }, [camStream]);

  const handleToggleMic = async () => {
    const next = !media.micEnabled;
    if (next) {
      await mediaApi.setupMic().catch(() => {});
      const ok = await mediaCapture.startMic(media.micDeviceId, media.micGain, onSendWs);
      if (!ok) {
        onNotify(
          'Mikrofon Girişi',
          devices.secureContext
            ? 'Mikrofon erişimi başlatılamadı; tarayıcı iznini kontrol edin.'
            : 'Tarayıcılar canlı mikrofon yakalamayı yalnızca HTTPS veya localhost bağlantısında açar. Linux PulseAudio sanal mikrofonu (tamga_mic) arka planda hazırlandı.',
          'warning'
        );
      }
      onUpdateMedia({ micEnabled: ok });
      refreshHardware(false);
    } else {
      mediaCapture.stopMic(onSendWs);
      onUpdateMedia({ micEnabled: false });
    }
  };

  const handleToggleCamera = async () => {
    const next = !media.cameraEnabled;
    if (next) {
      await mediaApi.setupCamera(false).catch(() => {});
      const ok = await mediaCapture.startCamera(
        media.cameraDeviceId,
        media.cameraResolution,
        media.cameraMirror,
        onSendWs
      );
      if (!ok) {
        onNotify(
          'Görüntü Girişi',
          devices.secureContext
            ? 'Kamera başlatılamadı; tarayıcı iznini kontrol edin.'
            : 'Tarayıcılar canlı kamera akışını yalnızca HTTPS veya localhost bağlantısında açar.',
          'warning'
        );
      }
      onUpdateMedia({ cameraEnabled: ok });
      refreshHardware(false);
    } else {
      mediaCapture.stopCamera(onSendWs);
      onUpdateMedia({ cameraEnabled: false });
    }
  };

  const handleInstallV4l2 = async () => {
    setInstallingDriver(true);
    try {
      const res = await mediaApi.setupCamera(true);
      onNotify('Sanal Kamera', res.note, res.ready ? 'success' : 'warning');
      refreshHardware(false);
    } catch (e) {
      onNotify('Sanal Kamera Hatası', (e as Error).message, 'error');
    } finally {
      setInstallingDriver(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Ses & Kamera</h2>
        <button
          type="button"
          onClick={() => refreshHardware(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--os-surface-2)] border border-[var(--os-border)] hover:border-[var(--os-border-strong)] text-[11px] font-medium"
        >
          <RefreshCw className="w-3 h-3" />
          <span>Cihazları Tara</span>
        </button>
      </div>

      {/* 1. HOPARLÖR ÇIKIŞI */}
      <div
        data-testid="media-speaker-card"
        className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] divide-y divide-[var(--os-border)]"
      >
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)]">
              {muted || volume === 0 ? (
                <VolumeX className="w-4 h-4 text-red-400" />
              ) : (
                <Volume2 className="w-4 h-4 text-emerald-400" />
              )}
            </div>
            <div>
              <div className="text-xs font-semibold">Hoparlör Çıkışı</div>
              <div className="text-[11px] text-[var(--os-text-muted)]">
                {hwStatus?.pulseRunning
                  ? `Linux PulseAudio Aktif (${hwStatus.sinks.length} çıkış)`
                  : 'Tarayıcı ses çıkışı'}
              </div>
            </div>
          </div>

          <button
            type="button"
            data-testid="media-speaker-test-btn"
            onClick={() => remoteAudio.playTestTone()}
            className="px-3 py-1.5 rounded-lg bg-[var(--os-bg)] border border-[var(--os-border)] hover:border-[var(--os-border-strong)] text-[11px] font-medium"
          >
            Test Sesi Çal
          </button>
        </div>

        <div className="px-4 py-3 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium">Çıkış Aygıtı</span>
            <select
              data-testid="media-speaker-select"
              value={media.speakerDeviceId}
              onChange={(e) => {
                const nextId = e.target.value;
                onUpdateMedia({ speakerDeviceId: nextId });
                remoteAudio.setOutputDevice(nextId).catch(() => {});
              }}
              className="max-w-[260px] px-2.5 py-1.5 rounded-lg bg-[var(--os-bg)] border border-[var(--os-border)] text-xs text-[var(--os-text)] focus:outline-none"
            >
              <option value="default">Sistem Varsayılan Hoparlörü</option>
              {devices.speakers.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Hoparlör (${d.deviceId.slice(0, 6)})`}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">Çıkış Düzeyi</span>
              <button
                type="button"
                onClick={onToggleMute}
                className="font-mono text-[11px] text-[var(--os-text-muted)]"
              >
                {muted ? 'Sessiz' : `%${volume}`}
              </button>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={muted ? 0 : volume}
              onChange={(e) => onChangeVolume(Number(e.target.value))}
              style={{ accentColor: 'var(--os-accent-bg)' }}
              className="w-full"
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-medium">Uzak Masaüstü Ses Akışı (PulseAudio)</span>
            <button
              type="button"
              onClick={() => onToggleAudioStream(!audioEnabled)}
              className={`px-3 py-1 rounded-lg text-[11px] font-medium border ${
                audioEnabled
                  ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] border-transparent'
                  : 'bg-[var(--os-bg)] border-[var(--os-border)] text-[var(--os-text-muted)]'
              }`}
            >
              {audioEnabled ? 'Açık' : 'Kapalı'}
            </button>
          </div>
        </div>
      </div>

      {/* 2. MİKROFON GİRİŞİ */}
      <div
        data-testid="media-mic-card"
        className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] divide-y divide-[var(--os-border)]"
      >
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)]">
              {media.micEnabled ? (
                <Mic className="w-4 h-4 text-emerald-400" />
              ) : (
                <MicOff className="w-4 h-4 text-[var(--os-text-muted)]" />
              )}
            </div>
            <div>
              <div className="text-xs font-semibold">Mikrofon Girişi</div>
              <div className="text-[11px] text-[var(--os-text-muted)]">
                {hwStatus?.virtualMicReady
                  ? `Linux Sanal Mikrofon: ${hwStatus.virtualMicName}`
                  : 'Linux Sanal Mikrofon hazırlanabilir'}
              </div>
            </div>
          </div>

          <button
            type="button"
            data-testid="media-mic-toggle-btn"
            onClick={handleToggleMic}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
              media.micEnabled
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/35'
                : 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] border-transparent'
            }`}
          >
            {media.micEnabled ? 'Mikrofonu Kapat' : 'Mikrofonu Aç'}
          </button>
        </div>

        <div className="px-4 py-3 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium">Giriş Aygıtı</span>
            <select
              data-testid="media-mic-select"
              value={media.micDeviceId}
              onChange={(e) => {
                const nextId = e.target.value;
                onUpdateMedia({ micDeviceId: nextId });
                if (media.micEnabled) {
                  mediaCapture.startMic(nextId, media.micGain, onSendWs);
                }
              }}
              className="max-w-[260px] px-2.5 py-1.5 rounded-lg bg-[var(--os-bg)] border border-[var(--os-border)] text-xs text-[var(--os-text)] focus:outline-none"
            >
              <option value="default">Varsayılan Mikrofon</option>
              {devices.microphones.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Mikrofon (${d.deviceId.slice(0, 6)})`}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">Giriş Kazancı</span>
              <span className="font-mono text-[11px] text-[var(--os-text-muted)]">
                %{media.micGain}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={150}
              step={5}
              value={media.micGain}
              onChange={(e) => {
                const g = Number(e.target.value);
                mediaCapture.setMicGain(g);
                onUpdateMedia({ micGain: g });
              }}
              style={{ accentColor: 'var(--os-accent-bg)' }}
              className="w-full"
            />
          </div>

          {/* Live VU Meter */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-[var(--os-text-muted)]">
              <span>Giriş Seviyesi (Canlı)</span>
              <span className="font-mono">{micLevel}%</span>
            </div>
            <div className="h-2 rounded-full bg-[var(--os-bg)] border border-[var(--os-border)] overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-75"
                style={{ width: `${micLevel}%` }}
              />
            </div>
          </div>

          {!devices.secureContext && (
            <div className="px-3 py-2 rounded-xl bg-amber-500/12 border border-amber-500/35 text-[11px] text-[var(--os-text-secondary)] leading-relaxed">
              Tarayıcılar düz HTTP adreslerinde yerel mikrofonu engeller (HTTPS / localhost gerekir). Sunucu tarafındaki PulseAudio sanal mikrofonu yine de etkindir.
            </div>
          )}
        </div>
      </div>

      {/* 3. GÖRÜNTÜ GİRİŞİ (KAMERA) */}
      <div
        data-testid="media-camera-card"
        className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] divide-y divide-[var(--os-border)]"
      >
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)]">
              {media.cameraEnabled ? (
                <Video className="w-4 h-4 text-emerald-400" />
              ) : (
                <VideoOff className="w-4 h-4 text-[var(--os-text-muted)]" />
              )}
            </div>
            <div>
              <div className="text-xs font-semibold">Görüntü Girişi (Kamera)</div>
              <div className="text-[11px] text-[var(--os-text-muted)]">
                {hwStatus?.cameraNote || 'Kamera cihazı hazırlanıyor...'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {hwStatus && !hwStatus.v4l2LoopbackReady && (
              <button
                type="button"
                disabled={installingDriver}
                onClick={handleInstallV4l2}
                className="px-2.5 py-1.5 rounded-lg bg-[var(--os-bg)] border border-[var(--os-border)] hover:border-[var(--os-border-strong)] text-[11px] font-medium disabled:opacity-40"
              >
                {installingDriver ? 'Kuruluyor...' : 'Sürücüyü Kur'}
              </button>
            )}
            <button
              type="button"
              data-testid="media-camera-toggle-btn"
              onClick={handleToggleCamera}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                media.cameraEnabled
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/35'
                  : 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] border-transparent'
              }`}
            >
              {media.cameraEnabled ? 'Kamerayı Kapat' : 'Kamerayı Aç'}
            </button>
          </div>
        </div>

        <div className="px-4 py-3 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium">Kamera Aygıtı</span>
            <select
              data-testid="media-camera-select"
              value={media.cameraDeviceId}
              onChange={(e) => {
                const nextId = e.target.value;
                onUpdateMedia({ cameraDeviceId: nextId });
                if (media.cameraEnabled) {
                  mediaCapture.startCamera(nextId, media.cameraResolution, media.cameraMirror, onSendWs);
                }
              }}
              className="max-w-[260px] px-2.5 py-1.5 rounded-lg bg-[var(--os-bg)] border border-[var(--os-border)] text-xs text-[var(--os-text)] focus:outline-none"
            >
              <option value="default">Varsayılan Kamera</option>
              {devices.cameras.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Kamera (${d.deviceId.slice(0, 6)})`}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium">Çözünürlük & Ayna</span>
            <div className="flex items-center gap-1.5">
              {(['480p', '720p'] as const).map((res) => (
                <button
                  key={res}
                  type="button"
                  onClick={() => {
                    onUpdateMedia({ cameraResolution: res });
                    if (media.cameraEnabled) {
                      mediaCapture.startCamera(media.cameraDeviceId, res, media.cameraMirror, onSendWs);
                    }
                  }}
                  className={`px-2.5 py-1 rounded-md text-[11px] border ${
                    media.cameraResolution === res
                      ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] border-transparent font-medium'
                      : 'bg-[var(--os-bg)] border-[var(--os-border)] text-[var(--os-text-muted)]'
                  }`}
                >
                  {res}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  const next = !media.cameraMirror;
                  onUpdateMedia({ cameraMirror: next });
                  if (media.cameraEnabled) {
                    mediaCapture.startCamera(media.cameraDeviceId, media.cameraResolution, next, onSendWs);
                  }
                }}
                className={`px-2.5 py-1 rounded-md text-[11px] border ${
                  media.cameraMirror
                    ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] border-transparent font-medium'
                    : 'bg-[var(--os-bg)] border-[var(--os-border)] text-[var(--os-text-muted)]'
                }`}
              >
                Aynala
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-[#0b0c10] border border-[var(--os-border)] h-36 overflow-hidden flex items-center justify-center">
            {camStream ? (
              <video
                ref={previewVideoRef}
                muted
                playsInline
                className={`h-full w-full object-cover ${media.cameraMirror ? 'scale-x-[-1]' : ''}`}
              />
            ) : (
              <span className="text-[11px] text-[var(--os-text-subtle)]">
                Kamera önizlemesi için &quot;Kamerayı Aç&quot; düğmesini kullanın
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
