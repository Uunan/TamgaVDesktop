import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, Globe, KeyRound, Loader2, RefreshCw } from 'lucide-react';
import { getBridgeDesktopId, webAppApi } from '../../services/osBridge';

interface WebAppWindowProps {
  url: string;
  appName: string;
  onTitleChange?: (nextTitle: string) => void;
  onOpenInChrome?: (url: string) => void;
  onNotify?: (title: string, message: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const WebAppWindow: React.FC<WebAppWindowProps> = ({
  url,
  appName,
  onTitleChange,
  onOpenInChrome,
  onNotify,
}) => {
  const desktopId = getBridgeDesktopId();
  const buildSrc = (target: string, nonce = 0) =>
    `/web-app-proxy/open?url=${encodeURIComponent(target)}&desktop=${encodeURIComponent(desktopId)}${nonce ? `&r=${nonce}` : ''}`;

  const [reloadNonce, setReloadNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncingCookies, setSyncingCookies] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const iframeSrc = buildSrc(url, reloadNonce);

  useEffect(() => {
    setLoading(true);
  }, [iframeSrc]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === 'tamga_webapp_title' && typeof e.data.title === 'string' && e.data.title.trim()) {
        onTitleChange?.(e.data.title.trim());
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onTitleChange]);

  const handleSyncCookies = async () => {
    setSyncingCookies(true);
    try {
      const res = await webAppApi.syncChromeCookies();
      setReloadNonce((n) => n + 1);
      onNotify?.(
        appName,
        res.importedCount > 0
          ? `${res.importedCount} Chrome oturum çerezi aktarıldı ve yenilendi.`
          : 'Mevcut oturum yenilendi.',
        'success'
      );
    } catch (err) {
      onNotify?.('Oturum Senkronizasyonu', (err as Error).message, 'error');
    } finally {
      setSyncingCookies(false);
    }
  };

  return (
    <div data-testid="web-app-window" className="flex-1 min-h-0 flex flex-col bg-[#0f1014] relative">
      {/* Subtle Native Web App Toolbar */}
      <div className="h-8 shrink-0 px-2.5 border-b border-[var(--os-border)] bg-[var(--os-surface-2)] flex items-center justify-between gap-2 text-[11px] text-[var(--os-text-muted)]">
        <div className="flex items-center gap-1.5 min-w-0">
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400 shrink-0" />
          ) : (
            <Globe className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          )}
          <span className="truncate font-mono text-[10.5px] opacity-85">{url}</span>
          <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[9.5px] font-semibold shrink-0">
            Native Web
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            title="Yenile"
            className="p-1 rounded-md hover:bg-[var(--os-hover)] text-[var(--os-text-muted)] hover:text-[var(--os-text)] transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={syncingCookies}
            onClick={handleSyncCookies}
            title="Chrome Oturum / Çerezlerini Aktar"
            className="flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-[var(--os-hover)] text-[var(--os-text-muted)] hover:text-[var(--os-text)] transition-colors disabled:opacity-40"
          >
            <KeyRound className="w-3 h-3" />
            <span>Oturum Aktar</span>
          </button>
          {onOpenInChrome && (
            <button
              type="button"
              onClick={() => onOpenInChrome(url)}
              title="İstersen Google Chrome'da Aç"
              className="flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-[var(--os-hover)] text-[var(--os-text-muted)] hover:text-[var(--os-text)] transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              <span>Chrome</span>
            </button>
          )}
        </div>
      </div>

      {/* Native DOM Iframe */}
      <iframe
        ref={iframeRef}
        data-testid="web-app-iframe"
        src={iframeSrc}
        title={appName}
        onLoad={() => setLoading(false)}
        allow="clipboard-read; clipboard-write; fullscreen; microphone; camera"
        className="flex-1 w-full h-full border-0 bg-white"
      />
    </div>
  );
};
