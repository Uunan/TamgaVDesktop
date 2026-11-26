import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { appsApi } from '../../services/osBridge';
import { useWindowFrameControls } from '../desktop/WindowFrame';

export interface VSCodeNewWindowRequest {
  url?: string;
  folderPath?: string;
  width?: number;
  height?: number;
}

interface VSCodeWindowProps {
  folderPath?: string;
  directUrl?: string;
  theme?: 'dark' | 'light';
  onOpenNewWindow?: (req: VSCodeNewWindowRequest) => void;
}

const INTERACTIVE_TITLEBAR_SELECTOR = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="tab"]',
  '.menubar-menu-button',
  '.command-center',
  '.action-item',
  '.window-appicon',
  '.monaco-action-bar',
].join(', ');

function parseWindowFeatures(features?: string): { width?: number; height?: number } {
  if (!features) return {};
  const wMatch = features.match(/(?:^|,)\s*width\s*=\s*(\d+)/i);
  const hMatch = features.match(/(?:^|,)\s*height\s*=\s*(\d+)/i);
  return {
    width: wMatch ? Number(wMatch[1]) : undefined,
    height: hMatch ? Number(hMatch[1]) : undefined,
  };
}

export const VSCodeWindow: React.FC<VSCodeWindowProps> = ({
  folderPath,
  directUrl,
  theme = 'dark',
  onOpenNewWindow,
}) => {
  const [readyUrl, setReadyUrl] = useState<string | null>(directUrl || null);
  const [statusMsg, setStatusMsg] = useState('VS Code hazırlanıyor...');
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const frameControls = useWindowFrameControls();
  const controlsRef = useRef(frameControls);
  controlsRef.current = frameControls;
  const openNewRef = useRef(onOpenNewWindow);
  openNewRef.current = onOpenNewWindow;
  const initialThemeRef = useRef(theme);

  useEffect(() => {
    if (directUrl) {
      setReadyUrl(directUrl);
      return;
    }
    let cancelled = false;
    appsApi
      .startVSCodeWeb(folderPath, initialThemeRef.current)
      .then((res) => {
        if (!cancelled) setReadyUrl(res.url);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });

    const poll = setInterval(() => {
      appsApi
        .vscodeStatus()
        .then((st) => {
          if (!cancelled && st.statusMessage) setStatusMsg(st.statusMessage);
        })
        .catch(() => {});
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [folderPath, directUrl]);

  const attachIframeTitlebarIntegration = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let doc: Document | null = null;
    let childWin: Window | null = null;
    try {
      doc = iframe.contentDocument;
      childWin = iframe.contentWindow;
    } catch {
      return;
    }
    if (!doc || !childWin) return;

    const ensureStyleAndMetrics = () => {
      if (!doc) return;
      if (doc.head && !doc.getElementById('tamga-vscode-wco')) {
        const style = doc.createElement('style');
        style.id = 'tamga-vscode-wco';
        style.textContent = `
          /* Reserve left slot inside VS Code's real custom titlebar for macOS traffic lights */
          .monaco-workbench .part.titlebar > .titlebar-container > .titlebar-left {
            padding-left: 72px !important;
          }
          .monaco-workbench .part.titlebar > .titlebar-container {
            cursor: default;
          }
        `;
        doc.head.appendChild(style);
      }

      const tb = doc.querySelector('.monaco-workbench .part.titlebar') as HTMLElement | null;
      if (tb) {
        const r = tb.getBoundingClientRect();
        if (r.height > 16) {
          controlsRef.current?.setTitlebarMetrics(Math.max(0, Math.round(r.top)), Math.round(r.height));
        }
      }
    };

    ensureStyleAndMetrics();

    const mutObs = new MutationObserver(() => ensureStyleAndMetrics());
    if (doc.documentElement) {
      mutObs.observe(doc.documentElement, { childList: true, subtree: true, attributes: true });
    }

    const onChildMouseDown = (ev: MouseEvent) => {
      controlsRef.current?.focusWindow();
      if (ev.button !== 0) return;
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const inDragZone = target.closest('.part.titlebar, .part.banner');
      if (!inDragZone) return;
      if (target.closest(INTERACTIVE_TITLEBAR_SELECTOR)) return;

      ev.preventDefault();
      const iframeRect = iframe.getBoundingClientRect();
      controlsRef.current?.startExternalDrag({
        clientX: iframeRect.left + ev.clientX,
        clientY: iframeRect.top + ev.clientY,
        screenX: ev.screenX,
        screenY: ev.screenY,
        sourceWindow: childWin,
      });
    };

    const onChildDblClick = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest('.part.titlebar')) return;
      if (target.closest(INTERACTIVE_TITLEBAR_SELECTOR)) return;
      ev.preventDefault();
      controlsRef.current?.toggleMaximize();
    };

    // Route File -> New Window / Open in New Window inside TamgaVDesktop instead of browser tabs
    const origOpen = childWin.open.bind(childWin);
    childWin.open = ((url?: string | URL, target?: string, features?: string) => {
      const urlStr = url ? String(url) : '';
      const dims = parseWindowFeatures(features);
      try {
        const parsed = urlStr ? new URL(urlStr, window.location.href) : null;
        if (
          openNewRef.current &&
          (!parsed ||
            (parsed.origin === window.location.origin && parsed.pathname.startsWith('/vscode-web')))
        ) {
          openNewRef.current({
            url: parsed ? `${parsed.pathname}${parsed.search}${parsed.hash}` : undefined,
            width: dims.width,
            height: dims.height,
          });
          return null;
        }
      } catch {}
      return origOpen(url, target, features);
    }) as typeof childWin.open;

    // Allow VS Code scripts / commands to resize their own Tamga WindowFrame
    childWin.resizeTo = (w: number, h: number) => {
      if (w > 200 && h > 160) controlsRef.current?.resizeFrame(w, h);
    };
    childWin.resizeBy = (dw: number, dh: number) => {
      const rect = iframe.getBoundingClientRect();
      controlsRef.current?.resizeFrame(rect.width + dw, rect.height + dh);
    };

    childWin.addEventListener('mousedown', onChildMouseDown, true);
    childWin.addEventListener('dblclick', onChildDblClick, true);
    childWin.addEventListener('resize', ensureStyleAndMetrics);

    return () => {
      mutObs.disconnect();
      try {
        childWin?.removeEventListener('mousedown', onChildMouseDown, true);
        childWin?.removeEventListener('dblclick', onChildDblClick, true);
        childWin?.removeEventListener('resize', ensureStyleAndMetrics);
        if (childWin) childWin.open = origOpen;
      } catch {}
    };
  }, []);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!readyUrl) {
      frameControls?.setTitlebarMetrics(0, 35);
    }
  }, [readyUrl, frameControls]);

  const handleFallbackBarMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    frameControls?.startExternalDrag({
      clientX: e.clientX,
      clientY: e.clientY,
      screenX: e.screenX,
      screenY: e.screenY,
      sourceWindow: window,
    });
  };

  if (error) {
    return (
      <div className="relative w-full h-full flex flex-col items-center justify-center p-6 text-center bg-[#181818] text-[#cccccc] gap-2">
        <div
          onMouseDown={handleFallbackBarMouseDown}
          onDoubleClick={() => frameControls?.toggleMaximize()}
          className="absolute top-0 left-0 right-0 h-[35px] select-none"
        />
        <div className="text-xs font-semibold text-red-400">VS Code Başlatılamadı</div>
        <div className="text-[11px] opacity-75 max-w-md">{error}</div>
      </div>
    );
  }

  if (!readyUrl) {
    return (
      <div className="relative w-full h-full flex flex-col items-center justify-center gap-3 bg-[#181818] text-[#e5e5e5]">
        <div
          onMouseDown={handleFallbackBarMouseDown}
          onDoubleClick={() => frameControls?.toggleMaximize()}
          className="absolute top-0 left-0 right-0 h-[35px] select-none"
        />
        <Loader2 className="w-6 h-6 animate-spin" />
        <div className="text-xs font-medium">{statusMsg}</div>
        <div className="text-[11px] opacity-60">
          Görüntü aktarımı olmadan %100 yerli DOM editörü açılıyor
        </div>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      src={readyUrl}
      onLoad={() => {
        cleanupRef.current?.();
        cleanupRef.current = attachIframeTitlebarIntegration() || null;
      }}
      title="Visual Studio Code"
      data-testid="vscode-web-iframe"
      allow="clipboard-read; clipboard-write"
      className="w-full h-full border-0 bg-[#181818]"
    />
  );
};
