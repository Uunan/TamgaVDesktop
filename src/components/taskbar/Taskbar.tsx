import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppWindow,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Folder,
  Gauge,
  HardDrive,
  Layers,
  Link2,
  Lock,
  LogOut,
  Minimize2,
  Monitor,
  Moon,
  Play,
  Plus,
  RotateCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sun,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  type DockPreferences,
  type LinuxAppInfo,
  type OSWindow,
  type SettingsTabId,
  type TelemetryData,
  type ToastItem,
  type VFSNode,
  type VirtualDesktopInfo,
} from '../../types/os';
import {
  AppStoreIcon,
  FileIcon,
  FirefoxLogoIcon,
  GoogleChromeLogoIcon,
  OriginalAppIcon,
  SettingsAppIcon,
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
  theme: 'dark' | 'light';
  dock: DockPreferences;
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
  onToggleTheme: (nextTheme: 'dark' | 'light', origin?: { x: number; y: number }) => void;
  onClearNotifications: () => void;
  onOpenBrowser: (opts?: { forceNew?: boolean }) => void;
  onOpenTerminal: () => void;
  onOpenAppStore: () => void;
  onOpenSettings: (tab?: SettingsTabId) => void;
  onLaunchLinuxApp: (app: LinuxAppInfo, opts?: { forceNew?: boolean }) => void;
  onOpenFolder: (path: string) => void;
  onOpenNode: (node: VFSNode) => void;
  onToggleWindowFromTaskbar: (winId: string) => void;
  onCloseWindow: (winId: string) => void;
  onLockScreen: () => void;
  onReboot: () => void;
  onLogout?: () => void;
}

type ActiveFlyout = 'launcher' | 'controls' | 'notifications' | 'calendar' | null;

interface DockContextState {
  title: string;
  anchor: DOMRect;
  win?: OSWindow;
  onOpen?: () => void;
  onNewWindow?: () => void;
}

function getOriginFromEvent(e: React.MouseEvent<HTMLButtonElement>): { x: number; y: number } {
  if (e.clientX || e.clientY) {
    return { x: e.clientX, y: e.clientY };
  }
  const rect = e.currentTarget.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return { r: 24, g: 24, b: 27 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function resolveDockPalette(dock: DockPreferences, theme: 'dark' | 'light') {
  const presets: Record<string, string> = {
    auto: theme === 'dark' ? '#141418' : '#ffffff',
    dark: '#141418',
    light: '#f8fafc',
    obsidian: '#09090b',
    midnight: '#0f172a',
    emerald: '#06281e',
    amethyst: '#1e1136',
    custom: dock.customColor || '#18181b',
  };
  const hex = presets[dock.color] || presets.auto;
  const { r, g, b } = parseHexColor(hex);
  const alpha = Math.max(0.2, Math.min(1, (dock.opacity ?? 86) / 100));
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  const isLight = luminance > 160;

  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`,
    borderColor: isLight ? 'rgba(15, 23, 42, 0.14)' : 'rgba(255, 255, 255, 0.14)',
    color: isLight ? '#0f172a' : '#f4f4f5',
    mutedColor: isLight ? 'rgba(15, 23, 42, 0.62)' : 'rgba(244, 244, 245, 0.65)',
    hoverBg: isLight ? 'hover:bg-black/[0.07]' : 'hover:bg-white/[0.11]',
    activeBg: isLight ? 'bg-black/[0.11]' : 'bg-white/[0.15]',
    chipBg: isLight ? 'bg-black/[0.06] hover:bg-black/[0.10]' : 'bg-white/[0.08] hover:bg-white/[0.14]',
    dividerBg: isLight ? 'bg-black/15' : 'bg-white/15',
    indicatorActive: isLight ? '#0f172a' : '#ffffff',
    indicatorIdle: isLight ? 'rgba(15, 23, 42, 0.35)' : 'rgba(255, 255, 255, 0.45)',
    isLight,
  };
}

function computeAnchoredFlyoutStyle(
  anchor: DOMRect | null,
  dockPos: DockPreferences['position'],
  panelWidth: number,
  panelHeightEst: number
): React.CSSProperties {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const safe = 12;
  const gap = 12;
  const effectiveW = Math.min(panelWidth, vw - safe * 2);

  if (!anchor) {
    if (dockPos === 'top') return { top: 76, left: safe };
    if (dockPos === 'left') return { left: 76, top: safe };
    if (dockPos === 'right') return { right: 76, top: safe };
    return { bottom: 76, left: safe };
  }

  if (dockPos === 'top') {
    const center = anchor.left + anchor.width / 2;
    const left = Math.max(safe, Math.min(vw - effectiveW - safe, Math.round(center - effectiveW / 2)));
    return { top: Math.round(anchor.bottom + gap), left };
  }

  if (dockPos === 'left') {
    const center = anchor.top + anchor.height / 2;
    const top = Math.max(safe, Math.min(vh - panelHeightEst - safe, Math.round(center - panelHeightEst / 2)));
    return { left: Math.round(anchor.right + gap), top };
  }

  if (dockPos === 'right') {
    const center = anchor.top + anchor.height / 2;
    const top = Math.max(safe, Math.min(vh - panelHeightEst - safe, Math.round(center - panelHeightEst / 2)));
    return { right: Math.round(vw - anchor.left + gap), top };
  }

  // bottom (default)
  const center = anchor.left + anchor.width / 2;
  const left = Math.max(safe, Math.min(vw - effectiveW - safe, Math.round(center - effectiveW / 2)));
  return { bottom: Math.round(vh - anchor.top + gap), left };
}

/* Smooth macOS cosine-wave Dock icon magnifier that expands layout spacing so the Dock container itself breathes & stretches smoothly */
const DockMagnifySlot: React.FC<{
  enabled: boolean;
  maxScale: number;
  pointer: { x: number; y: number } | null;
  pos: DockPreferences['position'];
  children: React.ReactNode;
}> = ({ enabled, maxScale, pointer, pos, children }) => {
  const slotRef = useRef<HTMLDivElement>(null);
  const baseMetricsRef = useRef<{ center: number; size: number } | null>(null);
  const isVert = pos === 'left' || pos === 'right';

  if (!pointer || !enabled) {
    baseMetricsRef.current = null;
  } else if (!baseMetricsRef.current && slotRef.current) {
    const rect = slotRef.current.getBoundingClientRect();
    baseMetricsRef.current = {
      center: isVert ? rect.top + rect.height / 2 : rect.left + rect.width / 2,
      size: isVert ? rect.height : rect.width,
    };
  }

  let scale = 1;
  let lift = 0;
  let extraMargin = 0;

  if (enabled && pointer && baseMetricsRef.current) {
    const { center, size } = baseMetricsRef.current;
    const cursor = isVert ? pointer.y : pointer.x;
    const dist = Math.abs(cursor - center);
    const radius = 128;
    if (dist < radius) {
      const influence = Math.cos((dist / radius) * (Math.PI / 2));
      const clampedMax = Math.max(1.05, Math.min(2, maxScale));
      scale = 1 + (clampedMax - 1) * influence;
      lift = (scale - 1) * 14;
      extraMargin = Number((((scale - 1) * Math.max(32, Math.min(size, 64))) * 0.46).toFixed(1));
    }
  }

  const transformOrigin =
    pos === 'top'
      ? 'center top'
      : pos === 'left'
      ? 'left center'
      : pos === 'right'
      ? 'right center'
      : 'center bottom';

  const transform =
    scale > 1.005
      ? pos === 'top'
        ? `translateY(${lift.toFixed(1)}px) scale(${scale.toFixed(3)})`
        : pos === 'left'
        ? `translateX(${lift.toFixed(1)}px) scale(${scale.toFixed(3)})`
        : pos === 'right'
        ? `translateX(-${lift.toFixed(1)}px) scale(${scale.toFixed(3)})`
        : `translateY(-${lift.toFixed(1)}px) scale(${scale.toFixed(3)})`
      : 'translate(0, 0) scale(1)';

  return (
    <div
      ref={slotRef}
      style={{
        transform,
        transformOrigin,
        marginLeft: !isVert ? `${extraMargin}px` : undefined,
        marginRight: !isVert ? `${extraMargin}px` : undefined,
        marginTop: isVert ? `${extraMargin}px` : undefined,
        marginBottom: isVert ? `${extraMargin}px` : undefined,
        transition:
          'transform 115ms cubic-bezier(0.22, 1, 0.36, 1), margin 115ms cubic-bezier(0.22, 1, 0.36, 1)',
        zIndex: scale > 1.08 ? 20 : 1,
      }}
      className="relative shrink-0 will-change-transform"
    >
      {children}
    </div>
  );
};

const DockAppIcon: React.FC<{ win: OSWindow; size: number }> = ({ win, size }) => {
  if (win.kind === 'browser' || (win.kind === 'linux-app' && win.appId === 'chrome')) {
    return <GoogleChromeLogoIcon size={size} />;
  }
  if (win.kind === 'terminal') {
    if (win.appId) {
      return (
        <OriginalAppIcon
          appId={win.appId}
          iconName={win.appIconName || win.appId}
          name={win.title}
          size={size}
        />
      );
    }
    return <TerminalAppIcon size={size} />;
  }
  if (win.kind === 'app-store') return <AppStoreIcon size={size} />;
  if (win.kind === 'settings') return <SettingsAppIcon size={size} />;
  if (win.kind === 'preview') {
    return <Eye style={{ width: size - 4, height: size - 4 }} className="shrink-0 text-sky-400" />;
  }
  if (win.kind === 'folder') {
    return <Folder style={{ width: size - 4, height: size - 4 }} className="shrink-0" />;
  }
  if (win.kind === 'vscode') {
    return <OriginalAppIcon appId="vscode" iconName="vscode" name={win.title} size={size} />;
  }
  if (win.kind === 'linux-app') {
    return (
      <OriginalAppIcon
        appId={win.appId}
        iconName={win.appIconName || win.appId}
        name={win.title}
        size={size}
      />
    );
  }
  return <AppWindow style={{ width: size - 4, height: size - 4 }} className="shrink-0" />;
};

export const Taskbar: React.FC<TaskbarProps> = ({
  windows,
  focusedWindowId,
  allNodes,
  telemetry,
  pingMs,
  notificationHistory,
  theme,
  dock,
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
  onToggleTheme,
  onClearNotifications,
  onOpenBrowser,
  onOpenTerminal,
  onOpenAppStore,
  onOpenSettings,
  onLaunchLinuxApp,
  onOpenFolder,
  onOpenNode,
  onToggleWindowFromTaskbar,
  onCloseWindow,
  onLockScreen,
  onReboot,
  onLogout,
}) => {
  const [flyout, setFlyout] = useState<ActiveFlyout>(null);
  const [flyoutAnchor, setFlyoutAnchor] = useState<DOMRect | null>(null);
  const [dockCtx, setDockCtx] = useState<DockContextState | null>(null);
  const [dockPointer, setDockPointer] = useState<{ x: number; y: number } | null>(null);

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
        setDockCtx(null);
      }
    };
    window.addEventListener('pointerdown', handleDown);
    return () => window.removeEventListener('pointerdown', handleDown);
  }, []);

  const toggleFlyout = (target: ActiveFlyout, e: React.MouseEvent<HTMLButtonElement>) => {
    setDockCtx(null);
    const rect = e.currentTarget.getBoundingClientRect();
    setFlyoutAnchor(rect);
    setFlyout((prev) => (prev === target ? null : target));
  };

  const openDockContext = (
    e: React.MouseEvent<HTMLButtonElement>,
    payload: Omit<DockContextState, 'anchor'>
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setFlyout(null);
    setDockCtx({
      ...payload,
      anchor: e.currentTarget.getBoundingClientRect(),
    });
  };

  const installedLinuxApps = useMemo(
    () => linuxApps.filter((a) => a.installed),
    [linuxApps]
  );

  const secondaryLinuxApps = useMemo(
    () => installedLinuxApps.filter((a) => a.id !== 'chrome'),
    [installedLinuxApps]
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
    (w) => (w.kind === 'linux-app' && w.appId === 'chrome') || w.kind === 'browser'
  );
  const terminalWin = windows.find((w) => w.kind === 'terminal' && !w.appId);
  const appStoreWin = windows.find((w) => w.kind === 'app-store');
  const otherWindows = windows.filter(
    (w) =>
      w.id !== browserWin?.id &&
      w.id !== terminalWin?.id &&
      w.id !== appStoreWin?.id
  );

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

  // Dock layout calculations
  const pos = dock.position || 'bottom';
  const styleMode = dock.style || 'floating';
  const sizeMode = dock.size || 'md';
  const isVertical = pos === 'left' || pos === 'right';
  const isCompactDock = styleMode === 'macos' || styleMode === 'minimal';
  const showTextLabels = !isVertical && Boolean(dock.showLabels) && styleMode !== 'minimal';
  const magEnabled = dock.magnification ?? true;
  const magScale = dock.magnificationScale ?? 1.45;

  const palette = useMemo(() => resolveDockPalette(dock, theme), [dock, theme]);

  const flyoutAnimClass =
    pos === 'top'
      ? 'flyout-pop-down'
      : pos === 'left'
      ? 'flyout-pop-right'
      : pos === 'right'
      ? 'flyout-pop-left'
      : 'flyout-pop-up';

  const sizeTokens = useMemo(() => {
    if (sizeMode === 'sm') {
      return {
        icon: 19,
        btnSize: 'h-8 w-8',
        btnPill: 'h-8 px-2',
        barThickH: 'h-[46px]',
        barThickW: 'w-[50px]',
        pad: isVertical ? 'py-2 px-1.5' : 'px-2 py-1',
      };
    }
    if (sizeMode === 'lg') {
      return {
        icon: 27,
        btnSize: 'h-12 w-12',
        btnPill: 'h-12 px-3',
        barThickH: 'h-[64px]',
        barThickW: 'w-[68px]',
        pad: isVertical ? 'py-3 px-2' : 'px-3.5 py-1.5',
      };
    }
    return {
      icon: 23,
      btnSize: 'h-10 w-10',
      btnPill: 'h-10 px-2.5',
      barThickH: 'h-[54px]',
      barThickW: 'w-[58px]',
      pad: isVertical ? 'py-2.5 px-1.5' : 'px-3 py-1',
    };
  }, [sizeMode, isVertical]);

  const dockContainerClass = useMemo(() => {
    const base = 'fixed z-[9950] border transition-all duration-300 flex items-center gap-1.5';
    const dir = isVertical ? 'flex-col justify-between' : 'flex-row justify-between';

    if (styleMode === 'full') {
      if (pos === 'top') return `${base} ${dir} top-0 left-0 right-0 ${sizeTokens.barThickH} ${sizeTokens.pad} rounded-none border-t-0 border-x-0`;
      if (pos === 'left') return `${base} ${dir} left-0 top-0 bottom-0 ${sizeTokens.barThickW} ${sizeTokens.pad} rounded-none border-l-0 border-y-0`;
      if (pos === 'right') return `${base} ${dir} right-0 top-0 bottom-0 ${sizeTokens.barThickW} ${sizeTokens.pad} rounded-none border-r-0 border-y-0`;
      return `${base} ${dir} bottom-0 left-0 right-0 ${sizeTokens.barThickH} ${sizeTokens.pad} rounded-none border-b-0 border-x-0`;
    }

    if (styleMode === 'macos' || styleMode === 'minimal') {
      const radius = styleMode === 'minimal' ? 'rounded-full' : 'rounded-[22px]';
      if (pos === 'top') {
        const edge = styleMode === 'minimal' ? 'top-2.5' : 'top-3';
        return `${base} ${dir} ${edge} left-1/2 -translate-x-1/2 max-w-[calc(100vw-24px)] ${sizeTokens.barThickH} ${sizeTokens.pad} ${radius}`;
      }
      if (pos === 'left') {
        const edge = styleMode === 'minimal' ? 'left-2.5' : 'left-3';
        return `${base} ${dir} ${edge} top-1/2 -translate-y-1/2 max-h-[calc(100vh-24px)] ${sizeTokens.barThickW} ${sizeTokens.pad} ${radius}`;
      }
      if (pos === 'right') {
        const edge = styleMode === 'minimal' ? 'right-2.5' : 'right-3';
        return `${base} ${dir} ${edge} top-1/2 -translate-y-1/2 max-h-[calc(100vh-24px)] ${sizeTokens.barThickW} ${sizeTokens.pad} ${radius}`;
      }
      const edge = styleMode === 'minimal' ? 'bottom-2.5' : 'bottom-3';
      return `${base} ${dir} ${edge} left-1/2 -translate-x-1/2 max-w-[calc(100vw-24px)] ${sizeTokens.barThickH} ${sizeTokens.pad} ${radius}`;
    }

    // Default: floating full-width inset bar
    if (pos === 'top') return `${base} ${dir} top-3 left-4 right-4 ${sizeTokens.barThickH} ${sizeTokens.pad} rounded-2xl`;
    if (pos === 'left') return `${base} ${dir} left-3 top-4 bottom-4 ${sizeTokens.barThickW} ${sizeTokens.pad} rounded-2xl`;
    if (pos === 'right') return `${base} ${dir} right-3 top-4 bottom-4 ${sizeTokens.barThickW} ${sizeTokens.pad} rounded-2xl`;
    return `${base} ${dir} bottom-3 left-4 right-4 ${sizeTokens.barThickH} ${sizeTokens.pad} rounded-2xl`;
  }, [pos, styleMode, isVertical, sizeTokens]);

  const renderIndicator = (active: boolean, launching?: boolean) => {
    const color = active || launching ? palette.indicatorActive : palette.indicatorIdle;
    if (pos === 'left') {
      return (
        <span
          style={{ backgroundColor: color }}
          className={`absolute left-0.5 top-1/2 -translate-y-1/2 w-1 rounded-full transition-all ${
            launching ? 'h-2.5 animate-pulse' : active ? 'h-4' : 'h-1.5'
          }`}
        />
      );
    }
    if (pos === 'right') {
      return (
        <span
          style={{ backgroundColor: color }}
          className={`absolute right-0.5 top-1/2 -translate-y-1/2 w-1 rounded-full transition-all ${
            launching ? 'h-2.5 animate-pulse' : active ? 'h-4' : 'h-1.5'
          }`}
        />
      );
    }
    if (pos === 'top') {
      return (
        <span
          style={{ backgroundColor: color }}
          className={`absolute top-0.5 left-1/2 -translate-x-1/2 h-1 rounded-full transition-all ${
            launching ? 'w-2.5 animate-pulse' : active ? 'w-4' : 'w-1.5'
          }`}
        />
      );
    }
    return (
      <span
        style={{ backgroundColor: color }}
        className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 h-1 rounded-full transition-all ${
          launching ? 'w-2.5 animate-pulse' : active ? 'w-4' : 'w-1.5'
        }`}
      />
    );
  };

  const dockHoverExpand = magEnabled && Boolean(dockPointer);
  const dockStyleObj: React.CSSProperties = {
    backgroundColor: palette.backgroundColor,
    borderColor: palette.borderColor,
    color: palette.color,
    backdropFilter: `blur(${dock.blur ?? 18}px)`,
    WebkitBackdropFilter: `blur(${dock.blur ?? 18}px)`,
    boxShadow: styleMode === 'full' ? 'none' : 'var(--os-dock-shadow)',
    paddingLeft: !isVertical && dockHoverExpand ? '18px' : undefined,
    paddingRight: !isVertical && dockHoverExpand ? '18px' : undefined,
    paddingTop: isVertical && dockHoverExpand ? '16px' : undefined,
    paddingBottom: isVertical && dockHoverExpand ? '16px' : undefined,
    transition:
      'padding 130ms cubic-bezier(0.22, 1, 0.36, 1), background-color 220ms ease, border-color 220ms ease',
  };

  const btnShapeClass = styleMode === 'minimal' ? 'rounded-full' : 'rounded-xl';

  return (
    <div ref={containerRef} className="select-none">
      {/* 0. DOCK RIGHT-CLICK CONTEXT MENU — Animated & anchored right above the clicked Dock icon */}
      {dockCtx && (
        <div
          key={`dock-ctx-${dockCtx.title}`}
          data-testid="dock-context-menu"
          style={{
            ...computeAnchoredFlyoutStyle(dockCtx.anchor, pos, 200, 150),
            boxShadow: 'var(--os-shadow)',
          }}
          className={`fixed z-[9990] w-50 rounded-2xl bg-[var(--os-surface-2)]/95 backdrop-blur-xl border border-[var(--os-border-strong)] p-1.5 text-xs text-[var(--os-text)] ${flyoutAnimClass}`}
        >
          <div className="px-2.5 py-1.5 text-[11px] font-semibold text-[var(--os-text-muted)] truncate border-b border-[var(--os-border)] mb-1">
            {dockCtx.title}
          </div>

          {dockCtx.win ? (
            <>
              <button
                onClick={() => {
                  onToggleWindowFromTaskbar(dockCtx.win!.id);
                  setDockCtx(null);
                }}
                className="w-full px-2.5 py-2 rounded-xl hover:bg-[var(--os-hover)] flex items-center gap-2 text-left transition-colors"
              >
                <Minimize2 className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                <span>
                  {dockCtx.win.minimized || focusedWindowId !== dockCtx.win.id
                    ? 'Öne Getir'
                    : 'Küçült'}
                </span>
              </button>

              {dockCtx.onNewWindow && (
                <button
                  onClick={() => {
                    dockCtx.onNewWindow?.();
                    setDockCtx(null);
                  }}
                  className="w-full px-2.5 py-2 rounded-xl hover:bg-[var(--os-hover)] flex items-center gap-2 text-left transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                  <span>Yeni Pencere</span>
                </button>
              )}

              <div className="my-1 border-t border-[var(--os-border)]" />

              <button
                onClick={() => {
                  onCloseWindow(dockCtx.win!.id);
                  setDockCtx(null);
                }}
                data-testid="dock-ctx-close"
                className="w-full px-2.5 py-2 rounded-xl hover:bg-red-500/15 text-red-400 flex items-center gap-2 text-left font-medium transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                <span>Kapat</span>
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                dockCtx.onOpen?.();
                setDockCtx(null);
              }}
              className="w-full px-2.5 py-2 rounded-xl hover:bg-[var(--os-hover)] flex items-center gap-2 text-left transition-colors"
            >
              <Play className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
              <span>Aç</span>
            </button>
          )}
        </div>
      )}

      {/* 1. LAUNCHER MENU — Anchored directly to Launcher button with spring pop */}
      {flyout === 'launcher' && (
        <div
          key="flyout-launcher"
          data-testid="flyout-launcher"
          style={{
            ...computeAnchoredFlyoutStyle(flyoutAnchor, pos, 390, 480),
            boxShadow: 'var(--os-shadow)',
          }}
          className={`fixed z-[9980] w-[390px] max-w-[calc(100vw-24px)] rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] overflow-hidden text-[var(--os-text)] ${flyoutAnimClass}`}
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
                {'terminal bash shell konsol uç birim'.includes(startSearch.toLowerCase()) && (
                  <button
                    onClick={() => {
                      onOpenTerminal();
                      setFlyout(null);
                    }}
                    className="w-full p-2.5 rounded-xl hover:bg-[var(--os-hover)] flex items-center gap-3 text-left transition-colors"
                  >
                    <TerminalAppIcon size={28} />
                    <div>
                      <div className="text-xs font-medium text-[var(--os-text)]">Uç Birim</div>
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
                    <OriginalAppIcon
                      appId={app.id}
                      iconName={app.iconName}
                      name={app.name}
                      accent={app.accent}
                      size={24}
                    />
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
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => {
                      onOpenBrowser();
                      setFlyout(null);
                    }}
                    className="p-2.5 rounded-xl bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] border border-[var(--os-border)] flex flex-col items-center gap-1.5 text-center transition-colors"
                  >
                    {useFirefoxIcon ? (
                      <FirefoxLogoIcon size={32} />
                    ) : (
                      <GoogleChromeLogoIcon size={32} />
                    )}
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
                    <span className="text-[11px] font-medium text-[var(--os-text)]">Uç Birim</span>
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

                {linuxGuiReady && secondaryLinuxApps.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--os-text-subtle)] px-1">
                      Kurulu Uygulamalar
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto">
                      {secondaryLinuxApps.map((app) => (
                        <button
                          key={app.id}
                          onClick={() => {
                            onLaunchLinuxApp(app);
                            setFlyout(null);
                          }}
                          className="p-2 rounded-xl bg-[var(--os-bg)] hover:bg-[var(--os-surface-3)] border border-[var(--os-border)] flex items-center gap-2 text-left transition-colors"
                        >
                          <OriginalAppIcon
                            appId={app.id}
                            iconName={app.iconName}
                            name={app.name}
                            accent={app.accent}
                            size={20}
                          />
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

      {/* 2. CLEAN CONTROL CENTER — Includes Settings, Stream, Theme, Virtual Desktops, Audio, Brightness, Telemetry */}
      {flyout === 'controls' && (
        <div
          key="flyout-controls"
          data-testid="flyout-controls"
          style={{
            ...computeAnchoredFlyoutStyle(flyoutAnchor, pos, 344, 490),
            boxShadow: 'var(--os-shadow)',
          }}
          className={`fixed z-[9980] w-[344px] max-w-[calc(100vw-24px)] rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] p-4 space-y-3.5 text-[var(--os-text)] ${flyoutAnimClass}`}
        >
          {/* Quick Settings Entry Row */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => {
                onOpenSettings('dock');
                setFlyout(null);
              }}
              data-testid="control-center-settings-btn"
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[var(--os-bg)] hover:bg-[var(--os-surface-3)] border border-[var(--os-border)] transition-colors text-left"
            >
              <Settings className="w-4 h-4 text-[var(--os-text)] shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[var(--os-text)] truncate">Sistem Ayarları</div>
                <div className="text-[10px] text-[var(--os-text-subtle)] truncate">Dock, Tema, Sistem</div>
              </div>
            </button>
            <button
              onClick={() => {
                onOpenSettings('stream');
                setFlyout(null);
              }}
              data-testid="control-center-stream-btn"
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[var(--os-bg)] hover:bg-[var(--os-surface-3)] border border-[var(--os-border)] transition-colors text-left"
            >
              <Gauge className="w-4 h-4 text-emerald-500 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[var(--os-text)] truncate">Akış & Kalite</div>
                <div className="text-[10px] text-[var(--os-text-subtle)] truncate">30 FPS & Netlik</div>
              </div>
            </button>
          </div>

          {/* Theme Switcher */}
          <div className="space-y-1.5 pt-2.5 border-t border-[var(--os-border)]">
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
                <span>Koyu</span>
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
                <span>Açık</span>
              </button>
            </div>
          </div>

          {/* Virtual Desktops Switcher (moved cleanly into Control Center!) */}
          <div data-testid="control-center-spaces" className="space-y-2 pt-2.5 border-t border-[var(--os-border)]">
            <div className="flex items-center justify-between text-[11px] text-[var(--os-text-muted)]">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                <span>Sanal Masaüstleri</span>
              </span>
              <span className="font-mono text-[10px]">{desktops.length}</span>
            </div>

            <div className="space-y-1 max-h-28 overflow-y-auto">
              {desktops.map((d) => {
                const active = d.id === currentDesktop.id;
                return (
                  <div
                    key={d.id}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl border transition-colors ${
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
                      className="flex-1 text-left min-w-0 text-xs font-medium truncate"
                    >
                      {d.name}
                    </button>
                    <div className="flex items-center gap-0.5 shrink-0 ml-1">
                      <button
                        onClick={() => {
                          onCopyDesktopLink(d.id);
                          setCopiedId(d.id);
                          setTimeout(() => setCopiedId(null), 1500);
                        }}
                        title="Bağlantıyı kopyala"
                        className="p-1 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-muted)] hover:text-[var(--os-text)]"
                      >
                        {copiedId === d.id ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          <Link2 className="w-3 h-3" />
                        )}
                      </button>
                      {desktops.length > 1 && (
                        <button
                          onClick={() => onDeleteDesktop(d.id)}
                          title="Masaüstünü Sil"
                          className="p-1 rounded-lg hover:bg-red-500/15 text-[var(--os-text-subtle)] hover:text-red-500"
                        >
                          <Trash2 className="w-3 h-3" />
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
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                value={newDesktopName}
                onChange={(e) => setNewDesktopName(e.target.value)}
                placeholder="Yeni masaüstü..."
                className="flex-1 px-2.5 py-1.5 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)] focus:border-[var(--os-border-strong)] focus:outline-none text-[11px] text-[var(--os-text)] placeholder:text-[var(--os-text-subtle)]"
              />
              <button
                type="submit"
                className="px-2.5 py-1.5 rounded-xl bg-[var(--os-accent-bg)] hover:opacity-90 text-[var(--os-accent-fg)] text-[11px] font-semibold flex items-center gap-1 shrink-0"
              >
                <Plus className="w-3 h-3" />
                <span>Ekle</span>
              </button>
            </form>
          </div>

          {/* Audio & Brightness */}
          <div className="space-y-2.5 pt-2.5 border-t border-[var(--os-border)]">
            <div className="space-y-1">
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

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-[var(--os-text-muted)]">
                <span>Parlaklık</span>
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

          {/* System Telemetry Strip */}
          <div className="pt-2.5 border-t border-[var(--os-border)] grid grid-cols-3 gap-2 text-[11px]">
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

      {/* 3. NOTIFICATIONS — Anchored to Notifications button */}
      {flyout === 'notifications' && (
        <div
          key="flyout-notifications"
          data-testid="flyout-notifications"
          style={{
            ...computeAnchoredFlyoutStyle(flyoutAnchor, pos, 320, 260),
            boxShadow: 'var(--os-shadow)',
          }}
          className={`fixed z-[9980] w-80 max-w-[calc(100vw-24px)] rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] p-4 space-y-3 text-[var(--os-text)] ${flyoutAnimClass}`}
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

      {/* 4. CLOCK & CALENDAR — Anchored to Clock button */}
      {flyout === 'calendar' && (
        <div
          key="flyout-calendar"
          data-testid="flyout-calendar"
          style={{
            ...computeAnchoredFlyoutStyle(flyoutAnchor, pos, 304, 380),
            boxShadow: 'var(--os-shadow)',
          }}
          className={`fixed z-[9980] w-76 max-w-[calc(100vw-24px)] rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] p-4 space-y-4 text-[var(--os-text)] ${flyoutAnimClass}`}
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

      {/* CUSTOMIZABLE DOCK / PANEL WITH MACOS MAGNIFICATION & RIGHT-CLICK MENU */}
      <div
        data-testid="dock-bar"
        data-dock-position={pos}
        data-dock-style={styleMode}
        data-dock-magnification={magEnabled ? 'true' : 'false'}
        style={dockStyleObj}
        onPointerMove={(e) => {
          if (magEnabled) setDockPointer({ x: e.clientX, y: e.clientY });
        }}
        onPointerLeave={() => setDockPointer(null)}
        className={dockContainerClass}
      >
        {/* Start Section: Launcher + Core Pinned Apps + Running Windows */}
        <div
          className={`flex items-center gap-1 min-w-0 ${
            isVertical
              ? 'flex-col flex-1'
              : isCompactDock
              ? 'flex-row'
              : 'flex-row flex-1'
          }`}
        >
          <DockMagnifySlot enabled={magEnabled} maxScale={magScale} pointer={dockPointer} pos={pos}>
            <button
              onClick={(e) => toggleFlyout('launcher', e)}
              data-testid="dock-launcher-btn"
              title="Menü"
              className={`${sizeTokens.btnSize} ${btnShapeClass} flex items-center justify-center transition-colors shrink-0 ${
                flyout === 'launcher' ? palette.activeBg : palette.hoverBg
              }`}
            >
              <div className="grid grid-cols-2 gap-1">
                <span className="w-1.5 h-1.5 rounded-xs bg-current" />
                <span className="w-1.5 h-1.5 rounded-xs bg-current" />
                <span className="w-1.5 h-1.5 rounded-xs bg-current" />
                <span className="w-1.5 h-1.5 rounded-xs bg-current" />
              </div>
            </button>
          </DockMagnifySlot>

          <div
            className={`${
              isVertical ? 'w-5 h-[1px] my-1' : 'h-5 w-[1px] mx-1'
            } ${palette.dividerBg} shrink-0`}
          />

          {/* Pinned Default Browser: Google Chrome */}
          <DockMagnifySlot enabled={magEnabled} maxScale={magScale} pointer={dockPointer} pos={pos}>
            <button
              onClick={() => {
                if (browserWin) onToggleWindowFromTaskbar(browserWin.id);
                else onOpenBrowser();
              }}
              onContextMenu={(e) =>
                openDockContext(e, {
                  title: primaryBrowserLabel,
                  win: browserWin,
                  onOpen: () => onOpenBrowser(),
                  onNewWindow: () => onOpenBrowser({ forceNew: true }),
                })
              }
              data-testid="dock-browser-btn"
              data-launching={browserWin?.launching ? 'true' : 'false'}
              title={browserWin?.launching ? `${primaryBrowserLabel} açılıyor...` : primaryBrowserLabel}
              className={`relative ${
                showTextLabels && !isCompactDock ? sizeTokens.btnPill : sizeTokens.btnSize
              } ${btnShapeClass} flex items-center justify-center gap-2 transition-colors shrink-0 ${
                browserWin && !browserWin.minimized && focusedWindowId === browserWin.id && !browserWin.launching
                  ? palette.activeBg
                  : palette.hoverBg
              }`}
            >
              <span
                className={`inline-flex items-center justify-center ${
                  browserWin?.launching
                    ? isVertical
                      ? 'dock-bounce-x'
                      : 'dock-bounce-y'
                    : ''
                }`}
              >
                {useFirefoxIcon ? (
                  <FirefoxLogoIcon size={sizeTokens.icon} />
                ) : (
                  <GoogleChromeLogoIcon size={sizeTokens.icon} />
                )}
              </span>
              {showTextLabels && !isCompactDock && (
                <span className="text-xs font-medium hidden lg:inline">{primaryBrowserLabel}</span>
              )}
              {browserWin &&
                renderIndicator(
                  !browserWin.minimized && focusedWindowId === browserWin.id && !browserWin.launching,
                  Boolean(browserWin.launching)
                )}
            </button>
          </DockMagnifySlot>

          {/* Pinned Real Linux Terminal */}
          <DockMagnifySlot enabled={magEnabled} maxScale={magScale} pointer={dockPointer} pos={pos}>
            <button
              onClick={() => {
                if (terminalWin) onToggleWindowFromTaskbar(terminalWin.id);
                else onOpenTerminal();
              }}
              onContextMenu={(e) =>
                openDockContext(e, {
                  title: 'Uç Birim',
                  win: terminalWin,
                  onOpen: onOpenTerminal,
                  onNewWindow: onOpenTerminal,
                })
              }
              data-testid="dock-terminal-btn"
              title="Uç Birim"
              className={`relative ${
                showTextLabels && !isCompactDock ? sizeTokens.btnPill : sizeTokens.btnSize
              } ${btnShapeClass} flex items-center justify-center gap-2 transition-colors shrink-0 ${
                terminalWin && !terminalWin.minimized && focusedWindowId === terminalWin.id
                  ? palette.activeBg
                  : palette.hoverBg
              }`}
            >
              <TerminalAppIcon size={sizeTokens.icon} />
              {showTextLabels && !isCompactDock && (
                <span className="text-xs font-medium hidden lg:inline">Uç Birim</span>
              )}
              {terminalWin &&
                renderIndicator(!terminalWin.minimized && focusedWindowId === terminalWin.id)}
            </button>
          </DockMagnifySlot>

          {/* Pinned Linux App Store */}
          <DockMagnifySlot enabled={magEnabled} maxScale={magScale} pointer={dockPointer} pos={pos}>
            <button
              onClick={() => {
                if (appStoreWin) onToggleWindowFromTaskbar(appStoreWin.id);
                else onOpenAppStore();
              }}
              onContextMenu={(e) =>
                openDockContext(e, {
                  title: 'Uygulamalar',
                  win: appStoreWin,
                  onOpen: onOpenAppStore,
                })
              }
              data-testid="dock-apps-btn"
              title="Uygulamalar"
              className={`relative ${
                showTextLabels && !isCompactDock ? sizeTokens.btnPill : sizeTokens.btnSize
              } ${btnShapeClass} flex items-center justify-center gap-2 transition-colors shrink-0 ${
                appStoreWin && !appStoreWin.minimized && focusedWindowId === appStoreWin.id
                  ? palette.activeBg
                  : palette.hoverBg
              }`}
            >
              <AppStoreIcon size={sizeTokens.icon} />
              {showTextLabels && !isCompactDock && (
                <span className="text-xs font-medium hidden xl:inline">Uygulamalar</span>
              )}
              {appStoreWin &&
                renderIndicator(!appStoreWin.minimized && focusedWindowId === appStoreWin.id)}
            </button>
          </DockMagnifySlot>

          {/* Open Other Windows (Linux Apps w/ macOS Launch Bounce, Folders, Preview, Settings) */}
          {otherWindows.length > 0 && (
            <div
              className={`flex items-center gap-1 min-w-0 ${
                isVertical ? 'flex-col' : 'flex-row'
              }`}
            >
              {otherWindows.map((w) => {
                const active = !w.minimized && focusedWindowId === w.id && !w.launching;
                const isLaunching = Boolean(w.launching);
                const bounceClass = isLaunching
                  ? isVertical
                    ? 'dock-bounce-x'
                    : 'dock-bounce-y'
                  : '';
                const matchedLinuxApp = w.appId
                  ? linuxApps.find((a) => a.id === w.appId)
                  : undefined;

                return (
                  <DockMagnifySlot
                    key={w.id}
                    enabled={magEnabled}
                    maxScale={magScale}
                    pointer={dockPointer}
                    pos={pos}
                  >
                    <button
                      onClick={() => onToggleWindowFromTaskbar(w.id)}
                      onContextMenu={(e) =>
                        openDockContext(e, {
                          title: w.title,
                          win: w,
                          onNewWindow: matchedLinuxApp
                            ? () => onLaunchLinuxApp(matchedLinuxApp, { forceNew: true })
                            : w.kind === 'terminal'
                            ? onOpenTerminal
                            : undefined,
                        })
                      }
                      data-testid={`dock-win-${w.appId || w.kind}`}
                      data-launching={isLaunching ? 'true' : 'false'}
                      title={isLaunching ? `${w.title} açılıyor...` : w.title}
                      className={`relative ${
                        showTextLabels && !isCompactDock
                          ? `${sizeTokens.btnPill} max-w-[165px]`
                          : sizeTokens.btnSize
                      } ${btnShapeClass} flex items-center justify-center gap-2 shrink-0 text-xs transition-colors ${
                        active ? palette.activeBg : palette.hoverBg
                      }`}
                    >
                      <span className={`inline-flex items-center justify-center ${bounceClass}`}>
                        <DockAppIcon win={w} size={sizeTokens.icon} />
                      </span>
                      {showTextLabels && !isCompactDock && (
                        <span className="truncate">{w.title}</span>
                      )}
                      {renderIndicator(active, isLaunching)}
                    </button>
                  </DockMagnifySlot>
                );
              })}
            </div>
          )}
        </div>

        {/* Separator for compact macOS/minimal dock */}
        {isCompactDock && (
          <div
            className={`${
              isVertical ? 'w-5 h-[1px] my-0.5' : 'h-5 w-[1px] mx-0.5'
            } ${palette.dividerBg} shrink-0`}
          />
        )}

        {/* End Section: Audio, Control Center (Theme, Virtual Desktops, Settings), Notifications, Clock */}
        <div
          className={`flex items-center gap-1 shrink-0 ${
            isVertical ? 'flex-col' : 'flex-row'
          }`}
        >
          {!isCompactDock && (
            <button
              onClick={onToggleMute}
              title={muted ? 'Sesi Aç' : 'Sessize Al'}
              className={`${sizeTokens.btnSize} ${btnShapeClass} flex items-center justify-center transition-colors ${palette.hoverBg}`}
            >
              {muted || volume === 0 ? (
                <VolumeX className="w-4 h-4 text-red-500" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
          )}

          <button
            onClick={(e) => toggleFlyout('controls', e)}
            data-testid="dock-controls-btn"
            title="Kontrol Merkezi & Ayarlar"
            className={`${sizeTokens.btnSize} ${btnShapeClass} flex items-center justify-center transition-colors ${
              flyout === 'controls' ? palette.activeBg : palette.hoverBg
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>

          {!isCompactDock && (
            <button
              onClick={(e) => toggleFlyout('notifications', e)}
              title="Bildirimler"
              className={`relative ${sizeTokens.btnSize} ${btnShapeClass} flex items-center justify-center transition-colors ${
                flyout === 'notifications' ? palette.activeBg : palette.hoverBg
              }`}
            >
              <Bell className="w-4 h-4" />
              {notificationHistory.length > 0 && (
                <span
                  style={{ backgroundColor: palette.indicatorActive }}
                  className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
                />
              )}
            </button>
          )}

          <button
            onClick={(e) => toggleFlyout('calendar', e)}
            title={`${timeShort} · ${dateShort}`}
            className={`${
              isVertical ? `${sizeTokens.btnSize} px-0.5` : `${sizeTokens.btnPill}`
            } ${btnShapeClass} flex flex-col items-center justify-center leading-tight transition-colors ${
              flyout === 'calendar' ? palette.activeBg : palette.hoverBg
            }`}
          >
            <span className={`${isVertical ? 'text-[11px]' : 'text-xs'} font-semibold font-mono`}>
              {timeShort}
            </span>
            {!isVertical && !isCompactDock && (
              <span style={{ color: palette.mutedColor }} className="text-[10px] font-mono">
                {dateShort}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
