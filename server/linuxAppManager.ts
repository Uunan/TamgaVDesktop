import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';

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

export interface LinuxRuntimeStatus {
  platform: string;
  isLinux: boolean;
  guiReady: boolean;
  missingDeps: string[];
  hasAudio: boolean;
  isRoot: boolean;
  distro: string;
}

interface CatalogAppDef {
  id: string;
  name: string;
  description: string;
  binaryNames: string[];
  defaultCommand: string;
  category: LinuxAppInfo['category'];
  needsNoSandbox?: boolean;
  installScript: string;
}

const CURATED_CATALOG: CatalogAppDef[] = [
  {
    id: 'firefox',
    name: 'Firefox',
    description: 'Gerçek Mozilla Firefox web tarayıcısı (.deb)',
    binaryNames: ['firefox', 'firefox-esr'],
    defaultCommand: 'firefox',
    category: 'browser',
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
install -d -m 0755 /etc/apt/keyrings
wget -q https://packages.mozilla.org/apt/repo-signing-key.gpg -O- | tee /etc/apt/keyrings/packages.mozilla.org.asc >/dev/null
echo "deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main" > /etc/apt/sources.list.d/mozilla.list
printf "Package: *\\nPin: origin packages.mozilla.org\\nPin-Priority: 1000\\n" > /etc/apt/preferences.d/mozilla
apt-get update -y && apt-get install -y firefox`,
  },
  {
    id: 'vscode',
    name: 'VS Code',
    description: 'Visual Studio Code — Gerçek masaüstü kod editörü',
    binaryNames: ['code'],
    defaultCommand: 'code',
    category: 'development',
    needsNoSandbox: true,
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y wget gpg apt-transport-https
wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor --yes > /etc/apt/keyrings/packages.microsoft.gpg
echo "deb [arch=amd64,arm64,armhf signed-by=/etc/apt/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" > /etc/apt/sources.list.d/vscode.list
apt-get update -y && apt-get install -y code`,
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    description: 'Google Antigravity IDE (Linux masaüstü sürümü)',
    binaryNames: ['antigravity'],
    defaultCommand: 'antigravity',
    category: 'development',
    needsNoSandbox: true,
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
mkdir -p /etc/apt/keyrings
curl -fsSL https://us-central1-apt.pkg.dev/doc/repo-signing-key.gpg | gpg --dearmor --yes -o /etc/apt/keyrings/antigravity-repo-key.gpg
echo "deb [signed-by=/etc/apt/keyrings/antigravity-repo-key.gpg] https://us-central1-apt.pkg.dev/projects/antigravity-auto-updater-dev/ antigravity-debian main" > /etc/apt/sources.list.d/antigravity.list
apt-get update -y && apt-get install -y antigravity`,
  },
  {
    id: 'chromium',
    name: 'Chromium',
    description: 'Açık kaynaklı Chromium web tarayıcısı',
    binaryNames: ['chromium', 'chromium-browser', 'google-chrome'],
    defaultCommand: 'chromium-browser',
    category: 'browser',
    needsNoSandbox: true,
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y chromium || apt-get install -y chromium-browser`,
  },
  {
    id: 'mousepad',
    name: 'Not Defteri',
    description: 'Hafif GTK metin ve kod düzenleyici (Mousepad)',
    binaryNames: ['mousepad', 'gedit', 'leafpad'],
    defaultCommand: 'mousepad',
    category: 'office',
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y mousepad`,
  },
  {
    id: 'gimp',
    name: 'GIMP',
    description: 'Gelişmiş açık kaynaklı görsel düzenleme aracı',
    binaryNames: ['gimp'],
    defaultCommand: 'gimp',
    category: 'media',
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y gimp`,
  },
  {
    id: 'vlc',
    name: 'VLC Media Player',
    description: 'Video ve ses oynatıcı',
    binaryNames: ['vlc'],
    defaultCommand: 'vlc',
    category: 'media',
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y vlc`,
  },
];

function whichBinary(name: string): string | null {
  try {
    const out = execSync(`command -v ${name}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: '/bin/sh',
    })
      .toString('utf-8')
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

function readDistroName(): string {
  if (process.platform !== 'linux') return `${process.platform} (${os.release()})`;
  try {
    const content = fs.readFileSync('/etc/os-release', 'utf-8');
    const match = content.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    if (match) return match[1];
  } catch {}
  return `Linux ${os.release()}`;
}

function sanitizeExec(raw: string): string {
  return raw
    .replace(/%[fFuUdDnNickvm]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function categorizeFromDesktop(cats: string): LinuxAppInfo['category'] {
  const c = cats.toLowerCase();
  if (c.includes('webbrowser') || c.includes('network')) return 'browser';
  if (c.includes('development') || c.includes('ide')) return 'development';
  if (c.includes('audio') || c.includes('video') || c.includes('graphics')) return 'media';
  if (c.includes('office') || c.includes('texteditor')) return 'office';
  if (c.includes('system') || c.includes('utility')) return 'system';
  return 'other';
}

export class LinuxAppManager {
  private installLogs = new Map<string, { status: 'running' | 'done' | 'error'; log: string }>();

  public getRuntimeStatus(): LinuxRuntimeStatus {
    const isLinux = process.platform === 'linux';
    const required = ['Xvfb', 'openbox', 'ffmpeg', 'python3', 'xdotool'];
    const missingDeps = isLinux ? required.filter((bin) => !whichBinary(bin)) : required;
    const hasAudio = isLinux && Boolean(whichBinary('pulseaudio') && whichBinary('parec'));
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    return {
      platform: process.platform,
      isLinux,
      guiReady: isLinux && missingDeps.length === 0,
      missingDeps,
      hasAudio,
      isRoot,
      distro: readDistroName(),
    };
  }

  public listApps(): LinuxAppInfo[] {
    const byId = new Map<string, LinuxAppInfo>();

    // 1. Curated catalog first
    for (const def of CURATED_CATALOG) {
      let foundBin: string | null = null;
      for (const b of def.binaryNames) {
        const res = whichBinary(b);
        if (res) {
          foundBin = b;
          break;
        }
      }
      byId.set(def.id, {
        id: def.id,
        name: def.name,
        description: def.description,
        command: foundBin || def.defaultCommand,
        category: def.category,
        iconName: def.id,
        installed: Boolean(foundBin),
        installable: process.platform === 'linux',
        needsNoSandbox: def.needsNoSandbox,
      });
    }

    // 2. Auto-discover any other installed Linux GUI apps from .desktop entries
    if (process.platform === 'linux') {
      const dirs = [
        '/usr/share/applications',
        '/usr/local/share/applications',
        path.join(os.homedir(), '.local/share/applications'),
      ];
      const knownCommands = new Set(
        Array.from(byId.values())
          .filter((a) => a.installed)
          .map((a) => a.command.split(' ')[0])
      );

      for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        let files: string[] = [];
        try {
          files = fs.readdirSync(dir).filter((f) => f.endsWith('.desktop'));
        } catch {
          continue;
        }
        for (const file of files) {
          try {
            const fullPath = path.join(dir, file);
            const raw = fs.readFileSync(fullPath, 'utf-8');
            const entryBlock = raw.split(/\[Desktop Action /)[0];
            if (/^NoDisplay\s*=\s*true/mi.test(entryBlock)) continue;
            if (/^Hidden\s*=\s*true/mi.test(entryBlock)) continue;
            if (/^Terminal\s*=\s*true/mi.test(entryBlock)) continue;
            if (!/^Type\s*=\s*Application/mi.test(entryBlock)) continue;

            const nameMatch = entryBlock.match(/^Name\s*=\s*(.+)$/m);
            const execMatch = entryBlock.match(/^Exec\s*=\s*(.+)$/m);
            const commentMatch = entryBlock.match(/^Comment\s*=\s*(.+)$/m);
            const iconMatch = entryBlock.match(/^Icon\s*=\s*(.+)$/m);
            const catMatch = entryBlock.match(/^Categories\s*=\s*(.+)$/m);

            if (!nameMatch || !execMatch) continue;
            const cleanCmd = sanitizeExec(execMatch[1]);
            const bin = path.basename(cleanCmd.split(' ')[0] || '');
            if (!bin || knownCommands.has(bin)) continue;
            // Skip internal X11/Openbox/display utilities
            if (['openbox', 'obconf', 'xterm', 'uxterm', 'python3'].includes(bin)) continue;

            const id = `desktop-${file.replace(/\.desktop$/i, '').replace(/[^a-z0-9_-]/gi, '-')}`;
            if (byId.has(id)) continue;
            knownCommands.add(bin);

            const needsNoSandbox = /code|electron|antigravity|chrome|chromium|discord|slack|obsidian/i.test(
              `${bin} ${nameMatch[1]}`
            );

            byId.set(id, {
              id,
              name: nameMatch[1].trim(),
              description: commentMatch?.[1]?.trim() || `Linux uygulaması (${bin})`,
              command: cleanCmd,
              category: categorizeFromDesktop(catMatch?.[1] || ''),
              iconName: iconMatch?.[1]?.trim(),
              installed: true,
              installable: false,
              desktopFile: fullPath,
              needsNoSandbox,
            });
          } catch {
            // ignore broken desktop entry
          }
        }
      }
    }

    return Array.from(byId.values());
  }

  public getApp(appId: string): LinuxAppInfo | undefined {
    return this.listApps().find((a) => a.id === appId);
  }

  public resolveIconPath(iconName: string): string | null {
    if (!iconName) return null;
    if (path.isAbsolute(iconName) && fs.existsSync(iconName)) return iconName;
    const safe = path.basename(iconName).replace(/[^a-z0-9._-]/gi, '');
    if (!safe) return null;

    const searchPaths = [
      `/usr/share/icons/hicolor/128x128/apps/${safe}.png`,
      `/usr/share/icons/hicolor/64x64/apps/${safe}.png`,
      `/usr/share/icons/hicolor/48x48/apps/${safe}.png`,
      `/usr/share/icons/hicolor/scalable/apps/${safe}.svg`,
      `/usr/share/pixmaps/${safe}.png`,
      `/usr/share/pixmaps/${safe}.svg`,
      `/usr/share/pixmaps/${safe}.xpm`,
    ];
    for (const p of searchPaths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  public startInstall(appId: string, customAptPackage?: string): { jobId: string } {
    if (process.platform !== 'linux') {
      throw new Error('Linux uygulama kurulumu yalnızca Linux sunucularda çalışır.');
    }

    let script = '';
    if (customAptPackage) {
      const cleanPkg = customAptPackage.trim();
      if (!/^[a-z0-9][a-z0-9.+\-:~/_]+$/i.test(cleanPkg)) {
        throw new Error('Geçersiz paket adı.');
      }
      script = `set -e\nexport DEBIAN_FRONTEND=noninteractive\napt-get update -y && apt-get install -y ${cleanPkg}`;
    } else {
      const def = CURATED_CATALOG.find((c) => c.id === appId);
      if (!def) throw new Error('Uygulama katalogda bulunamadı.');
      script = def.installScript;
    }

    const jobId = `inst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const record = { status: 'running' as 'running' | 'done' | 'error', log: '' };
    this.installLogs.set(jobId, record);

    const proc = spawn('/bin/bash', ['-c', script], {
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
    });

    const append = (buf: Buffer) => {
      record.log += buf.toString('utf-8');
      if (record.log.length > 40000) {
        record.log = record.log.slice(-40000);
      }
    };

    proc.stdout.on('data', append);
    proc.stderr.on('data', append);
    proc.on('exit', (code) => {
      record.status = code === 0 ? 'done' : 'error';
      record.log += code === 0 ? '\n✓ Kurulum başarıyla tamamlandı.\n' : `\n✗ Kurulum hata kodu ile sonlandı (${code}).\n`;
    });

    return { jobId };
  }

  public getInstallJob(jobId: string): { status: 'running' | 'done' | 'error'; log: string } | null {
    return this.installLogs.get(jobId) || null;
  }
}
