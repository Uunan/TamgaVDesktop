import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppWindow,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Folder,
  HardDrive,
  ImagePlus,
  Layers,
  LayoutGrid,
  Link2,
  Lock,
  LogOut,
  Monitor,
  Moon,
  Package,
  Plus,
  RotateCw,
  Search,
  SlidersHorizontal,
  Sun,
  Terminal,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  WALLPAPERS,
  type DesktopMeta,
  type LinuxAppInfo,
  type OSWindow,
  type TelemetryData,
  type ToastItem,
  type VFSNode,
  type VirtualDesktopInfo,
} from '../../types/os';
import { buildAppIconUrl, buildWallpaperUrl } from '../../services/osBridge';
import {
  AppStoreIcon,
  ChromiumLogoIcon,
  FileIcon,
  FirefoxLogoIcon,
  TerminalAppIcon,
} from '../icons/FileIcon';
import { formatUptime, getFileTypeLabel } from '../../utils/format';

interface TaskbarProps {
  windows: OSWindow[];
  focusedWindowId: string | null;
  allNodes: VFSNode[];
  telemetry: TelemetryData | null;
  pingMs: number;
  notificationHistory: ToastItem[];
  wallpaperId: string;
  customWallpaper?: string;
  theme: 'dark' | 'light';
  brightness: number;
  volume: number;
  muted: boolean;
  currentDesktop: VirtualDesktopInfo;
  desktops: VirtualDesktopInfo[];
  linuxApps: LinuxAppInfo[];
  linuxGuiReady: boolean;
  useFirefoxIcon: boolean;
  primaryBrowserLabel: string;
  authEnabled: boolean;
  onSwitchDesktop: (id: string) => void;
  onCreateDesktop: (name?: string) => void;
  onDeleteDesktop: (id: string) => void;
  onCopyDesktopLink: (id: string) => void;
  onChangeBrightness: (v: number) => void;
  onChangeVolume: (v: number) => void;
  onToggleMute: () => void;
  onSelectWallpaper: (id: DesktopMeta['preferences']['wallpaper']) => void;
  onTriggerWallpaperUpload: () => void;
  onToggleTheme: (nextTheme: 'dark' | 'light', origin?: { x: number; y: number }) => void;
  onClearNotifications: () => void;
  onOpenBrowser: () => void;
  onOpenTerminal: () => void;
  onOpenAppStore: () => void;
  onLaunchLinuxApp: (app: LinuxAppInfo) => void;
  onOpenFolder: (path: string) => void;
  onOpenNode: (node: VFSNode) => void;
  onToggleWindowFromTaskbar: (winId: string) => void;
  onLockScreen: () => void;
  onReboot: () => void;
  onLogout?: () => void;
}

type ActiveFlyout = 'launcher' | 'spaces' | 'controls' | 'notifications' | 'calendar' | null;

function getOriginFromEvent(e: React.MouseEvent<HTMLButtonElement>): { x: number; y: number } {
  if (e.clientX || e.clientY) {
    return { x: e.clientX, y: e.clientY };
  }
  const rect = e.currentTarget.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export const Taskbar: React.FC<TaskbarProps> = ({
  windows,
  focusedWindowId,
  allNodes,
  telemetry,
  pingMs,
  notificationHistory,
  wallpaperId,
  customWallpaper,
  theme,
  brightness,
  volume,
  muted,
  currentDesktop,
  desktops,
  linuxApps,
  linuxGuiReady,
  useFirefoxIcon,
  primaryBrowserLabel,
  authEnabled,
  onSwitchDesktop,
  onCreateDesktop,
  onDeleteDesktop,
  onCopyDesktopLink,
  onChangeBrightness,
  onChangeVolume,
  onToggleMute,
  onSelectWallpaper,
  onTriggerWallpaperUpload,
  onToggleTheme,
  onClearNotifications,
  onOpenBrowser,
  onOpenTerminal,
  onOpenAppStore,
  onLaunchLinuxApp,
  onOpenFolder,
  onOpenNode,
  onToggleWindowFromTaskbar,
  onLockScreen,
  onReboot,
  onLogout,
}) => {
  const [flyout, setFlyout] = useState<ActiveFlyout>(null);
  const [now, setNow] = useState(() => new Date());
  const [startSearch, setStartSearch] = useState('');
  const [newDesktopName, setNewDesktopName] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [calCursor, setCalCursor] = useState(() => new Date());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const handleDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFlyout(null);
      }
    };
    window.addEventListener('pointerdown', handleDown);
    return () => window.removeEventListener('pointerdown', handleDown);
  }, []);

  const toggleFlyout = (target: ActiveFlyout) => {
    setFlyout((prev) => (prev === target ? null : target));
  };

  const installedLinuxApps = useMemo(
    () => linuxApps.filter((a) => a.installed),
    [linuxApps]
  );

  const searchApps = useMemo(() => {
    const q = startSearch.trim().toLowerCase();
    if (!q) return [];
    return installedLinuxApps.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.command.toLowerCase().includes(q)
    );
  }, [installedLinuxApps, startSearch]);

  const searchResults = useMemo(() => {
    const q = startSearch.trim().toLowerCase();
    if (!q) return [];
    return allNodes
      .filter(
        (n) =>
          !n.path.startsWith('/.trash') &&
          (n.name.toLowerCase().includes(q) ||
            n.extension.toLowerCase().includes(q) ||
            getFileTypeLabel(n).toLowerCase().includes(q))
      )
      .slice(0, 6);
  }, [allNodes, startSearch]);

  const recentFiles = useMemo(() => {
    return allNodes
      .filter((n) => !n.isDir && !n.path.startsWith('/.trash'))
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
      .slice(0, 4);
  }, [allNodes]);

  const calendarDays = useMemo(() => {
    const year = calCursor.getFullYear();
    const month = calCursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const startWeekday = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ day: number | null; isToday: boolean }> = [];
    for (let i = 0; i < startWeekday; i++) cells.push({ day: null, isToday: false });
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday =
        d === now.getDate() && month === now.getMonth() && year === now.getFullYear();
      cells.push({ day: d, isToday });
    }
    return cells;
  }, [calCursor, now]);

  const browserWin = windows.find(
    (w) => w.kind === 'browser' || (w.kind === 'linux-app' && w.appId === 'firefox')
  );
  const terminalWin = windows.find((w) => w.kind === 'terminal');
  const appStoreWin = windows.find((w) => w.kind === 'app-store');
  const otherWindows = windows.filter(
    (w) => w.id !== browserWin?.id && w.id !== terminalWin?.id && w.id !== appStoreWin?.id
  );
  const customWallpaperUrl = customWallpaper ? buildWallpaperUrl(customWallpaper) : undefined;

  const timeShort = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const timeWithSec = now.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const dateShort = now.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const dateLong = now.toLocaleDateString('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div ref={containerRef} className="select-none">
      {/* 1. LAUNCHER MENU */}
      {flyout === 'launcher' && (
        <div
          style={{ boxShadow: 'var(--os-shadow)' }}
          className="fixed bottom-20 left-4 z-[9980] w-[390px] max-w-[calc(100vw-32px)] rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] overflow-hidden text-[var(--os-text)]"
        >
          <div className="p-4 space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 text-[var(--os-text-subtle)] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                autoFocus
                value={startSearch}
                onChange={(e) => setStartSearch(e.target.value)}
                placeholder="Uygulama veya dosya ara..."
                className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)] focus:border-[var(--os-border-strong)] focus:outline-none text-xs text-[var(--os-text)] placeholder:text-[var(--os-text-subtle)]"
              />
            </div>

            {startSearch.trim() ? (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {'terminal bash shell konsol'.includes(startSearch.toLowerCase()) && (
                  <button
                    onClick={() => {
                      onOpenTerminal();
                      setFlyout(null);
                    }}
                    className="w-full p-2.5 rounded-xl hover:bg-[var(--os-hover)] flex items-center gap-3 text-left transition-colors"
                  >
                    <TerminalAppIcon size={28} />
                    <div>
                      <div className="text-xs font-medium text-[var(--os-text)]">Terminal</div>
                      <div className="text-[11px] text-[var(--os-text-muted)]">Linux Kabuğu</div>
                    </div>
                  </button>
                )}
                {searchApps.map((app) => (
                  <button
                    key={app.id}
                    onClick={() => {
                      onLaunchLinuxApp(app);
                      setFlyout(null);
                    }}
                    className="w-full p-2.5 rounded-xl hover:bg-[var(--os-hover)] flex items-center gap-3 text-left transition-colors"
                  >
                    <Package className="w-5 h-5 text-[var(--os-text-secondary)] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-[var(--os-text)] truncate">{app.name}</div>
                      <div className="text-[10px] text-[var(--os-text-muted)] truncate">{app.description}</div>
                    </div>
                  </button>
                ))}
                {searchResults.map((node) => (
                  <button
                    key={node.path}
                    onClick={() => {
                      onOpenNode(node);
                      setFlyout(null);
                    }}
                    className="w-full p-2 rounded-xl hover:bg-[var(--os-hover)] flex items-center gap-3 text-left transition-colors"
                  >
                    <FileIcon node={node} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-[var(--os-text)] truncate">{node.name}</div>
                      <div className="text-[10px] text-[var(--os-text-subtle)] truncate">{node.path}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <>
                {/* Core Apps Row */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => {
                      onOpenBrowser();
                      setFlyout(null);
                    }}
                    className="p-2.5 rounded-xl bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] border border-[var(--os-border)] flex flex-col items-center gap-1.5 text-center transition-colors"
                  >
                    {useFirefoxIcon ? <FirefoxLogoIcon size={32} /> : <ChromiumLogoIcon size={32} />}
                    <span className="text-[11px] font-medium text-[var(--os-text)] truncate w-full">
                      {primaryBrowserLabel}
                    </span>
                  </button>

                  <button
                    onClick={() => {
                      onOpenTerminal();
                      setFlyout(null);
                    }}
                    className="p-2.5 rounded-xl bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] border border-[var(--os-border)] flex flex-col items-center gap-1.5 text-center transition-colors"
                  >
                    <TerminalAppIcon size={32} />
                    <span className="text-[11px] font-medium text-[var(--os-text)]">Terminal</span>
                  </button>

                  <button
                    onClick={() => {
                      onOpenAppStore();
                      setFlyout(null);
                    }}
                    className="p-2.5 rounded-xl bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] border border-[var(--os-border)] flex flex-col items-center gap-1.5 text-center transition-colors"
                  >
                    <AppStoreIcon size={32} />
                    <span className="text-[11px] font-medium text-[var(--os-text)]">Uygulamalar</span>
                  </button>
                </div>

                {/* Installed Native Linux GUI Apps */}
                {linuxGuiReady && installedLinuxApps.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--os-text-subtle)] px-1">
                      Kurulu Linux Uygulamaları
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto">
                      {installedLinuxApps.map((app) => (
                        <button
                          key={app.id}
                          onClick={() => {
                            onLaunchLinuxApp(app);
                            setFlyout(null);
                          }}
                          className="p-2 rounded-xl bg-[var(--os-bg)] hover:bg-[var(--os-surface-3)] border border-[var(--os-border)] flex items-center gap-2 text-left transition-colors"
                        >
                          {app.iconName ? (
                            <img
                              src={buildAppIconUrl(app.iconName)}
                              alt=""
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = 'none';
                              }}
                              className="w-5 h-5 object-contain shrink-0"
                            />
                          ) : (
                            <Package className="w-4 h-4 text-[var(--os-text-muted)] shrink-0" />
                          )}
                          <span className="text-xs text-[var(--os-text)] truncate">{app.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { label: 'Disk', path: '/', icon: HardDrive },
                    { label: 'Masaüstü', path: '/Desktop', icon: Monitor },
                    { label: 'Belgeler', path: '/Documents', icon: Folder },
                    { label: 'İndirilenler', path: '/Downloads', icon: Folder },
                    { label: 'Projeler', path: '/Projects', icon: Folder },
                    { label: 'Çöp Kutusu', path: '/.trash', icon: Folder },
                  ].map((loc) => (
                    <button
                      key={loc.path}
                      onClick={() => {
                        onOpenFolder(loc.path);
                        setFlyout(null);
                      }}
                      className="p-2 rounded-xl bg-[var(--os-bg)] hover:bg-[var(--os-surface-3)] border border-[var(--os-border)] flex items-center gap-2 text-xs text-[var(--os-text-secondary)] transition-colors"
                    >
                      <loc.icon className="w-3.5 h-3.5 text-[var(--os-text-muted)] shrink-0" />
                      <span className="truncate">{loc.label}</span>
                    </button>
                  ))}
                </div>

                {recentFiles.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--os-text-subtle)] px-1">
                      Son Dosyalar
                    </div>
                    {recentFiles.map((f) => (
                      <button
                        key={f.path}
                        onClick={() => {
                          onOpenNode(f);
                          setFlyout(null);
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg hover:bg-[var(--os-hover)] flex items-center gap-2.5 text-left transition-colors"
                      >
                        <FileIcon node={f} size={22} />
                        <span className="text-xs text-[var(--os-text-secondary)] truncate flex-1">
                          {f.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="px-4 py-2.5 bg-[var(--os-sidebar)] border-t border-[var(--os-border)] flex items-center justify-between text-xs">
            <span className="text-[var(--os-text-muted)] font-medium truncate">
              TamgaVDesktop · {currentDesktop.name}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setFlyout(null);
                  onLockScreen();
                }}
                title="Kilitle"
                className="p-2 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-muted)] hover:text-[var(--os-text)] transition-colors"
              >
                <Lock className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setFlyout(null);
                  onReboot();
                }}
                title="Yenile"
                className="p-2 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-muted)] hover:text-[var(--os-text)] transition-colors"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
              {authEnabled && onLogout && (
                <button
                  onClick={() => {
                    setFlyout(null);
                    onLogout();
                  }}
                  title="Oturumu Kapat"
                  className="p-2 rounded-lg hover:bg-red-500/15 text-[var(--os-text-muted)] hover:text-red-500 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. INDEPENDENT VIRTUAL DESKTOPS SWITCHER */}
      {flyout === 'spaces' && (
        <div
          style={{ boxShadow: 'var(--os-shadow)' }}
          className="fixed bottom-20 left-16 z-[9980] w-80 max-w-[calc(100vw-32px)] rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] p-4 space-y-3.5 text-[var(--os-text)]"
        >
          <div>
            <div className="text-xs font-semibold text-[var(--os-text)]">Bağımsız Sanal Masaüstleri</div>
            <div className="text-[11px] text-[var(--os-text-muted)] mt-0.5">
              Her masaüstünün dosya sistemi, profilleri ve oturumları izoledir.
            </div>
          </div>

          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {desktops.map((d) => {
              const active = d.id === currentDesktop.id;
              return (
                <div
                  key={d.id}
                  className={`flex items-center justify-between p-2.5 rounded-xl border transition-colors ${
                    active
                      ? 'bg-[var(--os-surface-3)] border-[var(--os-border-strong)] text-[var(--os-text)]'
                      : 'bg-[var(--os-bg)] border-[var(--os-border)] text-[var(--os-text-secondary)] hover:bg-[var(--os-hover)]'
                  }`}
                >
                  <button
                    onClick={() => {
                      if (!active) onSwitchDesktop(d.id);
                      setFlyout(null);
                    }}
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="text-xs font-medium truncate">{d.name}</div>
                    <div className="text-[10px] text-[var(--os-text-subtle)] font-mono truncate">
                      ?desktop={d.id}
                    </div>
                  </button>

                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button
                      onClick={() => {
                        onCopyDesktopLink(d.id);
                        setCopiedId(d.id);
                        setTimeout(() => setCopiedId(null), 1500);
                      }}
                      title="Doğrudan masaüstü bağlantısını kopyala"
                      className="p-1.5 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-muted)] hover:text-[var(--os-text)] transition-colors"
                    >
                      {copiedId === d.id ? (
                        <Check className="w-3.5 h-3.5 text-[var(--os-text)]" />
                      ) : (
                        <Link2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {desktops.length > 1 && (
                      <button
                        onClick={() => onDeleteDesktop(d.id)}
                        title="Masaüstünü Sil"
                        className="p-1.5 rounded-lg hover:bg-red-500/15 text-[var(--os-text-subtle)] hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              onCreateDesktop(newDesktopName.trim() || undefined);
              setNewDesktopName('');
              setFlyout(null);
            }}
            className="flex items-center gap-1.5 pt-2 border-t border-[var(--os-border)]"
          >
            <input
              type="text"
              value={newDesktopName}
              onChange={(e) => setNewDesktopName(e.target.value)}
              placeholder="Yeni masaüstü adı..."
              className="flex-1 px-3 py-2 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)] focus:border-[var(--os-border-strong)] focus:outline-none text-xs text-[var(--os-text)] placeholder:text-[var(--os-text-subtle)]"
            />
            <button
              type="submit"
              className="px-3 py-2 rounded-xl bg-[var(--os-accent-bg)] hover:opacity-90 text-[var(--os-accent-fg)] text-xs font-semibold flex items-center gap-1 shrink-0 transition-opacity"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Oluştur</span>
            </button>
          </form>
        </div>
      )}

      {/* 3. CLEAN CONTROL CENTER */}
      {flyout === 'controls' && (
        <div
          style={{ boxShadow: 'var(--os-shadow)' }}
          className="fixed bottom-20 right-4 z-[9980] w-[356px] max-w-[calc(100vw-32px)] rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] p-4 space-y-4 text-[var(--os-text)]"
        >
          {/* Theme Switcher */}
          <div className="space-y-2">
            <div className="text-[11px] text-[var(--os-text-muted)]">Görünüm</div>
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)]">
              <button
                onClick={(e) => onToggleTheme('dark', getOriginFromEvent(e))}
                data-testid="theme-dark-btn"
                className={`py-2 px-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                  theme === 'dark'
                    ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] shadow-sm'
                    : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
                }`}
              >
                <Moon className="w-3.5 h-3.5" />
                <span>Koyu Tema</span>
              </button>
              <button
                onClick={(e) => onToggleTheme('light', getOriginFromEvent(e))}
                data-testid="theme-light-btn"
                className={`py-2 px-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                  theme === 'light'
                    ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] shadow-sm'
                    : 'text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
                }`}
              >
                <Sun className="w-3.5 h-3.5" />
                <span>Açık Tema</span>
              </button>
            </div>
          </div>

          <div className="space-y-3 pt-3 border-t border-[var(--os-border)]">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-[var(--os-text-muted)]">
                <span>Ses</span>
                <span className="font-mono">%{muted ? 0 : volume}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={onToggleMute}
                  className="p-1.5 rounded-lg bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] text-[var(--os-text)] transition-colors"
                >
                  {muted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-red-500" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={muted ? 0 : volume}
                  onChange={(e) => onChangeVolume(Number(e.target.value))}
                  style={{ accentColor: 'var(--os-accent-bg)' }}
                  className="flex-1"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-[var(--os-text-muted)]">
                <span>Ekran Parlaklığı</span>
                <span className="font-mono">%{brightness}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-[var(--os-surface-3)] text-[var(--os-text)]">
                  <Sun className="w-4 h-4" />
                </div>
                <input
                  type="range"
                  min={45}
                  max={100}
                  value={brightness}
                  onChange={(e) => onChangeBrightness(Number(e.target.value))}
                  style={{ accentColor: 'var(--os-accent-bg)' }}
                  className="flex-1"
                />
              </div>
            </div>
          </div>

          {/* Wallpaper Picker + Custom Image Upload */}
          <div className="space-y-2 pt-3 border-t border-[var(--os-border)]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[var(--os-text-muted)]">Arka Plan</span>
              <button
                onClick={() => onTriggerWallpaperUpload()}
                data-testid="wallpaper-upload-btn"
                className="text-[11px] font-medium text-[var(--os-text)] hover:opacity-80 flex items-center gap-1 transition-opacity"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                <span>Resim Seç...</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {WALLPAPERS.map((wp) => (
                <button
                  key={wp.id}
                  onClick={() => onSelectWallpaper(wp.id)}
                  className={`px-1.5 py-2 rounded-xl text-[11px] font-medium border transition-colors whitespace-nowrap ${
                    wallpaperId === wp.id
                      ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] border-transparent'
                      : 'bg-[var(--os-bg)] border-[var(--os-border)] text-[var(--os-text-secondary)] hover:bg-[var(--os-surface-3)]'
                  }`}
                >
                  {wp.name}
                </button>
              ))}
            </div>

            {customWallpaperUrl ? (
              <div className="flex items-center gap-1.5 pt-0.5">
                <button
                  onClick={() => onSelectWallpaper('custom')}
                  className={`flex-1 flex items-center gap-2.5 p-1.5 pr-3 rounded-xl border transition-all text-left ${
                    wallpaperId === 'custom'
                      ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] border-transparent'
                      : 'bg-[var(--os-bg)] border-[var(--os-border)] text-[var(--os-text-secondary)] hover:bg-[var(--os-surface-3)]'
                  }`}
                >
                  <img
                    src={customWallpaperUrl}
                    alt="Özel Arka Plan"
                    className="w-10 h-7 rounded-lg object-cover shrink-0 border border-black/15"
                  />
                  <span className="text-[11px] font-medium truncate">Özel Resim</span>
                </button>
                <button
                  onClick={() => onTriggerWallpaperUpload()}
                  title="Farklı Resim Seç"
                  className="px-2.5 py-2.5 rounded-xl bg-[var(--os-bg)] hover:bg-[var(--os-surface-3)] border border-[var(--os-border)] text-[var(--os-text-secondary)] transition-colors shrink-0"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => onTriggerWallpaperUpload()}
                className="w-full py-2 px-3 rounded-xl bg-[var(--os-bg)] hover:bg-[var(--os-surface-3)] border border-dashed border-[var(--os-border-strong)] text-[11px] font-medium text-[var(--os-text-secondary)] flex items-center justify-center gap-2 transition-colors"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                <span>Cihazdan Arka Plan Resmi Seç</span>
              </button>
            )}
          </div>

          <div className="pt-3 border-t border-[var(--os-border)] grid grid-cols-3 gap-2 text-[11px]">
            <div className="p-2 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)]">
              <div className="text-[var(--os-text-subtle)]">CPU</div>
              <div className="font-mono font-semibold text-[var(--os-text)] mt-0.5">
                %{telemetry?.cpuPercent ?? 6}
              </div>
            </div>
            <div className="p-2 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)]">
              <div className="text-[var(--os-text-subtle)]">Bellek</div>
              <div className="font-mono font-semibold text-[var(--os-text)] mt-0.5">
                %{telemetry?.ramPercent ?? 35}
              </div>
            </div>
            <div className="p-2 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)]">
              <div className="text-[var(--os-text-subtle)]">Gecikme</div>
              <div className="font-mono font-semibold text-[var(--os-text)] mt-0.5">{pingMs} ms</div>
            </div>
          </div>
          <div className="text-[10px] text-[var(--os-text-subtle)] flex justify-between">
            <span>Çalışma Süresi: {formatUptime(telemetry?.uptimeSeconds ?? 0)}</span>
            <span>{telemetry?.hostname || `${telemetry?.desktopsCount ?? 1} Masaüstü`}</span>
          </div>
        </div>
      )}

      {/* 4. NOTIFICATIONS */}
      {flyout === 'notifications' && (
        <div
          style={{ boxShadow: 'var(--os-shadow)' }}
          className="fixed bottom-20 right-4 z-[9980] w-80 max-w-[calc(100vw-32px)] rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] p-4 space-y-3 text-[var(--os-text)]"
        >
          <div className="flex items-center justify-between pb-2 border-b border-[var(--os-border)]">
            <span className="text-xs font-semibold">Bildirimler</span>
            {notificationHistory.length > 0 && (
              <button
                onClick={onClearNotifications}
                className="text-[11px] text-[var(--os-text-muted)] hover:text-[var(--os-text)] transition-colors"
              >
                Temizle
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto space-y-2">
            {notificationHistory.length === 0 ? (
              <div className="py-6 text-center text-xs text-[var(--os-text-subtle)]">Bildirim yok.</div>
            ) : (
              notificationHistory.map((item) => (
                <div
                  key={item.id}
                  className="p-2.5 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)] text-xs space-y-0.5"
                >
                  <div className="font-medium text-[var(--os-text)]">{item.title}</div>
                  <div className="text-[11px] text-[var(--os-text-muted)]">{item.message}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 5. CLOCK & CALENDAR */}
      {flyout === 'calendar' && (
        <div
          style={{ boxShadow: 'var(--os-shadow)' }}
          className="fixed bottom-20 right-4 z-[9980] w-76 max-w-[calc(100vw-32px)] rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] p-4 space-y-4 text-[var(--os-text)]"
        >
          <div className="pb-3 border-b border-[var(--os-border)]">
            <div className="text-3xl font-light font-mono tracking-tight text-[var(--os-text)]">
              {timeWithSec}
            </div>
            <div className="text-xs text-[var(--os-text-muted)] capitalize mt-1">{dateLong}</div>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold capitalize">
                {calCursor.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() =>
                    setCalCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
                  }
                  className="p-1 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)]"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCalCursor(new Date())}
                  className="px-2 py-0.5 rounded-md text-[10px] bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] text-[var(--os-text)]"
                >
                  Bugün
                </button>
                <button
                  onClick={() =>
                    setCalCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
                  }
                  className="p-1 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)]"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-[var(--os-text-subtle)] font-medium">
              {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((wd) => (
                <div key={wd}>{wd}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {calendarDays.map((cell, i) => (
                <div
                  key={i}
                  className={`h-8 rounded-lg flex items-center justify-center ${
                    !cell.day
                      ? ''
                      : cell.isToday
                      ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] font-bold'
                      : 'text-[var(--os-text-secondary)] hover:bg-[var(--os-hover)]'
                  }`}
                >
                  {cell.day || ''}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* FLOATING PADDED MACOS-STYLE BOTTOM BAR */}
      <div
        style={{ boxShadow: 'var(--os-dock-shadow)' }}
        className="fixed bottom-3 left-4 right-4 h-[54px] z-[9950] rounded-2xl bg-[var(--os-dock)] backdrop-blur-md border border-[var(--os-border-strong)] px-3 flex items-center justify-between gap-2"
      >
        {/* Left: Launcher + Spaces + Core Pinned Apps + Open Windows */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <button
            onClick={() => toggleFlyout('launcher')}
            data-testid="dock-launcher-btn"
            title="Menü"
            className={`h-10 w-10 rounded-xl flex items-center justify-center transition-colors shrink-0 ${
              flyout === 'launcher'
                ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)]'
                : 'hover:bg-[var(--os-hover)] text-[var(--os-text)]'
            }`}
          >
            <div className="grid grid-cols-2 gap-1">
              <span className="w-1.5 h-1.5 rounded-xs bg-current" />
              <span className="w-1.5 h-1.5 rounded-xs bg-current" />
              <span className="w-1.5 h-1.5 rounded-xs bg-current" />
              <span className="w-1.5 h-1.5 rounded-xs bg-current" />
            </div>
          </button>

          <button
            onClick={() => toggleFlyout('spaces')}
            title="Sanal Masaüstleri"
            className={`h-10 px-3 rounded-xl flex items-center gap-2 text-xs font-medium transition-colors shrink-0 ${
              flyout === 'spaces'
                ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)]'
                : 'bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] text-[var(--os-text)]'
            }`}
          >
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline max-w-[110px] truncate">{currentDesktop.name}</span>
          </button>

          <div className="h-5 w-[1px] bg-[var(--os-border-strong)] mx-1 shrink-0" />

          {/* Pinned Browser (Firefox on Linux / Chromium fallback) */}
          <button
            onClick={() => {
              if (browserWin) onToggleWindowFromTaskbar(browserWin.id);
              else onOpenBrowser();
            }}
            data-testid="dock-browser-btn"
            title={primaryBrowserLabel}
            className={`relative h-10 px-2.5 rounded-xl flex items-center gap-2 transition-colors shrink-0 ${
              browserWin && !browserWin.minimized && focusedWindowId === browserWin.id
                ? 'bg-[var(--os-active)] text-[var(--os-text)]'
                : 'hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)]'
            }`}
          >
            {useFirefoxIcon ? <FirefoxLogoIcon size={23} /> : <ChromiumLogoIcon size={23} />}
            <span className="text-xs font-medium hidden lg:inline">{primaryBrowserLabel}</span>
            {browserWin && (
              <span
                className={`absolute bottom-1 left-1/2 -translate-x-1/2 h-1 rounded-full ${
                  !browserWin.minimized && focusedWindowId === browserWin.id
                    ? 'w-4 bg-[var(--os-accent-bg)]'
                    : 'w-1.5 bg-[var(--os-text-subtle)]'
                }`}
              />
            )}
          </button>

          {/* Pinned Real Linux Terminal */}
          <button
            onClick={() => {
              if (terminalWin) onToggleWindowFromTaskbar(terminalWin.id);
              else onOpenTerminal();
            }}
            data-testid="dock-terminal-btn"
            title="Terminal"
            className={`relative h-10 px-2.5 rounded-xl flex items-center gap-2 transition-colors shrink-0 ${
              terminalWin && !terminalWin.minimized && focusedWindowId === terminalWin.id
                ? 'bg-[var(--os-active)] text-[var(--os-text)]'
                : 'hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)]'
            }`}
          >
            <TerminalAppIcon size={23} />
            <span className="text-xs font-medium hidden lg:inline">Terminal</span>
            {terminalWin && (
              <span
                className={`absolute bottom-1 left-1/2 -translate-x-1/2 h-1 rounded-full ${
                  !terminalWin.minimized && focusedWindowId === terminalWin.id
                    ? 'w-4 bg-[var(--os-accent-bg)]'
                    : 'w-1.5 bg-[var(--os-text-subtle)]'
                }`}
              />
            )}
          </button>

          {/* Pinned Linux App Manager */}
          <button
            onClick={() => {
              if (appStoreWin) onToggleWindowFromTaskbar(appStoreWin.id);
              else onOpenAppStore();
            }}
            data-testid="dock-apps-btn"
            title="Uygulamalar"
            className={`relative h-10 px-2.5 rounded-xl flex items-center gap-2 transition-colors shrink-0 ${
              appStoreWin && !appStoreWin.minimized && focusedWindowId === appStoreWin.id
                ? 'bg-[var(--os-active)] text-[var(--os-text)]'
                : 'hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)]'
            }`}
          >
            <AppStoreIcon size={23} />
            <span className="text-xs font-medium hidden xl:inline">Uygulamalar</span>
            {appStoreWin && (
              <span
                className={`absolute bottom-1 left-1/2 -translate-x-1/2 h-1 rounded-full ${
                  !appStoreWin.minimized && focusedWindowId === appStoreWin.id
                    ? 'w-4 bg-[var(--os-accent-bg)]'
                    : 'w-1.5 bg-[var(--os-text-subtle)]'
                }`}
              />
            )}
          </button>

          {/* Open Other Windows (Folders, Linux Apps, Properties) */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar min-w-0">
            {otherWindows.map((w) => {
              const active = !w.minimized && focusedWindowId === w.id;
              return (
                <button
                  key={w.id}
                  onClick={() => onToggleWindowFromTaskbar(w.id)}
                  className={`relative h-10 px-3 rounded-xl flex items-center gap-2 max-w-[165px] shrink-0 text-xs transition-colors ${
                    active
                      ? 'bg-[var(--os-active)] text-[var(--os-text)]'
                      : 'hover:bg-[var(--os-hover)] text-[var(--os-text-muted)] hover:text-[var(--os-text)]'
                  }`}
                >
                  {w.kind === 'terminal' ? (
                    <Terminal className="w-4 h-4 shrink-0" />
                  ) : w.kind === 'linux-app' || w.kind === 'vscode' ? (
                    <AppWindow className="w-4 h-4 shrink-0" />
                  ) : w.kind === 'app-store' ? (
                    <LayoutGrid className="w-4 h-4 shrink-0" />
                  ) : (
                    <Folder className="w-4 h-4 shrink-0" />
                  )}
                  <span className="truncate">{w.title}</span>
                  <span
                    className={`absolute bottom-1 left-1/2 -translate-x-1/2 h-1 rounded-full ${
                      active ? 'w-3.5 bg-[var(--os-accent-bg)]' : 'w-1.5 bg-[var(--os-text-subtle)]'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Quick Theme Toggle, Volume, Control Center, Notifications, Clock */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => onToggleTheme(theme === 'dark' ? 'light' : 'dark', getOriginFromEvent(e))}
            data-testid="dock-theme-toggle"
            title={theme === 'dark' ? 'Açık Temaya Geç' : 'Koyu Temaya Geç'}
            className="h-10 w-9 rounded-xl flex items-center justify-center hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)] hover:text-[var(--os-text)] transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            onClick={onToggleMute}
            title={muted ? 'Sesi Aç' : 'Sessize Al'}
            className="h-10 w-9 rounded-xl flex items-center justify-center hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)] hover:text-[var(--os-text)] transition-colors"
          >
            {muted || volume === 0 ? (
              <VolumeX className="w-4 h-4 text-red-500" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>

          <button
            onClick={() => toggleFlyout('controls')}
            data-testid="dock-controls-btn"
            title="Kontrol Merkezi"
            className={`h-10 px-2.5 rounded-xl flex items-center gap-2 text-xs transition-colors ${
              flyout === 'controls'
                ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)]'
                : 'hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)] hover:text-[var(--os-text)]'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>

          <button
            onClick={() => toggleFlyout('notifications')}
            title="Bildirimler"
            className={`relative h-10 w-9 rounded-xl flex items-center justify-center transition-colors ${
              flyout === 'notifications'
                ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)]'
                : 'hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)] hover:text-[var(--os-text)]'
            }`}
          >
            <Bell className="w-4 h-4" />
            {notificationHistory.length > 0 && (
              <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[var(--os-accent-bg)]" />
            )}
          </button>

          <button
            onClick={() => toggleFlyout('calendar')}
            title="Saat ve Takvim"
            className={`h-10 px-3 rounded-xl flex flex-col items-end justify-center leading-tight transition-colors ${
              flyout === 'calendar'
                ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)]'
                : 'hover:bg-[var(--os-hover)] text-[var(--os-text)]'
            }`}
          >
            <span className="text-xs font-semibold font-mono">{timeShort}</span>
            <span className="text-[10px] opacity-65 font-mono">{dateShort}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
