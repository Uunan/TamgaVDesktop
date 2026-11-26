import type { VFSNode } from '../types/os';

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 && i > 0 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h} sa ${m} dk`;
  if (m > 0) return `${m} dk ${s} sn`;
  return `${s} sn`;
}

export function formatDateTimeTR(iso: string): string {
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const EXTENSION_DESCRIPTIONS: Record<string, string> = {
  html: 'Chromium HTML Web Belgesi',
  htm: 'Chromium HTML Web Belgesi',
  css: 'Basamaklı Stil Şablonu (CSS)',
  scss: 'SASS Stil Şablonu',
  js: 'JavaScript Betik Dosyası',
  mjs: 'ES Modül JavaScript Dosyası',
  ts: 'TypeScript Kaynak Kodu',
  tsx: 'TypeScript React Bileşeni',
  jsx: 'JavaScript React Bileşeni',
  py: 'Python Betiği',
  sh: 'Kabuk (Shell) Komut Betiği',
  zsh: 'Zsh Kabuk Betiği',
  json: 'JSON Veri Yapılandırma Dosyası',
  yaml: 'YAML Yapılandırma Dosyası',
  yml: 'YAML Yapılandırma Dosyası',
  toml: 'TOML Yapılandırma Dosyası',
  env: 'Ortam Değişkenleri Dosyası (.env)',
  xml: 'XML İşaretleme Belgesi',
  csv: 'Virgülle Ayrılmış Veri Tablosu (CSV)',
  xlsx: 'Elektronik Tablo Çalışma Kitabı',
  xls: 'Elektronik Tablo Dosyası',
  sql: 'SQL Veritabanı Sorgu Betiği',
  db: 'Veritabanı Dosyası',
  sqlite: 'SQLite Veritabanı Dosyası',
  txt: 'Düz Metin Belgesi',
  md: 'Markdown Zengin Metin Belgesi',
  log: 'Sistem Günlük Kaydı (Log)',
  pdf: 'Taşınabilir Belge Biçimi (PDF)',
  doc: 'Kelime İşlemci Belgesi',
  docx: 'Kelime İşlemci Belgesi (DOCX)',
  ppt: 'Sunum Dosyası',
  pptx: 'Sunum Dosyası (PPTX)',
  png: 'PNG Görsel Dosyası',
  jpg: 'JPEG Fotoğraf Dosyası',
  jpeg: 'JPEG Fotoğraf Dosyası',
  gif: 'Hareketli GIF Görseli',
  webp: 'WebP Görsel Dosyası',
  svg: 'Ölçeklenebilir Vektör Grafiği (SVG)',
  ico: 'Simge Dosyası (ICO)',
  mp3: 'MP3 Ses Dosyası',
  wav: 'WAV Kayıpsız Ses Dosyası',
  ogg: 'OGG Ses Dosyası',
  flac: 'FLAC Yüksek Çözünürlüklü Ses',
  mp4: 'MP4 Video Dosyası',
  webm: 'WebM Video Akışı',
  mov: 'QuickTime Video Dosyası',
  mkv: 'Matroska Video Kapsayıcısı',
  zip: 'Sıkıştırılmış ZIP Arşivi',
  rar: 'RAR Sıkıştırılmış Arşiv',
  '7z': '7-Zip Sıkıştırılmış Arşiv',
  tar: 'TAR Arşiv Paketi',
  gz: 'GZip Sıkıştırılmış Paket',
  'tar.gz': 'Sıkıştırılmış TAR.GZ Arşivi',
  exe: 'Çalıştırılabilir Uygulama Paketi (EXE)',
  dmg: 'macOS Disk Kalıbı Paketi',
  app: 'Uygulama Paketi',
  deb: 'Debian Sistem Paketi',
  iso: 'Optik Disk Kalıbı (ISO)',
  rs: 'Rust Kaynak Kodu',
  go: 'Go Kaynak Kodu',
  cpp: 'C++ Kaynak Kodu',
  c: 'C Kaynak Kodu',
  java: 'Java Kaynak Kodu',
  php: 'PHP Betik Dosyası',
  rb: 'Ruby Betik Dosyası',
};

export function getFileTypeLabel(node: VFSNode): string {
  if (node.isDir) {
    if (node.path === '/.trash') return 'Sistem Geri Dönüşüm Kutusu';
    return 'Dosya Klasörü';
  }
  if (!node.extension) return 'Uzantısız Veri Dosyası';
  return EXTENSION_DESCRIPTIONS[node.extension] || `${node.extension.toUpperCase()} Dosyası (.${node.extension})`;
}

export function isTextEditableExtension(ext: string): boolean {
  const editable = new Set([
    '',
    'txt',
    'md',
    'html',
    'htm',
    'css',
    'scss',
    'js',
    'mjs',
    'ts',
    'tsx',
    'jsx',
    'py',
    'json',
    'yaml',
    'yml',
    'toml',
    'ini',
    'env',
    'gitignore',
    'xml',
    'svg',
    'csv',
    'sql',
    'sh',
    'zsh',
    'bash',
    'log',
    'rs',
    'go',
    'cpp',
    'c',
    'h',
    'java',
    'php',
    'rb',
  ]);
  return editable.has(ext.toLowerCase());
}

export function isImageExtension(ext: string): boolean {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext.toLowerCase());
}

export function isVideoExtension(ext: string): boolean {
  return ['mp4', 'webm', 'ogg', 'mov'].includes(ext.toLowerCase());
}

export function isAudioExtension(ext: string): boolean {
  return ['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext.toLowerCase());
}

export function translateFolderDisplayName(vPath: string, fallbackName: string): string {
  switch (vPath) {
    case '/':
      return 'Bu Compute';
    case '/Desktop':
      return 'Masaüstü';
    case '/Documents':
      return 'Belgeler';
    case '/Downloads':
      return 'İndirilenler';
    case '/Projects':
      return 'Projeler';
    case '/.trash':
      return 'Geri Dönüşüm Kutusu';
    default:
      return fallbackName;
  }
}
