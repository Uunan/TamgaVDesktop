import type { LinuxAppInfo, VFSNode } from '../types/os';
import { isImageExtension, isTextEditableExtension, isVideoExtension } from './format';

export type OpenWithTargetId =
  | 'browser'
  | 'chromium-builtin'
  | 'preview'
  | 'vscode-web'
  | 'terminal'
  | `app:${string}`;

export interface OpenWithOption {
  id: OpenWithTargetId;
  label: string;
  subtitle: string;
  iconAppId?: string;
  iconKind: 'browser' | 'chromium' | 'preview' | 'vscode' | 'terminal' | 'app';
  isDefault: boolean;
  recommended: boolean;
}

const HTML_EXTS = new Set(['html', 'htm', 'xhtml', 'mhtml']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus']);
const DOCUMENT_EXTS = new Set([
  'pdf',
  'doc',
  'docx',
  'odt',
  'rtf',
  'xls',
  'xlsx',
  'ods',
  'csv',
  'ppt',
  'pptx',
  'odp',
  'epub',
]);
const DESIGN_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico', 'svg', 'avif', 'tiff', 'xcf', 'psd', 'obj', 'stl', 'blend']);
const BROWSER_VIEWABLE_EXTS = new Set([
  'html',
  'htm',
  'xhtml',
  'mhtml',
  'svg',
  'xml',
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'ico',
  'avif',
  'mp4',
  'webm',
  'mp3',
  'wav',
  'ogg',
  'txt',
  'json',
  'css',
  'js',
  'csv',
]);

const BROWSER_APP_IDS = new Set(['chrome', 'firefox', 'brave']);
const DEV_EDITOR_IDS = new Set(['vscode', 'antigravity', 'cursor', 'vscodium', 'sublime', 'geany', 'mousepad', 'meld']);
const DESIGN_APP_IDS = new Set(['gimp', 'inkscape', 'krita', 'blender']);
const MEDIA_APP_IDS = new Set(['vlc', 'audacity', 'kdenlive', 'shotcut', 'handbrake', 'obs-studio']);
const OFFICE_APP_IDS = new Set(['libreoffice', 'obsidian', 'xournalpp', 'sqlitebrowser']);
const NON_FILE_OPEN_APP_IDS = new Set([
  'antigravity-cli',
  'codex',
  'claude-code',
  'gemini-cli',
  'vscode-web',
  'bleachbit',
  'remmina',
  'flameshot',
]);

export function getExtensionKey(node: Pick<VFSNode, 'extension'>): string {
  const ext = (node.extension || '').trim().toLowerCase();
  return ext || '_noext';
}

export function isHtmlExtension(ext?: string): boolean {
  return HTML_EXTS.has((ext || '').trim().toLowerCase());
}

export function getPrimaryBrowserApp(linuxApps: LinuxAppInfo[]): LinuxAppInfo | undefined {
  const chrome = linuxApps.find((a) => a.id === 'chrome' && a.installed);
  if (chrome) return chrome;
  return linuxApps.find((a) => BROWSER_APP_IDS.has(a.id) && a.installed);
}

export function getDefaultOpenWithTarget(
  node: Pick<VFSNode, 'extension'>,
  defaultApps?: Record<string, string>
): OpenWithTargetId {
  const key = getExtensionKey(node);
  const override = defaultApps?.[key];
  if (override && typeof override === 'string') {
    if (
      override === 'browser' ||
      override === 'chromium-builtin' ||
      override === 'preview' ||
      override === 'vscode-web' ||
      override === 'terminal'
    ) {
      return override;
    }
    if (override.startsWith('app:') && override.length > 4) {
      return override as `app:${string}`;
    }
  }
  if (isHtmlExtension(node.extension)) {
    return 'browser';
  }
  return 'preview';
}

function isAudioExt(ext: string): boolean {
  return AUDIO_EXTS.has(ext.toLowerCase());
}

function matchesLinuxApp(app: LinuxAppInfo, ext: string): boolean {
  const e = ext.toLowerCase();
  if (BROWSER_APP_IDS.has(app.id)) {
    return BROWSER_VIEWABLE_EXTS.has(e);
  }
  if (DEV_EDITOR_IDS.has(app.id)) {
    return isTextEditableExtension(e) || HTML_EXTS.has(e) || e === '' || e === 'svg';
  }
  if (DESIGN_APP_IDS.has(app.id)) {
    if (app.id === 'inkscape') return e === 'svg' || e === 'pdf' || DESIGN_EXTS.has(e);
    if (app.id === 'blender') return e === 'blend' || e === 'obj' || e === 'stl' || isImageExtension(e);
    return isImageExtension(e) || DESIGN_EXTS.has(e) || e === 'pdf';
  }
  if (MEDIA_APP_IDS.has(app.id)) {
    if (app.id === 'audacity') return isAudioExt(e) || isVideoExtension(e);
    return isVideoExtension(e) || isAudioExt(e);
  }
  if (OFFICE_APP_IDS.has(app.id)) {
    if (app.id === 'obsidian') return e === 'md' || e === 'markdown' || e === 'txt' || e === 'pdf';
    if (app.id === 'sqlitebrowser') return e === 'db' || e === 'sqlite' || e === 'sqlite3' || e === 'sql';
    if (app.id === 'xournalpp') return e === 'pdf' || e === 'xopp';
    return DOCUMENT_EXTS.has(e) || e === 'txt' || e === 'html';
  }
  return false;
}

export function getOpenWithOptions(
  node: VFSNode,
  linuxApps: LinuxAppInfo[],
  linuxGuiReady: boolean,
  defaultApps?: Record<string, string>
): OpenWithOption[] {
  const ext = (node.extension || '').trim().toLowerCase();
  const isHtml = isHtmlExtension(ext);
  const isCodeOrText = isTextEditableExtension(ext) || isHtml || ext === '';
  const isPdf = ext === 'pdf';
  const isBrowserViewable = BROWSER_VIEWABLE_EXTS.has(ext);
  const defaultTarget = getDefaultOpenWithTarget(node, defaultApps);

  const primaryBrowser = getPrimaryBrowserApp(linuxApps);
  const browserDisplayName = primaryBrowser?.name || (linuxGuiReady ? 'Google Chrome' : 'Varsayılan Tarayıcı');
  const browserIconId = primaryBrowser?.iconName || primaryBrowser?.id || 'chrome';

  const candidates: Array<OpenWithOption & { priority: number }> = [];

  candidates.push({
    id: 'browser',
    label: browserDisplayName,
    subtitle: isHtml ? 'Varsayılan Web Tarayıcısı' : 'Web Tarayıcısında Aç',
    iconAppId: browserIconId,
    iconKind: 'browser',
    isDefault: defaultTarget === 'browser',
    recommended: isHtml || isPdf || isBrowserViewable,
    priority: isHtml ? 1 : isPdf ? 2 : isBrowserViewable ? 4 : 9,
  });

  candidates.push({
    id: 'preview',
    label: 'Önizleme',
    subtitle: 'Yerleşik Görüntüleyici & Düzenleyici',
    iconKind: 'preview',
    isDefault: defaultTarget === 'preview',
    recommended: true,
    priority: isHtml ? 2 : 1,
  });

  candidates.push({
    id: 'chromium-builtin',
    label: 'Chromium (Yerleşik)',
    subtitle: 'Uygulama İçi Hızlı Tarayıcı',
    iconAppId: 'chrome',
    iconKind: 'chromium',
    isDefault: defaultTarget === 'chromium-builtin',
    recommended: isHtml || isPdf || isBrowserViewable,
    priority: isHtml ? 3 : isPdf ? 3 : isBrowserViewable ? 6 : 8,
  });

  candidates.push({
    id: 'vscode-web',
    label: 'VS Code Web',
    subtitle: 'Tarayıcı İçi Kod Editörü',
    iconAppId: 'vscode-web',
    iconKind: 'vscode',
    isDefault: defaultTarget === 'vscode-web',
    recommended: isCodeOrText,
    priority: isHtml ? 4 : isCodeOrText ? 2 : 12,
  });

  for (const app of linuxApps) {
    if (!app.installed || NON_FILE_OPEN_APP_IDS.has(app.id)) continue;
    if (app.launchMode === 'terminal' || app.launchMode === 'web') continue;
    if (primaryBrowser && app.id === primaryBrowser.id) continue;
    if (!linuxGuiReady && BROWSER_APP_IDS.has(app.id)) continue;

    const targetId = `app:${app.id}` as OpenWithTargetId;
    const matched = matchesLinuxApp(app, ext);
    candidates.push({
      id: targetId,
      label: app.name,
      subtitle: app.publisher || 'Kurulu Masaüstü Uygulaması',
      iconAppId: app.iconName || app.id,
      iconKind: 'app',
      isDefault: defaultTarget === targetId,
      recommended: matched,
      priority: matched ? (DEV_EDITOR_IDS.has(app.id) || DESIGN_APP_IDS.has(app.id) || MEDIA_APP_IDS.has(app.id) ? 3 : 5) : 20,
    });
  }

  candidates.push({
    id: 'terminal',
    label: 'Uç Birim',
    subtitle: 'Klasör Konumunda Terminal Aç',
    iconKind: 'terminal',
    isDefault: defaultTarget === 'terminal',
    recommended: isCodeOrText,
    priority: isCodeOrText ? 7 : 15,
  });

  return candidates
    .sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.label.localeCompare(b.label, 'tr');
    })
    .map(({ priority: _p, ...option }) => option);
}
