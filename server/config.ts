import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export interface TamgaConfig {
  name: string;
  host: string;
  port: number;
  dataDir: string;
  trustProxy: boolean;
  auth: {
    enabled: boolean;
    username: string;
    passwordHash: string;
    sessionSecret: string;
  };
  desktop: {
    defaultTheme: 'dark' | 'light';
    defaultWallpaper: string;
    allowMultiDesktop: boolean;
    filesystemMode: 'isolated' | 'host';
    hostRootPath: string;
  };
  linuxApps: {
    enabled: boolean;
    fps: number;
    quality: number;
    audio: boolean;
    allowInstall: boolean;
  };
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.startsWith('scrypt:')) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 3) return false;
  const [, salt, originalHex] = parts;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const original = Buffer.from(originalHex, 'hex');
    if (derived.length !== original.length) return false;
    return crypto.timingSafeEqual(derived, original);
  } catch {
    return false;
  }
}

export function getDefaultConfigPath(): string {
  if (process.env.TAMGA_CONFIG) {
    return path.resolve(process.env.TAMGA_CONFIG);
  }
  const cwdConfig = path.resolve(process.cwd(), 'tamga.config.json');
  if (fs.existsSync(cwdConfig)) {
    return cwdConfig;
  }
  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
    return '/etc/tamga-vdesktop/config.json';
  }
  return path.join(os.homedir(), '.config', 'tamga-vdesktop', 'config.json');
}

export function getDefaultDataDir(): string {
  if (process.env.TAMGA_DATA_DIR) {
    return path.resolve(process.env.TAMGA_DATA_DIR);
  }
  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
    return '/var/lib/tamga-vdesktop';
  }
  const localStorage = path.resolve(process.cwd(), 'storage');
  if (fs.existsSync(localStorage)) {
    return localStorage;
  }
  return path.join(os.homedir(), '.local', 'share', 'tamga-vdesktop');
}

export function createDefaultConfig(overrides?: Partial<{
  host: string;
  port: number;
  dataDir: string;
  username: string;
  password: string;
  authEnabled: boolean;
}>): TamgaConfig {
  const defaultPass = overrides?.password || 'tamga2026';
  return {
    name: 'TamgaVDesktop',
    host: overrides?.host || '0.0.0.0',
    port: overrides?.port || 4800,
    dataDir: overrides?.dataDir || getDefaultDataDir(),
    trustProxy: true,
    auth: {
      enabled: overrides?.authEnabled ?? false,
      username: overrides?.username || 'admin',
      passwordHash: hashPassword(defaultPass),
      sessionSecret: crypto.randomBytes(32).toString('hex'),
    },
    desktop: {
      defaultTheme: 'dark',
      defaultWallpaper: 'mono-peaks',
      allowMultiDesktop: true,
      filesystemMode: 'isolated',
      hostRootPath: os.homedir(),
    },
    linuxApps: {
      enabled: process.platform === 'linux',
      fps: 20,
      quality: 4,
      audio: true,
      allowInstall: true,
    },
  };
}

export function saveConfig(configPath: string, config: TamgaConfig): void {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export function loadConfig(explicitPath?: string): { config: TamgaConfig; configPath: string } {
  const configPath = explicitPath ? path.resolve(explicitPath) : getDefaultConfigPath();
  const base = createDefaultConfig();

  let fileCfg: Partial<TamgaConfig> = {};
  if (fs.existsSync(configPath)) {
    try {
      fileCfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      fileCfg = {};
    }
  }

  const merged: TamgaConfig = {
    ...base,
    ...fileCfg,
    auth: {
      ...base.auth,
      ...(fileCfg.auth || {}),
    },
    desktop: {
      ...base.desktop,
      ...(fileCfg.desktop || {}),
    },
    linuxApps: {
      ...base.linuxApps,
      ...(fileCfg.linuxApps || {}),
    },
  };

  // Environment variable overrides
  if (process.env.TAMGA_HOST) merged.host = process.env.TAMGA_HOST;
  if (process.env.TAMGA_PORT || process.env.PORT) {
    const parsedPort = Number(process.env.TAMGA_PORT || process.env.PORT);
    if (!Number.isNaN(parsedPort) && parsedPort > 0) merged.port = parsedPort;
  }
  if (process.env.TAMGA_DATA_DIR) merged.dataDir = path.resolve(process.env.TAMGA_DATA_DIR);
  if (process.env.TAMGA_AUTH_ENABLED !== undefined) {
    merged.auth.enabled = process.env.TAMGA_AUTH_ENABLED === 'true' || process.env.TAMGA_AUTH_ENABLED === '1';
  }
  if (process.env.TAMGA_USER) merged.auth.username = process.env.TAMGA_USER;
  if (process.env.TAMGA_PASSWORD) {
    merged.auth.passwordHash = hashPassword(process.env.TAMGA_PASSWORD);
    merged.auth.enabled = true;
  }

  return { config: merged, configPath };
}
