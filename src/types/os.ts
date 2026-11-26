export interface VFSNode {
  name: string;
  path: string;
  parentPath: string;
  isDir: boolean;
  extension: string;
  size: number;
  childCount: number;
  createdAt: string;
  modifiedAt: string;
  originalPath?: string;
}

export interface DesktopMeta {
  positions: Record<string, { x: number; y: number }>;
  trashOrigins: Record<string, string>;
  preferences: {
    wallpaper: string;
    customWallpaper?: string;
    theme: 'dark' | 'light';
    iconSize: 'sm' | 'md' | 'lg';
    autoArrange: boolean;
    sortBy: 'name' | 'extension' | 'size' | 'modifiedAt';
  };
}

export interface VirtualDesktopInfo {
  id: string;
  name: string;
  createdAt: string;
}

export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
  username?: string;
  serverName?: string;
  version?: string;
  hostname?: string;
}

export interface LinuxRuntimeStatus {
  platform: string;
  isLinux: boolean;
  guiReady: boolean;
  missingDeps: string[];
  hasAudio: boolean;
  isRoot: boolean;
  distro: string;
}

export interface LinuxAppInfo {
  id: string;
  name: string;
  description: string;
  command: string;
  category: 'browser' | 'development' | 'media' | 'office' | 'system' | 'other';
  iconName?: string;
  installed: boolean;
  installable?: boolean;
  desktopFile?: string;
  needsNoSandbox?: boolean;
}

export interface RunningLinuxSession {
  sessionId: string;
  desktopId: string;
  appId: string;
  appName: string;
  title: string;
  width: number;
  height: number;
}

export interface TelemetryData {
  desktopId: string;
  cpuCores: number;
  cpuPercent: number;
  ramTotalGB: number;
  ramUsedGB: number;
  ramPercent: number;
  uptimeSeconds: number;
  desktopsCount: number;
  hostname?: string;
  distro?: string;
  linuxGuiReady?: boolean;
  engine: {
    ready: boolean;
    executable: string;
    activeTabs: number;
    webPagesCount: number;
    fps: number;
  };
}

export interface TabSummary {
  id: string;
  url: string;
  title: string;
  favicon: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isSecure: boolean;
  isPlayingAudio: boolean;
  mode: 'newtab' | 'file' | 'web';
  filePath?: string;
}

export type WindowKind =
  | 'browser'
  | 'folder'
  | 'properties'
  | 'terminal'
  | 'linux-app'
  | 'app-store'
  | 'vscode';

export interface OSWindow {
  id: string;
  kind: WindowKind;
  title: string;
  folderPath?: string;
  targetNodePath?: string;
  appSessionId?: string;
  appId?: string;
  terminalSessionId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  snap?: 'left' | 'right' | null;
  zIndex: number;
}

export interface ClipboardState {
  mode: 'copy' | 'cut';
  paths: string[];
}

export interface ToastItem {
  id: string;
  title: string;
  message: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  createdAt: number;
  actionLabel?: string;
  onAction?: () => void;
}

export interface WallpaperPreset {
  id: string;
  name: string;
}

export const WALLPAPERS: WallpaperPreset[] = [
  { id: 'mono-peaks', name: 'Geometrik Dağ' },
  { id: 'graphite-flat', name: 'Koyu Grafit' },
  { id: 'obsidian-flat', name: 'Mat Siyah' },
];
