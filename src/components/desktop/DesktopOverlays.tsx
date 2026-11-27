import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, KeyRound, Loader2, Lock, LogOut, RefreshCw, WifiOff } from 'lucide-react';
import type { AuthStatus, LockScreenPreferences } from '../../types/os';
import { authApi } from '../../services/osBridge';
import { WallpaperLayer } from './WallpaperLayer';

interface ScreensaverOverlayProps {
  active: boolean;
  scene: string;
  customVideoUrl?: string;
  currentWallpaperId: string;
  currentCustomWallpaper?: string;
  theme: 'dark' | 'light';
  requirePassword?: boolean;
  onDismiss: () => void;
}

export const ScreensaverOverlay: React.FC<ScreensaverOverlayProps> = ({
  active,
  scene,
  customVideoUrl,
  currentWallpaperId,
  currentCustomWallpaper,
  theme,
  requirePassword,
  onDismiss,
}) => {
  const [clock, setClock] = useState(() => new Date());
  const [videoFailed, setVideoFailed] = useState(false);
  const openedAtRef = useRef<number>(0);
  const startPointerRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    openedAtRef.current = Date.now();
    startPointerRef.current = null;
    setVideoFailed(false);
    setClock(new Date());
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, [active, customVideoUrl, scene]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onDismiss();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, onDismiss]);

  if (!active) return null;

  const wallpaperToShow =
    scene === 'wallpaper' || scene === 'current'
      ? currentWallpaperId
      : scene === 'clock'
      ? 'starry-nebula'
      : scene && scene !== 'custom-video'
      ? scene
      : 'wheat-field';

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() - openedAtRef.current < 700) return;
    if (!startPointerRef.current) {
      startPointerRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    const dist = Math.hypot(
      e.clientX - startPointerRef.current.x,
      e.clientY - startPointerRef.current.y
    );
    if (dist > 22) {
      onDismiss();
    }
  };

  return (
    <div
      data-testid="screensaver-overlay"
      onClick={() => {
        if (Date.now() - openedAtRef.current >= 250) onDismiss();
      }}
      onMouseMove={handleMouseMove}
      className="fixed inset-0 z-[9995] overflow-hidden select-none cursor-pointer bg-black text-white"
    >
      {scene === 'custom-video' && customVideoUrl && !videoFailed ? (
        <video
          src={customVideoUrl}
          autoPlay
          loop
          muted
          playsInline
          onError={() => setVideoFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <WallpaperLayer
          wallpaperId={wallpaperToShow}
          theme={scene === 'clock' ? 'dark' : theme}
          customWallpaper={scene === 'current' ? currentCustomWallpaper : undefined}
          animated={true}
        />
      )}

      {/* Subtle ambient vignette */}
      <div
        className={`absolute inset-0 pointer-events-none ${
          scene === 'clock'
            ? 'bg-black/45'
            : 'bg-gradient-to-t from-black/55 via-transparent to-black/25'
        }`}
      />

      {/* Clock + status footer */}
      <div
        className={`relative z-10 w-full h-full flex flex-col items-center ${
          scene === 'clock' ? 'justify-center' : 'justify-end pb-14'
        } px-6 text-center pointer-events-none`}
      >
        <div
          className={
            scene === 'clock'
              ? 'text-8xl sm:text-9xl font-extralight font-mono tracking-tight text-white drop-shadow-2xl'
              : 'text-6xl font-extralight font-mono tracking-tight text-white drop-shadow-lg'
          }
        >
          {clock.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div className="text-sm text-white/80 capitalize mt-2 drop-shadow">
          {clock.toLocaleDateString('tr-TR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </div>
        <div className="mt-6 px-4 py-1.5 rounded-full bg-black/45 backdrop-blur-md border border-white/15 text-[11px] text-white/80 inline-flex items-center gap-2">
          {requirePassword && <Lock className="w-3 h-3 text-white/75" />}
          <span>Devam etmek için dokunun veya bir tuşa basın</span>
        </div>
      </div>
    </div>
  );
};

interface LockScreenOverlayProps {
  locked: boolean;
  style: LockScreenPreferences['style'];
  showClock: boolean;
  requirePassword: boolean;
  wallpaperId: string;
  customWallpaper?: string;
  theme: 'dark' | 'light';
  authStatus: AuthStatus;
  lockClock: Date;
  onUnlock: () => void;
  onLogout?: () => void;
}

export const LockScreenOverlay: React.FC<LockScreenOverlayProps> = ({
  locked,
  style,
  showClock,
  requirePassword,
  wallpaperId,
  customWallpaper,
  theme,
  authStatus,
  lockClock,
  onUnlock,
  onLogout,
}) => {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const needsPassword = Boolean(authStatus.enabled && requirePassword);

  useEffect(() => {
    if (!locked) {
      setPassword('');
      setError(null);
      setSubmitting(false);
      return;
    }
    if (needsPassword) {
      const id = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(id);
    }
  }, [locked, needsPassword]);

  if (!locked) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!needsPassword) {
      onUnlock();
      return;
    }
    if (!password) {
      setError('Lütfen parolanızı girin.');
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await authApi.login(authStatus.username || 'admin', password);
      setPassword('');
      onUnlock();
    } catch (err) {
      setError((err as Error).message || 'Hatalı parola.');
      setPassword('');
      inputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="lock-screen-overlay"
      onClick={() => {
        if (!needsPassword) onUnlock();
      }}
      className={`fixed inset-0 z-[9998] overflow-hidden flex flex-col items-center justify-center select-none ${
        needsPassword ? 'cursor-default' : 'cursor-pointer'
      } ${style === 'minimal' ? 'bg-[var(--os-bg)] text-[var(--os-text)]' : 'text-white'}`}
    >
      {/* Background treatment by selected Lock Screen style */}
      {(style === 'wallpaper' || style === 'clock') && (
        <div className="absolute inset-0 pointer-events-none">
          <WallpaperLayer
            wallpaperId={wallpaperId}
            theme={theme}
            customWallpaper={customWallpaper}
            animated={true}
          />
          <div
            className={`absolute inset-0 ${
              style === 'clock' ? 'bg-black/55 backdrop-blur-md' : 'bg-black/35 backdrop-blur-sm'
            }`}
          />
        </div>
      )}
      {style === 'blur' && (
        <div className="absolute inset-0 bg-[var(--os-lock-bg)] backdrop-blur-2xl pointer-events-none" />
      )}
      {style === 'minimal' && (
        <div className="absolute inset-0 bg-[var(--os-lock-bg)] backdrop-blur-md pointer-events-none" />
      )}

      <div className="relative z-10 flex flex-col items-center justify-center px-6 w-full max-w-md text-center">
        {showClock && (
          <>
            <div
              className={`${
                style === 'clock' ? 'text-8xl' : 'text-7xl'
              } font-extralight font-mono tracking-tight drop-shadow-xl`}
            >
              {lockClock.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="text-sm opacity-80 capitalize mt-3 drop-shadow">
              {lockClock.toLocaleDateString('tr-TR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </div>
          </>
        )}

        {needsPassword ? (
          <form
            onSubmit={handleSubmit}
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: 'var(--os-shadow)' }}
            className="mt-8 w-[320px] max-w-full rounded-2xl bg-[var(--os-surface-2)]/90 backdrop-blur-xl border border-[var(--os-border-strong)] p-5 text-[var(--os-text)] space-y-3.5"
          >
            <div className="flex items-center justify-center gap-2 text-xs font-medium text-[var(--os-text-secondary)]">
              <div className="w-7 h-7 rounded-full bg-[var(--os-surface-3)] border border-[var(--os-border)] flex items-center justify-center">
                <KeyRound className="w-3.5 h-3.5 text-[var(--os-text)]" />
              </div>
              <span>{authStatus.username || 'admin'}</span>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Parola ile kilidi aç..."
                data-testid="lockscreen-password"
                className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)] focus:border-[var(--os-border-strong)] focus:outline-none text-xs text-[var(--os-text)]"
              />
              <button
                type="submit"
                disabled={submitting}
                data-testid="lockscreen-unlock-btn"
                title="Kilidi Aç"
                className="w-9 h-9 rounded-xl bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] hover:opacity-90 disabled:opacity-50 flex items-center justify-center shrink-0 transition-opacity"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4" />
                )}
              </button>
            </div>

            {error && (
              <div
                data-testid="lockscreen-error"
                className="px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/30 text-[11px] text-red-400 text-left"
              >
                {error}
              </div>
            )}

            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="w-full pt-1 text-[11px] text-[var(--os-text-muted)] hover:text-[var(--os-text)] inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <LogOut className="w-3 h-3" />
                <span>Oturumu Kapat</span>
              </button>
            )}
          </form>
        ) : (
          <div className="mt-10 px-5 py-2.5 rounded-full bg-[var(--os-surface-2)]/90 backdrop-blur-md border border-[var(--os-border-strong)] flex items-center gap-2 text-xs text-[var(--os-text)]">
            <Lock className="w-3.5 h-3.5" />
            <span>Açmak için dokunun veya tıklayın</span>
          </div>
        )}
      </div>
    </div>
  );
};

interface OfflineBannerOverlayProps {
  offline: boolean;
  onRetry?: () => void;
}

export const OfflineBannerOverlay: React.FC<OfflineBannerOverlayProps> = ({
  offline,
  onRetry,
}) => {
  if (!offline) return null;

  return (
    <div
      data-testid="offline-overlay"
      className="fixed inset-0 z-[10050] bg-black/45 backdrop-blur-md flex flex-col items-center justify-start pt-5 px-4 select-none transition-all duration-300"
    >
      <div
        data-testid="offline-banner"
        style={{ boxShadow: 'var(--os-shadow)' }}
        className="w-auto max-w-[92vw] px-4 py-2.5 rounded-2xl bg-[var(--os-surface-2)] border border-red-500/35 text-[var(--os-text)] flex items-center gap-3"
      >
        <div className="w-8 h-8 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center shrink-0">
          <WifiOff className="w-4 h-4 text-red-400" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[var(--os-text)]">
            İnternet bağlantınızı kontrol edin
          </div>
          <div className="text-[11px] text-[var(--os-text-muted)]">
            Sunucu veya ağ bağlantısı koptu. Bağlantı sağlandığında masaüstü otomatik devam edecek.
          </div>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            data-testid="offline-retry-btn"
            className="px-2.5 py-1.5 rounded-xl bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] border border-[var(--os-border)] text-[11px] font-medium text-[var(--os-text)] inline-flex items-center gap-1.5 shrink-0 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Dene</span>
          </button>
        )}
      </div>
    </div>
  );
};
