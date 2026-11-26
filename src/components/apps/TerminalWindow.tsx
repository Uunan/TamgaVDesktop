import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getBridgeDesktopId } from '../../services/osBridge';
import { copyTextToHostClipboard, setCachedClipboardText } from '../../utils/clipboardBridge';

interface TerminalWindowProps {
  sessionId: string;
  cwdPath?: string;
  initialCommand?: string;
  fontSize?: number;
  cursorBlink?: boolean;
  theme: 'dark' | 'light';
  onClipboardSync?: (text: string) => void;
  onExit?: () => void;
}

const DARK_THEME = {
  background: '#141416',
  foreground: '#f5f5f7',
  cursor: '#f5f5f7',
  selectionBackground: 'rgba(255,255,255,0.22)',
  black: '#1c1c1e',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e4e4e7',
  brightBlack: '#71717a',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff',
};

const LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#18181b',
  cursor: '#18181b',
  selectionBackground: 'rgba(0,0,0,0.16)',
  black: '#18181b',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#e4e4e7',
  brightBlack: '#71717a',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#ffffff',
};

export const TerminalWindow: React.FC<TerminalWindowProps> = ({
  sessionId,
  cwdPath,
  initialCommand,
  fontSize = 13,
  cursorBlink = true,
  theme,
  onClipboardSync,
  onExit,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const clipSyncRef = useRef(onClipboardSync);
  clipSyncRef.current = onClipboardSync;
  const initialCmdRef = useRef(initialCommand);
  initialCmdRef.current = initialCommand;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink,
      fontSize,
      lineHeight: 1.32,
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      theme: theme === 'light' ? LIGHT_THEME : DARK_THEME,
      scrollback: 4000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();
    term.focus();
    termRef.current = term;
    fitRef.current = fitAddon;

    // Intercept Cmd+C / Ctrl+Shift+C / Ctrl+C (when text is selected) to copy to host clipboard,
    // and let Cmd+V / Ctrl+V / Ctrl+Shift+V trigger native browser paste so HTTP & HTTPS both work!
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true;
      const isAltGraph = Boolean(ev.getModifierState?.('AltGraph')) || (ev.ctrlKey && ev.altKey);
      if (isAltGraph) return true;

      const keyLower = ev.key.toLowerCase();
      const hasSel = term.hasSelection();

      if (
        (ev.metaKey && keyLower === 'c') ||
        (ev.ctrlKey && ev.shiftKey && keyLower === 'c') ||
        (ev.ctrlKey && !ev.shiftKey && keyLower === 'c' && hasSel)
      ) {
        const sel = term.getSelection();
        if (sel) {
          ev.preventDefault();
          copyTextToHostClipboard(sel);
          clipSyncRef.current?.(sel);
          term.clearSelection();
          return false;
        }
      }

      // Allow browser's native paste event to fire for Ctrl+V / Ctrl+Shift+V / Cmd+V (don't let xterm swallow Ctrl+V as ^V)
      if ((ev.ctrlKey || ev.metaKey) && keyLower === 'v') {
        return false;
      }

      return true;
    });

    const handleDomPaste = (ev: ClipboardEvent) => {
      const txt = ev.clipboardData?.getData('text/plain');
      if (txt) {
        ev.preventDefault();
        ev.stopPropagation();
        setCachedClipboardText(txt);
        clipSyncRef.current?.(txt);
        term.paste(txt);
      }
    };
    container.addEventListener('paste', handleDomPaste, true);

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const desktopId = getBridgeDesktopId();
    const cwdQuery = cwdPath ? `&cwd=${encodeURIComponent(cwdPath)}` : '';
    const ws = new WebSocket(
      `${proto}//${window.location.host}/ws/terminal?desktop=${encodeURIComponent(
        desktopId
      )}&sessionId=${encodeURIComponent(sessionId)}&cols=${term.cols}&rows=${term.rows}${cwdQuery}`
    );
    wsRef.current = ws;

    const sendRawInput = (data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    };

    // Bypass @xterm/xterm@5.5.0 built-in requestMode() ReferenceError ('n is not defined' after Vite bundle)
    // and answer OSC 10/11 foreground/background queries immediately so Codex/Neovim/TUI apps never stall.
    const decPrivSub = term.parser.registerCsiHandler(
      { prefix: '?', intermediates: '$', final: 'p' },
      (params) => {
        const mode = Number(Array.isArray(params[0]) ? params[0][0] : (params[0] ?? 0));
        const status =
          mode === 7 || mode === 25
            ? 1
            : [1, 6, 12, 45, 66, 1000, 1002, 1003, 1004, 1006, 1007, 1047, 1048, 1049, 2004, 2026].includes(mode)
            ? 2
            : 0;
        sendRawInput(`\x1b[?${mode};${status}$y`);
        return true;
      }
    );
    const decAnsiSub = term.parser.registerCsiHandler(
      { intermediates: '$', final: 'p' },
      (params) => {
        const mode = Number(Array.isArray(params[0]) ? params[0][0] : (params[0] ?? 0));
        const status = mode === 2 ? 4 : mode === 12 ? 3 : mode === 4 || mode === 20 ? 2 : 0;
        sendRawInput(`\x1b[${mode};${status}$y`);
        return true;
      }
    );
    const osc10Sub = term.parser.registerOscHandler(10, (data) => {
      if (data === '?') {
        sendRawInput(
          themeRef.current === 'light'
            ? '\x1b]10;rgb:0f0f/1717/2a2a\x1b\\'
            : '\x1b]10;rgb:e2e2/e8e8/f0f0\x1b\\'
        );
        return true;
      }
      return false;
    });
    const osc11Sub = term.parser.registerOscHandler(11, (data) => {
      if (data === '?') {
        sendRawInput(
          themeRef.current === 'light'
            ? '\x1b]11;rgb:f8f8/fafa/fcfc\x1b\\'
            : '\x1b]11;rgb:0a0a/0e0e/1717\x1b\\'
        );
        return true;
      }
      return false;
    });

    ws.onopen = () => {
      if (initialCmdRef.current) {
        sendRawInput(`${initialCmdRef.current}\r`);
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === 'output' && typeof msg.data === 'string') {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          term.writeln('\r\n\x1b[90m[Oturum sonlandı]\x1b[0m');
          onExit?.();
        }
      } catch {}
    };

    ws.onclose = () => {
      term.writeln('\r\n\x1b[90m[Bağlantı kapatıldı]\x1b[0m');
    };

    const dataSub = term.onData((data) => {
      sendRawInput(data);
    });

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
          }
        } catch {}
      });
    });
    ro.observe(container);

    return () => {
      container.removeEventListener('paste', handleDomPaste, true);
      ro.disconnect();
      decPrivSub.dispose();
      decAnsiSub.dispose();
      osc10Sub.dispose();
      osc11Sub.dispose();
      dataSub.dispose();
      ws.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = theme === 'light' ? LIGHT_THEME : DARK_THEME;
    }
  }, [theme]);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.fontSize = fontSize;
      termRef.current.options.cursorBlink = cursorBlink;
      try {
        fitRef.current?.fit();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'resize',
              cols: termRef.current.cols,
              rows: termRef.current.rows,
            })
          );
        }
      } catch {}
    }
  }, [fontSize, cursorBlink]);

  return (
    <div
      data-testid="terminal-window"
      onPointerDown={() => termRef.current?.focus()}
      className="w-full h-full p-2.5 overflow-hidden bg-[var(--os-bg)]"
    >
      <div ref={hostRef} className="w-full h-full" />
    </div>
  );
};
