import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { CheckCircle2, Info, Lock, TriangleAlert, X } from 'lucide-react';
import {
  WALLPAPERS,
  type AuthStatus,
  type ClipboardState,
  type DesktopMeta,
  type LinuxAppInfo,
  type LinuxRuntimeStatus,
  type OSWindow,
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
import { LoginScreen } from './components/auth/LoginScreen';
import { TerminalWindow } from './components/apps/TerminalWindow';
import { LinuxAppWindow } from './components/apps/LinuxAppWindow';
import { AppStoreWindow } from './components/apps/AppStoreWindow';
import { VSCodeWindow } from './components/apps/VSCodeWindow';
import { Taskbar } from './components/taskbar/Taskbar';
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
  },
};

function readInitialDesktopId(): string {
  if (typeof window === 'undefined') return 'main';
  const params = new URLSearchParams(window.location.search);
  return params.get('desktop') || 'main';
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

  const [locked, setLocked] = useState(false);
  const [lockClock, setLockClock] = useState(() => new Date());

  const [allNodes, setAllNodes] = useState<VFSNode[]>([]);
  const [meta, setMeta] = useState<DesktopMeta>(DEFAULT_META);
  const [selectedDesktopPaths, setSelectedDesktopPaths] = useState<string[]>([]);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);

  const [windows, setWindows] = useState<OSWindow[]>([]);
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const [focusedWindowId, setFocusedWindowId] = useState<string | null>(null);
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
  const [uploadTargetDir, setUploadTargetDir] = useState('/Desktop');

  const wsRef = useRef<WebSocket | null>(null);
  const wsQueueRef = useRef<string[]>([]);
  const videoListenersRef = useRef<Set<(jpegBytes: Uint8Array) => void>>(new Set());
  const lastVideoBytesRef = useRef<Uint8Array | null>(null);

  const [tabs, setTabs] = useState<TabSummary[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [pingMs, setPingMs] = useState<number>(2);

  const isAuthorized = authChecked && (!authStatus.enabled || authStatus.authenticated);

  const [brightness, setBrightness] = useState(100);
  const [volume, setVolume] = useState(85);
  const [muted, setMuted] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [notificationHistory, setNotificationHistory] = useState<ToastItem[]>([]);

  useEffect(() => {
    remoteAudio.setVolume(volume, muted);
  }, [volume, muted]);

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
      setMeta(snap.meta);
      if (snap.desktop) setCurrentDesktop(snap.desktop);
      if (snap.desktops) setDesktops(snap.desktops);
    } catch {
      // retry via WS
    }
  }, []);

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
      await authApi.logout();
    } catch {}
    setWindows([]);
    setFocusedWindowId(null);
    setAuthStatus((prev) => ({ ...prev, authenticated: false }));
  }, []);

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
      }
    },
    [sendWs]
  );

  const openTerminalWindow = useCallback(() => {
    const z = ++nextZRef.current;
    const sessionId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const id = `win-${sessionId}`;
    const vw = window.innerWidth;
    const vh = window.innerHeight - 76;
    const width = Math.min(820, vw - 36);
    const height = Math.min(520, vh - 36);
    setWindows((prev) => {
      const offset = (prev.length % 5) * 24;
      return [
        ...prev,
        {
          id,
          kind: 'terminal',
          title: 'Terminal',
          terminalSessionId: sessionId,
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
      const width = Math.min(840, vw - 36);
      const height = Math.min(600, vh - 36);
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
            title: 'Visual Studio Code',
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

  const launchLinuxApp = useCallback(
    async (params: {
      appId?: string;
      command?: string;
      appName?: string;
      needsNoSandbox?: boolean;
      forceNew?: boolean;
    }) => {
      remoteAudio.ensureContext();
      const vw = window.innerWidth;
      const vh = window.innerHeight - 76;
      const viewportWidth = Math.max(960, vw - 36);
      const viewportHeight = Math.max(600, vh - 32 - 42);
      const width = Math.min(740, vw - 36);
      const height = Math.min(520, vh - 32);

      // Run Visual Studio Code in 100% Web-Native DOM mode (zero video lag, zero remote cursor!)
      if (params.appId === 'vscode' || params.command?.trim() === 'code') {
        openVSCodeWindow({ folderPath: '/Projects', forceNew: params.forceNew });
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
        // the existing main WebSocket receives `window_opened` and spawns the new WindowFrame.
        const hasExistingSessionWindow = windowsRef.current.some(
          (w) => w.kind === 'linux-app' && w.appSessionId === res.sessionId
        );
        if (res.openedAsExtraWindow && hasExistingSessionWindow) {
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
      } catch (e) {
        pushToast('Uygulama Başlatılamadı', (e as Error).message, 'error');
      }
    },
    [pushToast, openVSCodeWindow]
  );

  const firefoxApp = useMemo(
    () => linuxApps.find((a) => a.id === 'firefox' && a.installed),
    [linuxApps]
  );
  const useFirefoxAsPrimary = Boolean(linuxRuntime?.guiReady && firefoxApp);

  const openPrimaryBrowser = useCallback(
    (initialUrl?: string) => {
      // Local VFS files open inside our instant local file viewer/editor; web browser launches native Firefox on Linux
      if (!initialUrl && useFirefoxAsPrimary && firefoxApp) {
        launchLinuxApp({
          appId: firefoxApp.id,
          command: firefoxApp.command,
          appName: firefoxApp.name,
          needsNoSandbox: firefoxApp.needsNoSandbox,
        });
        return;
      }
      openChromiumWindow(initialUrl);
    },
    [useFirefoxAsPrimary, firefoxApp, launchLinuxApp, openChromiumWindow]
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
            case 'telemetry':
              setTelemetry(msg.data);
              break;
            case 'vfs_snapshot':
              if (msg.snapshot) {
                setAllNodes(msg.snapshot.nodes);
                setMeta(msg.snapshot.meta);
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
        if (!closed) reconnectTimer = setTimeout(connect, 1200);
      };
    };

    connect();
    return () => {
      closed = true;
      if (pingInterval) clearInterval(pingInterval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [desktopId, isAuthorized, pushToast, openFolderWindow]);

  const handleSwitchDesktop = useCallback((nextId: string) => {
    setWindows([]);
    setFocusedWindowId(null);
    setSelectedDesktopPaths([]);
    setRenamingPath(null);
    setCtxMenu(null);
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
      else openChromiumWindow(`file://${node.path}`);
    },
    [openFolderWindow, openChromiumWindow]
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

  const handleUpdatePreferences = async (partial: Partial<DesktopMeta['preferences']>) => {
    try {
      if (partial.autoArrange) await vfsApi.resetPositions();
      const res = await vfsApi.updateMeta({ preferences: partial });
      setMeta(res.meta);
    } catch {}
  };

  useEffect(() => {
    const activeTheme = meta.preferences.theme || 'dark';
    document.documentElement.setAttribute('data-theme', activeTheme);
  }, [meta.preferences.theme]);

  useEffect(() => {
    return () => {
      if (themeTimerRef.current) clearTimeout(themeTimerRef.current);
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (locked) {
        if (e.key === 'Enter' || e.key === ' ') setLocked(false);
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
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedDesktopPaths(desktopNodes.map((n) => n.path));
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && selectedDesktopPaths.length) {
        e.preventDefault();
        setClipboard({ mode: 'copy', paths: selectedDesktopPaths });
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x' && selectedDesktopPaths.length) {
        e.preventDefault();
        setClipboard({ mode: 'cut', paths: selectedDesktopPaths });
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        handlePaste('/Desktop');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [locked, selectedDesktopPaths, desktopNodes, clipboard]);

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

  return (
    <div className="relative w-screen h-screen overflow-hidden select-none bg-[var(--os-bg)] text-[var(--os-text)]">
      {/* Animated Wallpaper Layer (Custom Image or Built-in Presets) */}
      <WallpaperLayer
        wallpaperId={meta.preferences.wallpaper}
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
        primaryBrowserLabel={useFirefoxAsPrimary ? 'Firefox' : 'Chromium'}
        useFirefoxIcon={useFirefoxAsPrimary}
        onOpenChromium={openPrimaryBrowser}
        onOpenTerminal={openTerminalWindow}
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
      />

      {/* OPEN WINDOWS */}
      {windows.map((win) => {
        const isWinDropHighlighted =
          (win.kind === 'browser' && externalDropTarget === 'browser') ||
          (win.kind === 'folder' &&
            Boolean(win.folderPath) &&
            externalDropTarget === `folder:${win.folderPath}`);

        return (
          <WindowFrame
            key={win.id}
            win={win}
            isFocused={focusedWindowId === win.id}
            isDropHighlighted={isWinDropHighlighted}
            onFocus={focusWindow}
            onClose={(id) => {
              const target = windows.find((w) => w.id === id);
              if (target?.kind === 'linux-app' && target.appSessionId) {
                appsApi.close(target.appSessionId, target.appViewId || 'main').catch(() => {});
              }
              setWindows((prev) => prev.filter((w) => w.id !== id));
              if (focusedWindowId === id) setFocusedWindowId(null);
            }}
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
                <ChromiumTabStrip tabs={tabs} activeTabId={activeTabId} sendWs={sendWs} />
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
                sendWs={sendWs}
                onOpenFolder={openFolderWindow}
                onVfsSaved={refreshVfs}
                onNotify={pushToast}
              />
            )}

            {win.kind === 'terminal' && win.terminalSessionId && (
              <TerminalWindow
                sessionId={win.terminalSessionId}
                theme={meta.preferences.theme || 'dark'}
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

            {win.kind === 'linux-app' && win.appSessionId && (
              <LinuxAppWindow
                sessionId={win.appSessionId}
                viewId={win.appViewId || 'main'}
                appName={win.title}
                isFocused={focusedWindowId === win.id}
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
                    needsNoSandbox: app.needsNoSandbox,
                    forceNew: opts?.forceNew,
                  })
                }
                onLaunchCustomCommand={(cmd) =>
                  launchLinuxApp({
                    appId: 'custom',
                    command: cmd,
                    appName: cmd.split(' ')[0] || 'Uygulama',
                  })
                }
                onOpenTerminal={openTerminalWindow}
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
      <FullscreenNotice locked={locked} />

      {/* TOAST NOTIFICATIONS */}
      <div className="fixed bottom-20 right-5 z-[9970] flex flex-col gap-2 w-76 pointer-events-none">
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

      {/* FLOATING BOTTOM BAR */}
      <Taskbar
        windows={windows}
        focusedWindowId={focusedWindowId}
        allNodes={allNodes}
        telemetry={telemetry}
        pingMs={pingMs}
        notificationHistory={notificationHistory}
        wallpaperId={meta.preferences.wallpaper}
        customWallpaper={meta.preferences.customWallpaper}
        theme={meta.preferences.theme || 'dark'}
        brightness={brightness}
        volume={volume}
        muted={muted}
        currentDesktop={currentDesktop}
        desktops={desktops}
        linuxApps={linuxApps}
        linuxGuiReady={Boolean(linuxRuntime?.guiReady)}
        useFirefoxIcon={useFirefoxAsPrimary}
        primaryBrowserLabel={useFirefoxAsPrimary ? 'Firefox' : 'Chromium'}
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
        onSelectWallpaper={(id) => handleUpdatePreferences({ wallpaper: id })}
        onTriggerWallpaperUpload={() => wallpaperUploadRef.current?.click()}
        onToggleTheme={handleChangeTheme}
        onClearNotifications={() => setNotificationHistory([])}
        onOpenBrowser={() => openPrimaryBrowser()}
        onOpenTerminal={openTerminalWindow}
        onOpenAppStore={openAppStoreWindow}
        onLaunchLinuxApp={(app) =>
          launchLinuxApp({
            appId: app.id,
            command: app.command,
            appName: app.name,
            needsNoSandbox: app.needsNoSandbox,
          })
        }
        onOpenFolder={openFolderWindow}
        onOpenNode={handleOpenNode}
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
        onLockScreen={() => setLocked(true)}
        onReboot={refreshVfs}
        onLogout={handleLogout}
      />

      {/* LOCK SCREEN */}
      {locked && (
        <div
          onClick={() => setLocked(false)}
          className="fixed inset-0 z-[9998] bg-[var(--os-lock-bg)] backdrop-blur-xl flex flex-col items-center justify-center text-[var(--os-text)] cursor-pointer"
        >
          <div className="text-7xl font-extralight font-mono tracking-tight">
            {lockClock.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="text-sm text-[var(--os-text-muted)] capitalize mt-3">
            {lockClock.toLocaleDateString('tr-TR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </div>
          <div className="mt-10 px-5 py-2.5 rounded-full bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] flex items-center gap-2 text-xs text-[var(--os-text-secondary)]">
            <Lock className="w-3.5 h-3.5" />
            <span>Açmak için dokunun veya tıklayın</span>
          </div>
        </div>
      )}

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
