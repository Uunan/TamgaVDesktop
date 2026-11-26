import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';

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
}

export interface AptSearchResult {
  packageName: string;
  summary: string;
  installed: boolean;
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
  publisher: string;
  description: string;
  binaryNames: string[];
  defaultCommand: string;
  category: LinuxAppInfo['category'];
  accent: string;
  featured?: boolean;
  needsNoSandbox?: boolean;
  packageName?: string;
  installScript: string;
  uninstallScript?: string;
}

const APT_HELPER = (pkg: string) =>
  `set -e\nexport DEBIAN_FRONTEND=noninteractive\napt-get update -y && apt-get install -y ${pkg}`;

const APT_REMOVE = (pkg: string) =>
  `set -e\nexport DEBIAN_FRONTEND=noninteractive\napt-get remove -y ${pkg} && apt-get autoremove -y`;

const CURATED_CATALOG: CatalogAppDef[] = [
  /* ─── FEATURED & DEVELOPMENT ─── */
  {
    id: 'antigravity',
    name: 'Google Antigravity',
    publisher: 'Google DeepMind',
    description: 'Resmi Google Antigravity 2.x yapay zeka geliştirme ortamı (Linux x64/ARM64)',
    binaryNames: ['antigravity', '/opt/antigravity/antigravity', '/opt/antigravity/Antigravity'],
    defaultCommand: 'antigravity',
    category: 'development',
    accent: '#6366f1',
    featured: true,
    needsNoSandbox: true,
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y curl tar gzip ca-certificates gnupg libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 2>/dev/null || apt-get install -y curl tar gzip ca-certificates gnupg libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 || true
ARCH=$(dpkg --print-architecture)
if [ "$ARCH" = "arm64" ]; then PLAT="linux-arm"; else PLAT="linux-x64"; fi
echo "Resmi Google Antigravity sürümü kontrol ediliyor ($PLAT)..."
PAGE=$(curl -fsSL "https://antigravity.google/download?os=linux" || true)
URL=$(printf "%s" "$PAGE" | grep -oE "https://storage\\.googleapis\\.com/antigravity-public/antigravity-hub/[^\"' ]+/\${PLAT}/Antigravity\\.tar\\.gz" | head -n 1 || true)
if [ -z "$URL" ]; then
  URL=$(printf "%s" "$PAGE" | grep -oE "https://edgedl\\.me\\.gvt1\\.com/[^\"' ]+/\${PLAT}/Antigravity[^\"' ]*\\.tar\\.gz" | head -n 1 || true)
fi
if [ -n "$URL" ]; then
  echo "İndiriliyor: $URL"
  rm -rf /tmp/antigravity-dl /opt/antigravity
  mkdir -p /tmp/antigravity-dl /opt/antigravity
  curl -fL --progress-bar "$URL" -o /tmp/antigravity-dl/antigravity.tar.gz
  tar -xzf /tmp/antigravity-dl/antigravity.tar.gz -C /tmp/antigravity-dl
  SUBDIR=$(find /tmp/antigravity-dl -maxdepth 2 -type f \\( -name "antigravity" -o -name "Antigravity" \\) | head -n 1)
  if [ -n "$SUBDIR" ]; then
    APP_DIR=$(dirname "$SUBDIR")
    cp -a "$APP_DIR/." /opt/antigravity/
  else
    cp -a /tmp/antigravity-dl/. /opt/antigravity/
  fi
  rm -rf /tmp/antigravity-dl
  if [ -f /opt/antigravity/chrome-sandbox ]; then
    chown root:root /opt/antigravity/chrome-sandbox && chmod 4755 /opt/antigravity/chrome-sandbox || true
  fi
  BIN_TARGET=$(find /opt/antigravity -maxdepth 1 -type f \\( -name "antigravity" -o -name "Antigravity" \\) | head -n 1)
  chmod +x "$BIN_TARGET"
  cat > /usr/local/bin/antigravity <<WRAP
#!/bin/sh
exec "$BIN_TARGET" "\\$@"
WRAP
  chmod +x /usr/local/bin/antigravity
  ICON_PATH=$(find /opt/antigravity -maxdepth 4 -type f \\( -name "*.png" -o -name "*.svg" \\) | grep -iE "icon|antigravity|logo" | head -n 1 || true)
  if [ -n "$ICON_PATH" ]; then
    mkdir -p /usr/share/pixmaps
    cp "$ICON_PATH" /usr/share/pixmaps/antigravity.png 2>/dev/null || true
  fi
  cat > /usr/share/applications/antigravity.desktop <<DESK
[Desktop Entry]
Name=Google Antigravity
Comment=Google Antigravity AI IDE
Exec=/usr/local/bin/antigravity %F
Icon=antigravity
Terminal=false
Type=Application
Categories=Development;IDE;
DESK
else
  echo "Doğrudan tarball bulunamadı, resmi Google Antigravity APT deposu kullanılıyor..."
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://us-central1-apt.pkg.dev/doc/repo-signing-key.gpg | gpg --dearmor --yes -o /etc/apt/keyrings/antigravity-repo-key.gpg
  echo "deb [signed-by=/etc/apt/keyrings/antigravity-repo-key.gpg] https://us-central1-apt.pkg.dev/projects/antigravity-auto-updater-dev/ antigravity-debian main" > /etc/apt/sources.list.d/antigravity.list
  apt-get update -y && apt-get install -y antigravity
fi`,
    uninstallScript: `set -e
rm -rf /opt/antigravity /usr/local/bin/antigravity /usr/share/applications/antigravity.desktop /usr/share/pixmaps/antigravity.png
apt-get remove -y antigravity 2>/dev/null || true`,
  },
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    publisher: 'Microsoft',
    description: 'Zengin eklenti ekosistemiyle modern kod editörü (Web-Native + Linux)',
    binaryNames: ['code'],
    defaultCommand: 'code',
    category: 'development',
    accent: '#0ea5e9',
    featured: true,
    needsNoSandbox: true,
    packageName: 'code',
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y wget gpg apt-transport-https
mkdir -p /etc/apt/keyrings
wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor --yes > /etc/apt/keyrings/packages.microsoft.gpg
echo "deb [arch=amd64,arm64,armhf signed-by=/etc/apt/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" > /etc/apt/sources.list.d/vscode.list
apt-get update -y && apt-get install -y code`,
    uninstallScript: APT_REMOVE('code'),
  },
  {
    id: 'chrome',
    name: 'Google Chrome',
    publisher: 'Google',
    description: 'Hızlı ve güvenli resmi Google Chrome web tarayıcısı (.deb)',
    binaryNames: ['google-chrome-stable', 'google-chrome'],
    defaultCommand: 'google-chrome-stable',
    category: 'browser',
    accent: '#3b82f6',
    featured: true,
    needsNoSandbox: true,
    packageName: 'google-chrome-stable',
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get update -y && apt-get install -y /tmp/google-chrome.deb
rm -f /tmp/google-chrome.deb`,
    uninstallScript: APT_REMOVE('google-chrome-stable'),
  },
  {
    id: 'firefox',
    name: 'Mozilla Firefox',
    publisher: 'Mozilla',
    description: 'Gizlilik odaklı, açık kaynaklı resmi Mozilla Firefox tarayıcısı (.deb)',
    binaryNames: ['firefox', 'firefox-esr'],
    defaultCommand: 'firefox',
    category: 'browser',
    accent: '#f97316',
    featured: true,
    packageName: 'firefox',
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
install -d -m 0755 /etc/apt/keyrings
wget -q https://packages.mozilla.org/apt/repo-signing-key.gpg -O- | tee /etc/apt/keyrings/packages.mozilla.org.asc >/dev/null
echo "deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main" > /etc/apt/sources.list.d/mozilla.list
printf "Package: *\\nPin: origin packages.mozilla.org\\nPin-Priority: 1000\\n" > /etc/apt/preferences.d/mozilla
apt-get update -y && apt-get install -y firefox`,
    uninstallScript: APT_REMOVE('firefox'),
  },
  {
    id: 'brave',
    name: 'Brave Browser',
    publisher: 'Brave Software',
    description: 'Dahili reklam ve izleyici engelleyicili hızlı Chromium tarayıcısı',
    binaryNames: ['brave-browser', 'brave-browser-stable'],
    defaultCommand: 'brave-browser',
    category: 'browser',
    accent: '#ea580c',
    needsNoSandbox: true,
    packageName: 'brave-browser',
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y curl
curl -fsSLo /usr/share/keyrings/brave-browser-archive-keyring.gpg https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/brave-browser-archive-keyring.gpg] https://brave-browser-apt-release.s3.brave.com/ stable main" > /etc/apt/sources.list.d/brave-browser-release.list
apt-get update -y && apt-get install -y brave-browser`,
    uninstallScript: APT_REMOVE('brave-browser'),
  },

  /* ─── MORE DEVELOPMENT ─── */
  {
    id: 'vscodium',
    name: 'VSCodium',
    publisher: 'VSCodium',
    description: 'Telemetrisiz, tamamen açık kaynaklı VS Code derlemesi',
    binaryNames: ['codium'],
    defaultCommand: 'codium',
    category: 'development',
    accent: '#2563eb',
    needsNoSandbox: true,
    packageName: 'codium',
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y wget gpg
wget -qO - https://gitlab.com/paulcarroty/vscodium-deb-rpm-repo/raw/master/pub.gpg | gpg --dearmor --yes -o /usr/share/keyrings/vscodium-archive-keyring.gpg
echo "deb [ signed-by=/usr/share/keyrings/vscodium-archive-keyring.gpg ] https://download.vscodium.com/debs vscodium main" > /etc/apt/sources.list.d/vscodium.list
apt-get update -y && apt-get install -y codium`,
    uninstallScript: APT_REMOVE('codium'),
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    publisher: 'Sublime HQ',
    description: 'Ultra hızlı, hafif ve güçlü metin ve kod düzenleyici',
    binaryNames: ['subl'],
    defaultCommand: 'subl',
    category: 'development',
    accent: '#f59e0b',
    packageName: 'sublime-text',
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y wget gpg apt-transport-https
wget -qO - https://download.sublimetext.com/sublimehq-pub.gpg | gpg --dearmor --yes -o /etc/apt/trusted.gpg.d/sublimehq-archive.gpg
echo "deb https://download.sublimetext.com/ apt/stable/" > /etc/apt/sources.list.d/sublime-text.list
apt-get update -y && apt-get install -y sublime-text`,
    uninstallScript: APT_REMOVE('sublime-text'),
  },
  {
    id: 'geany',
    name: 'Geany IDE',
    publisher: 'Geany',
    description: 'Hafif GTK tabanlı çok dilli hızlı IDE',
    binaryNames: ['geany'],
    defaultCommand: 'geany',
    category: 'development',
    accent: '#eab308',
    packageName: 'geany',
    installScript: APT_HELPER('geany'),
    uninstallScript: APT_REMOVE('geany'),
  },
  {
    id: 'filezilla',
    name: 'FileZilla',
    publisher: 'FileZilla Project',
    description: 'FTP, FTPS ve SFTP sunucular için görsel dosya aktarım istemcisi',
    binaryNames: ['filezilla'],
    defaultCommand: 'filezilla',
    category: 'development',
    accent: '#dc2626',
    packageName: 'filezilla',
    installScript: APT_HELPER('filezilla'),
    uninstallScript: APT_REMOVE('filezilla'),
  },
  {
    id: 'sqlitebrowser',
    name: 'DB Browser for SQLite',
    publisher: 'SQLiteBrowser',
    description: 'SQLite veritabanlarını görsel olarak oluşturma ve sorgulama aracı',
    binaryNames: ['sqlitebrowser'],
    defaultCommand: 'sqlitebrowser',
    category: 'development',
    accent: '#0284c7',
    packageName: 'sqlitebrowser',
    installScript: APT_HELPER('sqlitebrowser'),
    uninstallScript: APT_REMOVE('sqlitebrowser'),
  },
  {
    id: 'meld',
    name: 'Meld Diff',
    publisher: 'GNOME',
    description: 'Dosya, klasör ve Git değişikliklerini görsel karşılaştırma aracı',
    binaryNames: ['meld'],
    defaultCommand: 'meld',
    category: 'development',
    accent: '#16a34a',
    packageName: 'meld',
    installScript: APT_HELPER('meld'),
    uninstallScript: APT_REMOVE('meld'),
  },

  /* ─── DESIGN & MEDIA ─── */
  {
    id: 'gimp',
    name: 'GIMP',
    publisher: 'GIMP Team',
    description: 'Profesyonel açık kaynaklı fotoğraf düzenleme ve grafik tasarım stüdyosu',
    binaryNames: ['gimp'],
    defaultCommand: 'gimp',
    category: 'media',
    accent: '#8b5cf6',
    featured: true,
    packageName: 'gimp',
    installScript: APT_HELPER('gimp'),
    uninstallScript: APT_REMOVE('gimp'),
  },
  {
    id: 'inkscape',
    name: 'Inkscape',
    publisher: 'Inkscape Project',
    description: 'Profesyonel SVG vektör çizim ve illüstrasyon editörü',
    binaryNames: ['inkscape'],
    defaultCommand: 'inkscape',
    category: 'media',
    accent: '#64748b',
    packageName: 'inkscape',
    installScript: APT_HELPER('inkscape'),
    uninstallScript: APT_REMOVE('inkscape'),
  },
  {
    id: 'krita',
    name: 'Krita',
    publisher: 'KDE',
    description: 'Dijital boyama, konsept sanatı ve illüstrasyon uygulaması',
    binaryNames: ['krita'],
    defaultCommand: 'krita',
    category: 'media',
    accent: '#ec4899',
    packageName: 'krita',
    installScript: APT_HELPER('krita'),
    uninstallScript: APT_REMOVE('krita'),
  },
  {
    id: 'blender',
    name: 'Blender',
    publisher: 'Blender Foundation',
    description: '3D modelleme, animasyon, render ve video kurgu paketi',
    binaryNames: ['blender'],
    defaultCommand: 'blender',
    category: 'media',
    accent: '#f97316',
    packageName: 'blender',
    installScript: APT_HELPER('blender'),
    uninstallScript: APT_REMOVE('blender'),
  },
  {
    id: 'vlc',
    name: 'VLC Media Player',
    publisher: 'VideoLAN',
    description: 'Her formatı oynatan hızlı ve güvenilir video & ses oynatıcı',
    binaryNames: ['vlc'],
    defaultCommand: 'vlc',
    category: 'media',
    accent: '#f97316',
    packageName: 'vlc',
    installScript: APT_HELPER('vlc'),
    uninstallScript: APT_REMOVE('vlc'),
  },
  {
    id: 'obs-studio',
    name: 'OBS Studio',
    publisher: 'OBS Project',
    description: 'Ekran kaydı ve canlı yayın stüdyosu',
    binaryNames: ['obs'],
    defaultCommand: 'obs',
    category: 'media',
    accent: '#334155',
    packageName: 'obs-studio',
    installScript: APT_HELPER('obs-studio'),
    uninstallScript: APT_REMOVE('obs-studio'),
  },
  {
    id: 'audacity',
    name: 'Audacity',
    publisher: 'Audacity Team',
    description: 'Çok kanallı ses kayıt ve düzenleme editörü',
    binaryNames: ['audacity'],
    defaultCommand: 'audacity',
    category: 'media',
    accent: '#2563eb',
    packageName: 'audacity',
    installScript: APT_HELPER('audacity'),
    uninstallScript: APT_REMOVE('audacity'),
  },
  {
    id: 'kdenlive',
    name: 'Kdenlive',
    publisher: 'KDE',
    description: 'Çok kanallı profesyonel açık kaynaklı video kurgu editörü',
    binaryNames: ['kdenlive'],
    defaultCommand: 'kdenlive',
    category: 'media',
    accent: '#3b82f6',
    packageName: 'kdenlive',
    installScript: APT_HELPER('kdenlive'),
    uninstallScript: APT_REMOVE('kdenlive'),
  },
  {
    id: 'shotcut',
    name: 'Shotcut',
    publisher: 'Meltytech',
    description: 'Modern, hızlı ve kolay kullanımlı video düzenleyici',
    binaryNames: ['shotcut'],
    defaultCommand: 'shotcut',
    category: 'media',
    accent: '#0891b2',
    packageName: 'shotcut',
    installScript: APT_HELPER('shotcut'),
    uninstallScript: APT_REMOVE('shotcut'),
  },
  {
    id: 'handbrake',
    name: 'HandBrake',
    publisher: 'HandBrake Team',
    description: 'Video format dönüştürme ve sıkıştırma aracı',
    binaryNames: ['ghb'],
    defaultCommand: 'ghb',
    category: 'media',
    accent: '#e11d48',
    packageName: 'handbrake',
    installScript: APT_HELPER('handbrake'),
    uninstallScript: APT_REMOVE('handbrake'),
  },

  /* ─── OFFICE & PRODUCTIVITY ─── */
  {
    id: 'libreoffice',
    name: 'LibreOffice',
    publisher: 'The Document Foundation',
    description: 'Tam kapsamlı ofis paketi (Writer, Calc, Impress, Draw)',
    binaryNames: ['libreoffice', 'soffice'],
    defaultCommand: 'libreoffice',
    category: 'office',
    accent: '#22c55e',
    featured: true,
    packageName: 'libreoffice',
    installScript: APT_HELPER('libreoffice'),
    uninstallScript: APT_REMOVE('libreoffice'),
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    publisher: 'Obsidian',
    description: 'Markdown tabanlı kişisel bilgi grafiği ve not alma uygulaması',
    binaryNames: ['obsidian'],
    defaultCommand: 'obsidian',
    category: 'office',
    accent: '#7c3aed',
    needsNoSandbox: true,
    packageName: 'obsidian',
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y curl
URL=$(curl -fsSL https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest | grep -oE 'https://github\\.com/obsidianmd/obsidian-releases/releases/download/[^"]+amd64\\.deb' | head -n 1)
curl -fL "$URL" -o /tmp/obsidian.deb
apt-get install -y /tmp/obsidian.deb
rm -f /tmp/obsidian.deb`,
    uninstallScript: APT_REMOVE('obsidian'),
  },
  {
    id: 'thunderbird',
    name: 'Thunderbird',
    publisher: 'Mozilla',
    description: 'Güçlü masaüstü e-posta, takvim ve kişi yöneticisi',
    binaryNames: ['thunderbird'],
    defaultCommand: 'thunderbird',
    category: 'office',
    accent: '#0284c7',
    packageName: 'thunderbird',
    installScript: APT_HELPER('thunderbird'),
    uninstallScript: APT_REMOVE('thunderbird'),
  },
  {
    id: 'mousepad',
    name: 'Not Defteri (Mousepad)',
    publisher: 'Xfce',
    description: 'Hafif ve çok hızlı GTK metin & kod düzenleyici',
    binaryNames: ['mousepad', 'gedit', 'leafpad'],
    defaultCommand: 'mousepad',
    category: 'office',
    accent: '#6366f1',
    packageName: 'mousepad',
    installScript: APT_HELPER('mousepad'),
    uninstallScript: APT_REMOVE('mousepad'),
  },
  {
    id: 'xournalpp',
    name: 'Xournal++',
    publisher: 'Xournal++',
    description: 'PDF üzerine çizim, el yazısı ve açıklama ekleme aracı',
    binaryNames: ['xournalpp'],
    defaultCommand: 'xournalpp',
    category: 'office',
    accent: '#14b8a6',
    packageName: 'xournalpp',
    installScript: APT_HELPER('xournalpp'),
    uninstallScript: APT_REMOVE('xournalpp'),
  },

  /* ─── COMMUNICATION ─── */
  {
    id: 'discord',
    name: 'Discord',
    publisher: 'Discord Inc.',
    description: 'Sesli, görüntülü ve metin tabanlı topluluk & ekip iletişimi',
    binaryNames: ['discord'],
    defaultCommand: 'discord',
    category: 'communication',
    accent: '#5865f2',
    needsNoSandbox: true,
    packageName: 'discord',
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y curl
curl -fL "https://discord.com/api/download?platform=linux&format=deb" -o /tmp/discord.deb
apt-get install -y /tmp/discord.deb
rm -f /tmp/discord.deb`,
    uninstallScript: APT_REMOVE('discord'),
  },
  {
    id: 'telegram',
    name: 'Telegram Desktop',
    publisher: 'Telegram',
    description: 'Hızlı, bulut tabanlı resmi Telegram masaüstü istemcisi',
    binaryNames: ['telegram-desktop'],
    defaultCommand: 'telegram-desktop',
    category: 'communication',
    accent: '#0ea5e9',
    packageName: 'telegram-desktop',
    installScript: APT_HELPER('telegram-desktop'),
    uninstallScript: APT_REMOVE('telegram-desktop'),
  },

  /* ─── SYSTEM & UTILITIES ─── */
  {
    id: 'keepassxc',
    name: 'KeePassXC',
    publisher: 'KeePassXC Team',
    description: 'Çevrimdışı, güçlü şifrelemeli açık kaynaklı parola yöneticisi',
    binaryNames: ['keepassxc'],
    defaultCommand: 'keepassxc',
    category: 'system',
    accent: '#10b981',
    packageName: 'keepassxc',
    installScript: APT_HELPER('keepassxc'),
    uninstallScript: APT_REMOVE('keepassxc'),
  },
  {
    id: 'transmission',
    name: 'Transmission',
    publisher: 'Transmission',
    description: 'Sade, hafif ve hızlı BitTorrent istemcisi',
    binaryNames: ['transmission-gtk'],
    defaultCommand: 'transmission-gtk',
    category: 'system',
    accent: '#ef4444',
    packageName: 'transmission-gtk',
    installScript: APT_HELPER('transmission-gtk'),
    uninstallScript: APT_REMOVE('transmission-gtk'),
  },
  {
    id: 'remmina',
    name: 'Remmina',
    publisher: 'Remmina',
    description: 'RDP, VNC, SSH ve SPICE uzak masaüstü istemcisi',
    binaryNames: ['remmina'],
    defaultCommand: 'remmina',
    category: 'system',
    accent: '#14b8a6',
    packageName: 'remmina',
    installScript: APT_HELPER('remmina'),
    uninstallScript: APT_REMOVE('remmina'),
  },
  {
    id: 'bleachbit',
    name: 'BleachBit',
    publisher: 'BleachBit',
    description: 'Disk alanı açıcı ve önbellek/gizlilik temizleyici',
    binaryNames: ['bleachbit'],
    defaultCommand: 'bleachbit',
    category: 'system',
    accent: '#06b6d4',
    packageName: 'bleachbit',
    installScript: APT_HELPER('bleachbit'),
    uninstallScript: APT_REMOVE('bleachbit'),
  },
  {
    id: 'flameshot',
    name: 'Flameshot',
    publisher: 'Flameshot',
    description: 'Gelişmiş ekran görüntüsü alma ve işaretleme aracı',
    binaryNames: ['flameshot'],
    defaultCommand: 'flameshot gui',
    category: 'system',
    accent: '#a855f7',
    packageName: 'flameshot',
    installScript: APT_HELPER('flameshot'),
    uninstallScript: APT_REMOVE('flameshot'),
  },
];

function whichBinary(name: string): string | null {
  if (path.isAbsolute(name)) {
    return fs.existsSync(name) ? name : null;
  }
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
  if (c.includes('webbrowser')) return 'browser';
  if (c.includes('instantmessaging') || c.includes('chat') || c.includes('irc')) return 'communication';
  if (c.includes('development') || c.includes('ide')) return 'development';
  if (c.includes('audio') || c.includes('video') || c.includes('graphics')) return 'media';
  if (c.includes('office') || c.includes('texteditor')) return 'office';
  if (c.includes('system') || c.includes('utility') || c.includes('network')) return 'system';
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

    // 1. Curated Store catalog first
    for (const def of CURATED_CATALOG) {
      let foundBin: string | null = null;
      for (const b of def.binaryNames) {
        const res = whichBinary(b);
        if (res) {
          foundBin = path.isAbsolute(b) ? b : b;
          break;
        }
      }
      byId.set(def.id, {
        id: def.id,
        name: def.name,
        publisher: def.publisher,
        description: def.description,
        command: foundBin || def.defaultCommand,
        category: def.category,
        accent: def.accent,
        featured: def.featured,
        iconName: def.id,
        installed: Boolean(foundBin),
        installable: process.platform === 'linux',
        uninstallable: process.platform === 'linux' && Boolean(def.uninstallScript || def.packageName),
        packageName: def.packageName,
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
          .map((a) => path.basename(a.command.split(' ')[0] || ''))
      );
      const knownNames = new Set(
        Array.from(byId.values())
          .filter((a) => a.installed)
          .map((a) => a.name.toLowerCase())
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
            const cleanName = nameMatch[1].trim();
            const cleanCmd = sanitizeExec(execMatch[1]);
            const bin = path.basename(cleanCmd.split(' ')[0] || '');
            if (!bin || knownCommands.has(bin) || knownNames.has(cleanName.toLowerCase())) continue;
            // Skip internal X11/Openbox/GIMP duplicate or display utilities
            if (
              ['openbox', 'obconf', 'xterm', 'uxterm', 'python3', 'gimp-2.10', 'gimp-3.0', 'zutty'].includes(
                bin
              )
            ) {
              continue;
            }

            const id = `desktop-${file.replace(/\.desktop$/i, '').replace(/[^a-z0-9_-]/gi, '-')}`;
            if (byId.has(id)) continue;
            knownCommands.add(bin);
            knownNames.add(cleanName.toLowerCase());

            const needsNoSandbox = /code|electron|antigravity|chrome|chromium|brave|discord|slack|obsidian/i.test(
              `${bin} ${cleanName}`
            );

            byId.set(id, {
              id,
              name: cleanName,
              publisher: 'Ubuntu',
              description: commentMatch?.[1]?.trim() || `Linux uygulaması (${bin})`,
              command: cleanCmd,
              category: categorizeFromDesktop(catMatch?.[1] || ''),
              iconName: iconMatch?.[1]?.trim(),
              installed: true,
              installable: false,
              uninstallable: false,
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

  public searchApt(query: string): AptSearchResult[] {
    if (process.platform !== 'linux') return [];
    const clean = query.trim().replace(/[^a-z0-9.+\-\s]/gi, '');
    if (clean.length < 2) return [];
    try {
      const raw = execSync(`apt-cache search -- "${clean.replace(/"/g, '')}"`, {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 4000,
      }).toString('utf-8');

      const installedSet = new Set<string>();
      try {
        const dpkgOut = execSync("dpkg-query -W -f='${Package}\\n' 2>/dev/null || true", {
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 3000,
          shell: '/bin/sh',
        }).toString('utf-8');
        for (const line of dpkgOut.split('\n')) {
          if (line.trim()) installedSet.add(line.trim());
        }
      } catch {}

      const results: AptSearchResult[] = [];
      const qLower = clean.toLowerCase();
      const lines = raw.split('\n').filter(Boolean);

      // Prioritize exact / prefix matches and skip internal lib*/-dev/-dbg/-doc packages unless explicitly searched
      const scored: Array<{ score: number; item: AptSearchResult }> = [];
      for (const line of lines) {
        const sep = line.indexOf(' - ');
        if (sep === -1) continue;
        const pkg = line.slice(0, sep).trim();
        const summary = line.slice(sep + 3).trim();
        if (!pkg) continue;
        if (
          !qLower.startsWith('lib') &&
          (pkg.startsWith('lib') ||
            pkg.endsWith('-dev') ||
            pkg.endsWith('-dbg') ||
            pkg.endsWith('-doc') ||
            pkg.endsWith('-common') ||
            pkg.endsWith('-data') ||
            pkg.startsWith('gir1.2-'))
        ) {
          continue;
        }
        let score = 0;
        if (pkg === qLower) score += 100;
        else if (pkg.startsWith(qLower)) score += 50;
        else if (pkg.includes(qLower)) score += 25;
        if (summary.toLowerCase().includes(qLower)) score += 10;
        scored.push({
          score,
          item: {
            packageName: pkg,
            summary,
            installed: installedSet.has(pkg),
          },
        });
      }

      scored.sort((a, b) => b.score - a.score || a.item.packageName.localeCompare(b.item.packageName));
      for (const s of scored.slice(0, 36)) {
        results.push(s.item);
      }
      return results;
    } catch {
      return [];
    }
  }

  public resolveIconPath(iconName: string): string | null {
    if (!iconName) return null;
    if (path.isAbsolute(iconName) && fs.existsSync(iconName)) return iconName;
    const safe = path.basename(iconName).replace(/[^a-z0-9._-]/gi, '');
    if (!safe) return null;

    const aliasMap: Record<string, string[]> = {
      chrome: ['google-chrome', 'chromium', 'chromium-browser'],
      mousepad: ['org.xfce.mousepad', 'mousepad'],
      vscode: ['com.visualstudio.code', 'vscode', 'visual-studio-code'],
      vscodium: ['vscodium', 'codium'],
      sublime: ['sublime-text'],
      'obs-studio': ['com.obsproject.Studio', 'obs'],
      telegram: ['telegram', 'org.telegram.desktop'],
      libreoffice: ['libreoffice-startcenter', 'libreoffice-writer'],
      handbrake: ['fr.handbrake.ghb', 'hb-icon'],
      transmission: ['transmission'],
      antigravity: ['antigravity', 'Antigravity'],
    };
    const candidates = Array.from(new Set([safe, ...(aliasMap[safe] || [])]));

    for (const name of candidates) {
      const searchPaths = [
        `/usr/share/icons/hicolor/256x256/apps/${name}.png`,
        `/usr/share/icons/hicolor/128x128/apps/${name}.png`,
        `/usr/share/icons/hicolor/64x64/apps/${name}.png`,
        `/usr/share/icons/hicolor/48x48/apps/${name}.png`,
        `/usr/share/icons/hicolor/scalable/apps/${name}.svg`,
        `/usr/share/pixmaps/${name}.png`,
        `/usr/share/pixmaps/${name}.svg`,
        `/usr/share/pixmaps/${name}.xpm`,
      ];
      for (const p of searchPaths) {
        if (fs.existsSync(p)) return p;
      }
    }
    return null;
  }

  private runJobScript(script: string, doneMessage: string): { jobId: string } {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
      record.log +=
        code === 0
          ? `\n✓ ${doneMessage}\n`
          : `\n✗ İşlem hata kodu ile sonlandı (${code}).\n`;
    });

    return { jobId };
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

    return this.runJobScript(script, 'Kurulum başarıyla tamamlandı.');
  }

  public startUninstall(appId?: string, customAptPackage?: string): { jobId: string } {
    if (process.platform !== 'linux') {
      throw new Error('Linux uygulama kaldırma yalnızca Linux sunucularda çalışır.');
    }

    let script = '';
    if (customAptPackage) {
      const cleanPkg = customAptPackage.trim();
      if (!/^[a-z0-9][a-z0-9.+\-:~/_]+$/i.test(cleanPkg)) {
        throw new Error('Geçersiz paket adı.');
      }
      script = APT_REMOVE(cleanPkg);
    } else if (appId) {
      const def = CURATED_CATALOG.find((c) => c.id === appId);
      if (!def) throw new Error('Uygulama katalogda bulunamadı.');
      script = def.uninstallScript || (def.packageName ? APT_REMOVE(def.packageName) : '');
      if (!script) throw new Error('Bu uygulama için otomatik kaldırma betiği tanımlı değil.');
    } else {
      throw new Error('Uygulama kimliği veya paket adı gereklidir.');
    }

    return this.runJobScript(script, 'Uygulama başarıyla kaldırıldı.');
  }

  public getInstallJob(jobId: string): { status: 'running' | 'done' | 'error'; log: string } | null {
    return this.installLogs.get(jobId) || null;
  }
}
