import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  Check,
  Code2,
  Compass,
  Download,
  Globe,
  Loader2,
  MessageSquare,
  Package,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type { AptSearchResult, LinuxAppInfo, LinuxRuntimeStatus } from '../../types/os';
import { appsApi, buildAppIconUrl } from '../../services/osBridge';
import { FirefoxLogoIcon, GoogleChromeLogoIcon } from '../icons/FileIcon';

interface AppStoreWindowProps {
  runtime: LinuxRuntimeStatus | null;
  apps: LinuxAppInfo[];
  allowInstall: boolean;
  onRefreshApps: () => Promise<void>;
  onLaunchApp: (app: LinuxAppInfo, opts?: { forceNew?: boolean }) => void;
  onLaunchCustomCommand: (command: string, title?: string) => void;
  onOpenTerminal: () => void;
}

type StoreSection =
  | 'discover'
  | 'browser'
  | 'development'
  | 'media'
  | 'office'
  | 'communication'
  | 'system'
  | 'installed';

const SIDEBAR_ITEMS: Array<{ id: StoreSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'discover', label: 'Keşfet', icon: Compass },
  { id: 'browser', label: 'Tarayıcılar', icon: Globe },
  { id: 'development', label: 'Geliştirme', icon: Code2 },
  { id: 'media', label: 'Tasarım & Medya', icon: Palette },
  { id: 'office', label: 'Ofis & Notlar', icon: Briefcase },
  { id: 'communication', label: 'İletişim', icon: MessageSquare },
  { id: 'system', label: 'Sistem', icon: Wrench },
  { id: 'installed', label: 'Yüklü', icon: Check },
];

const StoreAppBadge: React.FC<{ app: LinuxAppInfo; size?: number }> = ({ app, size = 40 }) => {
  const [imgErr, setImgErr] = useState(false);

  if (app.id === 'chrome') return <GoogleChromeLogoIcon size={size} />;
  if (app.id === 'firefox') return <FirefoxLogoIcon size={size} />;

  if (app.installed && app.iconName && !imgErr) {
    return (
      <img
        src={buildAppIconUrl(app.iconName)}
        alt={app.name}
        onError={() => setImgErr(true)}
        style={{ width: size, height: size }}
        className="object-contain shrink-0"
      />
    );
  }

  const accent = app.accent || '#3f3f46';
  const initials = app.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${accent}, ${accent}bb)`,
      }}
      className="rounded-xl flex items-center justify-center text-white font-bold text-xs tracking-tight shadow-sm shrink-0"
    >
      {app.id === 'antigravity' ? (
        <Sparkles className="w-5 h-5 text-white" />
      ) : (
        initials || <Package className="w-4 h-4" />
      )}
    </div>
  );
};

export const AppStoreWindow: React.FC<AppStoreWindowProps> = ({
  runtime,
  apps,
  allowInstall,
  onRefreshApps,
  onLaunchApp,
  onLaunchCustomCommand,
  onOpenTerminal,
}) => {
  const [section, setSection] = useState<StoreSection>('discover');
  const [searchQuery, setSearchQuery] = useState('');
  const [aptResults, setAptResults] = useState<AptSearchResult[]>([]);
  const [searchingApt, setSearchingApt] = useState(false);

  const [activeJob, setActiveJob] = useState<{
    jobId: string;
    label: string;
    kind: 'install' | 'uninstall';
    targetKey: string;
    status: 'running' | 'done' | 'error';
    log: string;
  } | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [customCmd, setCustomCmd] = useState('');
  const logRef = useRef<HTMLPreElement>(null);

  // Poll active install / uninstall job
  useEffect(() => {
    if (!activeJob || activeJob.status !== 'running') return;
    let active = true;
    const poll = async () => {
      try {
        const res = await appsApi.getInstallJob(activeJob.jobId);
        if (!active) return;
        setActiveJob((prev) =>
          prev && prev.jobId === activeJob.jobId
            ? { ...prev, status: res.status, log: res.log }
            : prev
        );
        if (res.status !== 'running') {
          await onRefreshApps();
        }
      } catch {}
    };
    poll();
    const id = setInterval(poll, 1400);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [activeJob?.jobId, activeJob?.status, onRefreshApps]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [activeJob?.log]);

  // Debounced live Ubuntu APT repository search
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setAptResults([]);
      setSearchingApt(false);
      return;
    }
    let cancelled = false;
    setSearchingApt(true);
    const t = setTimeout(async () => {
      try {
        const res = await appsApi.searchApt(q);
        if (!cancelled) setAptResults(res.results || []);
      } catch {
        if (!cancelled) setAptResults([]);
      } finally {
        if (!cancelled) setSearchingApt(false);
      }
    }, 320);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [searchQuery]);

  const installedCount = useMemo(() => apps.filter((a) => a.installed).length, [apps]);
  const featuredApps = useMemo(() => apps.filter((a) => a.featured), [apps]);
  const heroApp = useMemo(
    () => apps.find((a) => a.id === 'antigravity') || featuredApps[0] || apps[0],
    [apps, featuredApps]
  );

  const visibleCurated = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      return apps.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          (a.publisher || '').toLowerCase().includes(q) ||
          a.command.toLowerCase().includes(q) ||
          (a.packageName || '').toLowerCase().includes(q)
      );
    }
    if (section === 'installed') return apps.filter((a) => a.installed);
    if (section === 'discover') return apps;
    return apps.filter((a) => a.category === section);
  }, [apps, section, searchQuery]);

  const startInstall = async (opts: { appId?: string; aptPackage?: string; label: string }) => {
    try {
      const res = await appsApi.install({ appId: opts.appId, aptPackage: opts.aptPackage });
      setActiveJob({
        jobId: res.jobId,
        label: opts.label,
        kind: 'install',
        targetKey: opts.appId || opts.aptPackage || '',
        status: 'running',
        log: `${opts.label} kuruluyor...\n`,
      });
    } catch (e) {
      setActiveJob({
        jobId: `err-${Date.now()}`,
        label: opts.label,
        kind: 'install',
        targetKey: opts.appId || opts.aptPackage || '',
        status: 'error',
        log: (e as Error).message,
      });
    }
  };

  const startUninstall = async (opts: { appId?: string; aptPackage?: string; label: string }) => {
    try {
      const res = await appsApi.uninstall({ appId: opts.appId, aptPackage: opts.aptPackage });
      setActiveJob({
        jobId: res.jobId,
        label: opts.label,
        kind: 'uninstall',
        targetKey: opts.appId || opts.aptPackage || '',
        status: 'running',
        log: `${opts.label} kaldırılıyor...\n`,
      });
    } catch (e) {
      setActiveJob({
        jobId: `err-${Date.now()}`,
        label: opts.label,
        kind: 'uninstall',
        targetKey: opts.appId || opts.aptPackage || '',
        status: 'error',
        log: (e as Error).message,
      });
    }
  };

  const isBusy = activeJob?.status === 'running';

  const renderAppCard = (app: LinuxAppInfo) => {
    const busyThis = isBusy && activeJob?.targetKey === app.id;
    return (
      <div
        key={app.id}
        data-testid={`store-app-${app.id}`}
        className="group p-3.5 rounded-2xl bg-[var(--os-surface-2)] hover:bg-[var(--os-surface-3)]/70 border border-[var(--os-border)] hover:border-[var(--os-border-strong)] transition-all flex items-center gap-3.5"
      >
        <StoreAppBadge app={app} size={42} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-[var(--os-text)] truncate">{app.name}</span>
            {app.installed && (
              <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 text-[9px] font-semibold shrink-0">
                Yüklü
              </span>
            )}
          </div>
          <div className="text-[10px] text-[var(--os-text-subtle)] truncate">
            {app.publisher || 'Ubuntu'}
          </div>
          <div className="text-[11px] text-[var(--os-text-muted)] truncate mt-0.5">
            {app.description}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {app.installed ? (
            <>
              <button
                onClick={() => onLaunchApp(app)}
                data-testid={`launch-app-${app.id}`}
                className="px-3 py-1.5 rounded-full bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] hover:opacity-90 text-[11px] font-semibold flex items-center gap-1 transition-opacity"
              >
                <Play className="w-3 h-3" />
                <span>Aç</span>
              </button>
              <button
                onClick={() => onLaunchApp(app, { forceNew: true })}
                title="Yeni Pencere"
                className="p-1.5 rounded-full bg-[var(--os-bg)] hover:bg-[var(--os-surface-4)] border border-[var(--os-border)] text-[var(--os-text-secondary)] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              {allowInstall && app.uninstallable && (
                <button
                  disabled={isBusy}
                  onClick={() => startUninstall({ appId: app.id, label: app.name })}
                  title="Kaldır"
                  className="p-1.5 rounded-full bg-[var(--os-bg)] hover:bg-red-500/15 border border-[var(--os-border)] text-[var(--os-text-subtle)] hover:text-red-400 disabled:opacity-40 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          ) : (
            <button
              disabled={isBusy || !allowInstall || !runtime?.isLinux}
              onClick={() => startInstall({ appId: app.id, label: app.name })}
              data-testid={`install-app-${app.id}`}
              className="px-3.5 py-1.5 rounded-full bg-[var(--os-bg)] hover:bg-[var(--os-accent-bg)] hover:text-[var(--os-accent-fg)] border border-[var(--os-border-strong)] text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-40 transition-colors"
            >
              {busyThis ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Download className="w-3 h-3" />
              )}
              <span>{busyThis ? 'Kuruluyor' : 'Yükle'}</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      data-testid="app-store-window"
      className="flex-1 min-h-0 flex bg-[var(--os-surface)] text-[var(--os-text)] select-none"
    >
      {/* Left Store Sidebar */}
      <aside className="w-48 shrink-0 border-r border-[var(--os-border)] bg-[var(--os-sidebar)] p-3 flex flex-col justify-between">
        <div className="space-y-1">
          <div className="px-2.5 pb-2 flex items-center justify-between">
            <span className="text-xs font-semibold tracking-tight">Mağaza</span>
            <button
              onClick={() => onRefreshApps()}
              title="Yenile"
              className="p-1 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-muted)]"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {SIDEBAR_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = !searchQuery.trim() && section === item.id;
            return (
              <button
                key={item.id}
                data-testid={`store-cat-${item.id}`}
                onClick={() => {
                  setSearchQuery('');
                  setSection(item.id);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)]'
                    : 'text-[var(--os-text-secondary)] hover:bg-[var(--os-hover)] hover:text-[var(--os-text)]'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'installed' && (
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                      active ? 'bg-black/15' : 'bg-[var(--os-bg)] text-[var(--os-text-subtle)]'
                    }`}
                  >
                    {installedCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="pt-3 border-t border-[var(--os-border)] space-y-2">
          <button
            onClick={onOpenTerminal}
            className="w-full px-2.5 py-2 rounded-xl bg-[var(--os-bg)] hover:bg-[var(--os-surface-3)] border border-[var(--os-border)] text-[11px] font-medium flex items-center gap-2 text-[var(--os-text-secondary)] transition-colors"
          >
            <Terminal className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Uç Birim</span>
          </button>
          <div className="px-2 text-[10px] text-[var(--os-text-subtle)] truncate">
            {runtime?.distro || 'Ubuntu APT'}
          </div>
        </div>
      </aside>

      {/* Main Store Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Search Bar */}
        <div className="px-5 py-3 border-b border-[var(--os-border)] bg-[var(--os-surface)] flex items-center gap-3 shrink-0">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[var(--os-text-subtle)] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              data-testid="store-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tüm Ubuntu uygulamalarında ara (Antigravity, Blender, Docker, Neovim...)"
              className="w-full pl-10 pr-8 py-2 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] focus:border-[var(--os-border-strong)] focus:outline-none text-xs text-[var(--os-text)] placeholder:text-[var(--os-text-subtle)]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--os-text-subtle)] hover:text-[var(--os-text)]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Store Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6">
          {/* Featured Hero Banner on Discover */}
          {!searchQuery.trim() && section === 'discover' && heroApp && (
            <div
              className="relative overflow-hidden rounded-3xl border border-[var(--os-border-strong)] p-5 flex items-center justify-between gap-5"
              style={{
                background:
                  'linear-gradient(135deg, rgba(99,102,241,0.22) 0%, rgba(14,165,233,0.14) 55%, rgba(16,185,129,0.12) 100%)',
              }}
            >
              <div className="flex items-center gap-4 min-w-0">
                <StoreAppBadge app={heroApp} size={56} />
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-indigo-400">
                    Öne Çıkan • {heroApp.publisher || 'Google DeepMind'}
                  </div>
                  <div className="text-base font-bold tracking-tight mt-0.5 truncate">
                    {heroApp.name}
                  </div>
                  <div className="text-xs text-[var(--os-text-muted)] mt-0.5 line-clamp-2 max-w-md">
                    {heroApp.description}
                  </div>
                </div>
              </div>
              <div className="shrink-0">
                {heroApp.installed ? (
                  <button
                    onClick={() => onLaunchApp(heroApp)}
                    className="px-4 py-2 rounded-full bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Aç</span>
                  </button>
                ) : (
                  <button
                    disabled={isBusy || !allowInstall || !runtime?.isLinux}
                    onClick={() => startInstall({ appId: heroApp.id, label: heroApp.name })}
                    className="px-4 py-2 rounded-full bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40"
                  >
                    {isBusy && activeJob?.targetKey === heroApp.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>Yükle</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Curated Catalog Grid */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-tight text-[var(--os-text)]">
                {searchQuery.trim()
                  ? `Mağaza Sonuçları (${visibleCurated.length})`
                  : SIDEBAR_ITEMS.find((i) => i.id === section)?.label || 'Uygulamalar'}
              </h3>
              <span className="text-[11px] text-[var(--os-text-subtle)]">
                {visibleCurated.length} uygulama
              </span>
            </div>

            {visibleCurated.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                {visibleCurated.map(renderAppCard)}
              </div>
            ) : (
              !searchQuery.trim() && (
                <div className="py-10 text-center text-xs text-[var(--os-text-subtle)] rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)]">
                  Bu kategoride henüz uygulama yok.
                </div>
              )
            )}
          </section>

          {/* Live Ubuntu APT Repository Results (ALL Ubuntu packages!) */}
          {searchQuery.trim().length >= 2 && (
            <section className="space-y-3 pt-2 border-t border-[var(--os-border)]">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold tracking-tight flex items-center gap-2">
                  <span>Ubuntu APT Deposu</span>
                  {searchingApt && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--os-text-muted)]" />}
                </h3>
                <span className="text-[11px] text-[var(--os-text-subtle)]">
                  {aptResults.length} paket
                </span>
              </div>

              {aptResults.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {aptResults.map((pkg) => {
                    const busyThis = isBusy && activeJob?.targetKey === pkg.packageName;
                    return (
                      <div
                        key={pkg.packageName}
                        data-testid={`apt-pkg-${pkg.packageName}`}
                        className="p-3 rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] flex items-center gap-3"
                      >
                        <div className="w-9 h-9 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)] flex items-center justify-center shrink-0">
                          <Package className="w-4 h-4 text-[var(--os-text-muted)]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-mono font-semibold truncate">
                              {pkg.packageName}
                            </span>
                            {pkg.installed && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[9px] font-semibold">
                                Yüklü
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[var(--os-text-muted)] truncate">
                            {pkg.summary}
                          </div>
                        </div>
                        {pkg.installed ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => onLaunchCustomCommand(pkg.packageName, pkg.packageName)}
                              className="px-2.5 py-1 rounded-full bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] text-[11px] font-semibold"
                            >
                              Aç
                            </button>
                            {allowInstall && (
                              <button
                                disabled={isBusy}
                                onClick={() =>
                                  startUninstall({ aptPackage: pkg.packageName, label: pkg.packageName })
                                }
                                title="Kaldır"
                                className="p-1.5 rounded-full bg-[var(--os-bg)] hover:bg-red-500/15 border border-[var(--os-border)] text-[var(--os-text-subtle)] hover:text-red-400 disabled:opacity-40"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <button
                            disabled={isBusy || !allowInstall || !runtime?.isLinux}
                            onClick={() =>
                              startInstall({ aptPackage: pkg.packageName, label: pkg.packageName })
                            }
                            className="px-3 py-1 rounded-full bg-[var(--os-bg)] hover:bg-[var(--os-accent-bg)] hover:text-[var(--os-accent-fg)] border border-[var(--os-border-strong)] text-[11px] font-semibold flex items-center gap-1 shrink-0 disabled:opacity-40 transition-colors"
                          >
                            {busyThis ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Download className="w-3 h-3" />
                            )}
                            <span>Yükle</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                !searchingApt && (
                  <div className="py-6 text-center text-xs text-[var(--os-text-subtle)]">
                    Ubuntu deposunda eşleşen paket bulunamadı.
                  </div>
                )
              )}
            </section>
          )}

          {/* Direct Command Runner (compact footer utility on System tab) */}
          {!searchQuery.trim() && section === 'system' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!customCmd.trim()) return;
                onLaunchCustomCommand(customCmd.trim());
                setCustomCmd('');
              }}
              className="p-3.5 rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] flex items-center gap-2"
            >
              <input
                type="text"
                value={customCmd}
                onChange={(e) => setCustomCmd(e.target.value)}
                placeholder="Özel Linux komutu çalıştır (örn: xcalc, gedit)..."
                className="flex-1 px-3 py-1.5 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)] text-xs font-mono focus:outline-none"
              />
              <button
                type="submit"
                disabled={!customCmd.trim() || !runtime?.guiReady}
                className="px-3.5 py-1.5 rounded-xl bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] text-xs font-semibold disabled:opacity-40"
              >
                Çalıştır
              </button>
            </form>
          )}
        </div>

        {/* Clean Bottom Install/Uninstall Progress Bar */}
        {activeJob && (
          <div className="border-t border-[var(--os-border-strong)] bg-[var(--os-sidebar)] px-4 py-2.5 shrink-0 space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                {activeJob.status === 'running' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" />
                ) : activeJob.status === 'done' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <X className="w-3.5 h-3.5 text-red-400 shrink-0" />
                )}
                <span className="font-medium truncate">
                  {activeJob.label} —{' '}
                  {activeJob.status === 'running'
                    ? activeJob.kind === 'uninstall'
                      ? 'Kaldırılıyor...'
                      : 'Kuruluyor...'
                    : activeJob.status === 'done'
                    ? 'Tamamlandı'
                    : 'Hata oluştu'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setShowLog((s) => !s)}
                  className="text-[11px] text-[var(--os-text-muted)] hover:text-[var(--os-text)]"
                >
                  {showLog ? 'Günlüğü Gizle' : 'Günlüğü Göster'}
                </button>
                {activeJob.status !== 'running' && (
                  <button
                    onClick={() => setActiveJob(null)}
                    className="p-1 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-muted)]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            {showLog && (
              <pre
                ref={logRef}
                className="max-h-36 overflow-y-auto p-2.5 rounded-xl bg-black/50 border border-[var(--os-border)] text-[10px] font-mono text-zinc-300 whitespace-pre-wrap break-all select-text"
              >
                {activeJob.log}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
