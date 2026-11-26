import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

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

export interface DockPreferences {
  position: 'bottom' | 'top' | 'left' | 'right';
  style: 'floating' | 'macos' | 'full' | 'minimal';
  size: 'sm' | 'md' | 'lg';
  color: 'auto' | 'dark' | 'light' | 'obsidian' | 'midnight' | 'emerald' | 'amethyst' | 'custom';
  customColor?: string;
  opacity: number;
  blur: number;
  showLabels: boolean;
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
  };
}

export const DEFAULT_STREAM_PREFERENCES: StreamPreferences = {
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
  audioEnabled: true,
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

export const DEFAULT_DOCK_PREFERENCES: DockPreferences = {
  position: 'bottom',
  style: 'floating',
  size: 'md',
  color: 'auto',
  customColor: '#18181b',
  opacity: 86,
  blur: 18,
  showLabels: true,
};

export interface VirtualDesktopInfo {
  id: string;
  name: string;
  createdAt: string;
}

let STORAGE_ROOT = path.resolve(process.cwd(), 'storage');
let DESKTOPS_ROOT = path.join(STORAGE_ROOT, 'desktops');
let REGISTRY_FILE = path.join(DESKTOPS_ROOT, 'registry.json');

export function setStorageRoot(dir: string): void {
  STORAGE_ROOT = path.resolve(dir);
  DESKTOPS_ROOT = path.join(STORAGE_ROOT, 'desktops');
  REGISTRY_FILE = path.join(DESKTOPS_ROOT, 'registry.json');
  fs.mkdirSync(DESKTOPS_ROOT, { recursive: true });
}

export function getStorageRoot(): string {
  return STORAGE_ROOT;
}

const SYSTEM_DIRS = ['/Desktop', '/Documents', '/Downloads', '/Projects', '/.trash'];

export function sanitizeDesktopId(raw: string): string {
  const cleaned = (raw || 'main')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return cleaned || 'main';
}

function extractExtension(name: string, isDir: boolean): string {
  if (isDir) return '';
  const lower = name.toLowerCase();
  if (lower.endsWith('.tar.gz')) return 'tar.gz';
  if (lower.startsWith('.') && !lower.slice(1).includes('.')) {
    return lower.slice(1);
  }
  const idx = lower.lastIndexOf('.');
  if (idx <= 0 || idx === lower.length - 1) return '';
  return lower.slice(idx + 1);
}

export class DesktopRegistry {
  private desktops: VirtualDesktopInfo[] = [];

  constructor() {
    fs.mkdirSync(DESKTOPS_ROOT, { recursive: true });
    this.migrateLegacyIfPresent();
    this.load();
  }

  private migrateLegacyIfPresent() {
    const legacyVfs = path.join(STORAGE_ROOT, 'vfs');
    const mainDir = path.join(DESKTOPS_ROOT, 'main');
    if (fs.existsSync(legacyVfs) && !fs.existsSync(mainDir)) {
      fs.mkdirSync(mainDir, { recursive: true });
      fs.cpSync(legacyVfs, path.join(mainDir, 'vfs'), { recursive: true });
      const legacyMeta = path.join(STORAGE_ROOT, 'meta.json');
      if (fs.existsSync(legacyMeta)) {
        fs.cpSync(legacyMeta, path.join(mainDir, 'meta.json'));
      }
      fs.writeFileSync(path.join(mainDir, '.seeded'), new Date().toISOString(), 'utf-8');
    }
  }

  private load() {
    if (fs.existsSync(REGISTRY_FILE)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.desktops = parsed;
          return;
        }
      } catch {
        // fallback below
      }
    }
    this.desktops = [
      {
        id: 'main',
        name: 'Masaüstü 1',
        createdAt: new Date().toISOString(),
      },
    ];
    this.save();
  }

  private save() {
    fs.mkdirSync(DESKTOPS_ROOT, { recursive: true });
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(this.desktops, null, 2), 'utf-8');
  }

  public list(): VirtualDesktopInfo[] {
    return [...this.desktops];
  }

  public ensureDesktop(rawId: string, desiredName?: string): VirtualDesktopInfo {
    const id = sanitizeDesktopId(rawId);
    const existing = this.desktops.find((d) => d.id === id);
    if (existing) return existing;

    const info: VirtualDesktopInfo = {
      id,
      name: desiredName?.trim() || `Masaüstü ${this.desktops.length + 1}`,
      createdAt: new Date().toISOString(),
    };
    this.desktops.push(info);
    this.save();
    return info;
  }

  public createNewDesktop(name?: string): VirtualDesktopInfo {
    const nextNum = this.desktops.length + 1;
    const cleanTitle = name?.trim() || `Masaüstü ${nextNum}`;
    const baseSlug = sanitizeDesktopId(
      cleanTitle
        .replace(/ğ/gi, 'g')
        .replace(/ü/gi, 'u')
        .replace(/ş/gi, 's')
        .replace(/ı/gi, 'i')
        .replace(/ö/gi, 'o')
        .replace(/ç/gi, 'c')
    );
    let candidate = baseSlug || `masaustu-${nextNum}`;
    let counter = 2;
    while (this.desktops.some((d) => d.id === candidate)) {
      candidate = `${baseSlug}-${counter++}`;
    }

    const info: VirtualDesktopInfo = {
      id: candidate,
      name: cleanTitle,
      createdAt: new Date().toISOString(),
    };
    this.desktops.push(info);
    this.save();
    return info;
  }

  public renameDesktop(rawId: string, newName: string): VirtualDesktopInfo {
    const id = sanitizeDesktopId(rawId);
    const item = this.desktops.find((d) => d.id === id);
    if (!item) throw new Error('Masaüstü bulunamadı.');
    const trimmed = newName.trim();
    if (!trimmed) throw new Error('Masaüstü adı boş olamaz.');
    item.name = trimmed;
    this.save();
    return item;
  }

  public deleteDesktop(rawId: string): VirtualDesktopInfo[] {
    const id = sanitizeDesktopId(rawId);
    if (this.desktops.length <= 1) {
      throw new Error('En az bir sanal masaüstü aktif kalmalıdır.');
    }
    const idx = this.desktops.findIndex((d) => d.id === id);
    if (idx === -1) return this.list();
    this.desktops.splice(idx, 1);
    this.save();

    const dir = path.join(DESKTOPS_ROOT, id);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return this.list();
  }
}

export class VFSManager {
  public readonly desktopId: string;
  private readonly instanceRoot: string;
  private readonly vfsRoot: string;
  private readonly metaFile: string;
  private meta: DesktopMeta;
  private changeListeners: Set<() => void> = new Set();

  constructor(desktopId: string, hostRootOverride?: string) {
    this.desktopId = sanitizeDesktopId(desktopId);
    this.instanceRoot = path.join(DESKTOPS_ROOT, this.desktopId);
    this.vfsRoot = hostRootOverride ? path.resolve(hostRootOverride) : path.join(this.instanceRoot, 'vfs');
    this.metaFile = path.join(this.instanceRoot, 'meta.json');

    fs.mkdirSync(this.instanceRoot, { recursive: true });
    fs.mkdirSync(this.vfsRoot, { recursive: true });
    this.meta = this.loadMeta();
    if (!hostRootOverride) {
      this.ensureSeedWorkspace();
    } else {
      for (const dir of SYSTEM_DIRS) {
        fs.mkdirSync(this.resolveDiskPath(dir), { recursive: true });
      }
    }
  }

  public getInstanceRoot(): string {
    return this.instanceRoot;
  }

  public getVfsRoot(): string {
    return this.vfsRoot;
  }

  public onChange(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }

  public notifyChange() {
    for (const cb of this.changeListeners) {
      try {
        cb();
      } catch {
        // ignore listener error
      }
    }
  }

  public getMeta(): DesktopMeta {
    return this.meta;
  }

  private loadMeta(): DesktopMeta {
    if (fs.existsSync(this.metaFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.metaFile, 'utf-8'));
        const wp =
          parsed.preferences?.wallpaper === 'nebula-compute'
            ? 'mono-peaks'
            : parsed.preferences?.wallpaper || 'mono-peaks';
        return {
          positions: parsed.positions || {},
          trashOrigins: parsed.trashOrigins || {},
          preferences: {
            wallpaper: wp,
            customWallpaper: parsed.preferences?.customWallpaper,
            theme: parsed.preferences?.theme === 'light' ? 'light' : 'dark',
            iconSize: parsed.preferences?.iconSize || 'md',
            autoArrange: parsed.preferences?.autoArrange ?? false,
            sortBy: parsed.preferences?.sortBy || 'name',
            stream: {
              ...DEFAULT_STREAM_PREFERENCES,
              ...(parsed.preferences?.stream || {}),
            },
            browser: {
              ...DEFAULT_BROWSER_PREFERENCES,
              ...(parsed.preferences?.browser || {}),
            },
            terminal: {
              ...DEFAULT_TERMINAL_PREFERENCES,
              ...(parsed.preferences?.terminal || {}),
            },
            ui: {
              ...DEFAULT_UI_PREFERENCES,
              ...(parsed.preferences?.ui || {}),
            },
            dock: {
              ...DEFAULT_DOCK_PREFERENCES,
              ...(parsed.preferences?.dock || {}),
            },
          },
        };
      } catch {
        // fallback below
      }
    }
    return {
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
      },
    };
  }

  private saveMeta() {
    fs.mkdirSync(this.instanceRoot, { recursive: true });
    fs.writeFileSync(this.metaFile, JSON.stringify(this.meta, null, 2), 'utf-8');
  }

  public normalizeVirtualPath(vPath: string): string {
    const cleaned = ('/' + (vPath || '').replace(/\\/g, '/'))
      .replace(/\/+/g, '/')
      .replace(/\/$/, '');
    return cleaned === '' ? '/' : cleaned;
  }

  public resolveDiskPath(vPath: string): string {
    const norm = this.normalizeVirtualPath(vPath);
    const resolved = path.resolve(this.vfsRoot, '.' + norm);
    if (!resolved.startsWith(this.vfsRoot)) {
      throw new Error('Geçersiz dosya yolu erişimi engellendi.');
    }
    return resolved;
  }

  private ensureSeedWorkspace() {
    const marker = path.join(this.instanceRoot, '.seeded');
    for (const dir of SYSTEM_DIRS) {
      fs.mkdirSync(this.resolveDiskPath(dir), { recursive: true });
    }
    if (fs.existsSync(marker)) return;

    fs.mkdirSync(this.resolveDiskPath('/Desktop/Projeler'), { recursive: true });

    fs.writeFileSync(
      this.resolveDiskPath('/Desktop/notlar.txt'),
      `Sanal Masaüstü (${this.desktopId})\n=========================\n- Bu masaüstü diğer sanal masaüstlerinden tamamen bağımsız bir disk ve tarayıcı oturumuna sahiptir.\n- Dosyaları açık klasör pencerelerinin veya Chromium penceresinin üstüne doğrudan sürükleyip bırakabilirsiniz.\n`,
      'utf-8'
    );

    fs.writeFileSync(
      this.resolveDiskPath('/Desktop/baslangic.html'),
      `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <title>Yerel Web Sayfası</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: #141416;
      color: #f5f5f7;
    }
    .box {
      background: #1c1c1e;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 18px;
      padding: 36px;
      max-width: 460px;
      text-align: center;
    }
    h1 { margin: 0 0 10px; font-size: 22px; font-weight: 600; }
    p { color: #a1a1a6; line-height: 1.6; font-size: 14px; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Yerel HTML Dosyası</h1>
    <p>Bu sayfa sanal masaüstünüzdeki <code>/Desktop/baslangic.html</code> dosyasından çalışıyor. Üst çubuktan kaynağı düzenleyip kaydedebilirsiniz.</p>
  </div>
</body>
</html>`,
      'utf-8'
    );

    fs.writeFileSync(
      this.resolveDiskPath('/Desktop/Projeler/analiz.py'),
      `def hesapla(veriler: list[float]) -> dict:\n    toplam = sum(veriler)\n    return {"adet": len(veriler), "ortalama": round(toplam / max(len(veriler), 1), 2)}\n\nif __name__ == "__main__":\n    print(hesapla([14.2, 19.8, 22.4]))\n`,
      'utf-8'
    );

    fs.writeFileSync(
      this.resolveDiskPath('/Desktop/Projeler/ayarlar.json'),
      JSON.stringify({ desktop: this.desktopId, browser: 'chromium', isolated: true }, null, 2),
      'utf-8'
    );

    const zip = new AdmZip();
    zip.addFile('bilgi.txt', Buffer.from('Sağ tıklayıp Buraya Ayıkla seçeneğiyle çıkartabilirsiniz.\n', 'utf-8'));
    zip.writeZip(this.resolveDiskPath('/Desktop/arsiv.zip'));

    fs.writeFileSync(marker, new Date().toISOString(), 'utf-8');
  }

  private statNode(vPath: string): VFSNode {
    const norm = this.normalizeVirtualPath(vPath);
    const diskPath = this.resolveDiskPath(norm);
    const stat = fs.statSync(diskPath);
    const isDir = stat.isDirectory();
    const name = norm === '/' ? 'Disk' : path.posix.basename(norm);
    const parentPath = norm === '/' ? '' : path.posix.dirname(norm);

    let childCount = 0;
    let size = stat.size;

    if (isDir) {
      const entries = fs.readdirSync(diskPath).filter((e) => e !== '.DS_Store');
      childCount = entries.length;
      size = this.computeDirSize(diskPath);
    }

    return {
      name,
      path: norm,
      parentPath,
      isDir,
      extension: extractExtension(name, isDir),
      size,
      childCount,
      createdAt: stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString(),
      originalPath: this.meta.trashOrigins[norm],
    };
  }

  private computeDirSize(diskDir: string): number {
    let total = 0;
    try {
      const entries = fs.readdirSync(diskDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.DS_Store') continue;
        const full = path.join(diskDir, entry.name);
        if (entry.isDirectory()) {
          total += this.computeDirSize(full);
        } else {
          total += fs.statSync(full).size;
        }
      }
    } catch {
      // ignore
    }
    return total;
  }

  public getSnapshot(): { nodes: VFSNode[]; meta: DesktopMeta } {
    const nodes: VFSNode[] = [];
    const walk = (vDir: string) => {
      const diskDir = this.resolveDiskPath(vDir);
      if (!fs.existsSync(diskDir)) return;
      if (vDir !== '/') {
        nodes.push(this.statNode(vDir));
      }
      const entries = fs.readdirSync(diskDir).filter((e) => e !== '.DS_Store');
      for (const entry of entries) {
        const childVPath = vDir === '/' ? `/${entry}` : `${vDir}/${entry}`;
        const childDisk = this.resolveDiskPath(childVPath);
        const st = fs.statSync(childDisk);
        if (st.isDirectory()) {
          walk(childVPath);
        } else {
          nodes.push(this.statNode(childVPath));
        }
      }
    };
    walk('/');
    return { nodes, meta: this.meta };
  }

  private getUniquePath(parentPath: string, desiredName: string): string {
    const cleanName = desiredName.replace(/[\\/]/g, '').trim() || 'Adsız';
    const normParent = this.normalizeVirtualPath(parentPath);
    let candidate = normParent === '/' ? `/${cleanName}` : `${normParent}/${cleanName}`;
    if (!fs.existsSync(this.resolveDiskPath(candidate))) {
      return candidate;
    }

    const extIdx = cleanName.lastIndexOf('.');
    const hasExt = extIdx > 0 && extIdx < cleanName.length - 1;
    const stem = hasExt ? cleanName.slice(0, extIdx) : cleanName;
    const ext = hasExt ? cleanName.slice(extIdx) : '';

    let counter = 2;
    while (true) {
      const nextName = `${stem} (${counter})${ext}`;
      candidate = normParent === '/' ? `/${nextName}` : `${normParent}/${nextName}`;
      if (!fs.existsSync(this.resolveDiskPath(candidate))) {
        return candidate;
      }
      counter++;
    }
  }

  public createFolder(parentPath: string, name: string, pos?: { x: number; y: number }): VFSNode {
    const targetVPath = this.getUniquePath(parentPath, name || 'Yeni Klasör');
    fs.mkdirSync(this.resolveDiskPath(targetVPath), { recursive: true });
    if (pos) {
      this.meta.positions[targetVPath] = pos;
      this.saveMeta();
    }
    this.notifyChange();
    return this.statNode(targetVPath);
  }

  public createFile(
    parentPath: string,
    name: string,
    content?: string,
    pos?: { x: number; y: number }
  ): VFSNode {
    const targetVPath = this.getUniquePath(parentPath, name || 'yeni-dosya.txt');
    const diskPath = this.resolveDiskPath(targetVPath);
    fs.mkdirSync(path.dirname(diskPath), { recursive: true });

    const finalContent = content !== undefined ? content : this.getDefaultTemplate(targetVPath);
    fs.writeFileSync(diskPath, finalContent, 'utf-8');
    if (pos) {
      this.meta.positions[targetVPath] = pos;
      this.saveMeta();
    }
    this.notifyChange();
    return this.statNode(targetVPath);
  }

  private getDefaultTemplate(vPath: string): string {
    const ext = extractExtension(path.posix.basename(vPath), false);
    switch (ext) {
      case 'html':
      case 'htm':
        return `<!DOCTYPE html>\n<html lang="tr">\n<head>\n  <meta charset="UTF-8" />\n  <title>Sayfa</title>\n</head>\n<body style="font-family:-apple-system,sans-serif;padding:2rem;background:#141416;color:#f5f5f7;">\n  <h1>Merhaba</h1>\n  <p>Yeni HTML belgesi hazır.</p>\n</body>\n</html>\n`;
      case 'json':
        return `{\n  "ad": "kayit",\n  "aktif": true\n}\n`;
      case 'md':
        return `# Başlık\n\nNotlarınızı buraya yazabilirsiniz.\n`;
      case 'py':
        return `def main():\n    print("Merhaba!")\n\nif __name__ == "__main__":\n    main()\n`;
      case 'js':
      case 'ts':
        return `console.log("Hazır");\n`;
      case 'css':
        return `body {\n  margin: 0;\n  background: #141416;\n  color: #f5f5f7;\n}\n`;
      case 'csv':
        return `id,baslik,deger\n1,Kalem A,100\n2,Kalem B,250\n`;
      case 'sql':
        return `SELECT * FROM kayitlar LIMIT 10;\n`;
      case 'svg':
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">\n  <rect width="200" height="200" rx="24" fill="#1c1c1e"/>\n  <circle cx="100" cy="100" r="52" fill="#e5e5ea"/>\n</svg>\n`;
      default:
        return '';
    }
  }

  public renameNode(vPath: string, newName: string): VFSNode {
    const norm = this.normalizeVirtualPath(vPath);
    if (SYSTEM_DIRS.includes(norm) || norm === '/') {
      throw new Error('Sistem ana dizinleri yeniden adlandırılamaz.');
    }
    const cleanName = newName.replace(/[\\/]/g, '').trim();
    if (!cleanName) {
      throw new Error('Dosya veya klasör adı boş olamaz.');
    }
    const parent = path.posix.dirname(norm);
    const nextVPath = parent === '/' ? `/${cleanName}` : `${parent}/${cleanName}`;
    if (nextVPath === norm) {
      return this.statNode(norm);
    }
    if (fs.existsSync(this.resolveDiskPath(nextVPath))) {
      throw new Error(`"${cleanName}" adında bir öğe zaten mevcut.`);
    }

    fs.renameSync(this.resolveDiskPath(norm), this.resolveDiskPath(nextVPath));

    const updatedPositions: Record<string, { x: number; y: number }> = {};
    for (const [k, v] of Object.entries(this.meta.positions)) {
      if (k === norm) updatedPositions[nextVPath] = v;
      else if (k.startsWith(norm + '/')) updatedPositions[nextVPath + k.slice(norm.length)] = v;
      else updatedPositions[k] = v;
    }
    this.meta.positions = updatedPositions;
    this.saveMeta();
    this.notifyChange();
    return this.statNode(nextVPath);
  }

  public moveNodes(paths: string[], targetDir: string): VFSNode[] {
    const normTarget = this.normalizeVirtualPath(targetDir);
    const targetDisk = this.resolveDiskPath(normTarget);
    if (!fs.existsSync(targetDisk) || !fs.statSync(targetDisk).isDirectory()) {
      throw new Error('Hedef klasör bulunamadı.');
    }

    const moved: VFSNode[] = [];
    for (const rawPath of paths) {
      const src = this.normalizeVirtualPath(rawPath);
      if (SYSTEM_DIRS.includes(src) || src === '/' || src === normTarget) continue;
      if (normTarget.startsWith(src + '/')) {
        throw new Error('Bir klasör kendi alt klasörünün içine taşınamaz.');
      }
      const base = path.posix.basename(src);
      const dest =
        path.posix.dirname(src) === normTarget ? src : this.getUniquePath(normTarget, base);
      if (dest !== src) {
        fs.renameSync(this.resolveDiskPath(src), this.resolveDiskPath(dest));
        delete this.meta.positions[src];
      }
      moved.push(this.statNode(dest));
    }
    this.saveMeta();
    this.notifyChange();
    return moved;
  }

  public copyNodes(paths: string[], targetDir: string): VFSNode[] {
    const normTarget = this.normalizeVirtualPath(targetDir);
    const copied: VFSNode[] = [];
    for (const rawPath of paths) {
      const src = this.normalizeVirtualPath(rawPath);
      if (src === '/') continue;
      if (normTarget.startsWith(src + '/')) {
        throw new Error('Bir klasör kendi alt klasörünün içine kopyalanamaz.');
      }
      const base = path.posix.basename(src);
      const desired = path.posix.dirname(src) === normTarget ? this.makeCopyName(base) : base;
      const dest = this.getUniquePath(normTarget, desired);
      fs.cpSync(this.resolveDiskPath(src), this.resolveDiskPath(dest), { recursive: true });
      copied.push(this.statNode(dest));
    }
    this.notifyChange();
    return copied;
  }

  private makeCopyName(name: string): string {
    const idx = name.lastIndexOf('.');
    if (idx > 0 && idx < name.length - 1) {
      return `${name.slice(0, idx)} kopyası${name.slice(idx)}`;
    }
    return `${name} kopyası`;
  }

  public trashNodes(paths: string[]): void {
    for (const rawPath of paths) {
      const src = this.normalizeVirtualPath(rawPath);
      if (SYSTEM_DIRS.includes(src) || src === '/') continue;
      if (src.startsWith('/.trash/')) {
        fs.rmSync(this.resolveDiskPath(src), { recursive: true, force: true });
        delete this.meta.trashOrigins[src];
        continue;
      }
      const dest = this.getUniquePath('/.trash', path.posix.basename(src));
      fs.renameSync(this.resolveDiskPath(src), this.resolveDiskPath(dest));
      this.meta.trashOrigins[dest] = src;
      delete this.meta.positions[src];
    }
    this.saveMeta();
    this.notifyChange();
  }

  public restoreNodes(trashPaths: string[]): VFSNode[] {
    const restored: VFSNode[] = [];
    for (const rawPath of trashPaths) {
      const src = this.normalizeVirtualPath(rawPath);
      if (!src.startsWith('/.trash/')) continue;
      const origin = this.meta.trashOrigins[src] || `/Desktop/${path.posix.basename(src)}`;
      const originParent = path.posix.dirname(origin);
      fs.mkdirSync(this.resolveDiskPath(originParent), { recursive: true });
      const finalDest = this.getUniquePath(originParent, path.posix.basename(origin));
      fs.renameSync(this.resolveDiskPath(src), this.resolveDiskPath(finalDest));
      delete this.meta.trashOrigins[src];
      restored.push(this.statNode(finalDest));
    }
    this.saveMeta();
    this.notifyChange();
    return restored;
  }

  public deletePermanently(paths: string[]): void {
    for (const rawPath of paths) {
      const src = this.normalizeVirtualPath(rawPath);
      if (SYSTEM_DIRS.includes(src) || src === '/') continue;
      fs.rmSync(this.resolveDiskPath(src), { recursive: true, force: true });
      delete this.meta.trashOrigins[src];
      delete this.meta.positions[src];
    }
    this.saveMeta();
    this.notifyChange();
  }

  public emptyTrash(): void {
    const trashDisk = this.resolveDiskPath('/.trash');
    if (fs.existsSync(trashDisk)) {
      for (const item of fs.readdirSync(trashDisk)) {
        fs.rmSync(path.join(trashDisk, item), { recursive: true, force: true });
      }
    }
    this.meta.trashOrigins = {};
    this.saveMeta();
    this.notifyChange();
  }

  public compressToZip(paths: string[], targetDir: string, zipName?: string): VFSNode {
    if (!paths.length) throw new Error('Arşivlenecek öğe seçilmedi.');
    const zip = new AdmZip();
    for (const rawPath of paths) {
      const src = this.normalizeVirtualPath(rawPath);
      const diskSrc = this.resolveDiskPath(src);
      if (!fs.existsSync(diskSrc)) continue;
      const st = fs.statSync(diskSrc);
      if (st.isDirectory()) {
        zip.addLocalFolder(diskSrc, path.posix.basename(src));
      } else {
        zip.addLocalFile(diskSrc);
      }
    }
    const baseName =
      zipName ||
      (paths.length === 1
        ? `${path.posix.basename(paths[0]).replace(/\.[^.]+$/, '')}.zip`
        : 'arsiv.zip');
    const finalName = baseName.toLowerCase().endsWith('.zip') ? baseName : `${baseName}.zip`;
    const destVPath = this.getUniquePath(targetDir, finalName);
    zip.writeZip(this.resolveDiskPath(destVPath));
    this.notifyChange();
    return this.statNode(destVPath);
  }

  public extractZip(zipVPath: string, targetDir?: string): VFSNode {
    const normZip = this.normalizeVirtualPath(zipVPath);
    const diskZip = this.resolveDiskPath(normZip);
    if (!fs.existsSync(diskZip)) throw new Error('Arşiv dosyası bulunamadı.');
    const parent = targetDir ? this.normalizeVirtualPath(targetDir) : path.posix.dirname(normZip);
    const folderBase = path.posix.basename(normZip).replace(/\.zip$/i, '') || 'ayiklanan';
    const destFolderVPath = this.getUniquePath(parent, folderBase);
    const destDisk = this.resolveDiskPath(destFolderVPath);
    fs.mkdirSync(destDisk, { recursive: true });

    const zip = new AdmZip(diskZip);
    zip.extractAllTo(destDisk, true);
    this.notifyChange();
    return this.statNode(destFolderVPath);
  }

  public readTextFile(vPath: string): { content: string; node: VFSNode } {
    const norm = this.normalizeVirtualPath(vPath);
    const disk = this.resolveDiskPath(norm);
    if (!fs.existsSync(disk) || fs.statSync(disk).isDirectory()) {
      throw new Error('Dosya okunamadı.');
    }
    const buf = fs.readFileSync(disk);
    return {
      content: buf.toString('utf-8'),
      node: this.statNode(norm),
    };
  }

  public writeTextFile(vPath: string, content: string): VFSNode {
    const norm = this.normalizeVirtualPath(vPath);
    const disk = this.resolveDiskPath(norm);
    fs.mkdirSync(path.dirname(disk), { recursive: true });
    fs.writeFileSync(disk, content, 'utf-8');
    this.notifyChange();
    return this.statNode(norm);
  }

  public saveUploadedBuffer(parentPath: string, originalName: string, buffer: Buffer): VFSNode {
    const destVPath = this.getUniquePath(parentPath, originalName);
    const disk = this.resolveDiskPath(destVPath);
    fs.mkdirSync(path.dirname(disk), { recursive: true });
    fs.writeFileSync(disk, buffer);
    this.notifyChange();
    return this.statNode(destVPath);
  }

  public updateMeta(partial: {
    positions?: Record<string, { x: number; y: number }>;
    preferences?: Partial<
      Omit<DesktopMeta['preferences'], 'stream' | 'browser' | 'terminal' | 'ui' | 'dock'> & {
        stream?: Partial<StreamPreferences>;
        browser?: Partial<BrowserPreferences>;
        terminal?: Partial<TerminalPreferences>;
        ui?: Partial<UiPreferences>;
        dock?: Partial<DockPreferences>;
      }
    >;
  }): DesktopMeta {
    if (partial.positions) {
      this.meta.positions = { ...this.meta.positions, ...partial.positions };
    }
    if (partial.preferences) {
      const { stream, browser, terminal, ui, dock, ...rest } = partial.preferences;
      this.meta.preferences = {
        ...this.meta.preferences,
        ...rest,
        stream: stream
          ? { ...this.meta.preferences.stream, ...stream }
          : this.meta.preferences.stream,
        browser: browser
          ? { ...this.meta.preferences.browser, ...browser }
          : this.meta.preferences.browser,
        terminal: terminal
          ? { ...this.meta.preferences.terminal, ...terminal }
          : this.meta.preferences.terminal,
        ui: ui ? { ...this.meta.preferences.ui, ...ui } : this.meta.preferences.ui,
        dock: dock ? { ...this.meta.preferences.dock, ...dock } : this.meta.preferences.dock,
      };
      if (!this.meta.preferences.customWallpaper) {
        delete this.meta.preferences.customWallpaper;
      }
    }
    this.saveMeta();
    return this.meta;
  }

  public saveCustomWallpaper(originalName: string, buffer: Buffer): DesktopMeta {
    const wpDir = path.join(this.instanceRoot, 'wallpapers');
    fs.mkdirSync(wpDir, { recursive: true });
    const rawExt = path.extname(originalName || '').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.png';
    const fileName = `wp-${Date.now()}${rawExt}`;
    fs.writeFileSync(path.join(wpDir, fileName), buffer);
    this.meta.preferences.wallpaper = 'custom';
    this.meta.preferences.customWallpaper = fileName;
    this.saveMeta();
    return this.meta;
  }

  public setWallpaperFromVfs(vPath: string): DesktopMeta {
    const disk = this.resolveDiskPath(vPath);
    if (!fs.existsSync(disk) || fs.statSync(disk).isDirectory()) {
      throw new Error('Resim dosyası bulunamadı.');
    }
    const buf = fs.readFileSync(disk);
    return this.saveCustomWallpaper(path.basename(disk), buf);
  }

  public resolveWallpaperPath(fileName: string): string {
    const safeName = path.basename(fileName || '');
    const wpDir = path.join(this.instanceRoot, 'wallpapers');
    const resolved = path.resolve(wpDir, safeName);
    if (!resolved.startsWith(wpDir)) {
      throw new Error('Geçersiz arka plan yolu.');
    }
    return resolved;
  }

  public clearPositions(): DesktopMeta {
    this.meta.positions = {};
    this.saveMeta();
    return this.meta;
  }
}
