import React, { useEffect, useState } from 'react';
import { Maximize2, X } from 'lucide-react';

interface FullscreenNoticeProps {
  locked?: boolean;
}

function checkIsFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    mozFullScreenElement?: Element | null;
  };
  if (doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement) {
    return true;
  }
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(display-mode: fullscreen)').matches
  ) {
    return true;
  }
  return false;
}

export const FullscreenNotice: React.FC<FullscreenNoticeProps> = ({ locked = false }) => {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => checkIsFullscreen());
  const [dismissed, setDismissed] = useState(false);
  const [mountedReady, setMountedReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMountedReady(true), 450);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const sync = () => setIsFullscreen(checkIsFullscreen());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    document.addEventListener('mozfullscreenchange', sync);
    window.addEventListener('resize', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
      document.removeEventListener('mozfullscreenchange', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  const handleEnterFullscreen = async () => {
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
      mozRequestFullScreen?: () => Promise<void> | void;
    };
    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      } else if (el.mozRequestFullScreen) {
        await el.mozRequestFullScreen();
      }
      setIsFullscreen(checkIsFullscreen());
      const kb = (
        navigator as Navigator & {
          keyboard?: { lock?: (keys?: string[]) => Promise<void> };
        }
      ).keyboard;
      if (kb?.lock) {
        kb.lock(['KeyW', 'KeyL']).catch(() => {});
      }
    } catch {
      // Ignore browser policy rejections
    }
  };

  const visible = mountedReady && !isFullscreen && !dismissed && !locked;

  return (
    <div
      data-testid="fullscreen-notice"
      data-visible={visible ? 'true' : 'false'}
      aria-hidden={!visible}
      style={{
        boxShadow: 'var(--os-shadow)',
        transition:
          'transform 480ms cubic-bezier(0.22, 1, 0.36, 1), opacity 340ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      className={`fixed top-4 right-4 z-[9965] w-[348px] max-w-[calc(100vw-32px)] rounded-2xl bg-[var(--os-dock)] backdrop-blur-md border border-[var(--os-border-strong)] p-3.5 text-[var(--os-text)] select-none ${
        visible
          ? 'translate-x-0 opacity-100 pointer-events-auto'
          : 'translate-x-[calc(100%+28px)] opacity-0 pointer-events-none'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-[var(--os-surface-3)] border border-[var(--os-border)] flex items-center justify-center shrink-0 mt-0.5">
          <Maximize2 className="w-4 h-4 text-[var(--os-text)]" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs font-semibold text-[var(--os-text)] leading-snug">
              Tam Ekran Önerilir
            </div>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              data-testid="fullscreen-dismiss-btn"
              title="Kapat"
              className="p-1 -mr-1 -mt-1 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-subtle)] hover:text-[var(--os-text)] transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <p className="text-[11px] text-[var(--os-text-muted)] leading-relaxed mt-0.5">
            Daha iyi bir masaüstü deneyimi için tam ekrana geçmenizi öneririz.
          </p>

          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleEnterFullscreen}
              data-testid="fullscreen-enter-btn"
              className="px-3 py-1.5 rounded-xl bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] hover:opacity-90 text-[11px] font-semibold flex items-center gap-1.5 transition-opacity"
            >
              <Maximize2 className="w-3 h-3" />
              <span>Tam Ekrana Geç</span>
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="px-2.5 py-1.5 rounded-xl hover:bg-[var(--os-hover)] text-[var(--os-text-muted)] hover:text-[var(--os-text)] text-[11px] font-medium transition-colors"
            >
              Şimdi Değil
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
