import React, { useEffect, useState } from 'react';
import {
  Check,
  Cpu,
  Gauge,
  HardDrive,
  ImagePlus,
  KeyRound,
  Layers,
  Lock,
  LogOut,
  Monitor,
  Moon,
  Palette,
  PanelBottom,
  Shield,
  Sliders,
  Sparkles,
  Sun,
  Terminal,
  Volume2,
  Zap,
} from 'lucide-react';
import {
  DEFAULT_DOCK_PREFERENCES,
  DEFAULT_LOCK_SCREEN_PREFERENCES,
  DEFAULT_MEDIA_PREFERENCES,
  DEFAULT_SCREENSAVER_PREFERENCES,
  DEFAULT_STREAM_PREFERENCES,
  DEFAULT_TERMINAL_PREFERENCES,
  DEFAULT_UI_PREFERENCES,
  WALLPAPERS,
  type AuthStatus,
  type DesktopMeta,
  type DockPreferences,
  type LockScreenPreferences,
  type MediaPreferences,
  type ScreensaverPreferences,
  type SettingsTabId,
  type StreamPreferences,
  type SystemInfoResponse,
  type TelemetryData,
  type VirtualDesktopInfo,
} from '../../types/os';
import { authApi, buildWallpaperUrl, systemApi } from '../../services/osBridge';
import { WallpaperThumb } from '../desktop/WallpaperLayer';
import { formatUptime } from '../../utils/format';
import { MediaSettingsSection } from './MediaSettingsSection';

export const STREAM_PRESETS: Record<
  'performance' | 'balanced' | 'ultra',
  {
    label: string;
    tag: string;
    config: Omit<StreamPreferences, 'audioEnabled' | 'scrollSensitivity' | 'smoothBuffer'>;
  }
> = {
  performance: {
    label: 'Hız',
    tag: '60 FPS • Düşük Gecikme',
    config: {
      preset: 'performance',
      dynamicQualityDrop: true,
      motionQuality: 48,
      motionScale: 0.5,
      maxDpr: 1,
      settlePng: false,
      settleDelayMs: 160,
      x11Fps: 60,
      x11MaxQuality: 76,
      x11MotionQuality: 46,
    },
  },
  balanced: {
    label: 'Dengeli',
    tag: '45 FPS • Akıllı',
    config: {
      preset: 'balanced',
      dynamicQualityDrop: true,
      motionQuality: 65,
      motionScale: 0.75,
      maxDpr: 2,
      settlePng: true,
      settleDelayMs: 200,
      x11Fps: 45,
      x11MaxQuality: 86,
      x11MotionQuality: 58,
    },
  },
  ultra: {
    label: 'Maksimum',
    tag: '60 FPS • Kayıpsız',
    config: {
      preset: 'ultra',
      dynamicQualityDrop: false,
      motionQuality: 90,
      motionScale: 1,
      maxDpr: 2,
      settlePng: true,
      settleDelayMs: 180,
      x11Fps: 60,
      x11MaxQuality: 92,
      x11MotionQuality: 84,
    },
  },
};

const DOCK_COLOR_SWATCHES: Array<{
  id: DockPreferences['color'];
  label: string;
  preview: string;
}> = [
  { id: 'auto', label: 'Otomatik', preview: 'linear-gradient(135deg, #27272a 50%, #f4f4f5 50%)' },
  { id: 'dark', label: 'Koyu Cam', preview: '#18181b' },
  { id: 'light', label: 'Açık Cam', preview: '#f4f4f6' },
  { id: 'obsidian', label: 'Saf Siyah', preview: '#09090b' },
  { id: 'midnight', label: 'Gece Mavisi', preview: '#111a2e' },
  { id: 'emerald', label: 'Zümrüt', preview: '#0d2620' },
  { id: 'amethyst', label: 'Ametist', preview: '#1e132b' },
];

/* Minimalist circular "i" hover info popover */
const InfoTip: React.FC<{ text: string }> = ({ text }) => (
  <span className="relative inline-flex items-center group/tip ml-1.5 align-middle">
    <span
      tabIndex={0}
      aria-label={text}
      className="w-[15px] h-[15px] rounded-full border border-[var(--os-border-strong)] text-[var(--os-text-subtle)] hover:text-[var(--os-text)] hover:border-[var(--os-text-muted)] text-[9.5px] font-semibold leading-none inline-flex items-center justify-center cursor-help transition-colors select-none"
    >
      i
    </span>
    <span
      style={{ boxShadow: 'var(--os-shadow)' }}
      className="pointer-events-none opacity-0 translate-y-1 group-hover/tip:opacity-100 group-hover/tip:translate-y-0 group-focus-within/tip:opacity-100 group-focus-within/tip:translate-y-0 transition-all duration-150 absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-56 px-3 py-2 rounded-xl bg-[var(--os-surface-3)] border border-[var(--os-border-strong)] text-[11px] font-normal leading-relaxed text-[var(--os-text)] z-[999] text-left whitespace-normal"
    >
      {text}
    </span>
  </span>
);

const Toggle: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
}> = ({ checked, onChange, testId }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    data-testid={testId}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
      checked ? 'bg-[var(--os-accent-bg)]' : 'bg-[var(--os-surface-3)] border border-[var(--os-border-strong)]'
    }`}
  >
    <span
      className={`inline-block h-3.5 w-3.5 transform rounded-full transition-transform ${
        checked
          ? 'translate-x-[18px] bg-[var(--os-accent-fg)]'
          : 'translate-x-[3px] bg-[var(--os-text-muted)]'
      }`}
    />
  </button>
);

const Row: React.FC<{
  label: string;
  tip?: string;
  right: React.ReactNode;
}> = ({ label, tip, right }) => (
  <div className="px-4 py-3 flex items-center justify-between gap-4">
    <div className="text-xs font-medium text-[var(--os-text)] flex items-center">
      <span>{label}</span>
      {tip && <InfoTip text={tip} />}
    </div>
    <div className="shrink-0">{right}</div>
  </div>
);

interface SettingsWindowProps {
  initialTab?: SettingsTabId;
  meta: DesktopMeta;
  telemetry: TelemetryData | null;
  pingMs: number;
  lastFrameKB: number;
  brightness: number;
  volume: number;
  muted: boolean;
  authStatus: AuthStatus;
  currentDesktop: VirtualDesktopInfo;
  desktops: VirtualDesktopInfo[];
  onUpdatePreferences: (partial: {
    wallpaper?: string;
    customWallpaper?: string;
    theme?: 'dark' | 'light';
    iconSize?: 'sm' | 'md' | 'lg';
    autoArrange?: boolean;
    sortBy?: 'name' | 'extension' | 'size' | 'modifiedAt';
    stream?: Partial<StreamPreferences>;
    terminal?: Partial<DesktopMeta['preferences']['terminal']>;
    ui?: Partial<DesktopMeta['preferences']['ui']>;
    dock?: Partial<DockPreferences>;
    media?: Partial<MediaPreferences>;
    screensaver?: Partial<ScreensaverPreferences>;
    lockScreen?: Partial<LockScreenPreferences>;
  }) => void;
  onToggleTheme: (nextTheme: 'dark' | 'light', origin?: { x: number; y: number }) => void;
  onTriggerWallpaperUpload: () => void;
  onChangeBrightness: (v: number) => void;
  onChangeVolume: (v: number) => void;
  onToggleMute: () => void;
  onOpenTerminal: (cwd?: string) => void;
  onSwitchDesktop: (id: string) => void;
  onCreateDesktop: (name?: string) => void;
  onLockScreen: () => void;
  onPreviewScreensaver?: () => void;
  onSendWs?: (msg: Record<string, unknown>) => void;
  onLogout?: () => void;
  onNotify: (title: string, message: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
}

const NAV_ITEMS: Array<{
  id: SettingsTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'stream', label: 'Akış & Kalite', icon: Gauge },
  { id: 'dock', label: 'Dock & Panel', icon: PanelBottom },
  { id: 'appearance', label: 'Görünüm', icon: Palette },
  { id: 'media', label: 'Ses & Kamera', icon: Volume2 },
  { id: 'terminal', label: 'Uç Birim', icon: Terminal },
  { id: 'system', label: 'Sistem', icon: Shield },
];

export const SettingsWindow: React.FC<SettingsWindowProps> = ({
  initialTab = 'stream',
  meta,
  telemetry,
  pingMs,
  lastFrameKB,
  brightness,
  volume,
  muted,
  authStatus,
  currentDesktop,
  desktops,
  onUpdatePreferences,
  onToggleTheme,
  onTriggerWallpaperUpload,
  onChangeBrightness,
  onChangeVolume,
  onToggleMute,
  onOpenTerminal,
  onSwitchDesktop,
  onCreateDesktop,
  onLockScreen,
  onPreviewScreensaver,
  onSendWs,
  onLogout,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const [sysInfo, setSysInfo] = useState<SystemInfoResponse | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPass, setSavingPass] = useState(false);

  const theme = meta.preferences.theme || 'dark';
  const stream: StreamPreferences = {
    ...DEFAULT_STREAM_PREFERENCES,
    ...(meta.preferences.stream || {}),
  };
  const dock: DockPreferences = {
    ...DEFAULT_DOCK_PREFERENCES,
    ...(meta.preferences.dock || {}),
  };
  const terminal = {
    ...DEFAULT_TERMINAL_PREFERENCES,
    ...(meta.preferences.terminal || {}),
  };
  const ui = {
    ...DEFAULT_UI_PREFERENCES,
    ...(meta.preferences.ui || {}),
  };
  const media: MediaPreferences = {
    ...DEFAULT_MEDIA_PREFERENCES,
    ...(meta.preferences.media || {}),
  };
  const screensaver: ScreensaverPreferences = {
    ...DEFAULT_SCREENSAVER_PREFERENCES,
    ...(meta.preferences.screensaver || {}),
  };
  const lockScreen: LockScreenPreferences = {
    ...DEFAULT_LOCK_SCREEN_PREFERENCES,
    ...(meta.preferences.lockScreen || {}),
  };

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    systemApi
      .info()
      .then((info) => setSysInfo(info))
      .catch(() => {});
  }, []);

  const updateStream = (partial: Partial<StreamPreferences>, markCustom = true) => {
    onUpdatePreferences({
      stream: {
        ...partial,
        ...(markCustom ? { preset: 'custom' } : {}),
      },
    });
  };

  const applyPreset = (presetKey: 'performance' | 'balanced' | 'ultra') => {
    onUpdatePreferences({
      stream: {
        ...STREAM_PRESETS[presetKey].config,
        audioEnabled: stream.audioEnabled,
        scrollSensitivity: stream.scrollSensitivity ?? 1.0,
        smoothBuffer: Boolean(stream.smoothBuffer),
      },
    });
  };

  const updateDock = (partial: Partial<DockPreferences>) => {
    onUpdatePreferences({ dock: partial });
  };

  const updateMedia = (partial: Partial<MediaPreferences>) => {
    onUpdatePreferences({ media: partial });
  };

  const updateScreensaver = (partial: Partial<ScreensaverPreferences>) => {
    onUpdatePreferences({ screensaver: partial });
  };

  const updateLockScreen = (partial: Partial<LockScreenPreferences>) => {
    onUpdatePreferences({ lockScreen: partial });
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 4) {
      onNotify('Parola', 'En az 4 karakter girin.', 'warning');
      return;
    }
    if (newPassword !== confirmPassword) {
      onNotify('Parola', 'Parolalar eşleşmiyor.', 'warning');
      return;
    }
    setSavingPass(true);
    try {
      await authApi.changePassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      onNotify('Güvenlik', 'Parola güncellendi.', 'success');
    } catch (err) {
      onNotify('Hata', (err as Error).message, 'error');
    } finally {
      setSavingPass(false);
    }
  };

  const customWallpaperUrl = meta.preferences.customWallpaper
    ? buildWallpaperUrl(meta.preferences.customWallpaper)
    : undefined;

  return (
    <div
      data-testid="settings-window"
      className="flex-1 min-h-0 flex bg-[var(--os-surface)] text-[var(--os-text)] select-none"
    >
      {/* Clean Minimal Sidebar */}
      <aside className="w-48 shrink-0 border-r border-[var(--os-border)] bg-[var(--os-sidebar)] p-2.5 flex flex-col justify-between">
        <div className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                data-testid={`settings-tab-${item.id}`}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)]'
                    : 'text-[var(--os-text-secondary)] hover:bg-[var(--os-hover)] hover:text-[var(--os-text)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="px-2.5 py-2 text-[10px] font-mono text-[var(--os-text-subtle)] flex items-center justify-between border-t border-[var(--os-border)]">
          <span>TamgaOS</span>
          <span>v{sysInfo?.version || authStatus.version || '1.4.0'}</span>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 overflow-y-auto px-6 py-5">
        <div className="max-w-xl mx-auto space-y-5">
          {/* 1. STREAM & QUALITY — Minimal GeForce NOW Style */}
          {activeTab === 'stream' && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-tight">Akış & Kalite</h2>
                <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--os-text-muted)] bg-[var(--os-surface-2)] border border-[var(--os-border)] px-2.5 py-1 rounded-full">
                  <span>{pingMs} ms</span>
                  <span className="opacity-30">•</span>
                  <span>{telemetry?.engine.fps ?? 0} FPS</span>
                  <span className="opacity-30">•</span>
                  <span>{lastFrameKB > 0 ? `${lastFrameKB} KB` : '—'}</span>
                </div>
              </div>

              {/* 3 Compact Preset Pills */}
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['performance', Zap],
                    ['balanced', Sliders],
                    ['ultra', Sparkles],
                  ] as const
                ).map(([key, Icon]) => {
                  const p = STREAM_PRESETS[key];
                  const active = stream.preset === key;
                  return (
                    <button
                      key={key}
                      data-testid={`stream-preset-${key}`}
                      onClick={() => applyPreset(key)}
                      className={`px-3 py-2.5 rounded-xl border text-left transition-all ${
                        active
                          ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] border-transparent'
                          : 'bg-[var(--os-surface-2)] border-[var(--os-border)] hover:border-[var(--os-border-strong)]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-semibold">
                        <Icon className="w-3.5 h-3.5" />
                        <span>{p.label}</span>
                      </div>
                      <div
                        className={`text-[10px] mt-0.5 ${
                          active ? 'opacity-75' : 'text-[var(--os-text-subtle)]'
                        }`}
                      >
                        {p.tag}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Dynamic Motion Quality Section */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] divide-y divide-[var(--os-border)]">
                <div>
                  <Row
                    label="Gecikme Korumalı Akıcı Kalite"
                    tip="Ping dalgalandığında bulanıklaşmak yerine kaliteyi yüksek tutar; tıklama ve yazmada sıfır bekleme, kesintisiz kaydırma ve videoda ise ~32–135 ms adaptif akış tamponu ile takılmayı yumuşatır."
                    right={
                      <Toggle
                        testId="toggle-smooth-buffer"
                        checked={Boolean(stream.smoothBuffer)}
                        onChange={(v) => updateStream({ smoothBuffer: v }, false)}
                      />
                    }
                  />
                  {stream.smoothBuffer && (
                    <div
                      data-testid="smooth-buffer-status"
                      className="px-4 pb-2.5 -mt-1 text-[11px] text-[var(--os-text-muted)] flex items-center justify-between gap-2"
                    >
                      <span>Aktif • Yüksek netlik, anlık tepki + dalgalanma koruması</span>
                      <span className="font-mono text-[10px] text-[var(--os-text-subtle)] shrink-0">
                        ~{Math.round(Math.min(135, Math.max(32, Math.max(0, pingMs - 60) * 0.35 + 34)))} ms tampon
                      </span>
                    </div>
                  )}
                </div>

                <Row
                  label="Hareket Anında Kalite Düşür"
                  tip="Sayfa kaydırırken veya pencere hareket ederken kare boyutunu geçici küçültür. Düşük internet ve yüksek pingde kaydırmayı çok hızlandırır."
                  right={
                    <Toggle
                      testId="toggle-dynamic-drop"
                      checked={stream.dynamicQualityDrop}
                      onChange={(v) => updateStream({ dynamicQualityDrop: v })}
                    />
                  }
                />

                <div className="px-4 py-3 space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium flex items-center">
                        Hareket Kalitesi
                        <InfoTip text="Kaydırma anında gönderilen JPEG sıkıştırma kalitesi. Düşük değer daha küçük kare ve daha akıcı tepki demektir." />
                      </span>
                      <span className="font-mono text-[11px] text-[var(--os-text-muted)]">
                        %{stream.motionQuality}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={35}
                      max={95}
                      disabled={!stream.dynamicQualityDrop}
                      value={stream.motionQuality}
                      onChange={(e) => updateStream({ motionQuality: Number(e.target.value) })}
                      style={{ accentColor: 'var(--os-accent-bg)' }}
                      className="w-full disabled:opacity-35"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-medium flex items-center">
                      Hareket Ölçeği
                      <InfoTip text="Kaydırma sırasında geçici çözünürlük çarpanı. 0.5x seçildiğinde kareler yaklaşık 4 kat daha hafif iletilir, durunca tekrar netleşir." />
                    </span>
                    <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--os-bg)] border border-[var(--os-border)]">
                      {[0.5, 0.75, 1].map((sc) => (
                        <button
                          key={sc}
                          disabled={!stream.dynamicQualityDrop}
                          onClick={() => updateStream({ motionScale: sc })}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-mono disabled:opacity-35 ${
                            Math.abs(stream.motionScale - sc) < 0.05
                              ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] font-semibold'
                              : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
                          }`}
                        >
                          {sc}x
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium flex items-center">
                        Netleştirme Gecikmesi
                        <InfoTip text="Hareket durduktan kaç milisaniye sonra tam çözünürlüklü net karenin gönderileceğini belirler." />
                      </span>
                      <span className="font-mono text-[11px] text-[var(--os-text-muted)]">
                        {stream.settleDelayMs} ms
                      </span>
                    </div>
                    <input
                      type="range"
                      min={150}
                      max={900}
                      step={50}
                      value={stream.settleDelayMs}
                      onChange={(e) => updateStream({ settleDelayMs: Number(e.target.value) })}
                      style={{ accentColor: 'var(--os-accent-bg)' }}
                      className="w-full"
                    />
                  </div>
                </div>
              </div>

              {/* Max Quality & X11 Section */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] divide-y divide-[var(--os-border)]">
                <Row
                  label="Maksimum Keskinlik"
                  tip="Görüntünün ulaşacağı tavan piksel yoğunluğu. 2x Retina metinleri yerel uygulama gibi keskinleştirir; 1x daha az bant genişliği kullanır."
                  right={
                    <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--os-bg)] border border-[var(--os-border)]">
                      {[
                        { val: 1, label: '1x' },
                        { val: 1.5, label: '1.5x' },
                        { val: 2, label: '2x' },
                      ].map((opt) => (
                        <button
                          key={opt.val}
                          data-testid={`stream-dpr-${opt.val}`}
                          onClick={() => updateStream({ maxDpr: opt.val })}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-mono ${
                            Math.abs(stream.maxDpr - opt.val) < 0.05
                              ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] font-semibold'
                              : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  }
                />

                <Row
                  label="Kayıpsız PNG Netleştirme"
                  tip="Sayfa durduğunda JPEG yerine kayıpsız PNG göndererek küçük metinlerde sıkıştırma izini tamamen sıfırlar."
                  right={
                    <Toggle
                      testId="toggle-settle-png"
                      checked={stream.settlePng}
                      onChange={(v) => updateStream({ settlePng: v })}
                    />
                  }
                />

                <div className="px-4 py-3 grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--os-text-muted)] flex items-center">
                        X11 FPS
                        <InfoTip text="Firefox, GIMP gibi yerel Linux uygulamalarının saniyedeki hedef kare hızı." />
                      </span>
                      <span className="font-mono">{stream.x11Fps}</span>
                    </div>
                    <input
                      type="range"
                      data-testid="stream-x11-fps"
                      min={15}
                      max={60}
                      step={5}
                      value={stream.x11Fps}
                      onChange={(e) => updateStream({ x11Fps: Number(e.target.value) })}
                      style={{ accentColor: 'var(--os-accent-bg)' }}
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--os-text-muted)]">X11 Hareket</span>
                      <span className="font-mono">%{stream.x11MotionQuality}</span>
                    </div>
                    <input
                      type="range"
                      min={30}
                      max={85}
                      value={stream.x11MotionQuality}
                      onChange={(e) => updateStream({ x11MotionQuality: Number(e.target.value) })}
                      style={{ accentColor: 'var(--os-accent-bg)' }}
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--os-text-muted)]">X11 Maks.</span>
                      <span className="font-mono">%{stream.x11MaxQuality}</span>
                    </div>
                    <input
                      type="range"
                      min={55}
                      max={95}
                      value={stream.x11MaxQuality}
                      onChange={(e) => updateStream({ x11MaxQuality: Number(e.target.value) })}
                      style={{ accentColor: 'var(--os-accent-bg)' }}
                      className="w-full"
                    />
                  </div>
                </div>

                <Row
                  label="Uzak Ses Aktarımı"
                  tip="Linux uygulamalarından çıkan PulseAudio sesini tarayıcıya canlı aktarır."
                  right={
                    <Toggle
                      checked={stream.audioEnabled}
                      onChange={(v) => updateStream({ audioEnabled: v }, false)}
                    />
                  }
                />

                <div className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium flex items-center">
                      Trackpad / Kaydırma Hızı
                      <InfoTip text="Chrome, VS Code ve diğer Linux native pencerelerde iki parmak trackpad ve fare tekerleği kaydırma hızını ayarlar (1.0x = Doğal macOS hızı)." />
                    </span>
                    <span className="font-mono text-[11px] text-[var(--os-text-muted)]">
                      {(stream.scrollSensitivity ?? 1.0).toFixed(1)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    data-testid="stream-scroll-sensitivity"
                    min={0.3}
                    max={2.5}
                    step={0.1}
                    value={stream.scrollSensitivity ?? 1.0}
                    onChange={(e) => updateStream({ scrollSensitivity: Number(e.target.value) }, false)}
                    style={{ accentColor: 'var(--os-accent-bg)' }}
                    className="w-full"
                  />
                </div>
              </div>
            </>
          )}

          {/* 2. DOCK & PANEL — Huge Customization Suite */}
          {activeTab === 'dock' && (
            <>
              <h2 className="text-sm font-semibold tracking-tight">Dock & Panel</h2>

              {/* Dock Position */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-4 space-y-3">
                <div className="text-xs font-medium flex items-center">
                  Konum
                  <InfoTip text="Dock'u ekranın alt, üst, sol veya sağ kenarına yerleştirebilirsiniz. Pencereler ve menüler otomatik uyum sağlar." />
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {(
                    [
                      ['bottom', 'Alt'],
                      ['top', 'Üst'],
                      ['left', 'Sol'],
                      ['right', 'Sağ'],
                    ] as const
                  ).map(([pos, label]) => {
                    const active = dock.position === pos;
                    return (
                      <button
                        key={pos}
                        data-testid={`dock-pos-${pos}`}
                        onClick={() => updateDock({ position: pos })}
                        className={`p-2.5 rounded-xl border flex flex-col items-center gap-2 transition-all ${
                          active
                            ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] border-transparent'
                            : 'bg-[var(--os-bg)] border-[var(--os-border)] hover:border-[var(--os-border-strong)]'
                        }`}
                      >
                        <div className="w-12 h-8 rounded-md border border-current/25 relative overflow-hidden">
                          <span
                            className={`absolute bg-current rounded-full ${
                              pos === 'bottom'
                                ? 'bottom-1 left-2 right-2 h-1.5'
                                : pos === 'top'
                                ? 'top-1 left-2 right-2 h-1.5'
                                : pos === 'left'
                                ? 'left-1 top-1.5 bottom-1.5 w-1.5'
                                : 'right-1 top-1.5 bottom-1.5 w-1.5'
                            }`}
                          />
                        </div>
                        <span className="text-[11px] font-medium">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Dock Shape / Style */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-4 space-y-3">
                <div className="text-xs font-medium flex items-center">
                  Dock Şekli
                  <InfoTip text="Yüzen ada, ortalanmış macOS dock, tam genişlik bar veya çerçevesiz minimal stil arasında anında geçiş yapın." />
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {(
                    [
                      ['floating', 'Yüzen'],
                      ['macos', 'macOS'],
                      ['full', 'Tam Bar'],
                      ['minimal', 'Minimal'],
                    ] as const
                  ).map(([st, label]) => {
                    const active = dock.style === st;
                    return (
                      <button
                        key={st}
                        data-testid={`dock-style-${st}`}
                        onClick={() => updateDock({ style: st })}
                        className={`py-2 px-2 rounded-xl border text-xs font-medium transition-all ${
                          active
                            ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] border-transparent'
                            : 'bg-[var(--os-bg)] border-[var(--os-border)] text-[var(--os-text-secondary)] hover:border-[var(--os-border-strong)]'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Color, Opacity, Blur, Size & Labels */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] divide-y divide-[var(--os-border)]">
                <div className="px-4 py-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium flex items-center">
                      Renk
                      <InfoTip text="Hazır cam tonlarından seçebilir veya sağdaki renk seçiciyle kendi Dock renginizi belirleyebilirsiniz." />
                    </span>
                    <label className="flex items-center gap-1.5 text-[11px] text-[var(--os-text-muted)] cursor-pointer">
                      <span>Özel</span>
                      <input
                        type="color"
                        value={dock.customColor || '#18181b'}
                        onChange={(e) =>
                          updateDock({ color: 'custom', customColor: e.target.value })
                        }
                        className="w-5 h-5 rounded cursor-pointer bg-transparent border-0"
                      />
                    </label>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {DOCK_COLOR_SWATCHES.map((sw) => {
                      const active = dock.color === sw.id;
                      return (
                        <button
                          key={sw.id}
                          title={sw.label}
                          data-testid={`dock-color-${sw.id}`}
                          onClick={() => updateDock({ color: sw.id })}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] transition-all ${
                            active
                              ? 'border-[var(--os-text)] bg-[var(--os-surface-3)] font-medium'
                              : 'border-[var(--os-border)] bg-[var(--os-bg)] text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
                          }`}
                        >
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-white/20 shrink-0"
                            style={{ background: sw.preview }}
                          />
                          <span>{sw.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="px-4 py-3 space-y-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium flex items-center">
                        Opaklık (Şeffaflık)
                        <InfoTip text="Dock arka planının opaklık yüzdesi. Düşürdükçe arkasındaki duvar kağıdı daha belirgin görünür." />
                      </span>
                      <span className="font-mono text-[11px] text-[var(--os-text-muted)]">
                        %{dock.opacity}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={20}
                      max={100}
                      value={dock.opacity}
                      onChange={(e) => updateDock({ opacity: Number(e.target.value) })}
                      style={{ accentColor: 'var(--os-accent-bg)' }}
                      className="w-full"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium flex items-center">
                        Cam Bulanıklığı
                        <InfoTip text="Dock arkasındaki buzlu cam (backdrop blur) şiddeti." />
                      </span>
                      <span className="font-mono text-[11px] text-[var(--os-text-muted)]">
                        {dock.blur} px
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={28}
                      value={dock.blur}
                      onChange={(e) => updateDock({ blur: Number(e.target.value) })}
                      style={{ accentColor: 'var(--os-accent-bg)' }}
                      className="w-full"
                    />
                  </div>
                </div>

                <Row
                  label="Uygulama Etiketleri"
                  tip="Yatay Dock'ta sabit simgelerin yanında isimlerini göster veya yalnızca ikon kullan."
                  right={
                    <Toggle
                      checked={dock.showLabels}
                      onChange={(v) => updateDock({ showLabels: v })}
                    />
                  }
                />

                <Row
                  label="Büyütme Efekti (macOS)"
                  tip="Fare ile Dock simgelerinin üzerinde gezinirken simgelerin yumuşakça büyümesini sağlar."
                  right={
                    <Toggle
                      testId="toggle-dock-magnification"
                      checked={dock.magnification ?? true}
                      onChange={(v) => updateDock({ magnification: v })}
                    />
                  }
                />

                <div className="px-4 py-3 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium flex items-center">
                      Büyütme Ölçeği
                      <InfoTip text="Fare üzerine gelindiğinde Dock simgelerinin ne kadar büyüyeceğini belirler." />
                    </span>
                    <span className="font-mono text-[11px] text-[var(--os-text-muted)]">
                      {(dock.magnificationScale ?? 1.45).toFixed(2)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    data-testid="dock-magnification-scale"
                    min={1.15}
                    max={1.85}
                    step={0.05}
                    disabled={!(dock.magnification ?? true)}
                    value={dock.magnificationScale ?? 1.45}
                    onChange={(e) => updateDock({ magnificationScale: Number(e.target.value) })}
                    style={{ accentColor: 'var(--os-accent-bg)' }}
                    className="w-full disabled:opacity-35"
                  />
                </div>

                <Row
                  label="Hızlı Dock Şablonu"
                  tip="Dock yüksekliği ve Dock simge boyutunu tek dokunuşta ayarlamanızı sağlar."
                  right={
                    <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--os-bg)] border border-[var(--os-border)]">
                      {(
                        [
                          { sz: 'sm', label: 'Kompakt (1.0x)', scale: 1.0 },
                          { sz: 'md', label: 'Varsayılan (1.4x)', scale: 1.4 },
                          { sz: 'lg', label: 'Geniş (1.65x)', scale: 1.65 },
                        ] as const
                      ).map((item) => {
                        const isMatch =
                          Math.abs((dock.barScale ?? 1.4) - item.scale) < 0.04 &&
                          Math.abs((dock.iconScale ?? 1.4) - item.scale) < 0.04;
                        return (
                          <button
                            key={item.sz}
                            data-testid={`dock-size-preset-${item.sz}`}
                            onClick={() =>
                              updateDock({
                                size: item.sz,
                                barScale: item.scale,
                                iconScale: item.scale,
                              })
                            }
                            className={`px-2 py-1 rounded-md text-[11px] ${
                              isMatch
                                ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] font-medium'
                                : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
                            }`}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  }
                />

                <div className="px-4 py-3 grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium flex items-center">
                        Dock Boyutu
                        <InfoTip text="Dock çubuğunun yüksekliğini/kalınlığını ve düğme çerçeve boyutunu bağımsız olarak ayarlar." />
                      </span>
                      <span className="font-mono text-[11px] text-[var(--os-text-muted)]">
                        {(dock.barScale ?? 1.4).toFixed(2)}x · {Math.round(54 * (dock.barScale ?? 1.4))}px
                      </span>
                    </div>
                    <input
                      type="range"
                      data-testid="dock-bar-scale"
                      min={0.85}
                      max={1.8}
                      step={0.05}
                      value={dock.barScale ?? 1.4}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        updateDock({
                          barScale: val,
                          size: val < 1.15 ? 'sm' : val > 1.55 ? 'lg' : 'md',
                        });
                      }}
                      style={{ accentColor: 'var(--os-accent-bg)' }}
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium flex items-center">
                        Dock Simge Boyutu
                        <InfoTip text="Dock içerisindeki uygulama simgelerinin büyüklüğünü bağımsız olarak belirler." />
                      </span>
                      <span className="font-mono text-[11px] text-[var(--os-text-muted)]">
                        {(dock.iconScale ?? 1.4).toFixed(2)}x · {Math.round(23 * (dock.iconScale ?? 1.4))}px
                      </span>
                    </div>
                    <input
                      type="range"
                      data-testid="dock-icon-scale"
                      min={0.85}
                      max={1.9}
                      step={0.05}
                      value={dock.iconScale ?? 1.4}
                      onChange={(e) => updateDock({ iconScale: Number(e.target.value) })}
                      style={{ accentColor: 'var(--os-accent-bg)' }}
                      className="w-full"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* 3. APPEARANCE, ANIMATED WALLPAPERS, SCREENSAVER & LOCK SCREEN */}
          {activeTab === 'appearance' && (
            <>
              <h2 className="text-sm font-semibold tracking-tight">Görünüm</h2>

              {/* Theme */}
              <div className="grid grid-cols-2 gap-2.5">
                {(
                  [
                    ['dark', 'Gece (Koyu)', Moon],
                    ['light', 'Gündüz (Açık)', Sun],
                  ] as const
                ).map(([tKey, label, Icon]) => {
                  const active = theme === tKey;
                  return (
                    <button
                      key={tKey}
                      onClick={(e) => onToggleTheme(tKey, { x: e.clientX, y: e.clientY })}
                      className={`flex items-center justify-between px-4 py-3 rounded-2xl border text-xs font-medium transition-all ${
                        active
                          ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] border-transparent'
                          : 'bg-[var(--os-surface-2)] border-[var(--os-border)] hover:border-[var(--os-border-strong)]'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Icon className="w-4 h-4" />
                        <span>{label}</span>
                      </span>
                      {active && <Check className="w-3.5 h-3.5" />}
                    </button>
                  );
                })}
              </div>

              {/* 26 Strictly Static Studio Wallpapers */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium flex items-center">
                    Stüdyo Duvar Kağıtları ({WALLPAPERS.length})
                    <InfoTip text="Masaüstü duvar kağıtları tam netlik ve sıfır işlemci yükü için hareketsizdir. Hareketli halleri yalnızca Ekran Koruyucuda oynatılır." />
                  </span>
                  <button
                    onClick={onTriggerWallpaperUpload}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[var(--os-bg)] border border-[var(--os-border)] hover:border-[var(--os-border-strong)]"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    <span>Özel Resim</span>
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2.5 max-h-80 overflow-y-auto pr-1">
                  {WALLPAPERS.map((wp) => {
                    const active = meta.preferences.wallpaper === wp.id;
                    return (
                      <button
                        key={wp.id}
                        data-testid={`wp-card-${wp.id}`}
                        onClick={() => onUpdatePreferences({ wallpaper: wp.id })}
                        style={{ contain: 'layout paint style' }}
                        className={`group rounded-xl p-1.5 text-left border transition-all ${
                          active
                            ? 'border-[var(--os-text)] bg-[var(--os-surface-3)]'
                            : 'border-[var(--os-border)] bg-[var(--os-bg)] hover:border-[var(--os-border-strong)]'
                        }`}
                      >
                        <WallpaperThumb wallpaperId={wp.id} theme={theme} className="w-full h-16" />
                        <div className="flex items-center justify-between gap-1 px-1 pt-1.5">
                          <span className="text-[11px] font-medium truncate">{wp.name}</span>
                        </div>
                      </button>
                    );
                  })}
                  {customWallpaperUrl && (
                    <button
                      onClick={() => onUpdatePreferences({ wallpaper: 'custom' })}
                      className={`rounded-xl p-1.5 text-left border transition-all ${
                        meta.preferences.wallpaper === 'custom'
                          ? 'border-[var(--os-text)] bg-[var(--os-surface-3)]'
                          : 'border-[var(--os-border)] bg-[var(--os-bg)]'
                      }`}
                    >
                      <img
                        src={customWallpaperUrl}
                        alt="Özel"
                        className="w-full h-16 object-cover rounded-lg"
                      />
                      <div className="text-[11px] font-medium truncate px-1 pt-1.5">Özel Resim</div>
                    </button>
                  )}
                </div>
              </div>

              {/* Animated Screensaver Controls (Living Versions of Wallpapers) */}
              <div
                data-testid="screensaver-settings-card"
                className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] divide-y divide-[var(--os-border)]"
              >
                <div className="px-4 py-3 flex items-center justify-between gap-4">
                  <div className="text-xs font-medium text-[var(--os-text)] flex items-center gap-2">
                    <span>Ekran Koruyucu</span>
                    <span
                      data-testid="screensaver-badge-animated"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-semibold text-emerald-400"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Hareketli
                    </span>
                    <InfoTip text="Belirlenen süre işlem yapılmazsa seçtiğiniz duvar kağıdının hareketli sahnesini tam ekran oynatır." />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {onPreviewScreensaver && (
                      <button
                        type="button"
                        data-testid="screensaver-preview-btn"
                        onClick={onPreviewScreensaver}
                        className="px-2.5 py-1 rounded-lg bg-[var(--os-bg)] border border-[var(--os-border)] hover:border-[var(--os-border-strong)] text-[11px] font-medium"
                      >
                        Önizle
                      </button>
                    )}
                    <Toggle
                      testId="toggle-screensaver-enabled"
                      checked={screensaver.enabled}
                      onChange={(v) => updateScreensaver({ enabled: v })}
                    />
                  </div>
                </div>

                <Row
                  label="Başlama Süresi"
                  right={
                    <select
                      data-testid="screensaver-idle-select"
                      value={screensaver.idleMinutes}
                      onChange={(e) => updateScreensaver({ idleMinutes: Number(e.target.value) })}
                      className="px-2.5 py-1 rounded-lg bg-[var(--os-bg)] border border-[var(--os-border)] text-xs text-[var(--os-text)] focus:outline-none"
                    >
                      {[1, 2, 5, 10, 15, 30].map((m) => (
                        <option key={m} value={m}>
                          {m} dakika sonra
                        </option>
                      ))}
                    </select>
                  }
                />

                <div className="px-4 py-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-medium text-[var(--os-text)]">
                      Hareketli Sahne / Video
                    </span>
                    <select
                      data-testid="screensaver-scene-select"
                      value={screensaver.scene}
                      onChange={(e) => updateScreensaver({ scene: e.target.value })}
                      className="max-w-[240px] px-2.5 py-1 rounded-lg bg-[var(--os-bg)] border border-[var(--os-border)] text-xs text-[var(--os-text)] focus:outline-none"
                    >
                      <option value="wallpaper">Mevcut Duvar Kağıdım (Hareketli)</option>
                      <option value="clock">Sade Büyük Saat (Hareketli)</option>
                      {WALLPAPERS.map((wp) => (
                        <option key={wp.id} value={wp.id}>
                          {wp.name} (Hareketli)
                        </option>
                      ))}
                      <option value="custom-video">Özel Video URL (MP4/WebM)</option>
                    </select>
                  </div>

                  {screensaver.scene !== 'custom-video' && (
                    <div className="relative h-20 rounded-xl overflow-hidden border border-[var(--os-border)]">
                      <WallpaperThumb
                        wallpaperId={
                          screensaver.scene === 'wallpaper' || screensaver.scene === 'current'
                            ? meta.preferences.wallpaper
                            : screensaver.scene === 'clock'
                            ? 'starry-nebula'
                            : screensaver.scene || 'wheat-field'
                        }
                        theme={screensaver.scene === 'clock' ? 'dark' : theme}
                        className="w-full h-full"
                        animated={true}
                      />
                      <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-transparent to-black/30 pointer-events-none" />
                      <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/62 backdrop-blur-md border border-white/20 text-[9px] font-semibold text-white">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Hareketli Ekran Koruyucu
                      </span>
                      <span className="absolute bottom-2 left-3 text-[11px] font-medium text-white drop-shadow">
                        {screensaver.scene === 'wallpaper' || screensaver.scene === 'current'
                          ? `${WALLPAPERS.find((w) => w.id === meta.preferences.wallpaper)?.name || 'Mevcut'} — Hareketli Hali`
                          : screensaver.scene === 'clock'
                          ? 'Sade Büyük Saat'
                          : WALLPAPERS.find((w) => w.id === screensaver.scene)?.name || screensaver.scene}
                      </span>
                    </div>
                  )}
                </div>

                {screensaver.scene === 'custom-video' && (
                  <div className="px-4 py-2.5 flex items-center gap-2">
                    <input
                      type="text"
                      value={screensaver.customVideoUrl || ''}
                      onChange={(e) => updateScreensaver({ customVideoUrl: e.target.value })}
                      placeholder="https://.../video.mp4 veya /Desktop/video.mp4"
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-[var(--os-bg)] border border-[var(--os-border)] text-xs focus:outline-none"
                    />
                  </div>
                )}

                <Row
                  label="Uyandırmada Şifre / Giriş İste"
                  right={
                    <div className="flex items-center gap-2">
                      {screensaver.requirePassword && (
                        <select
                          data-testid="screensaver-pass-delay"
                          value={screensaver.passwordDelayMinutes}
                          onChange={(e) =>
                            updateScreensaver({ passwordDelayMinutes: Number(e.target.value) })
                          }
                          className="px-2 py-1 rounded-lg bg-[var(--os-bg)] border border-[var(--os-border)] text-[11px] text-[var(--os-text)] focus:outline-none"
                        >
                          <option value={0}>Anında</option>
                          <option value={1}>1 dk sonra</option>
                          <option value={5}>5 dk sonra</option>
                          <option value={15}>15 dk sonra</option>
                        </select>
                      )}
                      <Toggle
                        testId="toggle-screensaver-password"
                        checked={screensaver.requirePassword}
                        onChange={(v) => updateScreensaver({ requirePassword: v })}
                      />
                    </div>
                  }
                />
              </div>

              {/* Clean Lock Screen Controls */}
              <div
                data-testid="lockscreen-settings-card"
                className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] divide-y divide-[var(--os-border)]"
              >
                <Row
                  label="Kilit Ekranı Görünümü"
                  right={
                    <select
                      data-testid="lockscreen-style-select"
                      value={lockScreen.style}
                      onChange={(e) =>
                        updateLockScreen({
                          style: e.target.value as LockScreenPreferences['style'],
                        })
                      }
                      className="px-2.5 py-1 rounded-lg bg-[var(--os-bg)] border border-[var(--os-border)] text-xs text-[var(--os-text)] focus:outline-none"
                    >
                      <option value="wallpaper">Hareketli Arkaplan & Saat</option>
                      <option value="blur">Bulanık Masaüstü</option>
                      <option value="clock">Büyük Saat & Tarih</option>
                      <option value="minimal">Sade Koyu</option>
                    </select>
                  }
                />

                <Row
                  label="Kilit Açılışında Parola Sor"
                  tip="Cmd+L ile kilitlediğinizde veya sekme açıldığında hesap parolanızı ister."
                  right={
                    <Toggle
                      testId="toggle-lock-password"
                      checked={lockScreen.requirePassword}
                      onChange={(v) => updateLockScreen({ requirePassword: v })}
                    />
                  }
                />
              </div>

              {/* Desktop Icon & Display controls (Dock controls live in Dock & Panel) */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] divide-y divide-[var(--os-border)]">
                <Row
                  label="Masaüstü Simge Boyutu"
                  right={
                    <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--os-bg)] border border-[var(--os-border)]">
                      {(
                        [
                          ['sm', 'Küçük'],
                          ['md', 'Orta'],
                          ['lg', 'Büyük'],
                        ] as const
                      ).map(([sz, label]) => (
                        <button
                          key={sz}
                          onClick={() => onUpdatePreferences({ iconSize: sz })}
                          className={`px-2.5 py-1 rounded-md text-[11px] ${
                            meta.preferences.iconSize === sz
                              ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] font-medium'
                              : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  }
                />

                <Row
                  label="Otomatik Hizala"
                  right={
                    <Toggle
                      checked={Boolean(meta.preferences.autoArrange)}
                      onChange={(v) => onUpdatePreferences({ autoArrange: v })}
                    />
                  }
                />

                <div className="px-4 py-3 grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium">Parlaklık</span>
                      <span className="font-mono text-[11px] text-[var(--os-text-muted)]">
                        %{brightness}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={45}
                      max={100}
                      value={brightness}
                      onChange={(e) => onChangeBrightness(Number(e.target.value))}
                      style={{ accentColor: 'var(--os-accent-bg)' }}
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium">Ses</span>
                      <button
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
                </div>

                <Row
                  label="Tam Ekran Bildirimi"
                  tip="Açılışta sağ üstte çıkan tam ekran öneri kartını gösterir."
                  right={
                    <Toggle
                      checked={ui.showFullscreenNotice}
                      onChange={(v) => onUpdatePreferences({ ui: { showFullscreenNotice: v } })}
                    />
                  }
                />
              </div>
            </>
          )}

          {/* 4. AUDIO OUTPUT, MICROPHONE & CAMERA HARDWARE */}
          {activeTab === 'media' && (
            <MediaSettingsSection
              media={media}
              volume={volume}
              muted={muted}
              audioEnabled={stream.audioEnabled}
              onUpdateMedia={updateMedia}
              onChangeVolume={onChangeVolume}
              onToggleMute={onToggleMute}
              onToggleAudioStream={(v) => updateStream({ audioEnabled: v }, false)}
              onSendWs={(msg) => onSendWs?.(msg)}
              onNotify={onNotify}
            />
          )}

          {/* 4. TERMINAL */}
          {activeTab === 'terminal' && (
            <>
              <h2 className="text-sm font-semibold tracking-tight">Uç Birim</h2>

              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] divide-y divide-[var(--os-border)]">
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">Yazı Boyutu</span>
                    <span className="font-mono text-[11px] text-[var(--os-text-muted)]">
                      {terminal.fontSize} px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={11}
                    max={18}
                    value={terminal.fontSize}
                    onChange={(e) =>
                      onUpdatePreferences({ terminal: { fontSize: Number(e.target.value) } })
                    }
                    style={{ accentColor: 'var(--os-accent-bg)' }}
                    className="w-full"
                  />
                  <div
                    style={{ fontSize: `${terminal.fontSize}px` }}
                    className="rounded-xl bg-[#141416] text-[#f5f5f7] font-mono px-3.5 py-2.5 border border-[var(--os-border)]"
                  >
                    <span className="text-emerald-400">root@tamga</span>:
                    <span className="text-blue-400">~/Desktop</span>$ ls
                  </div>
                </div>

                <Row
                  label="Yanıp Sönen İmleç"
                  right={
                    <Toggle
                      checked={terminal.cursorBlink}
                      onChange={(v) => onUpdatePreferences({ terminal: { cursorBlink: v } })}
                    />
                  }
                />

                <Row
                  label="Yeni Pencere"
                  tip="Masaüstünde veya herhangi bir klasörde sağ tıklayıp Uç Birim seçerek de doğrudan o dizinde açabilirsiniz."
                  right={
                    <button
                      onClick={() => onOpenTerminal('/Desktop')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] text-xs font-medium"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      <span>Aç</span>
                    </button>
                  }
                />
              </div>
            </>
          )}

          {/* 5. SYSTEM & SECURITY */}
          {activeTab === 'system' && (
            <>
              <h2 className="text-sm font-semibold tracking-tight">Sistem</h2>

              <div className="grid grid-cols-3 gap-2.5">
                {[
                  {
                    icon: Cpu,
                    label: 'CPU',
                    val: `${telemetry?.cpuPercent ?? 0}%`,
                    pct: telemetry?.cpuPercent ?? 0,
                    sub: `${telemetry?.cpuCores ?? 0} Çekirdek`,
                  },
                  {
                    icon: Monitor,
                    label: 'RAM',
                    val: `${telemetry?.ramPercent ?? 0}%`,
                    pct: telemetry?.ramPercent ?? 0,
                    sub: telemetry ? `${telemetry.ramUsedGB}/${telemetry.ramTotalGB} GB` : '—',
                  },
                  {
                    icon: HardDrive,
                    label: 'Disk',
                    val: sysInfo?.disk ? `${sysInfo.disk.percent}%` : '—',
                    pct: sysInfo?.disk?.percent ?? 0,
                    sub: sysInfo?.disk ? `${sysInfo.disk.usedGB}/${sysInfo.disk.totalGB} GB` : '—',
                  },
                ].map((m) => (
                  <div
                    key={m.label}
                    className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-3.5 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-[var(--os-text-muted)]">
                        <m.icon className="w-3.5 h-3.5" /> {m.label}
                      </span>
                      <span className="font-mono font-semibold">{m.val}</span>
                    </div>
                    <div className="h-1 rounded-full bg-[var(--os-surface-3)] overflow-hidden">
                      <div
                        className="h-full bg-[var(--os-accent-bg)] rounded-full transition-all"
                        style={{ width: `${Math.min(100, m.pct)}%` }}
                      />
                    </div>
                    <div className="text-[10px] font-mono text-[var(--os-text-subtle)]">{m.sub}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] px-4 py-2 divide-y divide-[var(--os-border)] text-xs">
                {[
                  ['Sunucu', sysInfo?.hostname || telemetry?.hostname || '—'],
                  ['Sistem', sysInfo?.runtime.distro || telemetry?.distro || 'Linux'],
                  ['Çalışma Süresi', telemetry ? formatUptime(telemetry.uptimeSeconds) : '—'],
                  ['Tarayıcı', 'Google Chrome'],
                  ['Linux GUI', sysInfo?.runtime.guiReady ? 'Hazır' : 'Eksik'],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between py-2">
                    <span className="text-[var(--os-text-muted)]">{k}</span>
                    <span className="font-mono text-[11px]">{v}</span>
                  </div>
                ))}
              </div>

              {/* Virtual Desktops */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                    Masaüstleri
                  </span>
                  <button
                    onClick={() => onCreateDesktop()}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[var(--os-bg)] border border-[var(--os-border)] hover:border-[var(--os-border-strong)]"
                  >
                    + Yeni
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {desktops.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => onSwitchDesktop(d.id)}
                      className={`px-3 py-1 rounded-lg text-xs border transition-colors ${
                        d.id === currentDesktop.id
                          ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] border-transparent font-medium'
                          : 'bg-[var(--os-bg)] border-[var(--os-border)] text-[var(--os-text-secondary)]'
                      }`}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Password & Session */}
              <form
                onSubmit={handlePasswordChange}
                className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-4 space-y-3"
              >
                <div className="text-xs font-medium flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                  <span>Parola Değiştir ({authStatus.username || 'admin'})</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Yeni parola"
                    className="px-3 py-1.5 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)] text-xs focus:outline-none focus:border-[var(--os-border-strong)]"
                  />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Tekrar"
                    className="px-3 py-1.5 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)] text-xs focus:outline-none focus:border-[var(--os-border-strong)]"
                  />
                </div>
                <div className="flex items-center justify-between pt-0.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onLockScreen}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[var(--os-bg)] border border-[var(--os-border)] hover:bg-[var(--os-hover)]"
                    >
                      <Lock className="w-3 h-3" />
                      <span>Kilitle</span>
                    </button>
                    {authStatus.enabled && onLogout && (
                      <button
                        type="button"
                        onClick={onLogout}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20"
                      >
                        <LogOut className="w-3 h-3" />
                        <span>Çıkış</span>
                      </button>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={savingPass || !newPassword}
                    className="px-3.5 py-1.5 rounded-lg bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] text-xs font-medium disabled:opacity-40"
                  >
                    Kaydet
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
};
