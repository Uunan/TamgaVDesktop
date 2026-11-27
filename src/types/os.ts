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

export interface StreamPreferences {
  preset: 'performance' | 'balanced' | 'ultra' | 'custom';
  dynamicQualityDrop: boolean;
  motionQuality: number;
  motionScale: number;
  maxDpr: number;
  settlePng: boolean;
  settleDelayMs: number;
  x11Fps: number;
  x11MaxQuality: number;
  x11MotionQuality: number;
  audioEnabled: boolean;
  scrollSensitivity?: number;
}

export interface BrowserPreferences {
  defaultUrl: string;
  closeTabsOnExit: boolean;
}

export interface TerminalPreferences {
  fontSize: number;
  cursorBlink: boolean;
}

export interface UiPreferences {
  showFullscreenNotice: boolean;
}

export interface MediaPreferences {
  speakerDeviceId: string;
  micEnabled: boolean;
  micDeviceId: string;
  micGain: number;
  cameraEnabled: boolean;
  cameraDeviceId: string;
  cameraResolution: '480p' | '720p';
  cameraMirror: boolean;
}

export interface ScreensaverPreferences {
  enabled: boolean;
  idleMinutes: number;
  scene: string;
  customVideoUrl?: string;
  requirePassword: boolean;
  passwordDelayMinutes: number;
}

export interface LockScreenPreferences {
  style: 'wallpaper' | 'blur' | 'minimal' | 'clock';
  requirePassword: boolean;
  showClock: boolean;
}

export interface DockPreferences {
  position: 'bottom' | 'top' | 'left' | 'right';
  style: 'floating' | 'macos' | 'full' | 'minimal';
  size: 'sm' | 'md' | 'lg';
  barScale: number;
  iconScale: number;
  color: 'auto' | 'dark' | 'light' | 'obsidian' | 'midnight' | 'emerald' | 'amethyst' | 'custom';
  customColor?: string;
  opacity: number;
  blur: number;
  showLabels: boolean;
  magnification: boolean;
  magnificationScale: number;
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
    stream: StreamPreferences;
    browser: BrowserPreferences;
    terminal: TerminalPreferences;
    ui: UiPreferences;
    dock: DockPreferences;
    media?: MediaPreferences;
    screensaver?: ScreensaverPreferences;
    lockScreen?: LockScreenPreferences;
    defaultApps?: Record<string, string>;
  };
}

export const DEFAULT_STREAM_PREFERENCES: StreamPreferences = {
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
  audioEnabled: true,
  scrollSensitivity: 1.0,
};

export const DEFAULT_BROWSER_PREFERENCES: BrowserPreferences = {
  defaultUrl: 'https://www.google.com',
  closeTabsOnExit: true,
};

export const DEFAULT_TERMINAL_PREFERENCES: TerminalPreferences = {
  fontSize: 13,
  cursorBlink: true,
};

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  showFullscreenNotice: true,
};

export const DEFAULT_MEDIA_PREFERENCES: MediaPreferences = {
  speakerDeviceId: 'default',
  micEnabled: false,
  micDeviceId: 'default',
  micGain: 100,
  cameraEnabled: false,
  cameraDeviceId: 'default',
  cameraResolution: '720p',
  cameraMirror: true,
};

export const DEFAULT_SCREENSAVER_PREFERENCES: ScreensaverPreferences = {
  enabled: false,
  idleMinutes: 5,
  scene: 'wheat-field',
  customVideoUrl: '',
  requirePassword: true,
  passwordDelayMinutes: 0,
};

export const DEFAULT_LOCK_SCREEN_PREFERENCES: LockScreenPreferences = {
  style: 'wallpaper',
  requirePassword: true,
  showClock: true,
};

export const DEFAULT_DOCK_PREFERENCES: DockPreferences = {
  position: 'bottom',
  style: 'floating',
  size: 'md',
  barScale: 1.4,
  iconScale: 1.4,
  color: 'auto',
  customColor: '#18181b',
  opacity: 86,
  blur: 18,
  showLabels: true,
  magnification: true,
  magnificationScale: 1.45,
};

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

export interface SystemInfoResponse {
  name: string;
  version: string;
  hostname: string;
  port: number;
  dataDir: string;
  filesystemMode: string;
  authEnabled: boolean;
  runtime: LinuxRuntimeStatus;
  disk?: {
    totalGB: number;
    usedGB: number;
    availGB: number;
    percent: number;
  };
}

export interface LinuxAppInfo {
  id: string;
  name: string;
  description: string;
  command: string;
  category: 'browser' | 'development' | 'media' | 'office' | 'communication' | 'system' | 'other';
  publisher?: string;
  accent?: string;
  featured?: boolean;
  iconName?: string;
  installed: boolean;
  installable?: boolean;
  uninstallable?: boolean;
  packageName?: string;
  desktopFile?: string;
  needsNoSandbox?: boolean;
  launchMode?: 'gui' | 'terminal' | 'web';
}

export interface AptSearchResult {
  packageName: string;
  summary: string;
  installed: boolean;
}

export interface RunningLinuxSession {
  sessionId: string;
  desktopId: string;
  appId: string;
  appName: string;
  title: string;
  width: number;
  height: number;
  openedAsExtraWindow?: boolean;
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

export interface MediaHardwareStatus {
  pulseRunning: boolean;
  sinks: Array<{ id: string; name: string; state: string }>;
  sources: Array<{ id: string; name: string; state: string }>;
  virtualMicName: string;
  virtualMicReady: boolean;
  virtualMicActiveClients: number;
  videoDevices: string[];
  v4l2LoopbackReady: boolean;
  cameraNote: string;
}

export type SettingsTabId = 'stream' | 'dock' | 'appearance' | 'media' | 'terminal' | 'system';

export type WindowKind =
  | 'browser'
  | 'web-app'
  | 'folder'
  | 'preview'
  | 'properties'
  | 'terminal'
  | 'linux-app'
  | 'app-store'
  | 'vscode'
  | 'settings';

export interface OSWindow {
  id: string;
  kind: WindowKind;
  title: string;
  folderPath?: string;
  previewNodePath?: string;
  vscodeUrl?: string;
  webAppUrl?: string;
  targetNodePath?: string;
  appSessionId?: string;
  appViewId?: string;
  appId?: string;
  appIconName?: string;
  launching?: boolean;
  terminalSessionId?: string;
  terminalCwd?: string;
  terminalInitialCommand?: string;
  settingsTab?: SettingsTabId;
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
  dynamicTime?: boolean;
}

export const WALLPAPERS: WallpaperPreset[] = [
  { id: 'mono-peaks', name: 'Geometrik Dağ' },
  { id: 'geo-dunes', name: 'Çöl Kumulları' },
  { id: 'geo-prism', name: 'Kristal Prizma' },
  { id: 'geo-waves', name: 'Topo Dalgalar' },
  { id: 'geo-aurora', name: 'Kuzey Işıkları' },
  { id: 'geo-horizon', name: 'Minimal Ufuk' },
  { id: 'wheat-field', name: 'Buğday Tarlası (Canlı)', dynamicTime: true },
  { id: 'ocean-horizon', name: 'Okyanus Ufku (Canlı)', dynamicTime: true },
  { id: 'cherry-blossom', name: 'Kiraz Çiçeği' },
  { id: 'bamboo-breeze', name: 'Bambu Esintisi' },
  { id: 'rainy-forest', name: 'Yağmurlu Orman' },
  { id: 'snowy-pines', name: 'Karlı Çamlık' },
  { id: 'lavender-valley', name: 'Lavanta Vadisi', dynamicTime: true },
  { id: 'starry-nebula', name: 'Yıldızlı Nebula' },
  { id: 'red-canyon', name: 'Kızıl Kanyon', dynamicTime: true },
  { id: 'solar-eclipse', name: 'Güneş Tutulması' },
  { id: 'glacial-mirror', name: 'Buzul Yansıması' },
  { id: 'moonlit-lake', name: 'Ay Işığı Gölü', dynamicTime: true },
  { id: 'cyber-grid', name: 'Siber Izgara' },
  { id: 'silk-flow', name: 'İpek Akışı' },
  { id: 'glass-orbs', name: 'Cam Küreler' },
  { id: 'golden-waves', name: 'Altın Dalgalar' },
  { id: 'dark-fractal', name: 'Karanlık Fraktal' },
  { id: 'volcanic-glow', name: 'Volkanik Parıltı' },
  { id: 'nordic-sea', name: 'Kuzey Denizi' },
  { id: 'prism-spectrum', name: 'Prizma Işığı' },
];
