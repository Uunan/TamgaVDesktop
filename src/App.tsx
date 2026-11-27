import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import {
  DEFAULT_BROWSER_PREFERENCES,
  DEFAULT_DOCK_PREFERENCES,
  DEFAULT_LOCK_SCREEN_PREFERENCES,
  DEFAULT_MEDIA_PREFERENCES,
  DEFAULT_SCREENSAVER_PREFERENCES,
  DEFAULT_STREAM_PREFERENCES,
  DEFAULT_TERMINAL_PREFERENCES,
  DEFAULT_UI_PREFERENCES,
  WALLPAPERS,
  type AuthStatus,
  type ClipboardState,
  type DesktopMeta,
  type DockPreferences,
  type LinuxAppInfo,
  type LinuxRuntimeStatus,
  type LockScreenPreferences,
  type MediaPreferences,
  type OSWindow,
  type ScreensaverPreferences,
  type SettingsTabId,
  type StreamPreferences,
  type TabSummary,
  type TelemetryData,
  type ToastItem,
  type VFSNode,
  type VirtualDesktopInfo,
} from './types/os';
import { appsApi, authApi, buildRawFileUrl, setBridgeDesktopId, vfsApi } from './services/osBridge';
import { remoteAudio } from './services/audioPlayer';
import { WallpaperLayer } from './components/desktop/WallpaperLayer';
import { DesktopCanvas } from './components/desktop/DesktopCanvas';
import { WindowFrame } from './components/desktop/WindowFrame';
import { FolderWindow } from './components/desktop/FolderWindow';
import { ChromiumTabStrip, ChromiumWindowBody } from './components/browser/ChromiumWindow';
import { ContextMenu, type ContextMenuItemTarget } from './components/desktop/ContextMenu';
import { NewCustomFileModal, PropertiesPane } from './components/desktop/FileDialogs';
import { FullscreenNotice } from './components/desktop/FullscreenNotice';
import {
  LockScreenOverlay,
  OfflineBannerOverlay,
  ScreensaverOverlay,
} from './components/desktop/DesktopOverlays';
import { LoginScreen } from './components/auth/LoginScreen';
import { TerminalWindow } from './components/apps/TerminalWindow';
import { LinuxAppWindow } from './components/apps/LinuxAppWindow';
import { AppStoreWindow } from './components/apps/AppStoreWindow';
import { VSCodeWindow } from './components/apps/VSCodeWindow';
import { WebAppWindow } from './components/apps/WebAppWindow';
import { SettingsWindow } from './components/apps/SettingsWindow';
import { PreviewWindow } from './components/apps/PreviewWindow';
import { Taskbar } from './components/taskbar/Taskbar';
import { copyTextToHostClipboard } from './utils/clipboardBridge';
import { translateFolderDisplayName } from './utils/format';

const DEFAULT_META: DesktopMeta = {
  positions: {},
  trashOrigins: {},
  preferences: {
    wallpaper: 'mono-peaks',
    theme: 'dark',
    iconSize: 'md',
    autoArrange: false,
    sortBy: 'name',
    stream: { ...DEFAULT_STREAM_PREFERENCES },
    browser: { ...DEFAULT_BROWSER_PREFERENCES },
    terminal: { ...DEFAULT_TERMINAL_PREFERENCES },
    ui: { ...DEFAULT_UI_PREFERENCES },
    dock: { ...DEFAULT_DOCK_PREFERENCES },
    media: { ...DEFAULT_MEDIA_PREFERENCES },
    screensaver: { ...DEFAULT_SCREENSAVER_PREFERENCES },
    lockScreen: { ...DEFAULT_LOCK_SCREEN_PREFERENCES },
  },
};

function readInitialDesktopId(): string {
  if (typeof window === 'undefined') return 'main';
  const params = new URLSearchParams(window.location.search);
  return params.get('desktop') || 'main';
}

function loadCachedMeta(desktopId: string): { meta: DesktopMeta; fromCache: boolean } {
  if (typeof window === 'undefined') return { meta: DEFAULT_META, fromCache: false };
  try {
    const raw = localStorage.getItem(`tamga_prefs_v1_${desktopId}`);
    if (!raw) return { meta: DEFAULT_META, fromCache: false };
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return { meta: DEFAULT_META, fromCache: false };
    return {
      fromCache: true,
      meta: {
        ...DEFAULT_META,
        preferences: {
          ...DEFAULT_META.preferences,
          wallpaper: typeof p.wallpaper === 'string' ? p.wallpaper : DEFAULT_META.preferences.wallpaper,
          customWallpaper: typeof p.customWallpaper === 'string' ? p.customWallpaper : undefined,
          theme: p.theme === 'light' ? 'light' : 'dark',
          iconSize: p.iconSize || DEFAULT_META.preferences.iconSize,
          autoArrange: Boolean(p.autoArrange),
          sortBy: p.sortBy || DEFAULT_META.preferences.sortBy,
          stream: { ...DEFAULT_STREAM_PREFERENCES, ...(p.stream || {}) },
          browser: { ...DEFAULT_BROWSER_PREFERENCES, ...(p.browser || {}) },
          terminal: { ...DEFAULT_TERMINAL_PREFERENCES, ...(p.terminal || {}) },
          ui: { ...DEFAULT_UI_PREFERENCES, ...(p.ui || {}) },
          dock: { ...DEFAULT_DOCK_PREFERENCES, ...(p.dock || {}) },
          media: { ...DEFAULT_MEDIA_PREFERENCES, ...(p.media || {}) },
          screensaver: { ...DEFAULT_SCREENSAVER_PREFERENCES, ...(p.screensaver || {}) },
          lockScreen: { ...DEFAULT_LOCK_SCREEN_PREFERENCES, ...(p.lockScreen || {}) },
        },
      },
    };
  } catch {
    return { meta: DEFAULT_META, fromCache: false };
  }
}

function saveCachedPrefs(desktopId: string, prefs: DesktopMeta['preferences']): void {
  try {
    localStorage.setItem(`tamga_prefs_v1_${desktopId}`, JSON.stringify(prefs));
  } catch {}
}

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>({
    enabled: false,
    authenticated: true,
    serverName: 'TamgaVDesktop',
  });

  const [desktopId, setDesktopId] = useState<string>(() => {
    const initial = readInitialDesktopId();
    setBridgeDesktopId(initial);
    return initial;
  });
  const [currentDesktop, setCurrentDesktop] = useState<VirtualDesktopInfo>({
    id: desktopId,
    name: 'Masaüstü 1',
    createdAt: new Date().toISOString(),
  });
  const [desktops, setDesktops] = useState<VirtualDesktopInfo[]>([currentDesktop]);

  const [linuxRuntime, setLinuxRuntime] = useState<LinuxRuntimeStatus | null>(null);
  const [linuxApps, setLinuxApps] = useState<LinuxAppInfo[]>([]);
  const [allowAppInstall, setAllowAppInstall] = useState(true);

  const [locked, setLocked] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(`tamga_locked_${desktopId}`) === '1';
    } catch {
      return false;
    }
  });
  const [lockClock, setLockClock] = useState(() => new Date());
  const [screensaverActive, setScreensaverActive] = useState(false);
  const [screensaverIsPreview, setScreensaverIsPreview] = useState(false);
  const lastActivityRef = useRef<number>(Date.now());
  const screensaverStartedAtRef = useRef<number>(0);

  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [wsDisconnected, setWsDisconnected] = useState(false);
  const [wsReconnectNonce, setWsReconnectNonce] = useState(0);
  const wsEverConnectedRef = useRef(false);
  const wsOfflineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activateLockScreen = useCallback(() => {
    try {
      sessionStorage.setItem(`tamga_locked_${desktopId}`, '1');
    } catch {}
    setScreensaverActive(false);
    setScreensaverIsPreview(false);
    setLocked(true);
  }, [desktopId]);

  const unlockDesktop = useCallback(() => {
    try {
      sessionStorage.removeItem(`tamga_locked_${desktopId}`);
    } catch {}
    lastActivityRef.current = Date.now();
    setLocked(false);
  }, [desktopId]);

  const [allNodes, setAllNodes] = useState<VFSNode[]>([]);
  const initialHydration = useMemo(() => loadCachedMeta(desktopId), []);
  const [meta, setMeta] = useState<DesktopMeta>(() => initialHydration.meta);
  const [prefsReady, setPrefsReady] = useState<boolean>(() => initialHydration.fromCache);
  const [selectedDesktopPaths, setSelectedDesktopPaths] = useState<string[]>([]);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);

  const [windows, setWindows] = useState<OSWindow[]>([]);
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const [focusedWindowId, setFocusedWindowId] = useState<string | null>(null);
  const focusedWindowIdRef = useRef<string | null>(null);
  focusedWindowIdRef.current = focusedWindowId;
  const [externalDropTarget, setExternalDropTarget] = useState<string | null>(null);
  const nextZRef = useRef(20);

  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    target: ContextMenuItemTarget;
  } | null>(null);
  const [customFileDialog, setCustomFileDialog] = useState<{
    parentPath: string;
    pos?: { x: number; y: number };
  } | null>(null);
  const globalUploadRef = useRef<HTMLInputElement>(null);
  const wallpaperUploadRef = useRef<HTMLInputElement>(null);
  const themeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefUpdateSeqRef = useRef(0);
  const prefPendingCountRef = useRef(0);
  const queuedPrefRef = useRef<{
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
    dock?: Partial<DockPreferences>;
    media?: Partial<MediaPreferences>;
    screensaver?: Partial<ScreensaverPreferences>;
    lockScreen?: Partial<LockScreenPreferences>;
  } | null>(null);
  const prefFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [uploadTargetDir, setUploadTargetDir] = useState('/Desktop');

  const wsRef = useRef<WebSocket | null>(null);
  const wsQueueRef = useRef<string[]>([]);
  const videoListenersRef = useRef<Set<(jpegBytes: Uint8Array) => void>>(new Set());
  const lastVideoBytesRef = useRef<Uint8Array | null>(null);
  const lastFrameStatUpdateRef = useRef<number>(0);

  const [tabs, setTabs] = useState<TabSummary[]>([]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const activeTabIdRef = useRef<string | null>(null);
  activeTabIdRef.current = activeTabId;
  const [browserCursor, setBrowserCursor] = useState<string>('default');
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [pingMs, setPingMs] = useState<number>(2);
  const [lastFrameKB, setLastFrameKB] = useState<number>(0);

  const isAuthorized = authChecked && (!authStatus.enabled || authStatus.authenticated);

  const [brightness, setBrightness] = useState(100);
  const [volume, setVolume] = useState(85);
  const [muted, setMuted] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [notificationHistory, setNotificationHistory] = useState<ToastItem[]>([]);

  useEffect(() => {
    remoteAudio.setVolume(volume, muted);
  }, [volume, muted]);

  useEffect(() => {
    const devId = meta.preferences.media?.speakerDeviceId || 'default';
    remoteAudio.setOutputDevice(devId).catch(() => {});
  }, [meta.preferences.media?.speakerDeviceId]);

  useEffect(() => {
    const onOnline = () => {
      setIsBrowserOnline(true);
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        setWsReconnectNonce((n) => n + 1);
      }
    };
    const onOffline = () => setIsBrowserOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const subscribeVideoFrame = useCallback((cb: (jpegBytes: Uint8Array) => void) => {
    videoListenersRef.current.add(cb);
    if (lastVideoBytesRef.current) {
      cb(lastVideoBytesRef.current);
    }
    return () => {
      videoListenersRef.current.delete(cb);
    };
  }, []);

  const pushToast = useCallback(
    (
      title: string,
      message: string,
      kind: ToastItem['kind'] = 'info',
      actionLabel?: string,
      onAction?: () => void
    ) => {
      const item: ToastItem = {
        id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        message,
        kind,
        createdAt: Date.now(),
        actionLabel,
        onAction,
      };
      setToasts((prev) => [...prev.slice(-2), item]);
      setNotificationHistory((prev) => [item, ...prev].slice(0, 25));
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== item.id));
      }, 4000);
    },
    []
  );

  const refreshVfs = useCallback(async () => {
    try {
      const snap = await vfsApi.getSnapshot();
      setAllNodes(snap.nodes);
      setMeta((prev) =>
        prefPendingCountRef.current > 0
          ? { ...snap.meta, preferences: prev.preferences }
          : snap.meta
      );
      if (prefPendingCountRef.current === 0) {
        saveCachedPrefs(desktopId, snap.meta.preferences);
      }
      setPrefsReady(true);
      if (snap.desktop) setCurrentDesktop(snap.desktop);
      if (snap.desktops) setDesktops(snap.desktops);
    } catch {
      setPrefsReady(true);
    }
  }, [desktopId]);

  useEffect(() => {
    if (prefsReady) {
      saveCachedPrefs(desktopId, meta.preferences);
    }
  }, [desktopId, meta.preferences, prefsReady]);

  const refreshApps = useCallback(async () => {
    try {
      const res = await appsApi.list();
      setLinuxRuntime(res.runtime);
      setLinuxApps(res.apps);
      setAllowAppInstall(res.allowInstall);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    authApi
      .status()
      .then((status) => {
        setAuthStatus(status);
        setAuthChecked(true);
      })
      .catch(() => {
        setAuthChecked(true);
      });
  }, []);

  useEffect(() => {
    setBridgeDesktopId(desktopId);
    const cached = loadCachedMeta(desktopId);
    if (cached.fromCache) {
      setMeta((prev) => ({ ...prev, preferences: cached.meta.preferences }));
      setPrefsReady(true);
    }
    const url = new URL(window.location.href);
    if (desktopId === 'main') {
      url.searchParams.delete('desktop');
    } else {
      url.searchParams.set('desktop', desktopId);
    }
    window.history.replaceState({}, '', url.toString());
    if (isAuthorized) {
      refreshVfs();
      refreshApps();
    }
  }, [desktopId, isAuthorized, refreshVfs, refreshApps]);

  const handleLogout = useCallback(async () => {
    try {
      sessionStorage.removeItem(`tamga_locked_${desktopId}`);
    } catch {}
    setLocked(false);
    try {
      await authApi.logout();
    } catch {}
    setWindows([]);
    setFocusedWindowId(null);
    setAuthStatus((prev) => ({ ...prev, authenticated: false }));
  }, [desktopId]);

  useEffect(() => {
    if (!locked) return;
    const id = setInterval(() => setLockClock(new Date()), 1000);
    return () => clearInterval(id);
  }, [locked]);

  const sendWs = useCallback((msg: Record<string, unknown>) => {
    const raw = JSON.stringify(msg);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(raw);
    } else {
      wsQueueRef.current.push(raw);
    }
  }, []);

  const focusWindow = useCallback((id: string) => {
    const z = ++nextZRef.current;
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, minimized: false, zIndex: z } : w))
    );
    setFocusedWindowId(id);
  }, []);

  const openFolderWindow = useCallback((folderPath: string) => {
    const z = ++nextZRef.current;
    let targetId = '';
    setWindows((prev) => {
      const existing = prev.find((w) => w.kind === 'folder' && w.folderPath === folderPath);
      if (existing) {
        targetId = existing.id;
        return prev.map((w) =>
          w.id === existing.id ? { ...w, minimized: false, zIndex: z } : w
        );
      }
      const offset = (prev.length % 5) * 24;
      const vw = window.innerWidth;
      const vh = window.innerHeight - 76;
      const width = Math.min(900, vw - 36);
      const height = Math.min(580, vh - 36);
      targetId = `win-folder-${Date.now()}`;
      return [
        ...prev,
        {
          id: targetId,
          kind: 'folder',
          title: translateFolderDisplayName(
            folderPath,
            folderPath.split('/').filter(Boolean).pop() || 'Klasör'
          ),
          folderPath,
          x: Math.max(18, Math.round((vw - width) / 2) + offset - 24),
          y: Math.max(18, Math.round((vh - height) / 2) + offset - 18),
          width,
          height,
          minimized: false,
          maximized: false,
          zIndex: z,
        },
      ];
    });
    if (targetId) setFocusedWindowId(targetId);
  }, []);

  const openChromiumWindow = useCallback(
    (initialUrl?: string) => {
      remoteAudio.ensureContext();
      const z = ++nextZRef.current;
      const id = 'win-chromium-main';
      const wasOpen = windowsRef.current.some((w) => w.kind === 'browser');
      setWindows((prev) => {
        const existing = prev.find((w) => w.kind === 'browser');
        if (existing) {
          return prev.map((w) =>
            w.id === existing.id ? { ...w, minimized: false, zIndex: z } : w
          );
        }
        const vw = window.innerWidth;
        const vh = window.innerHeight - 76;
        const width = Math.min(1160, vw - 36);
        const height = Math.min(730, vh - 28);
        return [
          ...prev,
          {
            id,
            kind: 'browser',
            title: 'Chromium',
            x: Math.max(18, Math.round((vw - width) / 2)),
            y: Math.max(18, Math.round((vh - height) / 2)),
            width,
            height,
            minimized: false,
            maximized: false,
            zIndex: z,
          },
        ];
      });
      setFocusedWindowId(id);
      if (initialUrl) {
        sendWs({ type: 'browser_new_tab', url: initialUrl });
      } else if (!wasOpen) {
        const defaultUrl =
          meta.preferences.browser?.defaultUrl || DEFAULT_BROWSER_PREFERENCES.defaultUrl;
        if (defaultUrl && defaultUrl !== 'compute://newtab') {
          const curTabs = tabsRef.current;
          if (curTabs.length === 0) {
            sendWs({ type: 'browser_new_tab', url: defaultUrl });
          } else if (curTabs.length === 1 && curTabs[0].mode === 'newtab') {
            sendWs({ type: 'browser_navigate', tabId: curTabs[0].id, url: defaultUrl });
          }
        }
      }
    },
    [sendWs, meta.preferences.browser?.defaultUrl]
  );

  const openTerminalWindow = useCallback((cwdPath?: string) => {
    const z = ++nextZRef.current;
    const sessionId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const id = `win-${sessionId}`;
    const vw = window.innerWidth;
    const vh = window.innerHeight - 76;
    const width = Math.min(820, vw - 36);
    const height = Math.min(520, vh - 36);
    const normCwd = cwdPath || '/Desktop';
    const title = normCwd && normCwd !== '/Desktop' ? `Uç Birim — ${normCwd}` : 'Uç Birim';
    setWindows((prev) => {
      const offset = (prev.length % 5) * 24;
      return [
        ...prev,
        {
          id,
          kind: 'terminal',
          title,
          terminalSessionId: sessionId,
          terminalCwd: normCwd,
          x: Math.max(18, Math.round((vw - width) / 2) + offset - 20),
          y: Math.max(18, Math.round((vh - height) / 2) + offset - 20),
          width,
          height,
          minimized: false,
          maximized: false,
          zIndex: z,
        },
      ];
    });
    setFocusedWindowId(id);
  }, []);

  const openSettingsWindow = useCallback((initialTab: SettingsTabId = 'stream') => {
    const z = ++nextZRef.current;
    const id = 'win-settings';
    setWindows((prev) => {
      const existing = prev.find((w) => w.id === id);
      if (existing) {
        return prev.map((w) =>
          w.id === id ? { ...w, minimized: false, zIndex: z, settingsTab: initialTab } : w
        );
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight - 76;
      const width = Math.min(880, vw - 36);
      const height = Math.min(620, vh - 32);
      return [
        ...prev,
        {
          id,
          kind: 'settings',
          title: 'Ayarlar',
          settingsTab: initialTab,
          x: Math.max(18, Math.round((vw - width) / 2)),
          y: Math.max(18, Math.round((vh - height) / 2)),
          width,
          height,
          minimized: false,
          maximized: false,
          zIndex: z,
        },
      ];
    });
    setFocusedWindowId(id);
  }, []);

  const openAppStoreWindow = useCallback(() => {
    const z = ++nextZRef.current;
    const id = 'win-app-store';
    setWindows((prev) => {
      const existing = prev.find((w) => w.id === id);
      if (existing) {
        return prev.map((w) => (w.id === id ? { ...w, minimized: false, zIndex: z } : w));
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight - 76;
      const width = Math.min(960, vw - 36);
      const height = Math.min(660, vh - 36);
      return [
        ...prev,
        {
          id,
          kind: 'app-store',
          title: 'Uygulamalar',
          x: Math.max(18, Math.round((vw - width) / 2)),
          y: Math.max(18, Math.round((vh - height) / 2)),
          width,
          height,
          minimized: false,
          maximized: false,
          zIndex: z,
        },
      ];
    });
    setFocusedWindowId(id);
    refreshApps();
  }, [refreshApps]);

  const openVSCodeWindow = useCallback(
    (opts?: {
      folderPath?: string;
      url?: string;
      width?: number;
      height?: number;
      forceNew?: boolean;
    }) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight - 76;
      const width = Math.min(opts?.width || 1160, vw - 36);
      const height = Math.min(opts?.height || 720, vh - 32);
      const z = ++nextZRef.current;

      if (!opts?.forceNew && !opts?.url) {
        const existing = windowsRef.current.find((w) => w.kind === 'vscode');
        if (existing) {
          setWindows((prev) =>
            prev.map((w) => (w.id === existing.id ? { ...w, minimized: false, zIndex: z } : w))
          );
          setFocusedWindowId(existing.id);
          return;
        }
      }

      const id =
        !opts?.forceNew && !opts?.url
          ? 'win-vscode-main'
          : `win-vscode-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;

      setWindows((prev) => {
        const offset = (prev.filter((w) => w.kind === 'vscode').length % 5) * 26;
        return [
          ...prev,
          {
            id,
            kind: 'vscode',
            title: 'Visual Studio Code Web',
            appId: 'vscode-web',
            appIconName: 'vscode-web',
            folderPath: opts?.folderPath || '/Projects',
            vscodeUrl: opts?.url,
            x: Math.max(18, Math.round((vw - width) / 2) + offset),
            y: Math.max(18, Math.round((vh - height) / 2) + offset),
            width,
            height,
            minimized: false,
            maximized: false,
            zIndex: z,
          },
        ];
      });
      setFocusedWindowId(id);
    },
    []
  );

  const syncClipboardAcrossDesktop = useCallback(
    (text: string) => {
      if (text) {
        sendWs({ type: 'clipboard_sync', text });
      }
    },
    [sendWs]
  );

  const openWebAppWindow = useCallback(
    (opts: {
      appId?: string;
      url: string;
      title: string;
      iconName?: string;
      forceNew?: boolean;
    }) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight - 76;
      const width = Math.min(1160, vw - 36);
      const height = Math.min(735, vh - 32);
      const z = ++nextZRef.current;

      if (!opts.forceNew) {
        const existing = windowsRef.current.find(
          (w) =>
            w.kind === 'web-app' &&
            ((opts.appId && w.appId === opts.appId) || w.webAppUrl === opts.url)
        );
        if (existing) {
          setWindows((prev) =>
            prev.map((w) =>
              w.id === existing.id ? { ...w, minimized: false, zIndex: z } : w
            )
          );
          setFocusedWindowId(existing.id);
          return;
        }
      }

      const id = `win-webapp-${opts.appId || 'custom'}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 5)}`;
      setWindows((prev) => {
        const offset = (prev.filter((w) => w.kind === 'web-app').length % 5) * 24;
        return [
          ...prev,
          {
            id,
            kind: 'web-app',
            title: opts.title,
            appId: opts.appId || 'web-app',
            appIconName: opts.iconName || opts.appId || 'chrome',
            webAppUrl: opts.url,
            x: Math.max(18, Math.round((vw - width) / 2) + offset),
            y: Math.max(18, Math.round((vh - height) / 2) + offset),
            width,
            height,
            minimized: false,
            maximized: false,
            zIndex: z,
          },
        ];
      });
      setFocusedWindowId(id);
    },
    []
  );

  const launchLinuxApp = useCallback(
    async (params: {
      appId?: string;
      command?: string;
      appName?: string;
      iconName?: string;
      initialUrl?: string;
      needsNoSandbox?: boolean;
      launchMode?: 'gui' | 'terminal' | 'web';
      forceNew?: boolean;
    }) => {
      remoteAudio.ensureContext();
      const vw = window.innerWidth;
      const vh = window.innerHeight - 76;
      const viewportWidth = Math.max(960, vw - 36);
      const viewportHeight = Math.max(600, vh - 32 - 42);
      const isBrowserApp =
        params.appId === 'chrome' ||
        params.appId === 'firefox' ||
        params.appId === 'brave' ||
        params.launchMode === 'web';
      const width = Math.min(isBrowserApp ? 1160 : 740, vw - 36);
      const height = Math.min(isBrowserApp ? 730 : 520, vh - 32);

      // Run VS Code Web in Web-Native DOM mode while leaving 'vscode' as native Linux Desktop app
      if (params.appId === 'vscode-web') {
        openVSCodeWindow({ folderPath: '/Projects', forceNew: params.forceNew });
        return;
      }

      const foundApp = linuxApps.find(
        (a) => a.id === params.appId || (params.command && a.command === params.command)
      );
      const resolvedIconName = params.iconName || foundApp?.iconName || params.appId;
      const effectiveMode =
        params.launchMode ||
        foundApp?.launchMode ||
        (['codex', 'claude-code', 'gemini-cli', 'antigravity-cli'].includes(params.appId || '')
          ? 'terminal'
          : /^https?:\/\//i.test(params.command || '')
          ? 'web'
          : 'gui');

      // Run HTTP/HTTPS web apps inside native embedded WebAppWindow (just like VS Code Web) without opening X11 Chrome
      if (effectiveMode === 'web') {
        const targetUrl =
          params.initialUrl ||
          (foundApp?.command && /^https?:\/\//i.test(foundApp.command)
            ? foundApp.command
            : /^https?:\/\//i.test(params.command || '')
            ? String(params.command)
            : 'https://www.google.com');
        openWebAppWindow({
          appId: params.appId || foundApp?.id || 'web-app',
          url: targetUrl,
          title: params.appName || foundApp?.name || 'Web Uygulaması',
          iconName: resolvedIconName,
          forceNew: params.forceNew,
        });
        return;
      }

      // Run TUI AI Agents (OpenAI Codex CLI, Claude Code CLI, Gemini CLI, Antigravity CLI) in crisp 60fps TrueColor PTY window
      if (effectiveMode === 'terminal') {
        if (!params.forceNew && params.appId) {
          const existingTui = windowsRef.current.find(
            (w) => w.kind === 'terminal' && w.appId === params.appId
          );
          if (existingTui) {
            focusWindow(existingTui.id);
            return;
          }
        }
        const z = ++nextZRef.current;
        const termSid = `tui-${params.appId || 'app'}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        const winId = `win-${termSid}`;
        const tuiW = Math.min(940, vw - 36);
        const tuiH = Math.min(620, vh - 36);
        const cmdToRun = (params.command || foundApp?.command || 'codex').trim();
        setWindows((prev) => {
          const offset = (prev.length % 4) * 22;
          return [
            ...prev,
            {
              id: winId,
              kind: 'terminal',
              title: params.appName || foundApp?.name || cmdToRun,
              appId: params.appId || foundApp?.id || 'codex',
              appIconName: resolvedIconName || params.appId || 'codex',
              terminalSessionId: termSid,
              terminalCwd: '/Projects',
              terminalInitialCommand: `clear && ${cmdToRun}`,
              x: Math.max(18, Math.round((vw - tuiW) / 2) + offset - 16),
              y: Math.max(18, Math.round((vh - tuiH) / 2) + offset - 16),
              width: tuiW,
              height: tuiH,
              minimized: false,
              maximized: false,
              zIndex: z,
            },
          ];
        });
        setFocusedWindowId(winId);
        return;
      }

      try {
        const res = await appsApi.launch({
          ...params,
          width,
          height: height - 42,
          viewportWidth,
          viewportHeight,
        });

        // If backend opened an extra window inside an active profile session (e.g. Firefox),
        // or opened an initialUrl tab inside an already-open browser session, focus existing window!
        const existingWin = windowsRef.current.find(
          (w) => w.kind === 'linux-app' && w.appSessionId === res.sessionId
        );
        if (existingWin && (res.openedAsExtraWindow || params.initialUrl)) {
          if (!res.openedAsExtraWindow) {
            focusWindow(existingWin.id);
          }
          return;
        }

        const z = ++nextZRef.current;
        const id = `win-linux-${res.sessionId}-main`;
        setWindows((prev) => {
          const offset = (prev.length % 4) * 20;
          return [
            ...prev,
            {
              id,
              kind: 'linux-app',
              title: res.title || res.appName,
              appSessionId: res.sessionId,
              appViewId: 'main',
              appId: res.appId,
              appIconName: resolvedIconName || res.appId,
              launching: true,
              x: Math.max(18, Math.round((vw - width) / 2) + offset - 16),
              y: Math.max(18, Math.round((vh - height) / 2) + offset - 16),
              width,
              height,
              minimized: false,
              maximized: false,
              zIndex: z,
            },
          ];
        });
        setFocusedWindowId(id);

        // Safety fallback: reveal window even if a slow app takes longer than expected
        setTimeout(() => {
          setWindows((prev) =>
            prev.map((w) => (w.id === id && w.launching ? { ...w, launching: false } : w))
          );
        }, 15000);
      } catch (e) {
        pushToast('Uygulama Başlatılamadı', (e as Error).message, 'error');
      }
    },
    [pushToast, openVSCodeWindow, openWebAppWindow, linuxApps, focusWindow]
  );

  const openPreviewWindow = useCallback((node: VFSNode) => {
    const z = ++nextZRef.current;
    const id = `win-preview-${node.path}`;
    setWindows((prev) => {
      const existing = prev.find((w) => w.id === id);
      if (existing) {
        return prev.map((w) => (w.id === id ? { ...w, minimized: false, zIndex: z } : w));
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight - 76;
      const width = Math.min(920, vw - 36);
      const height = Math.min(640, vh - 32);
      const offset = (prev.filter((w) => w.kind === 'preview').length % 5) * 22;
      return [
        ...prev,
        {
          id,
          kind: 'preview',
          title: `${node.name} — Önizleme`,
          previewNodePath: node.path,
          x: Math.max(18, Math.round((vw - width) / 2) + offset - 18),
          y: Math.max(18, Math.round((vh - height) / 2) + offset - 14),
          width,
          height,
          minimized: false,
          maximized: false,
          zIndex: z,
        },
      ];
    });
    setFocusedWindowId(id);
  }, []);

  const closeWindowById = useCallback(
    (id: string) => {
      const target = windowsRef.current.find((w) => w.id === id);
      if (target?.kind === 'linux-app' && target.appSessionId) {
        appsApi.close(target.appSessionId, target.appViewId || 'main').catch(() => {});
      }
      if (
        target?.kind === 'browser' &&
        (meta.preferences.browser?.closeTabsOnExit ?? true)
      ) {
        lastVideoBytesRef.current = null;
        sendWs({ type: 'browser_reset' });
      }
      setWindows((prev) => prev.filter((w) => w.id !== id));
      setFocusedWindowId((prev) => (prev === id ? null : prev));
    },
    [meta.preferences.browser?.closeTabsOnExit, sendWs]
  );

  const handleDropFilesOnLinuxApp = useCallback(
    async (sessionId: string, vfsPaths: string[]) => {
      if (!sessionId || vfsPaths.length === 0) return;
      try {
        await appsApi.openFiles(sessionId, vfsPaths);
        const win = windowsRef.current.find((w) => w.appSessionId === sessionId);
        if (win) focusWindow(win.id);
        pushToast(
          win?.title || 'Uygulama',
          `${vfsPaths.length} dosya uygulamaya aktarıldı.`,
          'success'
        );
      } catch (e) {
        pushToast('Dosya Açılamadı', (e as Error).message, 'error');
      }
    },
    [focusWindow, pushToast]
  );

  const openPrimaryBrowser = useCallback(
    (arg?: string | { forceNew?: boolean }) => {
      const initialUrl = typeof arg === 'string' ? arg : undefined;
      const forceNew = typeof arg === 'object' && Boolean(arg?.forceNew);

      if (initialUrl && initialUrl.startsWith('file://')) {
        const vfsPath = initialUrl.slice('file://'.length);
        const found = allNodes.find((n) => n.path === vfsPath);
        if (found) {
          openPreviewWindow(found);
          return;
        }
        openChromiumWindow(initialUrl);
        return;
      }

      if (!forceNew && !initialUrl) {
        const existingChrome = windowsRef.current.find(
          (w) => w.kind === 'linux-app' && w.appId === 'chrome'
        );
        if (existingChrome) {
          focusWindow(existingChrome.id);
          return;
        }
      }

      const chromeApp = linuxApps.find((a) => a.id === 'chrome');
      if (chromeApp?.installed) {
        launchLinuxApp({
          appId: 'chrome',
          command: chromeApp.command || 'google-chrome-stable',
          appName: 'Google Chrome',
          iconName: chromeApp.iconName,
          initialUrl,
          needsNoSandbox: true,
          forceNew,
        });
        return;
      }
      if (linuxRuntime?.guiReady) {
        launchLinuxApp({
          appId: 'chrome',
          command: 'google-chrome-stable',
          appName: 'Google Chrome',
          initialUrl,
          needsNoSandbox: true,
          forceNew,
        });
        return;
      }
      openAppStoreWindow();
      pushToast('Google Chrome', 'Google Chrome kurmak için Uygulamalar mağazasını kullanabilirsiniz.', 'info');
    },
    [
      allNodes,
      openPreviewWindow,
      openChromiumWindow,
      focusWindow,
      linuxApps,
      linuxRuntime?.guiReady,
      launchLinuxApp,
      openAppStoreWindow,
      pushToast,
    ]
  );

  const openPropertiesWindow = useCallback((node: VFSNode) => {
    const z = ++nextZRef.current;
    const id = `win-prop-${node.path}`;
    setWindows((prev) => {
      const existing = prev.find((w) => w.id === id);
      if (existing) {
        return prev.map((w) => (w.id === id ? { ...w, minimized: false, zIndex: z } : w));
      }
      return [
        ...prev,
        {
          id,
          kind: 'properties',
          title: `${translateFolderDisplayName(node.path, node.name)} — Bilgi`,
          targetNodePath: node.path,
          x: Math.max(24, Math.round(window.innerWidth / 2 - 200)),
          y: Math.max(24, Math.round((window.innerHeight - 76) / 2 - 210)),
          width: 400,
          height: 420,
          minimized: false,
          maximized: false,
          zIndex: z,
        },
      ];
    });
    setFocusedWindowId(id);
  }, []);

  // Scoped WebSocket per isolated Virtual Desktop (supports binary Video + Audio PCM!)
  useEffect(() => {
    if (!isAuthorized) return;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    lastVideoBytesRef.current = null;

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(
        `${proto}//${window.location.host}/ws?desktop=${encodeURIComponent(desktopId)}`
      );
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        wsEverConnectedRef.current = true;
        if (wsOfflineTimerRef.current) {
          clearTimeout(wsOfflineTimerRef.current);
          wsOfflineTimerRef.current = null;
        }
        setWsDisconnected(false);
        while (wsQueueRef.current.length > 0) {
          const item = wsQueueRef.current.shift();
          if (item) ws.send(item);
        }
        ws.send(JSON.stringify({ type: 'ping', ts: performance.now() }));
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', ts: performance.now() }));
          }
        }, 4500);
      };

      ws.onmessage = (ev) => {
        // Fast Binary Path: 0x01 = Video JPEG, 0x02 = Audio 24kHz Int16 PCM
        if (ev.data instanceof ArrayBuffer) {
          const buf = ev.data;
          if (buf.byteLength < 2) return;
          const header = new Uint8Array(buf, 0, 1)[0];
          if (header === 0x01) {
            const jpegBytes = new Uint8Array(buf, 1);
            lastVideoBytesRef.current = jpegBytes;
            const now = performance.now();
            if (now - lastFrameStatUpdateRef.current > 350) {
              lastFrameStatUpdateRef.current = now;
              setLastFrameKB(Math.max(1, Math.round(jpegBytes.byteLength / 1024)));
            }
            for (const listener of videoListenersRef.current) {
              listener(jpegBytes);
            }
          } else if (header === 0x02) {
            remoteAudio.pushPcm16(buf.slice(1));
          }
          return;
        }

        try {
          const msg = JSON.parse(String(ev.data));
          switch (msg.type) {
            case 'tabs_state':
              setTabs(msg.tabs || []);
              setActiveTabId(msg.activeTabId || null);
              break;
            case 'browser_cursor':
              setBrowserCursor(String(msg.cursor || 'default'));
              break;
            case 'telemetry':
              setTelemetry(msg.data);
              break;
            case 'vfs_snapshot':
              if (msg.snapshot) {
                setAllNodes(msg.snapshot.nodes);
                setMeta((prev) =>
                  prefPendingCountRef.current > 0
                    ? { ...msg.snapshot.meta, preferences: prev.preferences }
                    : msg.snapshot.meta
                );
              }
              break;
            case 'download_complete':
              pushToast(
                'İndirme Tamamlandı',
                `${msg.fileName} İndirilenler klasörüne kaydedildi.`,
                'success',
                'Aç',
                () => openFolderWindow('/Downloads')
              );
              break;
            case 'external_browser_opened': {
              const sId = String(msg.sessionId || '');
              if (!sId) break;
              const existing = windowsRef.current.find(
                (w) => w.kind === 'linux-app' && w.appSessionId === sId
              );
              if (existing) {
                focusWindow(existing.id);
              } else {
                const vw = window.innerWidth;
                const vh = window.innerHeight - 76;
                const width = Math.min(Number(msg.width) || 1160, vw - 36);
                const height = Math.min(Number(msg.height) || 730, vh - 32);
                const z = ++nextZRef.current;
                const winId = `win-linux-${sId}-main`;
                const appId = String(msg.appId || 'chrome');
                const isExisting = Boolean(msg.isExisting);
                setWindows((prev) => {
                  if (prev.some((w) => w.appSessionId === sId)) return prev;
                  return [
                    ...prev,
                    {
                      id: winId,
                      kind: 'linux-app',
                      title: String(msg.title || msg.appName || 'Google Chrome'),
                      appSessionId: sId,
                      appViewId: 'main',
                      appId,
                      appIconName: appId,
                      launching: !isExisting,
                      x: Math.max(18, Math.round((vw - width) / 2)),
                      y: Math.max(18, Math.round((vh - height) / 2)),
                      width,
                      height,
                      minimized: false,
                      maximized: false,
                      zIndex: z,
                    },
                  ];
                });
                setFocusedWindowId(winId);
                if (!isExisting) {
                  setTimeout(() => {
                    setWindows((prev) =>
                      prev.map((w) => (w.id === winId && w.launching ? { ...w, launching: false } : w))
                    );
                  }, 15000);
                }
              }
              break;
            }
            case 'external_chromium_opened':
              openChromiumWindow();
              break;
            case 'focus_linux_session': {
              const targetSessionId = String(msg.sessionId || '');
              if (!targetSessionId) break;
              const targetWin = windowsRef.current.find(
                (w) => w.kind === 'linux-app' && w.appSessionId === targetSessionId
              );
              if (targetWin) {
                focusWindow(targetWin.id);
              }
              break;
            }
            case 'desktop_clipboard':
              if (typeof msg.text === 'string' && msg.text) {
                copyTextToHostClipboard(msg.text);
              }
              break;
            case 'browser_error':
              pushToast('Tarayıcı', String(msg.message || ''), 'warning');
              break;
            case 'pong':
              if (typeof msg.ts === 'number') {
                setPingMs(Math.max(1, Math.round(performance.now() - msg.ts)));
              }
              break;
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        if (pingInterval) clearInterval(pingInterval);
        if (!closed) {
          if (wsEverConnectedRef.current && !wsOfflineTimerRef.current) {
            wsOfflineTimerRef.current = setTimeout(() => {
              wsOfflineTimerRef.current = null;
              setWsDisconnected(true);
            }, 2500);
          }
          reconnectTimer = setTimeout(connect, 1200);
        }
      };
    };

    wsEverConnectedRef.current = false;
    setWsDisconnected(false);
    connect();
    return () => {
      closed = true;
      if (pingInterval) clearInterval(pingInterval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsOfflineTimerRef.current) {
        clearTimeout(wsOfflineTimerRef.current);
        wsOfflineTimerRef.current = null;
      }
      wsRef.current?.close();
    };
  }, [desktopId, isAuthorized, wsReconnectNonce, pushToast, openFolderWindow, focusWindow, openChromiumWindow]);

  const handleSwitchDesktop = useCallback((nextId: string) => {
    setWindows([]);
    setFocusedWindowId(null);
    setSelectedDesktopPaths([]);
    setRenamingPath(null);
    setCtxMenu(null);
    try {
      setLocked(sessionStorage.getItem(`tamga_locked_${nextId}`) === '1');
    } catch {
      setLocked(false);
    }
    setBridgeDesktopId(nextId);
    setDesktopId(nextId);
  }, []);

  const handleCreateDesktop = async (name?: string) => {
    try {
      const res = await vfsApi.createDesktop(name);
      setDesktops(res.desktops);
      handleSwitchDesktop(res.desktop.id);
      pushToast('Yeni Masaüstü Hazır', `${res.desktop.name} oluşturuldu.`, 'success');
    } catch (e) {
      pushToast('Hata', (e as Error).message, 'error');
    }
  };

  const handleDeleteDesktop = async (id: string) => {
    try {
      const res = await vfsApi.deleteDesktop(id);
      setDesktops(res.desktops);
      if (desktopId === id && res.desktops[0]) {
        handleSwitchDesktop(res.desktops[0].id);
      }
    } catch (e) {
      pushToast('Silinemedi', (e as Error).message, 'error');
    }
  };

  const handleCopyDesktopLink = (id: string) => {
    const u = new URL(window.location.origin + window.location.pathname);
    u.searchParams.set('desktop', id);
    navigator.clipboard?.writeText(u.toString()).catch(() => {});
    pushToast('Bağlantı Kopyalandı', `${u.toString()} panoya kopyalandı.`, 'info');
  };

  const desktopNodes = useMemo(
    () => allNodes.filter((n) => n.parentPath === '/Desktop'),
    [allNodes]
  );

  const trashCount = useMemo(
    () => allNodes.find((n) => n.path === '/.trash')?.childCount ?? 0,
    [allNodes]
  );

  const handleOpenNode = useCallback(
    (node: VFSNode) => {
      if (node.isDir) openFolderWindow(node.path);
      else openPreviewWindow(node);
    },
    [openFolderWindow, openPreviewWindow]
  );

  const handleCreateFolder = async (parentPath: string, pos?: { x: number; y: number }) => {
    try {
      const res = await vfsApi.createFolder(parentPath, 'Yeni Klasör', pos);
      setAllNodes(res.snapshot.nodes);
      setMeta(res.snapshot.meta);
      setRenamingPath(res.node.path);
      if (parentPath === '/Desktop') setSelectedDesktopPaths([res.node.path]);
    } catch (e) {
      pushToast('Hata', (e as Error).message, 'error');
    }
  };

  const handleCreateFile = async (
    parentPath: string,
    fileName: string,
    pos?: { x: number; y: number }
  ) => {
    try {
      const res = await vfsApi.createFile(parentPath, fileName, undefined, pos);
      setAllNodes(res.snapshot.nodes);
      setMeta(res.snapshot.meta);
      if (parentPath === '/Desktop') setSelectedDesktopPaths([res.node.path]);
    } catch (e) {
      pushToast('Hata', (e as Error).message, 'error');
    }
  };

  const handleRenameCommit = async (oldPath: string, newName: string) => {
    try {
      const res = await vfsApi.rename(oldPath, newName);
      setAllNodes(res.snapshot.nodes);
      setMeta(res.snapshot.meta);
      if (res.node.parentPath === '/Desktop') setSelectedDesktopPaths([res.node.path]);
    } catch (e) {
      pushToast('Hata', (e as Error).message, 'error');
    }
  };

  const handleMoveNodes = async (paths: string[], targetDir: string) => {
    try {
      const res = await vfsApi.move(paths, targetDir);
      setAllNodes(res.snapshot.nodes);
      setMeta(res.snapshot.meta);
      setSelectedDesktopPaths([]);
    } catch (e) {
      pushToast('Taşıma Hatası', (e as Error).message, 'error');
    }
  };

  const handlePaste = async (targetDir: string) => {
    if (!clipboard?.paths.length) return;
    try {
      if (clipboard.mode === 'cut') {
        const res = await vfsApi.move(clipboard.paths, targetDir);
        setAllNodes(res.snapshot.nodes);
        setMeta(res.snapshot.meta);
        setClipboard(null);
      } else {
        const res = await vfsApi.copy(clipboard.paths, targetDir);
        setAllNodes(res.snapshot.nodes);
        setMeta(res.snapshot.meta);
      }
    } catch (e) {
      pushToast('Hata', (e as Error).message, 'error');
    }
  };

  const handleDuplicate = async (nodes: VFSNode[]) => {
    if (!nodes.length) return;
    try {
      const res = await vfsApi.copy(
        nodes.map((n) => n.path),
        nodes[0].parentPath
      );
      setAllNodes(res.snapshot.nodes);
      setMeta(res.snapshot.meta);
    } catch (e) {
      pushToast('Hata', (e as Error).message, 'error');
    }
  };

  const handleTrashPaths = async (paths: string[]) => {
    if (!paths.length) return;
    try {
      const res = await vfsApi.trash(paths);
      setAllNodes(res.snapshot.nodes);
      setMeta(res.snapshot.meta);
      setSelectedDesktopPaths([]);
    } catch (e) {
      pushToast('Hata', (e as Error).message, 'error');
    }
  };

  const handleRestoreNodes = async (nodes: VFSNode[]) => {
    try {
      const res = await vfsApi.restore(nodes.map((n) => n.path));
      setAllNodes(res.snapshot.nodes);
      setMeta(res.snapshot.meta);
    } catch (e) {
      pushToast('Hata', (e as Error).message, 'error');
    }
  };

  const handleDeletePermanent = async (nodes: VFSNode[]) => {
    try {
      const res = await vfsApi.deletePermanently(nodes.map((n) => n.path));
      setAllNodes(res.snapshot.nodes);
      setMeta(res.snapshot.meta);
    } catch (e) {
      pushToast('Hata', (e as Error).message, 'error');
    }
  };

  const handleEmptyTrash = async () => {
    try {
      const res = await vfsApi.emptyTrash();
      setAllNodes(res.snapshot.nodes);
      setMeta(res.snapshot.meta);
    } catch (e) {
      pushToast('Hata', (e as Error).message, 'error');
    }
  };

  const handleCompressZip = async (nodes: VFSNode[], dirPath: string) => {
    try {
      const res = await vfsApi.compressToZip(
        nodes.map((n) => n.path),
        dirPath
      );
      setAllNodes(res.snapshot.nodes);
      setMeta(res.snapshot.meta);
      pushToast('Arşivlendi', `${res.node.name} oluşturuldu.`, 'success');
    } catch (e) {
      pushToast('Hata', (e as Error).message, 'error');
    }
  };

  const handleExtractZip = async (node: VFSNode) => {
    try {
      const res = await vfsApi.extractZip(node.path, node.parentPath);
      setAllNodes(res.snapshot.nodes);
      setMeta(res.snapshot.meta);
      pushToast('Ayıklandı', `${res.node.name} klasörüne çıkartıldı.`, 'success');
    } catch (e) {
      pushToast('Hata', (e as Error).message, 'error');
    }
  };

  const handleUploadFiles = async (parentPath: string, files: FileList) => {
    try {
      const res = await vfsApi.uploadFiles(parentPath, files);
      setAllNodes(res.snapshot.nodes);
      setMeta(res.snapshot.meta);
      pushToast('Yüklendi', `${res.saved.length} dosya aktarıldı.`, 'success');
    } catch (e) {
      pushToast('Hata', (e as Error).message, 'error');
    }
  };

  const flushQueuedPreferences = async () => {
    const batch = queuedPrefRef.current;
    queuedPrefRef.current = null;
    prefFlushTimerRef.current = null;
    if (!batch) {
      prefPendingCountRef.current = Math.max(0, prefPendingCountRef.current - 1);
      return;
    }
    const seqAtSend = prefUpdateSeqRef.current;
    try {
      if (batch.autoArrange) await vfsApi.resetPositions();
      const res = await vfsApi.updateMeta({ preferences: batch });
      if (seqAtSend === prefUpdateSeqRef.current && !queuedPrefRef.current) {
        setMeta(res.meta);
      }
    } catch {
      // keep optimistic UI preferences on transient network hiccup
    } finally {
      prefPendingCountRef.current = Math.max(0, prefPendingCountRef.current - 1);
    }
  };

  const handleUpdatePreferences = async (partial: {
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
    dock?: Partial<DockPreferences>;
    media?: Partial<MediaPreferences>;
    screensaver?: Partial<ScreensaverPreferences>;
    lockScreen?: Partial<LockScreenPreferences>;
  }) => {
    prefUpdateSeqRef.current += 1;
    setMeta((prev) => {
      const { stream, browser, terminal, ui, dock, media, screensaver, lockScreen, ...rest } = partial;
      return {
        ...prev,
        preferences: {
          ...prev.preferences,
          ...rest,
          stream: stream
            ? { ...DEFAULT_STREAM_PREFERENCES, ...(prev.preferences.stream || {}), ...stream }
            : prev.preferences.stream || { ...DEFAULT_STREAM_PREFERENCES },
          browser: browser
            ? { ...DEFAULT_BROWSER_PREFERENCES, ...(prev.preferences.browser || {}), ...browser }
            : prev.preferences.browser || { ...DEFAULT_BROWSER_PREFERENCES },
          terminal: terminal
            ? { ...DEFAULT_TERMINAL_PREFERENCES, ...(prev.preferences.terminal || {}), ...terminal }
            : prev.preferences.terminal || { ...DEFAULT_TERMINAL_PREFERENCES },
          ui: ui
            ? { ...DEFAULT_UI_PREFERENCES, ...(prev.preferences.ui || {}), ...ui }
            : prev.preferences.ui || { ...DEFAULT_UI_PREFERENCES },
          dock: dock
            ? { ...DEFAULT_DOCK_PREFERENCES, ...(prev.preferences.dock || {}), ...dock }
            : prev.preferences.dock || { ...DEFAULT_DOCK_PREFERENCES },
          media: media
            ? { ...DEFAULT_MEDIA_PREFERENCES, ...(prev.preferences.media || {}), ...media }
            : prev.preferences.media || { ...DEFAULT_MEDIA_PREFERENCES },
          screensaver: screensaver
            ? { ...DEFAULT_SCREENSAVER_PREFERENCES, ...(prev.preferences.screensaver || {}), ...screensaver }
            : prev.preferences.screensaver || { ...DEFAULT_SCREENSAVER_PREFERENCES },
          lockScreen: lockScreen
            ? { ...DEFAULT_LOCK_SCREEN_PREFERENCES, ...(prev.preferences.lockScreen || {}), ...lockScreen }
            : prev.preferences.lockScreen || { ...DEFAULT_LOCK_SCREEN_PREFERENCES },
        },
      };
    });

    const prevQ = queuedPrefRef.current || {};
    queuedPrefRef.current = {
      ...prevQ,
      ...partial,
      stream: partial.stream || prevQ.stream ? { ...(prevQ.stream || {}), ...(partial.stream || {}) } : undefined,
      browser: partial.browser || prevQ.browser ? { ...(prevQ.browser || {}), ...(partial.browser || {}) } : undefined,
      terminal: partial.terminal || prevQ.terminal ? { ...(prevQ.terminal || {}), ...(partial.terminal || {}) } : undefined,
      ui: partial.ui || prevQ.ui ? { ...(prevQ.ui || {}), ...(partial.ui || {}) } : undefined,
      dock: partial.dock || prevQ.dock ? { ...(prevQ.dock || {}), ...(partial.dock || {}) } : undefined,
      media: partial.media || prevQ.media ? { ...(prevQ.media || {}), ...(partial.media || {}) } : undefined,
      screensaver:
        partial.screensaver || prevQ.screensaver
          ? { ...(prevQ.screensaver || {}), ...(partial.screensaver || {}) }
          : undefined,
      lockScreen:
        partial.lockScreen || prevQ.lockScreen
          ? { ...(prevQ.lockScreen || {}), ...(partial.lockScreen || {}) }
          : undefined,
    };
    if (!prefFlushTimerRef.current) {
      prefPendingCountRef.current += 1;
      prefFlushTimerRef.current = setTimeout(() => {
        void flushQueuedPreferences();
      }, 45);
    }
  };

  useEffect(() => {
    const activeTheme = meta.preferences.theme || 'dark';
    document.documentElement.setAttribute('data-theme', activeTheme);
  }, [meta.preferences.theme]);

  useEffect(() => {
    return () => {
      if (themeTimerRef.current) clearTimeout(themeTimerRef.current);
      if (prefFlushTimerRef.current) {
        clearTimeout(prefFlushTimerRef.current);
        prefFlushTimerRef.current = null;
        if (queuedPrefRef.current) {
          const remaining = queuedPrefRef.current;
          queuedPrefRef.current = null;
          void vfsApi.updateMeta({ preferences: remaining }).catch(() => {});
        }
      }
    };
  }, []);

  const handleChangeTheme = useCallback(
    (nextTheme: 'dark' | 'light', origin?: { x: number; y: number }) => {
      const currentTheme = meta.preferences.theme || 'dark';
      if (currentTheme === nextTheme) return;

      const applyThemeDom = () => {
        flushSync(() => {
          setMeta((prev) => ({
            ...prev,
            preferences: { ...prev.preferences, theme: nextTheme },
          }));
        });
        document.documentElement.setAttribute('data-theme', nextTheme);
      };

      const docWithVt = document as Document & {
        startViewTransition?: (cb: () => void) => { ready: Promise<void> };
      };
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

      if (typeof docWithVt.startViewTransition === 'function' && !prefersReducedMotion) {
        const x = origin?.x ?? window.innerWidth / 2;
        const y = origin?.y ?? window.innerHeight / 2;
        const endRadius = Math.hypot(
          Math.max(x, window.innerWidth - x),
          Math.max(y, window.innerHeight - y)
        );
        const vt = docWithVt.startViewTransition(applyThemeDom);
        vt.ready
          .then(() => {
            document.documentElement.animate(
              {
                clipPath: [
                  `circle(0px at ${x}px ${y}px)`,
                  `circle(${endRadius}px at ${x}px ${y}px)`,
                ],
              },
              {
                duration: 560,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                pseudoElement: '::view-transition-new(root)',
              }
            );
          })
          .catch(() => {});
      } else {
        if (themeTimerRef.current) clearTimeout(themeTimerRef.current);
        document.documentElement.classList.add('theme-transitioning');
        applyThemeDom();
        themeTimerRef.current = setTimeout(() => {
          document.documentElement.classList.remove('theme-transitioning');
        }, 460);
      }

      vfsApi
        .updateMeta({ preferences: { theme: nextTheme } })
        .then((res) => setMeta(res.meta))
        .catch(() => {});
    },
    [meta.preferences.theme]
  );

  const handleUploadWallpaper = async (file: File) => {
    try {
      const res = await vfsApi.uploadWallpaper(file);
      setMeta(res.meta);
      pushToast('Arka Plan Güncellendi', `${file.name} masaüstü arka planı yapıldı.`, 'success');
    } catch (e) {
      pushToast('Arka Plan Hatası', (e as Error).message, 'error');
    }
  };

  const handleSetWallpaperFromNode = async (node: VFSNode) => {
    try {
      const res = await vfsApi.setWallpaperFromVfs(node.path);
      setMeta(res.meta);
      pushToast('Arka Plan Güncellendi', `${node.name} masaüstü arka planı yapıldı.`, 'success');
    } catch (e) {
      pushToast('Arka Plan Hatası', (e as Error).message, 'error');
    }
  };

  const handleCloseShortcut = useCallback(() => {
    const curWindows = windowsRef.current;
    const focused = focusedWindowIdRef.current
      ? curWindows.find((w) => w.id === focusedWindowIdRef.current && !w.minimized)
      : undefined;
    const topWin =
      focused ||
      [...curWindows]
        .filter((w) => !w.minimized)
        .sort((a, b) => b.zIndex - a.zIndex)[0];
    if (!topWin) return;

    if (topWin.kind === 'browser' && activeTabIdRef.current) {
      sendWs({ type: 'browser_close_tab', tabId: activeTabIdRef.current });
      return;
    }
    if (topWin.kind === 'linux-app' && topWin.appSessionId) {
      window.dispatchEvent(
        new CustomEvent('tamga-linux-shortcut', {
          detail: {
            sessionId: topWin.appSessionId,
            viewId: topWin.appViewId || 'main',
            key: 'w',
            ctrlKey: true,
          },
        })
      );
      return;
    }
    closeWindowById(topWin.id);
  }, [closeWindowById, sendWs]);

  const handleDismissScreensaver = useCallback(() => {
    const wasPreview = screensaverIsPreview;
    const startedAt = screensaverStartedAtRef.current;
    lastActivityRef.current = Date.now();
    setScreensaverActive(false);
    setScreensaverIsPreview(false);
    if (wasPreview) return;
    const ss = meta.preferences.screensaver;
    if (ss?.requirePassword && authStatus.enabled) {
      const delayMs = Math.max(0, Number(ss.passwordDelayMinutes ?? 0)) * 60_000;
      if (Date.now() - startedAt >= delayMs) {
        activateLockScreen();
      }
    }
  }, [screensaverIsPreview, meta.preferences.screensaver, authStatus.enabled, activateLockScreen]);

  // Prevent accidental browser tab close (Cmd+W / Close button in non-fullscreen browsers)
  useEffect(() => {
    if (!isAuthorized) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isAuthorized]);

  // Lock KeyW & KeyL in Chromium Fullscreen so Cmd/Ctrl+W closes desktop tabs & Cmd+L locks TamgaOS
  useEffect(() => {
    const syncKeyboardLock = () => {
      const fs = Boolean(document.fullscreenElement);
      const kb = (
        navigator as Navigator & {
          keyboard?: { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };
        }
      ).keyboard;
      if (fs && kb?.lock) {
        kb.lock(['KeyW', 'KeyL']).catch(() => {});
      }
    };
    document.addEventListener('fullscreenchange', syncKeyboardLock);
    return () => document.removeEventListener('fullscreenchange', syncKeyboardLock);
  }, []);

  // Track user activity & trigger animated Screensaver after configured idle duration
  useEffect(() => {
    if (!isAuthorized) return;
    const markActive = () => {
      lastActivityRef.current = Date.now();
    };
    window.addEventListener('mousemove', markActive, { passive: true });
    window.addEventListener('mousedown', markActive, { passive: true });
    window.addEventListener('keydown', markActive, { passive: true });
    window.addEventListener('wheel', markActive, { passive: true });
    window.addEventListener('touchstart', markActive, { passive: true });

    const interval = setInterval(() => {
      const ss = meta.preferences.screensaver;
      if (!ss?.enabled || locked || screensaverActive) return;
      const idleMs = Math.max(1, Number(ss.idleMinutes ?? 5)) * 60_000;
      if (Date.now() - lastActivityRef.current >= idleMs) {
        screensaverStartedAtRef.current = Date.now();
        setScreensaverIsPreview(false);
        setScreensaverActive(true);
      }
    }, 10_000);

    return () => {
      clearInterval(interval);
      window.removeEventListener('mousemove', markActive);
      window.removeEventListener('mousedown', markActive);
      window.removeEventListener('keydown', markActive);
      window.removeEventListener('wheel', markActive);
      window.removeEventListener('touchstart', markActive);
    };
  }, [isAuthorized, meta.preferences.screensaver, locked, screensaverActive]);

  // Forward global shortcuts / activity from embedded proxy WebApp iframes
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'tamga_shortcut') {
        if (e.data.action === 'lock') {
          activateLockScreen();
        } else if (e.data.action === 'close-window') {
          handleCloseShortcut();
        }
      } else if (e.data?.type === 'tamga_activity') {
        lastActivityRef.current = Date.now();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [activateLockScreen, handleCloseShortcut]);

  useEffect(() => {
    const isMacHost = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      lastActivityRef.current = Date.now();

      if (locked) {
        const needsPassword = Boolean(
          authStatus.enabled && (meta.preferences.lockScreen?.requirePassword ?? true)
        );
        if (!needsPassword && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          unlockDesktop();
        }
        return;
      }

      const keyLow = e.key.toLowerCase();

      // Cmd+L (macOS) or Ctrl+Alt+L / Super+L (Linux/Win) -> Lock Screen with password
      const isLockHotkey =
        keyLow === 'l' &&
        !e.shiftKey &&
        (isMacHost
          ? e.metaKey && !e.ctrlKey && !e.altKey
          : (e.ctrlKey && e.altKey && !e.metaKey) || (e.metaKey && !e.ctrlKey && !e.altKey));
      if (isLockHotkey) {
        e.preventDefault();
        e.stopPropagation();
        activateLockScreen();
        return;
      }

      // Cmd+W / Ctrl+W -> Close active desktop Chrome tab or top OS window (never close host browser tab)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && keyLow === 'w') {
        e.preventDefault();
        e.stopPropagation();
        handleCloseShortcut();
        return;
      }

      const activeEl = document.activeElement as HTMLElement | null;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'CANVAS' ||
          activeEl.isContentEditable)
      ) {
        return;
      }

      if (e.key === 'F2' && selectedDesktopPaths.length === 1) {
        e.preventDefault();
        setRenamingPath(selectedDesktopPaths[0]);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDesktopPaths.length > 0) {
        e.preventDefault();
        handleTrashPaths(selectedDesktopPaths);
      } else if (e.key === 'Enter' && selectedDesktopPaths.length === 1) {
        const node = desktopNodes.find((n) => n.path === selectedDesktopPaths[0]);
        if (node) handleOpenNode(node);
      } else if ((e.metaKey || e.ctrlKey) && keyLow === 'a') {
        e.preventDefault();
        setSelectedDesktopPaths(desktopNodes.map((n) => n.path));
      } else if ((e.metaKey || e.ctrlKey) && keyLow === 'c' && selectedDesktopPaths.length) {
        e.preventDefault();
        setClipboard({ mode: 'copy', paths: selectedDesktopPaths });
      } else if ((e.metaKey || e.ctrlKey) && keyLow === 'x' && selectedDesktopPaths.length) {
        e.preventDefault();
        setClipboard({ mode: 'cut', paths: selectedDesktopPaths });
      } else if ((e.metaKey || e.ctrlKey) && keyLow === 'v') {
        e.preventDefault();
        handlePaste('/Desktop');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    locked,
    authStatus.enabled,
    meta.preferences.lockScreen?.requirePassword,
    unlockDesktop,
    activateLockScreen,
    handleCloseShortcut,
    selectedDesktopPaths,
    desktopNodes,
    clipboard,
  ]);

  if (!authChecked) {
    return <div className="w-screen h-screen bg-[var(--os-bg)]" />;
  }

  if (authStatus.enabled && !authStatus.authenticated) {
    return (
      <LoginScreen
        serverName={authStatus.serverName}
        hostname={authStatus.hostname}
        version={authStatus.version}
        onSuccess={(username) =>
          setAuthStatus((prev) => ({ ...prev, authenticated: true, username }))
        }
      />
    );
  }

  if (!prefsReady) {
    return <div className="w-screen h-screen bg-[var(--os-bg)]" />;
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden select-none bg-[var(--os-bg)] text-[var(--os-text)]">
      {/* Animated Wallpaper Layer (Custom Image or Built-in Day/Night Geometric Presets) */}
      <WallpaperLayer
        wallpaperId={meta.preferences.wallpaper}
        theme={meta.preferences.theme || 'dark'}
        customWallpaper={meta.preferences.customWallpaper}
      />

      <input
        ref={globalUploadRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            handleUploadFiles(uploadTargetDir, e.target.files);
            e.target.value = '';
          }
        }}
      />

      <input
        ref={wallpaperUploadRef}
        type="file"
        accept="image/*"
        data-testid="wallpaper-file-input"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            handleUploadWallpaper(file);
            e.target.value = '';
          }
        }}
      />

      {/* DESKTOP CANVAS */}
      <DesktopCanvas
        desktopNodes={desktopNodes}
        trashCount={trashCount}
        meta={meta}
        clipboard={clipboard}
        selectedPaths={selectedDesktopPaths}
        onSelectPaths={setSelectedDesktopPaths}
        renamingPath={renamingPath}
        onSetRenamingPath={setRenamingPath}
        onRenameCommit={handleRenameCommit}
        onOpenNode={handleOpenNode}
        primaryBrowserLabel="Google Chrome"
        useFirefoxIcon={false}
        onOpenChromium={openPrimaryBrowser}
        onOpenTerminal={() => openTerminalWindow('/Desktop')}
        onOpenAppStore={openAppStoreWindow}
        onOpenFolderWindow={openFolderWindow}
        onMoveNodesToFolder={handleMoveNodes}
        onTrashNodes={handleTrashPaths}
        onSaveIconPosition={async (p, pos) => {
          const res = await vfsApi.updateMeta({
            positions: { [p]: pos },
            preferences: { autoArrange: false },
          });
          setMeta(res.meta);
        }}
        onUploadHostFiles={(files) => handleUploadFiles('/Desktop', files)}
        onContextMenu={(x, y, target) => setCtxMenu({ x, y, target })}
        onExternalDropHover={setExternalDropTarget}
        onDropFilesOnLinuxApp={handleDropFilesOnLinuxApp}
      />

      {/* OPEN WINDOWS */}
      {windows.map((win) => {
        const isWinDropHighlighted =
          (win.kind === 'browser' && externalDropTarget === 'browser') ||
          (win.kind === 'folder' &&
            Boolean(win.folderPath) &&
            externalDropTarget === `folder:${win.folderPath}`) ||
          (win.kind === 'linux-app' &&
            Boolean(win.appSessionId) &&
            externalDropTarget === `linux-app:${win.appSessionId}`);

        const activeDock = { ...DEFAULT_DOCK_PREFERENCES, ...(meta.preferences.dock || {}) };
        const dockPos = activeDock.position || 'bottom';
        const isDockVert = dockPos === 'left' || dockPos === 'right';
        const dockScaleVal = Math.max(
          0.85,
          Math.min(
            1.85,
            activeDock.barScale ??
              (activeDock.size === 'sm' ? 1.0 : activeDock.size === 'lg' ? 1.65 : 1.4)
          )
        );
        const dockReserve =
          Math.max(
            68,
            Math.round((isDockVert ? 58 : 54) * dockScaleVal) +
              (activeDock.style === 'full' ? 8 : 20)
          );

        return (
          <WindowFrame
            key={win.id}
            win={win}
            isFocused={focusedWindowId === win.id}
            isDropHighlighted={isWinDropHighlighted}
            hiddenUntilReady={Boolean(win.launching)}
            dockPosition={dockPos}
            dockReserve={dockReserve}
            onFocus={focusWindow}
            onClose={closeWindowById}
            onMinimize={(id) =>
              setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, minimized: true } : w)))
            }
            onToggleMaximize={(id) =>
              setWindows((prev) =>
                prev.map((w) =>
                  w.id === id ? { ...w, maximized: !w.maximized, snap: null } : w
                )
              )
            }
            onUpdateBounds={(id, bounds) =>
              setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, ...bounds } : w)))
            }
            minWidth={win.kind === 'properties' ? 280 : win.kind === 'linux-app' ? 240 : 420}
            minHeight={win.kind === 'properties' ? 220 : win.kind === 'linux-app' ? 180 : 300}
            overlayTitlebar={win.kind === 'vscode'}
            headerContent={
              win.kind === 'browser' ? (
                <ChromiumTabStrip
                  tabs={tabs}
                  activeTabId={activeTabId}
                  defaultUrl={
                    meta.preferences.browser?.defaultUrl || DEFAULT_BROWSER_PREFERENCES.defaultUrl
                  }
                  sendWs={sendWs}
                />
              ) : undefined
            }
          >
            {win.kind === 'browser' && (
              <ChromiumWindowBody
                tabs={tabs}
                activeTabId={activeTabId}
                subscribeVideoFrame={subscribeVideoFrame}
                desktopNodes={desktopNodes}
                allNodes={allNodes}
                volume={volume}
                muted={muted}
                defaultUrl={
                  meta.preferences.browser?.defaultUrl || DEFAULT_BROWSER_PREFERENCES.defaultUrl
                }
                maxDpr={meta.preferences.stream?.maxDpr ?? 2}
                sendWs={sendWs}
                onOpenFolder={openFolderWindow}
                onVfsSaved={refreshVfs}
                onNotify={pushToast}
                browserCursor={browserCursor}
              />
            )}

            {win.kind === 'preview' && win.previewNodePath && (
              <PreviewWindow
                initialPath={win.previewNodePath}
                allNodes={allNodes}
                onTitleChange={(nextTitle, nextPath) =>
                  setWindows((prev) =>
                    prev.map((w) =>
                      w.id === win.id
                        ? { ...w, title: nextTitle, previewNodePath: nextPath }
                        : w
                    )
                  )
                }
                onVfsSaved={refreshVfs}
                onSetWallpaper={handleSetWallpaperFromNode}
                onNotify={pushToast}
              />
            )}

            {win.kind === 'terminal' && win.terminalSessionId && (
              <TerminalWindow
                sessionId={win.terminalSessionId}
                cwdPath={win.terminalCwd}
                initialCommand={win.terminalInitialCommand}
                fontSize={meta.preferences.terminal?.fontSize ?? 13}
                cursorBlink={meta.preferences.terminal?.cursorBlink ?? true}
                theme={meta.preferences.theme || 'dark'}
                onClipboardSync={syncClipboardAcrossDesktop}
                onExit={() => {
                  setWindows((prev) => prev.filter((w) => w.id !== win.id));
                }}
              />
            )}

            {win.kind === 'vscode' && (
              <VSCodeWindow
                folderPath={win.folderPath}
                directUrl={win.vscodeUrl}
                theme={meta.preferences.theme || 'dark'}
                onClipboardSync={syncClipboardAcrossDesktop}
                onOpenNewWindow={(req) =>
                  openVSCodeWindow({
                    folderPath: req.folderPath || win.folderPath,
                    url: req.url,
                    width: req.width,
                    height: req.height,
                    forceNew: true,
                  })
                }
              />
            )}

            {win.kind === 'web-app' && (
              <WebAppWindow
                url={win.webAppUrl || 'https://www.google.com'}
                appName={win.title}
                onTitleChange={(nextTitle) =>
                  setWindows((prev) =>
                    prev.map((w) => (w.id === win.id ? { ...w, title: nextTitle } : w))
                  )
                }
                onOpenInChrome={(targetUrl) => openPrimaryBrowser(targetUrl)}
                onNotify={pushToast}
              />
            )}

            {win.kind === 'linux-app' && win.appSessionId && (
              <LinuxAppWindow
                sessionId={win.appSessionId}
                viewId={win.appViewId || 'main'}
                appName={win.title}
                isFocused={focusedWindowId === win.id}
                externalDropHighlighted={externalDropTarget === `linux-app:${win.appSessionId}`}
                scrollSensitivity={meta.preferences.stream?.scrollSensitivity ?? 1.0}
                onVfsChanged={refreshVfs}
                onClipboardSync={syncClipboardAcrossDesktop}
                onLockScreen={activateLockScreen}
                onNotify={pushToast}
                onReady={() => {
                  setWindows((prev) =>
                    prev.map((w) => (w.id === win.id && w.launching ? { ...w, launching: false } : w))
                  );
                  focusWindow(win.id);
                }}
                onTitleChange={(nextTitle) =>
                  setWindows((prev) =>
                    prev.map((w) => (w.id === win.id ? { ...w, title: nextTitle } : w))
                  )
                }
                onWindowOpened={(extra) => {
                  const vw = window.innerWidth;
                  const vh = window.innerHeight - 76;
                  const extraW = Math.max(240, Math.min(vw - 28, Math.round(extra.width || 900)));
                  const extraH = Math.max(222, Math.min(vh - 14, Math.round((extra.height || 640) + 42)));
                  const extraId = `win-linux-${win.appSessionId}-${extra.view}`;
                  const z = ++nextZRef.current;
                  setWindows((prev) => {
                    if (prev.some((w) => w.id === extraId)) return prev;
                    return [
                      ...prev,
                      {
                        id: extraId,
                        kind: 'linux-app',
                        title: extra.title || win.title,
                        appSessionId: win.appSessionId,
                        appViewId: extra.view,
                        appId: win.appId,
                        appIconName: win.appIconName,
                        launching: true,
                        x: Math.max(18, Math.min(vw - extraW - 18, win.x + 34)),
                        y: Math.max(18, Math.min(vh - extraH - 12, win.y + 34)),
                        width: extraW,
                        height: extraH,
                        minimized: false,
                        maximized: false,
                        zIndex: z,
                      },
                    ];
                  });
                  setFocusedWindowId(extraId);
                }}
                onAppExit={() => {
                  setWindows((prev) => prev.filter((w) => w.id !== win.id));
                }}
              />
            )}

            {win.kind === 'app-store' && (
              <AppStoreWindow
                runtime={linuxRuntime}
                apps={linuxApps}
                allowInstall={allowAppInstall}
                onRefreshApps={refreshApps}
                onLaunchApp={(app, opts) =>
                  launchLinuxApp({
                    appId: app.id,
                    command: app.command,
                    appName: app.name,
                    iconName: app.iconName,
                    needsNoSandbox: app.needsNoSandbox,
                    launchMode: app.launchMode,
                    forceNew: opts?.forceNew,
                  })
                }
                onLaunchCustomCommand={(cmd) => {
                  const trimmed = cmd.trim();
                  if (/^https?:\/\//i.test(trimmed)) {
                    openWebAppWindow({
                      appId: 'custom-web',
                      url: trimmed,
                      title: trimmed.replace(/^https?:\/\//i, '').split('/')[0] || 'Web Uygulaması',
                      forceNew: true,
                    });
                    return;
                  }
                  launchLinuxApp({
                    appId: 'custom',
                    command: trimmed,
                    appName: trimmed.split(' ')[0] || 'Uygulama',
                  });
                }}
                onOpenTerminal={() => openTerminalWindow('/Desktop')}
              />
            )}

            {win.kind === 'folder' && (
              <FolderWindow
                initialPath={win.folderPath || '/Desktop'}
                allNodes={allNodes}
                clipboard={clipboard}
                externalDropTarget={externalDropTarget}
                renamingPath={renamingPath}
                onSetRenamingPath={setRenamingPath}
                onRenameCommit={handleRenameCommit}
                onOpenNode={handleOpenNode}
                onPathChangeTitle={(newTitle, newPath) =>
                  setWindows((prev) =>
                    prev.map((w) =>
                      w.id === win.id ? { ...w, title: newTitle, folderPath: newPath } : w
                    )
                  )
                }
                onCreateFolder={(dir) => handleCreateFolder(dir)}
                onOpenCustomFileDialog={(dir) => setCustomFileDialog({ parentPath: dir })}
                onUploadFiles={handleUploadFiles}
                onMoveNodes={handleMoveNodes}
                onTrashNodes={(nodes) => handleTrashPaths(nodes.map((n) => n.path))}
                onRestoreNodes={handleRestoreNodes}
                onEmptyTrash={handleEmptyTrash}
                onContextMenu={(x, y, target) => setCtxMenu({ x, y, target })}
              />
            )}

            {win.kind === 'properties' && (
              <PropertiesPane
                node={allNodes.find((n) => n.path === win.targetNodePath)}
                onOpenNode={handleOpenNode}
                onClose={() => setWindows((prev) => prev.filter((w) => w.id !== win.id))}
              />
            )}

            {win.kind === 'settings' && (
              <SettingsWindow
                initialTab={win.settingsTab || 'stream'}
                meta={meta}
                telemetry={telemetry}
                pingMs={pingMs}
                lastFrameKB={lastFrameKB}
                brightness={brightness}
                volume={volume}
                muted={muted}
                authStatus={authStatus}
                currentDesktop={currentDesktop}
                desktops={desktops}
                onUpdatePreferences={handleUpdatePreferences}
                onToggleTheme={handleChangeTheme}
                onTriggerWallpaperUpload={() => wallpaperUploadRef.current?.click()}
                onChangeBrightness={setBrightness}
                onChangeVolume={(v) => {
                  setVolume(v);
                  if (v > 0 && muted) setMuted(false);
                }}
                onToggleMute={() => setMuted((m) => !m)}
                onOpenTerminal={(dir) => openTerminalWindow(dir || '/Desktop')}
                onSwitchDesktop={handleSwitchDesktop}
                onCreateDesktop={handleCreateDesktop}
                onLockScreen={activateLockScreen}
                onPreviewScreensaver={() => {
                  screensaverStartedAtRef.current = Date.now();
                  setScreensaverIsPreview(true);
                  setScreensaverActive(true);
                }}
                onSendWs={sendWs}
                onLogout={handleLogout}
                onNotify={pushToast}
              />
            )}
          </WindowFrame>
        );
      })}

      {/* CONTEXT MENU */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          target={ctxMenu.target}
          clipboard={clipboard}
          preferences={meta.preferences}
          hasTrashItems={trashCount > 0}
          onClose={() => setCtxMenu(null)}
          onCreateFolder={handleCreateFolder}
          onCreateQuickFile={handleCreateFile}
          onOpenCustomFileDialog={(dirPath, pos) => setCustomFileDialog({ parentPath: dirPath, pos })}
          onTriggerUpload={(dirPath) => {
            setUploadTargetDir(dirPath);
            globalUploadRef.current?.click();
          }}
          onTriggerWallpaperUpload={() => wallpaperUploadRef.current?.click()}
          onSetWallpaperFromNode={handleSetWallpaperFromNode}
          onOpenNode={handleOpenNode}
          onStartRename={(node) => setRenamingPath(node.path)}
          onCopy={(nodes) => setClipboard({ mode: 'copy', paths: nodes.map((n) => n.path) })}
          onCut={(nodes) => setClipboard({ mode: 'cut', paths: nodes.map((n) => n.path) })}
          onDuplicate={handleDuplicate}
          onPaste={handlePaste}
          onTrash={(nodes) => handleTrashPaths(nodes.map((n) => n.path))}
          onRestore={handleRestoreNodes}
          onDeletePermanent={handleDeletePermanent}
          onEmptyTrash={handleEmptyTrash}
          onCompressZip={handleCompressZip}
          onExtractZip={handleExtractZip}
          onDownloadHost={(node) => {
            const a = document.createElement('a');
            a.href = buildRawFileUrl(node.path, '&download=1');
            a.click();
          }}
          onShowProperties={openPropertiesWindow}
          onOpenChromium={() => openPrimaryBrowser()}
          onOpenFolderWindow={openFolderWindow}
          onOpenTerminalInDir={(dirPath) => openTerminalWindow(dirPath)}
          onOpenSettings={(tab) => openSettingsWindow(tab || 'stream')}
          onUpdatePreferences={handleUpdatePreferences}
          onCycleWallpaper={() => {
            const idx = WALLPAPERS.findIndex((w) => w.id === meta.preferences.wallpaper);
            const next = WALLPAPERS[(idx + 1) % WALLPAPERS.length];
            handleUpdatePreferences({ wallpaper: next.id });
          }}
          onRefresh={refreshVfs}
        />
      )}

      {/* CUSTOM FILE EXTENSION CREATOR */}
      {customFileDialog && (
        <NewCustomFileModal
          parentPath={customFileDialog.parentPath}
          onClose={() => setCustomFileDialog(null)}
          onCreate={(fileName) => {
            const { parentPath, pos } = customFileDialog;
            setCustomFileDialog(null);
            handleCreateFile(parentPath, fileName, pos);
          }}
        />
      )}

      {/* TOP-RIGHT SLIDE-IN FULLSCREEN RECOMMENDATION */}
      {(meta.preferences.ui?.showFullscreenNotice ?? true) && (
        <FullscreenNotice locked={locked || screensaverActive} />
      )}

      {/* TOAST NOTIFICATIONS */}
      <div
        className={`fixed ${
          (meta.preferences.dock?.position || 'bottom') === 'bottom'
            ? 'bottom-28 right-5'
            : (meta.preferences.dock?.position || 'bottom') === 'right'
            ? 'bottom-5 right-28'
            : 'bottom-5 right-5'
        } z-[9970] flex flex-col gap-2 w-76 pointer-events-none`}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{ boxShadow: 'var(--os-shadow)' }}
            className="pointer-events-auto p-3.5 rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] flex items-start gap-2.5 text-xs text-[var(--os-text)]"
          >
            {t.kind === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-[var(--os-text)] shrink-0 mt-0.5" />
            ) : t.kind === 'error' || t.kind === 'warning' ? (
              <TriangleAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            ) : (
              <Info className="w-4 h-4 text-[var(--os-text-secondary)] shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[var(--os-text)]">{t.title}</div>
              <div className="text-[11px] text-[var(--os-text-muted)] mt-0.5">{t.message}</div>
              {t.actionLabel && t.onAction && (
                <button
                  onClick={() => {
                    t.onAction?.();
                    setToasts((prev) => prev.filter((x) => x.id !== t.id));
                  }}
                  className="mt-2 px-2.5 py-1 rounded-lg bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] text-[11px] font-semibold"
                >
                  {t.actionLabel}
                </button>
              )}
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="text-[var(--os-text-subtle)] hover:text-[var(--os-text)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* CUSTOMIZABLE DOCK / PANEL */}
      <Taskbar
        windows={windows}
        focusedWindowId={focusedWindowId}
        allNodes={allNodes}
        telemetry={telemetry}
        pingMs={pingMs}
        notificationHistory={notificationHistory}
        theme={meta.preferences.theme || 'dark'}
        dock={{ ...DEFAULT_DOCK_PREFERENCES, ...(meta.preferences.dock || {}) }}
        brightness={brightness}
        volume={volume}
        muted={muted}
        currentDesktop={currentDesktop}
        desktops={desktops}
        linuxApps={linuxApps}
        linuxGuiReady={Boolean(linuxRuntime?.guiReady)}
        useFirefoxIcon={false}
        primaryBrowserLabel="Google Chrome"
        authEnabled={authStatus.enabled}
        onSwitchDesktop={handleSwitchDesktop}
        onCreateDesktop={handleCreateDesktop}
        onDeleteDesktop={handleDeleteDesktop}
        onCopyDesktopLink={handleCopyDesktopLink}
        onChangeBrightness={setBrightness}
        onChangeVolume={(v) => {
          setVolume(v);
          if (v > 0 && muted) setMuted(false);
        }}
        onToggleMute={() => setMuted((m) => !m)}
        onToggleTheme={handleChangeTheme}
        onClearNotifications={() => setNotificationHistory([])}
        onOpenBrowser={(opts) => openPrimaryBrowser(opts)}
        onOpenTerminal={() => openTerminalWindow('/Desktop')}
        onOpenAppStore={openAppStoreWindow}
        onOpenSettings={(tab) => openSettingsWindow(tab || 'stream')}
        onLaunchLinuxApp={(app, opts) =>
          launchLinuxApp({
            appId: app.id,
            command: app.command,
            appName: app.name,
            iconName: app.iconName,
            needsNoSandbox: app.needsNoSandbox,
            launchMode: app.launchMode,
            forceNew: opts?.forceNew,
          })
        }
        onOpenFolder={openFolderWindow}
        onOpenNode={handleOpenNode}
        onCloseWindow={closeWindowById}
        onToggleWindowFromTaskbar={(winId) => {
          const target = windows.find((w) => w.id === winId);
          if (!target) return;
          if (target.minimized) focusWindow(winId);
          else if (focusedWindowId === winId) {
            setWindows((prev) =>
              prev.map((w) => (w.id === winId ? { ...w, minimized: true } : w))
            );
            setFocusedWindowId(null);
          } else {
            focusWindow(winId);
          }
        }}
        onLockScreen={activateLockScreen}
        onReboot={refreshVfs}
        onLogout={handleLogout}
      />

      {/* ANIMATED SCREENSAVER */}
      <ScreensaverOverlay
        active={screensaverActive && !locked}
        scene={meta.preferences.screensaver?.scene || DEFAULT_SCREENSAVER_PREFERENCES.scene}
        customVideoUrl={meta.preferences.screensaver?.customVideoUrl}
        currentWallpaperId={meta.preferences.wallpaper}
        currentCustomWallpaper={meta.preferences.customWallpaper}
        theme={meta.preferences.theme || 'dark'}
        requirePassword={Boolean(
          authStatus.enabled && (meta.preferences.screensaver?.requirePassword ?? true)
        )}
        onDismiss={handleDismissScreensaver}
      />

      {/* LOCK SCREEN */}
      <LockScreenOverlay
        locked={locked}
        style={meta.preferences.lockScreen?.style || DEFAULT_LOCK_SCREEN_PREFERENCES.style}
        showClock={meta.preferences.lockScreen?.showClock ?? true}
        requirePassword={meta.preferences.lockScreen?.requirePassword ?? true}
        wallpaperId={meta.preferences.wallpaper}
        customWallpaper={meta.preferences.customWallpaper}
        theme={meta.preferences.theme || 'dark'}
        authStatus={authStatus}
        lockClock={lockClock}
        onUnlock={unlockDesktop}
        onLogout={authStatus.enabled ? handleLogout : undefined}
      />

      {/* OFFLINE / DISCONNECTED BLUR OVERLAY */}
      <OfflineBannerOverlay
        offline={!isBrowserOnline || wsDisconnected}
        onRetry={() => {
          setIsBrowserOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
          setWsReconnectNonce((n) => n + 1);
          refreshVfs();
        }}
      />

      {/* BRIGHTNESS OVERLAY */}
      {brightness < 100 && (
        <div
          style={{ opacity: (100 - brightness) / 100 }}
          className="pointer-events-none fixed inset-0 z-[9997] bg-black"
        />
      )}
    </div>
  );
}
