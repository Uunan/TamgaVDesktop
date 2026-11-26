import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getBridgeDesktopId } from '../../services/osBridge';

interface TerminalWindowProps {
  sessionId: string;
  theme: 'dark' | 'light';
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

export const TerminalWindow: React.FC<TerminalWindowProps> = ({ sessionId, theme, onExit }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
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

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const desktopId = getBridgeDesktopId();
    const ws = new WebSocket(
      `${proto}//${window.location.host}/ws/terminal?desktop=${encodeURIComponent(
        desktopId
      )}&sessionId=${encodeURIComponent(sessionId)}&cols=${term.cols}&rows=${term.rows}`
    );
    wsRef.current = ws;

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
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
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
      ro.disconnect();
      dataSub.dispose();
      ws.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = theme === 'light' ? LIGHT_THEME : DARK_THEME;
    }
  }, [theme]);

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
