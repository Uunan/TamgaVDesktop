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
  Zap,
} from 'lucide-react';
import {
  DEFAULT_DOCK_PREFERENCES,
  DEFAULT_STREAM_PREFERENCES,
  DEFAULT_TERMINAL_PREFERENCES,
  DEFAULT_UI_PREFERENCES,
  WALLPAPERS,
  type AuthStatus,
  type DesktopMeta,
  type DockPreferences,
  type SettingsTabId,
  type StreamPreferences,
  type SystemInfoResponse,
  type TelemetryData,
  type VirtualDesktopInfo,
} from '../../types/os';
import { authApi, buildWallpaperUrl, systemApi } from '../../services/osBridge';
import { WallpaperThumb } from '../desktop/WallpaperLayer';
import { formatUptime } from '../../utils/format';

export const STREAM_PRESETS: Record<
  'performance' | 'balanced' | 'ultra',
  {
    label: string;
    tag: string;
    config: Omit<StreamPreferences, 'audioEnabled'>;
  }
> = {
  performance: {
    label: 'Hız',
    tag: '1x • Düşük Gecikme',
    config: {
      preset: 'performance',
      dynamicQualityDrop: true,
      motionQuality: 48,
      motionScale: 0.5,
      maxDpr: 1,
      settlePng: false,
      settleDelayMs: 220,
      x11Fps: 24,
      x11MaxQuality: 74,
      x11MotionQuality: 44,
    },
  },
  balanced: {
    label: 'Dengeli',
    tag: '2x • Akıllı',
    config: {
      preset: 'balanced',
      dynamicQualityDrop: true,
      motionQuality: 65,
      motionScale: 0.75,
      maxDpr: 2,
      settlePng: true,
      settleDelayMs: 300,
      x11Fps: 20,
      x11MaxQuality: 85,
      x11MotionQuality: 58,
    },
  },
  ultra: {
    label: 'Maksimum',
    tag: '2x • Kayıpsız',
    config: {
      preset: 'ultra',
      dynamicQualityDrop: false,
      motionQuality: 90,
      motionScale: 1,
      maxDpr: 2,
      settlePng: true,
      settleDelayMs: 240,
      x11Fps: 25,
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
      },
    });
  };

  const updateDock = (partial: Partial<DockPreferences>) => {
    onUpdatePreferences({ dock: partial });
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
                      min={10}
                      max={30}
                      step={2}
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
                  label="Boyut"
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
                          onClick={() => updateDock({ size: sz })}
                          className={`px-2.5 py-1 rounded-md text-[11px] ${
                            dock.size === sz
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
                  label="Uygulama Etiketleri"
                  tip="Yatay Dock'ta sabit simgelerin yanında isimlerini göster veya yalnızca ikon kullan."
                  right={
                    <Toggle
                      checked={dock.showLabels}
                      onChange={(v) => updateDock({ showLabels: v })}
                    />
                  }
                />
              </div>
            </>
          )}

          {/* 3. APPEARANCE & DAY/NIGHT GEOMETRIC WALLPAPERS */}
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

              {/* Geometric Wallpapers (Dynamic Day/Night) */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium flex items-center">
                    Geometrik Duvar Kağıtları
                    <InfoTip text="Her geometrik tasarım Gece (Koyu) ve Gündüz (Açık) temasında otomatik olarak farklı renk paleti ve atmosfer sunar." />
                  </span>
                  <button
                    onClick={onTriggerWallpaperUpload}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[var(--os-bg)] border border-[var(--os-border)] hover:border-[var(--os-border-strong)]"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    <span>Özel Resim</span>
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  {WALLPAPERS.map((wp) => {
                    const active = meta.preferences.wallpaper === wp.id;
                    return (
                      <button
                        key={wp.id}
                        data-testid={`wp-card-${wp.id}`}
                        onClick={() => onUpdatePreferences({ wallpaper: wp.id })}
                        className={`rounded-xl p-1.5 text-left border transition-all ${
                          active
                            ? 'border-[var(--os-text)] bg-[var(--os-surface-3)]'
                            : 'border-[var(--os-border)] bg-[var(--os-bg)] hover:border-[var(--os-border-strong)]'
                        }`}
                      >
                        <WallpaperThumb wallpaperId={wp.id} theme={theme} className="w-full h-14" />
                        <div className="text-[11px] font-medium truncate px-1 pt-1.5">
                          {wp.name}
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
                        className="w-full h-14 object-cover rounded-lg"
                      />
                      <div className="text-[11px] font-medium truncate px-1 pt-1.5">Özel Resim</div>
                    </button>
                  )}
                </div>
              </div>

              {/* Desktop & Display controls */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] divide-y divide-[var(--os-border)]">
                <Row
                  label="Simge Boyutu"
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
                  ['Chromium', telemetry?.engine.ready ? 'Hazır' : 'Yok'],
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
