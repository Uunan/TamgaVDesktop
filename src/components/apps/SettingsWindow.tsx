import React, { useEffect, useState } from 'react';
import {
  Check,
  Cpu,
  Gauge,
  Globe,
  HardDrive,
  ImagePlus,
  KeyRound,
  Layers,
  Lock,
  LogOut,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Shield,
  Sliders,
  Sparkles,
  Sun,
  Terminal,
  Volume2,
  Zap,
} from 'lucide-react';
import {
  DEFAULT_BROWSER_PREFERENCES,
  DEFAULT_STREAM_PREFERENCES,
  DEFAULT_TERMINAL_PREFERENCES,
  DEFAULT_UI_PREFERENCES,
  WALLPAPERS,
  type AuthStatus,
  type DesktopMeta,
  type SettingsTabId,
  type StreamPreferences,
  type SystemInfoResponse,
  type TelemetryData,
  type VirtualDesktopInfo,
} from '../../types/os';
import { authApi, buildWallpaperUrl, systemApi } from '../../services/osBridge';
import { formatUptime } from '../../utils/format';

export const STREAM_PRESETS: Record<
  'performance' | 'balanced' | 'ultra',
  {
    label: string;
    subtitle: string;
    badge: string;
    config: Omit<StreamPreferences, 'audioEnabled'>;
  }
> = {
  performance: {
    label: 'Hız Öncelikli',
    subtitle: 'Düşük ping, akıcı kaydırma ve hafif veri tüketimi',
    badge: 'En Hızlı',
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
    subtitle: 'Kaydırırken hızlı, durunca 2x Retina kayıpsız netlik',
    badge: 'Önerilen',
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
    label: 'Maksimum Kalite',
    subtitle: 'Her karede tam 2x Retina keskinlik ve en yüksek detay',
    badge: 'Retina 2x',
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
    browser?: Partial<DesktopMeta['preferences']['browser']>;
    terminal?: Partial<DesktopMeta['preferences']['terminal']>;
    ui?: Partial<DesktopMeta['preferences']['ui']>;
  }) => void;
  onToggleTheme: (nextTheme: 'dark' | 'light', origin?: { x: number; y: number }) => void;
  onTriggerWallpaperUpload: () => void;
  onChangeBrightness: (v: number) => void;
  onChangeVolume: (v: number) => void;
  onToggleMute: () => void;
  onResetBrowserTabs: () => void;
  onOpenTerminal: (cwd?: string) => void;
  onSwitchDesktop: (id: string) => void;
  onCreateDesktop: (name?: string) => void;
  onLockScreen: () => void;
  onLogout?: () => void;
  onNotify: (title: string, message: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
}

const NAV_ITEMS: Array<{ id: SettingsTabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'stream', label: 'Akış & Kalite', icon: Gauge },
  { id: 'appearance', label: 'Görünüm', icon: Palette },
  { id: 'browser', label: 'Tarayıcı', icon: Globe },
  { id: 'terminal', label: 'Uç Birim', icon: Terminal },
  { id: 'system', label: 'Sistem & Güvenlik', icon: Shield },
];

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
      checked ? 'bg-emerald-500' : 'bg-[var(--os-surface-3)] border border-[var(--os-border-strong)]'
    }`}
  >
    <span
      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
      }`}
    />
  </button>
);

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
  onResetBrowserTabs,
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

  const stream: StreamPreferences = {
    ...DEFAULT_STREAM_PREFERENCES,
    ...(meta.preferences.stream || {}),
  };
  const browser = {
    ...DEFAULT_BROWSER_PREFERENCES,
    ...(meta.preferences.browser || {}),
  };
  const terminal = {
    ...DEFAULT_TERMINAL_PREFERENCES,
    ...(meta.preferences.terminal || {}),
  };
  const ui = {
    ...DEFAULT_UI_PREFERENCES,
    ...(meta.preferences.ui || {}),
  };

  const [urlDraft, setUrlDraft] = useState(browser.defaultUrl);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setUrlDraft(browser.defaultUrl);
  }, [browser.defaultUrl]);

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

  const handleSaveDefaultUrl = (nextUrl: string) => {
    const trimmed = nextUrl.trim() || 'https://www.google.com';
    setUrlDraft(trimmed);
    onUpdatePreferences({ browser: { defaultUrl: trimmed } });
    onNotify('Tarayıcı Ayarı', `Varsayılan sekme adresi güncellendi: ${trimmed}`, 'success');
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 4) {
      onNotify('Parola Hatası', 'Parola en az 4 karakter olmalıdır.', 'warning');
      return;
    }
    if (newPassword !== confirmPassword) {
      onNotify('Parola Hatası', 'Parolalar eşleşmiyor.', 'warning');
      return;
    }
    setSavingPass(true);
    try {
      await authApi.changePassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      onNotify('Güvenlik', 'Yönetici parolası başarıyla güncellendi.', 'success');
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
      {/* Left Minimalist Sidebar */}
      <aside className="w-52 shrink-0 border-r border-[var(--os-border)] bg-[var(--os-surface-2)]/70 p-3 flex flex-col justify-between">
        <div className="space-y-1">
          <div className="px-2.5 pb-2.5 pt-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--os-text-subtle)]">
              Sistem Ayarları
            </div>
            <div className="text-[11px] text-[var(--os-text-muted)] truncate mt-0.5">
              {currentDesktop.name}
            </div>
          </div>

          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                data-testid={`settings-tab-${item.id}`}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                  active
                    ? 'bg-[var(--os-text)] text-[var(--os-bg)] shadow-sm'
                    : 'text-[var(--os-text-secondary)] hover:bg-[var(--os-hover)] hover:text-[var(--os-text)]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Bottom mini status */}
        <div className="rounded-xl bg-[var(--os-surface)] border border-[var(--os-border)] p-2.5 space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between text-[var(--os-text-muted)]">
            <span>Gecikme</span>
            <span className="font-mono text-[var(--os-text)]">{pingMs} ms</span>
          </div>
          <div className="flex items-center justify-between text-[var(--os-text-muted)]">
            <span>Sürüm</span>
            <span className="font-mono text-[var(--os-text)]">
              v{sysInfo?.version || authStatus.version || '1.3.0'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* 1. STREAM & QUALITY (GeForce NOW-style minimalist tuner) */}
          {activeTab === 'stream' && (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold tracking-tight flex items-center gap-2">
                    <Gauge className="w-4 h-4 text-emerald-400" />
                    <span>Akış & Görüntü Kalitesi</span>
                  </h2>
                  <p className="text-xs text-[var(--os-text-muted)] mt-1">
                    Kaydırma ve hareket anında kare kalitesini dinamik düşürüp hız kazanın; görüntü
                    durduğunda maksimum keskinliğe yükseltin.
                  </p>
                </div>
                <span className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-500/12 text-emerald-400 border border-emerald-500/25">
                  {stream.preset === 'performance'
                    ? 'Hız Modu'
                    : stream.preset === 'ultra'
                    ? 'Maksimum Kalite'
                    : stream.preset === 'custom'
                    ? 'Özel Profil'
                    : 'Dengeli'}
                </span>
              </div>

              {/* Live Minimal Telemetry Strip */}
              <div className="grid grid-cols-4 gap-2.5">
                <div className="rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] px-3.5 py-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--os-text-subtle)]">
                    Ağ Ping
                  </div>
                  <div className="text-sm font-semibold font-mono mt-0.5">{pingMs} ms</div>
                </div>
                <div className="rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] px-3.5 py-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--os-text-subtle)]">
                    Tarayıcı FPS
                  </div>
                  <div className="text-sm font-semibold font-mono mt-0.5">
                    {telemetry?.engine.fps ?? 0} FPS
                  </div>
                </div>
                <div className="rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] px-3.5 py-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--os-text-subtle)]">
                    Son Kare
                  </div>
                  <div className="text-sm font-semibold font-mono mt-0.5">
                    {lastFrameKB > 0 ? `${lastFrameKB} KB` : '—'}
                  </div>
                </div>
                <div className="rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] px-3.5 py-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--os-text-subtle)]">
                    Maks. Keskinlik
                  </div>
                  <div className="text-sm font-semibold font-mono mt-0.5">
                    {stream.maxDpr}x {stream.settlePng ? 'PNG' : 'JPG'}
                  </div>
                </div>
              </div>

              {/* 3 One-Click GeForce NOW Style Presets */}
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    ['performance', Zap],
                    ['balanced', Sliders],
                    ['ultra', Sparkles],
                  ] as const
                ).map(([key, Icon]) => {
                  const preset = STREAM_PRESETS[key];
                  const selected = stream.preset === key;
                  return (
                    <button
                      key={key}
                      data-testid={`stream-preset-${key}`}
                      onClick={() => applyPreset(key)}
                      className={`text-left rounded-2xl p-3.5 border transition-all ${
                        selected
                          ? 'bg-emerald-500/10 border-emerald-500/60 ring-1 ring-emerald-500/30'
                          : 'bg-[var(--os-surface-2)] border-[var(--os-border)] hover:border-[var(--os-border-strong)]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                            selected
                              ? 'bg-emerald-500 text-white'
                              : 'bg-[var(--os-surface-3)] text-[var(--os-text-secondary)]'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--os-surface)] border border-[var(--os-border)] text-[var(--os-text-muted)]">
                          {preset.badge}
                        </span>
                      </div>
                      <div className="text-xs font-semibold">{preset.label}</div>
                      <div className="text-[11px] text-[var(--os-text-muted)] mt-1 leading-relaxed">
                        {preset.subtitle}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Dynamic Motion Drop Controls */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] divide-y divide-[var(--os-border)]">
                <div className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold">
                      Anlık Hareket Kalite Düşürme (Akıcı Kaydırma)
                    </div>
                    <div className="text-[11px] text-[var(--os-text-muted)] mt-0.5">
                      Kaydırma ve hızlı değişim anlarında kare boyutunu geçici küçültür, durunca
                      netleştirir.
                    </div>
                  </div>
                  <Toggle
                    testId="toggle-dynamic-drop"
                    checked={stream.dynamicQualityDrop}
                    onChange={(v) => updateStream({ dynamicQualityDrop: v })}
                  />
                </div>

                <div className="p-4 space-y-4">
                  {/* Motion Quality Slider */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--os-text-secondary)]">
                        Hareket / Kaydırma Kare Kalitesi
                      </span>
                      <span className="font-mono font-medium">%{stream.motionQuality}</span>
                    </div>
                    <input
                      type="range"
                      min={35}
                      max={95}
                      step={1}
                      disabled={!stream.dynamicQualityDrop}
                      value={stream.motionQuality}
                      onChange={(e) => updateStream({ motionQuality: Number(e.target.value) })}
                      className="w-full accent-emerald-500 disabled:opacity-40"
                    />
                    <div className="flex justify-between text-[10px] text-[var(--os-text-subtle)]">
                      <span>Daha Hızlı (35%)</span>
                      <span>Dengeli (65%)</span>
                      <span>Yüksek Detay (95%)</span>
                    </div>
                  </div>

                  {/* Motion Resolution Scale */}
                  <div className="flex items-center justify-between gap-4 pt-1">
                    <div>
                      <div className="text-xs font-medium">Hareket Çözünürlük Ölçeği</div>
                      <div className="text-[11px] text-[var(--os-text-muted)]">
                        Kaydırma sırasında geçici ölçekleme (0.5x = ~4 kat daha hafif kare)
                      </div>
                    </div>
                    <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--os-surface)] border border-[var(--os-border)]">
                      {[0.5, 0.75, 1].map((sc) => (
                        <button
                          key={sc}
                          disabled={!stream.dynamicQualityDrop}
                          onClick={() => updateStream({ motionScale: sc })}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-colors disabled:opacity-40 ${
                            Math.abs(stream.motionScale - sc) < 0.05
                              ? 'bg-[var(--os-text)] text-[var(--os-bg)] font-semibold'
                              : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
                          }`}
                        >
                          {sc}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Settle Delay */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--os-text-secondary)]">
                        Durgunlaşma Sonrası Netleştirme Gecikmesi
                      </span>
                      <span className="font-mono font-medium">{stream.settleDelayMs} ms</span>
                    </div>
                    <input
                      type="range"
                      min={150}
                      max={900}
                      step={50}
                      value={stream.settleDelayMs}
                      onChange={(e) => updateStream({ settleDelayMs: Number(e.target.value) })}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                </div>
              </div>

              {/* Maximum Quality Controls */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] divide-y divide-[var(--os-border)]">
                <div className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold">Maksimum Keskinlik (HiDPI / DPR)</div>
                    <div className="text-[11px] text-[var(--os-text-muted)] mt-0.5">
                      Retina ekranlarda 2x kristal metin; düşük internette 1x daha hızlı akar.
                    </div>
                  </div>
                  <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--os-surface)] border border-[var(--os-border)]">
                    {[
                      { val: 1, label: '1x' },
                      { val: 1.5, label: '1.5x' },
                      { val: 2, label: '2x Retina' },
                    ].map((opt) => (
                      <button
                        key={opt.val}
                        data-testid={`stream-dpr-${opt.val}`}
                        onClick={() => updateStream({ maxDpr: opt.val })}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                          Math.abs(stream.maxDpr - opt.val) < 0.05
                            ? 'bg-[var(--os-text)] text-[var(--os-bg)]'
                            : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold">Kayıpsız PNG Netleştirme</div>
                    <div className="text-[11px] text-[var(--os-text-muted)] mt-0.5">
                      Hareket durduğunda okuma kalitesi için kayıpsız PNG karesi gönderir.
                    </div>
                  </div>
                  <Toggle
                    testId="toggle-settle-png"
                    checked={stream.settlePng}
                    onChange={(v) => updateStream({ settlePng: v })}
                  />
                </div>
              </div>

              {/* Linux X11 Applications Stream Controls */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold">
                      Linux Uygulamaları (Firefox, GIMP, Chrome X11)
                    </div>
                    <div className="text-[11px] text-[var(--os-text-muted)] mt-0.5">
                      Açık pencerelere yeniden başlatmadan anlık uygulanır.
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[var(--os-text-muted)]">
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Ses</span>
                    <Toggle
                      checked={stream.audioEnabled}
                      onChange={(v) => updateStream({ audioEnabled: v }, false)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--os-text-muted)]">Hedef FPS</span>
                      <span className="font-mono font-medium">{stream.x11Fps}</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={30}
                      step={2}
                      value={stream.x11Fps}
                      onChange={(e) => updateStream({ x11Fps: Number(e.target.value) })}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--os-text-muted)]">Hareket Kalitesi</span>
                      <span className="font-mono font-medium">%{stream.x11MotionQuality}</span>
                    </div>
                    <input
                      type="range"
                      min={30}
                      max={85}
                      step={1}
                      value={stream.x11MotionQuality}
                      onChange={(e) => updateStream({ x11MotionQuality: Number(e.target.value) })}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--os-text-muted)]">Maks. Kalite</span>
                      <span className="font-mono font-medium">%{stream.x11MaxQuality}</span>
                    </div>
                    <input
                      type="range"
                      min={55}
                      max={95}
                      step={1}
                      value={stream.x11MaxQuality}
                      onChange={(e) => updateStream({ x11MaxQuality: Number(e.target.value) })}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* 2. APPEARANCE & DESKTOP */}
          {activeTab === 'appearance' && (
            <>
              <div>
                <h2 className="text-base font-semibold tracking-tight">Görünüm & Masaüstü</h2>
                <p className="text-xs text-[var(--os-text-muted)] mt-1">
                  Tema, duvar kağıdı, simge boyutu ve ekran tercihlerinizi özelleştirin.
                </p>
              </div>

              {/* Theme */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-4 space-y-3">
                <div className="text-xs font-semibold">Tema</div>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      ['dark', 'Koyu Tema', Moon],
                      ['light', 'Açık Tema', Sun],
                    ] as const
                  ).map(([tKey, label, Icon]) => {
                    const active = (meta.preferences.theme || 'dark') === tKey;
                    return (
                      <button
                        key={tKey}
                        onClick={(e) =>
                          onToggleTheme(tKey, { x: e.clientX, y: e.clientY })
                        }
                        className={`flex items-center justify-between px-4 py-3 rounded-xl border text-xs font-medium transition-all ${
                          active
                            ? 'bg-[var(--os-text)] text-[var(--os-bg)] border-transparent'
                            : 'bg-[var(--os-surface)] border-[var(--os-border)] hover:bg-[var(--os-hover)]'
                        }`}
                      >
                        <span className="flex items-center gap-2.5">
                          <Icon className="w-4 h-4" />
                          <span>{label}</span>
                        </span>
                        {active && <Check className="w-4 h-4" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Wallpaper */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold">Duvar Kağıdı</div>
                  <button
                    onClick={onTriggerWallpaperUpload}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--os-surface)] border border-[var(--os-border-strong)] hover:bg-[var(--os-hover)]"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    <span>Özel Resim Yükle</span>
                  </button>
                </div>

                <div className="grid grid-cols-4 gap-2.5">
                  {WALLPAPERS.map((wp) => {
                    const active = meta.preferences.wallpaper === wp.id;
                    return (
                      <button
                        key={wp.id}
                        onClick={() => onUpdatePreferences({ wallpaper: wp.id })}
                        className={`rounded-xl p-3 text-left border transition-all ${
                          active
                            ? 'border-[var(--os-text)] bg-[var(--os-surface-3)]'
                            : 'border-[var(--os-border)] bg-[var(--os-surface)] hover:border-[var(--os-border-strong)]'
                        }`}
                      >
                        <div
                          className={`h-12 rounded-lg mb-2 ${
                            wp.id === 'mono-peaks'
                              ? 'bg-gradient-to-br from-zinc-700 via-zinc-900 to-black'
                              : wp.id === 'graphite-flat'
                              ? 'bg-zinc-800'
                              : 'bg-neutral-950'
                          }`}
                        />
                        <div className="text-[11px] font-medium truncate">{wp.name}</div>
                      </button>
                    );
                  })}
                  {customWallpaperUrl && (
                    <button
                      onClick={() => onUpdatePreferences({ wallpaper: 'custom' })}
                      className={`rounded-xl p-3 text-left border transition-all ${
                        meta.preferences.wallpaper === 'custom'
                          ? 'border-[var(--os-text)] bg-[var(--os-surface-3)]'
                          : 'border-[var(--os-border)] bg-[var(--os-surface)]'
                      }`}
                    >
                      <img
                        src={customWallpaperUrl}
                        alt="Özel"
                        className="h-12 w-full object-cover rounded-lg mb-2"
                      />
                      <div className="text-[11px] font-medium truncate">Özel Resim</div>
                    </button>
                  )}
                </div>
              </div>

              {/* Icons, Brightness, Audio, Fullscreen Notice */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] divide-y divide-[var(--os-border)]">
                <div className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold">Masaüstü Simge Boyutu</div>
                    <div className="text-[11px] text-[var(--os-text-muted)]">
                      Simgelerin kapladığı alan ve yazı boyutu
                    </div>
                  </div>
                  <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--os-surface)] border border-[var(--os-border)]">
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
                        className={`px-3 py-1 rounded-lg text-[11px] font-medium ${
                          meta.preferences.iconSize === sz
                            ? 'bg-[var(--os-text)] text-[var(--os-bg)]'
                            : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold">Simgeleri Otomatik Hizala</div>
                    <div className="text-[11px] text-[var(--os-text-muted)]">
                      Masaüstü öğelerini ızgarada düzenli tutar
                    </div>
                  </div>
                  <Toggle
                    checked={Boolean(meta.preferences.autoArrange)}
                    onChange={(v) => onUpdatePreferences({ autoArrange: v })}
                  />
                </div>

                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">Ekran Parlaklığı</span>
                    <span className="font-mono text-[var(--os-text-muted)]">%{brightness}</span>
                  </div>
                  <input
                    type="range"
                    min={40}
                    max={100}
                    value={brightness}
                    onChange={(e) => onChangeBrightness(Number(e.target.value))}
                    className="w-full accent-[var(--os-text)]"
                  />

                  <div className="flex items-center justify-between text-xs pt-1">
                    <span className="font-medium">Sistem Sesi</span>
                    <button
                      onClick={onToggleMute}
                      className="font-mono text-[var(--os-text-muted)] hover:text-[var(--os-text)]"
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
                    className="w-full accent-[var(--os-text)]"
                  />
                </div>

                <div className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold">Tam Ekran Öneri Bildirimi</div>
                    <div className="text-[11px] text-[var(--os-text-muted)]">
                      Girişte sağ üstte tam ekran önerisini göster
                    </div>
                  </div>
                  <Toggle
                    checked={ui.showFullscreenNotice}
                    onChange={(v) => onUpdatePreferences({ ui: { showFullscreenNotice: v } })}
                  />
                </div>
              </div>
            </>
          )}

          {/* 3. BROWSER (CHROMIUM) */}
          {activeTab === 'browser' && (
            <>
              <div>
                <h2 className="text-base font-semibold tracking-tight">Yerleşik Chromium Ayarları</h2>
                <p className="text-xs text-[var(--os-text-muted)] mt-1">
                  Varsayılan açılış sekmesi, pencere kapanış davranışı ve oturum yönetimi.
                </p>
              </div>

              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] divide-y divide-[var(--os-border)]">
                <div className="p-4 space-y-3">
                  <div>
                    <div className="text-xs font-semibold">Varsayılan Sekme / Başlangıç Adresi</div>
                    <div className="text-[11px] text-[var(--os-text-muted)] mt-0.5">
                      Chromium ilk açıldığında ve yeni sekme (+) eklendiğinde açılacak adres.
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      data-testid="settings-browser-default-url"
                      value={urlDraft}
                      onChange={(e) => setUrlDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveDefaultUrl(urlDraft);
                      }}
                      placeholder="https://www.google.com"
                      className="flex-1 px-3 py-2 rounded-xl bg-[var(--os-surface)] border border-[var(--os-border-strong)] text-xs font-mono focus:outline-none focus:border-[var(--os-text)]"
                    />
                    <button
                      onClick={() => handleSaveDefaultUrl(urlDraft)}
                      className="px-4 py-2 rounded-xl bg-[var(--os-text)] text-[var(--os-bg)] text-xs font-medium hover:opacity-90"
                    >
                      Kaydet
                    </button>
                  </div>
                  <div className="flex items-center gap-2 pt-0.5">
                    {[
                      { label: 'Google', url: 'https://www.google.com' },
                      { label: 'DuckDuckGo', url: 'https://duckduckgo.com' },
                      { label: 'Yeni Sekme Ekranı', url: 'compute://newtab' },
                    ].map((opt) => (
                      <button
                        key={opt.url}
                        onClick={() => handleSaveDefaultUrl(opt.url)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] border transition-colors ${
                          browser.defaultUrl === opt.url
                            ? 'bg-[var(--os-text)] text-[var(--os-bg)] border-transparent'
                            : 'bg-[var(--os-surface)] border-[var(--os-border)] text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold">
                      Pencere Kapatılınca Sekmeleri Otomatik Kapat
                    </div>
                    <div className="text-[11px] text-[var(--os-text-muted)] mt-0.5">
                      Chromium kapatıldığında (X) tüm sekmeleri kapatır ve sunucu RAM&apos;ini anında
                      boşaltır. Alta alındığında sekmeler korunur.
                    </div>
                  </div>
                  <Toggle
                    testId="toggle-close-tabs-on-exit"
                    checked={browser.closeTabsOnExit}
                    onChange={(v) => onUpdatePreferences({ browser: { closeTabsOnExit: v } })}
                  />
                </div>

                <div className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold">Aktif Sekme Oturumunu Sıfırla</div>
                    <div className="text-[11px] text-[var(--os-text-muted)] mt-0.5">
                      Açık tüm Chromium sekmelerini hemen kapatır ve bellek kullanımını sıfırlar.
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      onResetBrowserTabs();
                      onNotify('Chromium', 'Tüm açık sekmeler kapatıldı.', 'info');
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-[var(--os-surface)] border border-[var(--os-border-strong)] hover:bg-red-500/12 hover:text-red-400 hover:border-red-500/30 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Sekmeleri Temizle</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* 4. TERMINAL */}
          {activeTab === 'terminal' && (
            <>
              <div>
                <h2 className="text-base font-semibold tracking-tight">Uç Birim (Terminal)</h2>
                <p className="text-xs text-[var(--os-text-muted)] mt-1">
                  Linux PTY kabuğu görünüm ve davranış tercihleri. Masaüstünde veya herhangi bir
                  klasörde sağ tıklayarak &quot;Uç Birim&quot; açabilirsiniz.
                </p>
              </div>

              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] divide-y divide-[var(--os-border)]">
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold">Yazı Tipi Boyutu</span>
                    <span className="font-mono font-medium">{terminal.fontSize} px</span>
                  </div>
                  <input
                    type="range"
                    min={11}
                    max={18}
                    step={1}
                    value={terminal.fontSize}
                    onChange={(e) =>
                      onUpdatePreferences({ terminal: { fontSize: Number(e.target.value) } })
                    }
                    className="w-full accent-emerald-500"
                  />
                  {/* Live preview */}
                  <div
                    style={{ fontSize: `${terminal.fontSize}px` }}
                    className="rounded-xl bg-[#141416] text-[#f5f5f7] font-mono p-3.5 border border-[var(--os-border)] leading-relaxed"
                  >
                    <div>
                      <span className="text-emerald-400">root@tamga</span>:
                      <span className="text-blue-400">~/Desktop</span>$ ls -la
                    </div>
                    <div className="text-zinc-400">drwxr-xr-x 2 root root 4096 Projects</div>
                  </div>
                </div>

                <div className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold">Yanıp Sönen İmleç</div>
                    <div className="text-[11px] text-[var(--os-text-muted)]">
                      Açık terminallerde anında uygulanır
                    </div>
                  </div>
                  <Toggle
                    checked={terminal.cursorBlink}
                    onChange={(v) => onUpdatePreferences({ terminal: { cursorBlink: v } })}
                  />
                </div>

                <div className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold">Hızlı Başlat</div>
                    <div className="text-[11px] text-[var(--os-text-muted)]">
                      Masaüstü dizininde yeni bir Uç Birim penceresi aç
                    </div>
                  </div>
                  <button
                    onClick={() => onOpenTerminal('/Desktop')}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[var(--os-text)] text-[var(--os-bg)] text-xs font-medium"
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    <span>Uç Birim Aç</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* 5. SYSTEM & SECURITY */}
          {activeTab === 'system' && (
            <>
              <div>
                <h2 className="text-base font-semibold tracking-tight">Sistem & Güvenlik</h2>
                <p className="text-xs text-[var(--os-text-muted)] mt-1">
                  Sunucu kaynakları, sanal masaüstleri ve yönetici oturum güvenliği.
                </p>
              </div>

              {/* Resource Cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-[var(--os-text-muted)]">
                      <Cpu className="w-3.5 h-3.5" /> CPU
                    </span>
                    <span className="font-mono font-semibold">{telemetry?.cpuPercent ?? 0}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--os-surface-3)] overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, telemetry?.cpuPercent ?? 0)}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-[var(--os-text-subtle)]">
                    {telemetry?.cpuCores ?? 0} Çekirdek
                  </div>
                </div>

                <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-[var(--os-text-muted)]">
                      <Monitor className="w-3.5 h-3.5" /> RAM
                    </span>
                    <span className="font-mono font-semibold">{telemetry?.ramPercent ?? 0}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--os-surface-3)] overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, telemetry?.ramPercent ?? 0)}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-[var(--os-text-subtle)]">
                    {telemetry ? `${telemetry.ramUsedGB} / ${telemetry.ramTotalGB} GB` : '—'}
                  </div>
                </div>

                <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-[var(--os-text-muted)]">
                      <HardDrive className="w-3.5 h-3.5" /> Disk
                    </span>
                    <span className="font-mono font-semibold">
                      {sysInfo?.disk ? `${sysInfo.disk.percent}%` : '—'}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--os-surface-3)] overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, sysInfo?.disk?.percent ?? 0)}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-[var(--os-text-subtle)]">
                    {sysInfo?.disk ? `${sysInfo.disk.usedGB} / ${sysInfo.disk.totalGB} GB` : '—'}
                  </div>
                </div>
              </div>

              {/* System Info Table */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-4 space-y-2 text-xs">
                {[
                  ['Sunucu Adı', sysInfo?.hostname || telemetry?.hostname || '—'],
                  ['İşletim Sistemi', sysInfo?.runtime.distro || telemetry?.distro || 'Linux'],
                  ['TamgaVDesktop', `v${sysInfo?.version || authStatus.version || '1.3.0'}`],
                  ['Çalışma Süresi', telemetry ? formatUptime(telemetry.uptimeSeconds) : '—'],
                  ['Dosya Modu', sysInfo?.filesystemMode || 'isolated'],
                  [
                    'Yerleşik Chromium',
                    telemetry?.engine.ready ? 'HAZIR (Playwright HiDPI)' : 'Kurulmadı',
                  ],
                  ['Linux GUI Motoru', sysInfo?.runtime.guiReady ? 'HAZIR (X11 + PulseAudio)' : 'Eksik'],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-center justify-between py-1 border-b border-[var(--os-border)] last:border-0"
                  >
                    <span className="text-[var(--os-text-muted)]">{k}</span>
                    <span className="font-mono text-[11px]">{v}</span>
                  </div>
                ))}
              </div>

              {/* Virtual Desktops */}
              <div className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5" />
                    <span>Sanal Masaüstleri ({desktops.length})</span>
                  </div>
                  <button
                    onClick={() => onCreateDesktop()}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--os-surface)] border border-[var(--os-border-strong)] hover:bg-[var(--os-hover)]"
                  >
                    + Yeni Masaüstü
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {desktops.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => onSwitchDesktop(d.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs border transition-colors ${
                        d.id === currentDesktop.id
                          ? 'bg-[var(--os-text)] text-[var(--os-bg)] border-transparent font-medium'
                          : 'bg-[var(--os-surface)] border-[var(--os-border)] text-[var(--os-text-secondary)] hover:bg-[var(--os-hover)]'
                      }`}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Security / Password Change */}
              <form
                onSubmit={handlePasswordChange}
                className="rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold flex items-center gap-2">
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Yönetici Parolasını Değiştir ({authStatus.username || 'admin'})</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Yeni parola"
                    className="px-3 py-2 rounded-xl bg-[var(--os-surface)] border border-[var(--os-border-strong)] text-xs focus:outline-none focus:border-[var(--os-text)]"
                  />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Yeni parola (tekrar)"
                    className="px-3 py-2 rounded-xl bg-[var(--os-surface)] border border-[var(--os-border-strong)] text-xs focus:outline-none focus:border-[var(--os-text)]"
                  />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onLockScreen}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs bg-[var(--os-surface)] border border-[var(--os-border)] hover:bg-[var(--os-hover)]"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Ekranı Kilitle</span>
                    </button>
                    {authStatus.enabled && onLogout && (
                      <button
                        type="button"
                        onClick={onLogout}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs bg-red-500/10 text-red-400 border border-red-500/25 hover:bg-red-500/20"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Çıkış Yap</span>
                      </button>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={savingPass || !newPassword}
                    className="px-4 py-1.5 rounded-xl bg-[var(--os-text)] text-[var(--os-bg)] text-xs font-medium disabled:opacity-40"
                  >
                    {savingPass ? 'Kaydediliyor...' : 'Parolayı Güncelle'}
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
