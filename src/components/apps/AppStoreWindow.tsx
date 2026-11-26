import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Package,
  Play,
  Plus,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import type { LinuxAppInfo, LinuxRuntimeStatus } from '../../types/os';
import { appsApi, buildAppIconUrl } from '../../services/osBridge';
import { ChromiumLogoIcon } from '../icons/FileIcon';

interface AppStoreWindowProps {
  runtime: LinuxRuntimeStatus | null;
  apps: LinuxAppInfo[];
  allowInstall: boolean;
  onRefreshApps: () => Promise<void>;
  onLaunchApp: (app: LinuxAppInfo, opts?: { forceNew?: boolean }) => void;
  onLaunchCustomCommand: (command: string, title?: string) => void;
  onOpenTerminal: () => void;
  onOpenChromium?: () => void;
}

export const AppStoreWindow: React.FC<AppStoreWindowProps> = ({
  runtime,
  apps,
  allowInstall,
  onRefreshApps,
  onLaunchApp,
  onLaunchCustomCommand,
  onOpenTerminal,
  onOpenChromium,
}) => {
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [installLog, setInstallLog] = useState('');
  const [installStatus, setInstallStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [aptInput, setAptInput] = useState('');
  const [runCmdInput, setRunCmdInput] = useState('');
  const [failedIcons, setFailedIcons] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!jobId) return;
    const interval = setInterval(async () => {
      try {
        const res = await appsApi.getInstallJob(jobId);
        setInstallLog(res.log);
        setInstallStatus(res.status);
        if (res.status !== 'running') {
          clearInterval(interval);
          setInstallingId(null);
          await onRefreshApps();
        }
      } catch {
        clearInterval(interval);
        setInstallingId(null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [jobId, onRefreshApps]);

  const startInstall = async (params: { appId?: string; aptPackage?: string }, labelId: string) => {
    setInstallingId(labelId);
    setInstallStatus('running');
    setInstallLog('Kurulum başlatılıyor...\n');
    try {
      const res = await appsApi.install(params);
      setJobId(res.jobId);
    } catch (e) {
      setInstallStatus('error');
      setInstallLog((e as Error).message);
      setInstallingId(null);
    }
  };

  const installedApps = apps.filter((a) => a.installed);
  const availableApps = apps.filter((a) => !a.installed);

  return (
    <div className="w-full h-full flex flex-col bg-[var(--os-surface)] text-[var(--os-text)] overflow-hidden">
      {/* Top Runtime Bar */}
      <div className="px-5 py-3.5 bg-[var(--os-surface-2)] border-b border-[var(--os-border)] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--os-text)]">Linux Uygulamaları</div>
          <div className="text-[11px] text-[var(--os-text-muted)] truncate mt-0.5">
            {runtime?.distro || 'Sunucu'} ·{' '}
            {runtime?.guiReady
              ? 'Yerel X11 GUI Motoru Hazır'
              : runtime?.isLinux
              ? `Eksik paket: ${runtime.missingDeps.join(', ')}`
              : 'Yerel Linux GUI motoru Linux sunucularda aktiftir'}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onOpenTerminal}
            className="px-3 py-1.5 rounded-xl bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] text-xs font-medium text-[var(--os-text)] flex items-center gap-1.5 transition-colors"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Terminal</span>
          </button>
          <button
            onClick={() => onRefreshApps()}
            title="Yenile"
            className="p-2 rounded-xl hover:bg-[var(--os-hover)] text-[var(--os-text-muted)] hover:text-[var(--os-text)] transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* Installed Apps */}
        <section className="space-y-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--os-text-subtle)]">
            Kurulu Uygulamalar ({installedApps.length + (onOpenChromium ? 1 : 0)})
          </div>
          {installedApps.length === 0 && !onOpenChromium ? (
            <div className="p-4 rounded-2xl bg-[var(--os-bg)] border border-[var(--os-border)] text-xs text-[var(--os-text-muted)]">
              Henüz kurulu yerel Linux GUI uygulaması bulunamadı. Aşağıdan Firefox, VS Code veya Antigravity kurabilirsiniz.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {onOpenChromium && (
                <div className="p-3 rounded-2xl bg-[var(--os-bg)] border border-[var(--os-border)] flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[var(--os-surface-3)] flex items-center justify-center shrink-0 overflow-hidden">
                    <ChromiumLogoIcon size={26} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-[var(--os-text)] truncate">
                      Chromium
                    </div>
                    <div className="text-[11px] text-[var(--os-text-muted)] truncate">
                      Yerleşik HiDPI tarayıcı (Firefox’tan bağımsız)
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onOpenChromium()}
                      data-testid="launch-app-chromium"
                      className="px-3 py-1.5 rounded-xl bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] hover:opacity-90 text-xs font-semibold flex items-center gap-1 transition-opacity"
                    >
                      <Play className="w-3 h-3" />
                      <span>Aç</span>
                    </button>
                  </div>
                </div>
              )}
              {installedApps.map((app) => (
                <div
                  key={app.id}
                  className="p-3 rounded-2xl bg-[var(--os-bg)] border border-[var(--os-border)] flex items-center gap-3"
                >
                  <div className="w-10 h-10 rounded-xl bg-[var(--os-surface-3)] flex items-center justify-center shrink-0 overflow-hidden">
                    {app.iconName && !failedIcons[app.id] ? (
                      <img
                        src={buildAppIconUrl(app.iconName)}
                        alt={app.name}
                        onError={() => setFailedIcons((prev) => ({ ...prev, [app.id]: true }))}
                        className="w-7 h-7 object-contain"
                      />
                    ) : (
                      <Package className="w-5 h-5 text-[var(--os-text-secondary)]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-[var(--os-text)] truncate">
                      {app.name}
                    </div>
                    <div className="text-[11px] text-[var(--os-text-muted)] truncate">
                      {app.description}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {['firefox', 'vscode', 'chrome', 'mousepad', 'gimp', 'vlc'].includes(app.id) && (
                      <button
                        onClick={() => onLaunchApp(app, { forceNew: true })}
                        disabled={!runtime?.guiReady}
                        data-testid={`launch-new-window-${app.id}`}
                        title={`${app.name} — Yeni Pencere Aç`}
                        className="p-1.5 rounded-xl bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] disabled:opacity-40 text-[var(--os-text)] transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => onLaunchApp(app)}
                      disabled={!runtime?.guiReady}
                      data-testid={`launch-app-${app.id}`}
                      className="px-3 py-1.5 rounded-xl bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] hover:opacity-90 disabled:opacity-40 text-xs font-semibold flex items-center gap-1 transition-opacity"
                    >
                      <Play className="w-3 h-3" />
                      <span>Aç</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Available to Install */}
        {availableApps.length > 0 && (
          <section className="space-y-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--os-text-subtle)]">
              Tek Tıkla Kurulabilir
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {availableApps.map((app) => {
                const isBusy = installingId === app.id;
                return (
                  <div
                    key={app.id}
                    className="p-3 rounded-2xl bg-[var(--os-bg)] border border-[var(--os-border)] flex items-center gap-3"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[var(--os-surface-3)] flex items-center justify-center shrink-0">
                      <Package className="w-5 h-5 text-[var(--os-text-muted)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[var(--os-text)] truncate">
                        {app.name}
                      </div>
                      <div className="text-[11px] text-[var(--os-text-muted)] truncate">
                        {app.description}
                      </div>
                    </div>
                    <button
                      onClick={() => startInstall({ appId: app.id }, app.id)}
                      disabled={!allowInstall || !runtime?.isLinux || Boolean(installingId)}
                      className="px-3 py-1.5 rounded-xl bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] disabled:opacity-40 text-xs font-medium text-[var(--os-text)] flex items-center gap-1.5 shrink-0 transition-colors"
                    >
                      {isBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>{isBusy ? 'Kuruluyor' : 'Kur'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Custom APT Package Install + Run Any Linux GUI Command */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-[var(--os-border)]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!aptInput.trim()) return;
              startInstall({ aptPackage: aptInput.trim() }, 'custom-apt');
              setAptInput('');
            }}
            className="p-3.5 rounded-2xl bg-[var(--os-bg)] border border-[var(--os-border)] space-y-2"
          >
            <div className="text-xs font-medium text-[var(--os-text)]">APT Paketi Kur</div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={aptInput}
                onChange={(e) => setAptInput(e.target.value)}
                placeholder="ör. xcalc, mousepad, inkscape"
                className="flex-1 px-3 py-2 rounded-xl bg-[var(--os-surface)] border border-[var(--os-border)] focus:border-[var(--os-border-strong)] focus:outline-none text-xs text-[var(--os-text)] font-mono"
              />
              <button
                type="submit"
                disabled={!allowInstall || !runtime?.isLinux || Boolean(installingId)}
                className="px-3 py-2 rounded-xl bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] disabled:opacity-40 text-xs font-medium text-[var(--os-text)]"
              >
                Kur
              </button>
            </div>
          </form>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!runCmdInput.trim()) return;
              onLaunchCustomCommand(runCmdInput.trim());
              setRunCmdInput('');
            }}
            className="p-3.5 rounded-2xl bg-[var(--os-bg)] border border-[var(--os-border)] space-y-2"
          >
            <div className="text-xs font-medium text-[var(--os-text)]">
              Linux GUI Komutu Çalıştır
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={runCmdInput}
                onChange={(e) => setRunCmdInput(e.target.value)}
                placeholder="ör. firefox https://github.com"
                className="flex-1 px-3 py-2 rounded-xl bg-[var(--os-surface)] border border-[var(--os-border)] focus:border-[var(--os-border-strong)] focus:outline-none text-xs text-[var(--os-text)] font-mono"
              />
              <button
                type="submit"
                disabled={!runtime?.guiReady}
                className="px-3 py-2 rounded-xl bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] disabled:opacity-40 text-xs font-semibold flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" />
                <span>Çalıştır</span>
              </button>
            </div>
          </form>
        </section>

        {/* Live Install Output */}
        {installLog && (
          <section className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-medium">
              {installStatus === 'running' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : installStatus === 'done' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              ) : null}
              <span>Kurulum Çıktısı</span>
            </div>
            <pre className="p-3.5 rounded-2xl bg-[#121214] text-neutral-200 border border-[var(--os-border)] text-[11px] font-mono max-h-48 overflow-auto whitespace-pre-wrap">
              {installLog}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
};
