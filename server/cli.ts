#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execSync, spawnSync } from 'node:child_process';
import {
  createDefaultConfig,
  getDefaultConfigPath,
  getDefaultDataDir,
  hashPassword,
  loadConfig,
  saveConfig,
} from './config';
import { LinuxAppManager } from './linuxAppManager';
import {
  findChromiumExecutable,
  findPlaywrightManagedBrowser,
  installPlaywrightBrowserSync,
} from './chromiumManager';
import { startTamgaServer, TAMGA_VERSION } from './index';

function parseFlags(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg === '-p' && argv[i + 1]) {
      flags.port = argv[++i];
    } else if (arg === '-c' && argv[i + 1]) {
      flags.config = argv[++i];
    } else if (arg === '-h' || arg === '--help') {
      flags.help = true;
    } else if (arg === '-v' || arg === '--version') {
      flags.version = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function ask(rl: readline.Interface, question: string, fallback: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`${question} [${fallback}]: `, (answer) => {
      resolve(answer.trim() || fallback);
    });
  });
}

function printHelp() {
  console.log(`
TamgaVDesktop v${TAMGA_VERSION} — Linux Sanal Masaüstü Platformu

Kullanım:
  tamga-vdesktop start [seçenekler]         Sunucuyu başlatır
  tamga-vdesktop init [seçenekler]          Yapılandırma dosyasını oluşturur
  tamga-vdesktop install-browser            Yerleşik Playwright Chromium tarayıcısını kurar
  tamga-vdesktop setup-linux [seçenekler]   Linux GUI + Playwright Chromium ortamını kurar
  tamga-vdesktop service <komut>            systemd servisini yönetir (install|start|stop|restart|status|logs|uninstall)
  tamga-vdesktop passwd <yeni-parola>       Yönetici parolasını günceller
  tamga-vdesktop doctor                     Sistem ve bağımlılık teşhisi yapar

Seçenekler:
  -p, --port <port>           Dinlenecek port (varsayılan: 4800)
      --host <adres>          Bağlanılacak IP (varsayılan: 0.0.0.0)
  -c, --config <dosya>        Ayar dosyası yolu
      --data-dir <dizin>      Veri depolama dizini
      --user <kullanıcı>      Yönetici kullanıcı adı (init)
      --password <parola>     Yönetici parolası (init)
      --no-auth               Parola girişini kapat (init)
      --with-firefox          setup-linux ile Mozilla Firefox (.deb) kur
      --with-vscode           setup-linux ile Visual Studio Code kur
      --non-interactive       init komutunu sormadan çalıştır
  -v, --version               Sürümü göster
  -h, --help                  Yardım mesajını göster
`);
}

async function cmdInit(flags: Record<string, string | boolean>) {
  const configPath = typeof flags.config === 'string' ? path.resolve(flags.config) : getDefaultConfigPath();
  const nonInteractive = Boolean(flags['non-interactive']);

  let port = Number(flags.port || 4800);
  let host = String(flags.host || '0.0.0.0');
  let dataDir = typeof flags['data-dir'] === 'string' ? path.resolve(flags['data-dir']) : getDefaultDataDir();
  let authEnabled = flags['no-auth'] ? false : true;
  let username = String(flags.user || 'admin');
  let password = typeof flags.password === 'string' ? flags.password : '';

  if (!nonInteractive && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log(`\nTamgaVDesktop Kurulum Sihirbazı\nAyar dosyası: ${configPath}\n`);
    port = Number(await ask(rl, 'Dinlenecek port', String(port))) || 4800;
    host = await ask(rl, 'Dinlenecek adres (dış erişim için 0.0.0.0)', host);
    dataDir = path.resolve(await ask(rl, 'Veri dizini', dataDir));
    const authAns = await ask(rl, 'Giriş ekranı / parola koruması aktif olsun mu? (e/h)', authEnabled ? 'e' : 'h');
    authEnabled = authAns.toLowerCase().startsWith('e') || authAns.toLowerCase().startsWith('y');
    if (authEnabled) {
      username = await ask(rl, 'Yönetici kullanıcı adı', username);
      password = await ask(rl, 'Yönetici parolası', password || 'tamga2026');
    }
    rl.close();
  } else if (authEnabled && !password) {
    password = 'tamga2026';
  }

  const cfg = createDefaultConfig({
    host,
    port,
    dataDir,
    authEnabled,
    username,
    password: password || 'tamga2026',
  });

  saveConfig(configPath, cfg);
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`\n✓ Yapılandırma kaydedildi: ${configPath}`);
  console.log(`  Port       : ${cfg.port} (${cfg.host})`);
  console.log(`  Veri Dizini: ${cfg.dataDir}`);
  console.log(`  Giriş      : ${cfg.auth.enabled ? `Aktif (kullanıcı: ${cfg.auth.username})` : 'Kapalı'}`);
  console.log(`\nBaşlatmak için:  tamga-vdesktop start --config "${configPath}"`);
  console.log(`7/24 servis için: tamga-vdesktop service install --config "${configPath}"\n`);
}

function cmdInstallBrowser(flags: Record<string, string | boolean>) {
  const quiet = Boolean(flags.quiet);
  const withDeps = Boolean(flags['with-deps']);
  const ok = installPlaywrightBrowserSync({ quiet, withDeps });
  if (!ok && !quiet) {
    console.error('✗ Playwright Chromium kurulumu tamamlanamadı.');
    process.exit(1);
  }
  if (ok && !quiet) {
    const p = findPlaywrightManagedBrowser();
    console.log(`✓ Yerleşik Playwright Chromium hazır -> ${p || 'ms-playwright'}`);
  }
}

function cmdSetupLinux(flags: Record<string, string | boolean>) {
  if (process.platform !== 'linux') {
    console.error('setup-linux komutu yalnızca Ubuntu/Debian Linux sunucularda çalışır.');
    process.exit(1);
  }
  const withFirefox = Boolean(flags['with-firefox']);
  const withVscode = Boolean(flags['with-vscode']);

  const parts = [
    'set -e',
    'export DEBIAN_FRONTEND=noninteractive',
    'apt-get update -y',
    'apt-get install -y --no-install-recommends xvfb openbox ffmpeg libturbojpeg libxdamage1 libxtst6 libx11-6 libxfixes3 libxext6 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxrandr2 libgbm1 libasound2t64 xclip xdotool wmctrl dbus-x11 x11-utils dmz-cursor-theme pulseaudio pulseaudio-utils fonts-noto-core fonts-dejavu-core fonts-liberation fonts-noto-color-emoji desktop-file-utils hicolor-icon-theme wget gnupg ca-certificates curl || apt-get install -y --no-install-recommends xvfb openbox ffmpeg libturbojpeg libxdamage1 libxtst6 libx11-6 libxfixes3 libxext6 xclip xdotool wmctrl dbus-x11 x11-utils dmz-cursor-theme pulseaudio pulseaudio-utils fonts-dejavu-core fonts-liberation fonts-noto-color-emoji desktop-file-utils hicolor-icon-theme wget gnupg ca-certificates curl',
  ];

  if (withFirefox) {
    parts.push(`
if ! command -v firefox >/dev/null 2>&1; then
  install -d -m 0755 /etc/apt/keyrings
  wget -q https://packages.mozilla.org/apt/repo-signing-key.gpg -O- | tee /etc/apt/keyrings/packages.mozilla.org.asc >/dev/null
  echo "deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main" > /etc/apt/sources.list.d/mozilla.list
  printf "Package: *\\nPin: origin packages.mozilla.org\\nPin-Priority: 1000\\n" > /etc/apt/preferences.d/mozilla
  apt-get update -y && apt-get install -y firefox
fi`);
  }

  if (withVscode) {
    parts.push(`
if ! command -v code >/dev/null 2>&1; then
  install -d -m 0755 /etc/apt/keyrings
  wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor --yes > /etc/apt/keyrings/packages.microsoft.gpg
  echo "deb [arch=amd64,arm64,armhf signed-by=/etc/apt/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" > /etc/apt/sources.list.d/vscode.list
  apt-get update -y && apt-get install -y code
fi`);
  }

  parts.push('apt-get clean');

  console.log('TamgaVDesktop Linux GUI çalışma ortamı ve Playwright Chromium kuruluyor...');
  const res = spawnSync('/bin/bash', ['-c', parts.join('\n')], { stdio: 'inherit' });
  if (res.status !== 0) {
    process.exit(res.status || 1);
  }
  installPlaywrightBrowserSync({ quiet: false, withDeps: true });
  console.log('\n✓ Linux GUI çalışma ortamı ve yerleşik Chromium hazır!');
}

function cmdService(subCmd: string | undefined, flags: Record<string, string | boolean>) {
  if (process.platform !== 'linux') {
    console.error('systemd servis yönetimi yalnızca Linux sunucularda kullanılabilir.');
    process.exit(1);
  }
  const unitName = 'tamga-vdesktop.service';
  const unitPath = `/etc/systemd/system/${unitName}`;
  const configPath = typeof flags.config === 'string' ? path.resolve(flags.config) : getDefaultConfigPath();

  switch (subCmd) {
    case 'install': {
      if (!fs.existsSync(configPath)) {
        const cfg = createDefaultConfig({
          port: Number(flags.port || 4800),
          host: String(flags.host || '0.0.0.0'),
          authEnabled: !flags['no-auth'],
          password: typeof flags.password === 'string' ? flags.password : 'tamga2026',
        });
        saveConfig(configPath, cfg);
        console.log(`Varsayılan yapılandırma oluşturuldu: ${configPath}`);
      }
      const nodeBin = process.execPath;
      const cliEntry = path.resolve(process.argv[1]);
      const unitContent = `[Unit]
Description=TamgaVDesktop Virtual Desktop Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodeBin} ${cliEntry} start --config ${configPath}
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=HOME=${os.homedir()}
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
`;
      fs.writeFileSync(unitPath, unitContent, 'utf-8');
      execSync('systemctl daemon-reload', { stdio: 'inherit' });
      execSync(`systemctl enable --now ${unitName}`, { stdio: 'inherit' });
      console.log(`\n✓ ${unitName} kuruldu ve başlatıldı.`);
      console.log(`  Durum  : tamga-vdesktop service status`);
      console.log(`  Loglar : tamga-vdesktop service logs`);
      break;
    }
    case 'start':
    case 'stop':
    case 'restart':
      execSync(`systemctl ${subCmd} ${unitName}`, { stdio: 'inherit' });
      break;
    case 'status':
      spawnSync('systemctl', ['status', unitName, '--no-pager'], { stdio: 'inherit' });
      break;
    case 'logs':
      spawnSync('journalctl', ['-u', unitName, '-n', '80', '--no-pager'], { stdio: 'inherit' });
      break;
    case 'uninstall':
      try {
        execSync(`systemctl disable --now ${unitName}`, { stdio: 'inherit' });
      } catch {}
      if (fs.existsSync(unitPath)) fs.unlinkSync(unitPath);
      execSync('systemctl daemon-reload', { stdio: 'inherit' });
      console.log(`✓ ${unitName} kaldırıldı.`);
      break;
    default:
      console.log('Kullanım: tamga-vdesktop service <install|start|stop|restart|status|logs|uninstall>');
      process.exit(1);
  }
}

function cmdPasswd(newPassword: string | undefined, flags: Record<string, string | boolean>) {
  if (!newPassword || newPassword.length < 4) {
    console.error('Kullanım: tamga-vdesktop passwd <yeni-parola> (en az 4 karakter)');
    process.exit(1);
  }
  const { config, configPath } = loadConfig(typeof flags.config === 'string' ? flags.config : undefined);
  config.auth.passwordHash = hashPassword(newPassword);
  config.auth.enabled = true;
  saveConfig(configPath, config);
  console.log(`✓ Yönetici (${config.auth.username}) parolası güncellendi -> ${configPath}`);
}

function cmdDoctor(flags: Record<string, string | boolean>) {
  const { config, configPath } = loadConfig(typeof flags.config === 'string' ? flags.config : undefined);
  const appMgr = new LinuxAppManager();
  const status = appMgr.getRuntimeStatus();
  const apps = appMgr.listApps().filter((a) => a.installed);
  const pwPath = findPlaywrightManagedBrowser() || findChromiumExecutable();

  console.log(`\nTamgaVDesktop v${TAMGA_VERSION} — Sistem Teşhisi`);
  console.log(`──────────────────────────────────────────`);
  console.log(`İşletim Sistemi : ${status.distro}`);
  console.log(`Node.js         : ${process.version}`);
  console.log(`Ayar Dosyası    : ${configPath} (${fs.existsSync(configPath) ? 'mevcut' : 'varsayılan'})`);
  console.log(`Dinleme Adresi  : ${config.host}:${config.port}`);
  console.log(`Veri Dizini     : ${config.dataDir}`);
  console.log(`Giriş Koruması  : ${config.auth.enabled ? `Aktif (${config.auth.username})` : 'Kapalı'}`);
  console.log(`Yerleşik Chromium: ${pwPath ? `HAZIR (${pwPath})` : "Eksik ('tamga-vdesktop install-browser' çalıştırın)"}`);
  console.log(`Linux GUI Motor : ${status.guiReady ? 'HAZIR (Xvfb + Openbox + FFmpeg + X11)' : `Eksik: ${status.missingDeps.join(', ')}`}`);
  console.log(`Linux Ses Motor : ${status.hasAudio ? 'HAZIR (PulseAudio)' : 'Devre Dışı'}`);
  console.log(`Kurulu Uygulama : ${apps.length > 0 ? apps.map((a) => a.name).join(', ') : 'Yok'}`);
  console.log('');
}

async function main() {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  if (flags.version) {
    console.log(`tamga-vdesktop v${TAMGA_VERSION}`);
    return;
  }
  if (flags.help) {
    printHelp();
    return;
  }

  const cmd = positional[0] || 'start';
  switch (cmd) {
    case 'start': {
      const configPath = typeof flags.config === 'string' ? flags.config : undefined;
      const port = typeof flags.port === 'string' ? Number(flags.port) : undefined;
      const host = typeof flags.host === 'string' ? flags.host : undefined;
      await startTamgaServer({ configPath, port, host });
      break;
    }
    case 'init':
      await cmdInit(flags);
      break;
    case 'setup-linux':
      cmdSetupLinux(flags);
      break;
    case 'install-browser':
      cmdInstallBrowser(flags);
      break;
    case 'service':
      cmdService(positional[1], flags);
      break;
    case 'passwd':
      cmdPasswd(positional[1], flags);
      break;
    case 'doctor':
      cmdDoctor(flags);
      break;
    default:
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('[TamgaVDesktop] Hata:', err);
  process.exit(1);
});
