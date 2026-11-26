import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { remoteAudio } from '../../services/audioPlayer';

interface LinuxAppWindowProps {
  sessionId: string;
  appName: string;
  onTitleChange?: (title: string) => void;
  onAppExit?: () => void;
}

export const LinuxAppWindow: React.FC<LinuxAppWindowProps> = ({
  sessionId,
  appName,
  onTitleChange,
  onAppExit,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const decodingRef = useRef(false);
  const pendingJpegRef = useRef<Uint8Array | null>(null);
  const lastMoveTsRef = useRef(0);
  const touchStateRef = useRef<{ lastY: number; moved: boolean } | null>(null);
  const dimsRef = useRef({ width: 1100, height: 680 });

  const [hasFrame, setHasFrame] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cursorStyle, setCursorStyle] = useState<string>('default');

  const sendInput = (payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  useEffect(() => {
    let closed = false;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${proto}//${window.location.host}/ws/app?sessionId=${encodeURIComponent(sessionId)}`
    );
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    const decodeAndDraw = async (bytes: Uint8Array) => {
      if (decodingRef.current) {
        pendingJpegRef.current = bytes;
        return;
      }
      decodingRef.current = true;
      try {
        const blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' });
        const bitmap = await createImageBitmap(blob);
        const canvas = canvasRef.current;
        if (canvas && !closed) {
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
          }
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(bitmap, 0, 0);
          setHasFrame(true);
        }
        bitmap.close();
      } catch {
        // drop malformed frame
      } finally {
        decodingRef.current = false;
        const next = pendingJpegRef.current;
        if (next && !closed) {
          pendingJpegRef.current = null;
          decodeAndDraw(next);
        }
      }
    };

    ws.onopen = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && rect.width > 100 && rect.height > 100) {
        dimsRef.current = { width: Math.round(rect.width), height: Math.round(rect.height) };
        sendInput({ type: 'resize', width: dimsRef.current.width, height: dimsRef.current.height });
      }
    };

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        const buf = ev.data;
        if (buf.byteLength < 2) return;
        const header = new Uint8Array(buf, 0, 1)[0];
        if (header === 0x01) {
          decodeAndDraw(new Uint8Array(buf, 1));
        } else if (header === 0x02) {
          remoteAudio.pushPcm16(buf.slice(1));
        }
        return;
      }
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === 'title' && typeof msg.title === 'string') {
          onTitleChange?.(msg.title);
        } else if (msg.type === 'cursor' && typeof msg.cursor === 'string') {
          setCursorStyle(msg.cursor);
        } else if (msg.type === 'app_exit') {
          onAppExit?.();
        } else if (msg.type === 'error' && msg.message) {
          setErrorMsg(String(msg.message));
        } else if (msg.type === 'clipboard' && typeof msg.text === 'string') {
          navigator.clipboard?.writeText(msg.text).catch(() => {});
        }
      } catch {}
    };

    return () => {
      closed = true;
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 120 || rect.height < 120) return;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      dimsRef.current = { width: w, height: h };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        sendInput({ type: 'resize', width: w, height: h });
      }, 140);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  const toCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = (canvas.width || dimsRef.current.width) / Math.max(1, rect.width);
    const scaleY = (canvas.height || dimsRef.current.height) / Math.max(1, rect.height);
    return {
      x: Math.max(0, Math.round((clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.round((clientY - rect.top) * scaleY)),
    };
  };

  const mapButton = (btn: number) => (btn === 2 ? 'right' : btn === 1 ? 'middle' : 'left');

  return (
    <div
      ref={containerRef}
      data-testid="linux-app-window"
      className="relative w-full h-full overflow-hidden bg-[var(--os-bg)] select-none"
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          remoteAudio.ensureContext();
          canvasRef.current?.focus();
          const { x, y } = toCoords(e.clientX, e.clientY);
          if (e.pointerType === 'touch') {
            touchStateRef.current = { lastY: e.clientY, moved: false };
            sendInput({ type: 'mousemove', x, y });
            return;
          }
          sendInput({ type: 'mousedown', x, y, button: mapButton(e.button) });
        }}
        onPointerMove={(e) => {
          const now = performance.now();
          if (now - lastMoveTsRef.current < 16) return;
          lastMoveTsRef.current = now;
          const { x, y } = toCoords(e.clientX, e.clientY);
          if (e.pointerType === 'touch' && touchStateRef.current) {
            const dy = touchStateRef.current.lastY - e.clientY;
            if (Math.abs(dy) > 4) {
              touchStateRef.current.moved = true;
              touchStateRef.current.lastY = e.clientY;
              sendInput({ type: 'wheel', x, y, deltaY: dy * 2.2, deltaX: 0 });
            }
            return;
          }
          sendInput({ type: 'mousemove', x, y });
        }}
        onPointerUp={(e) => {
          const { x, y } = toCoords(e.clientX, e.clientY);
          if (e.pointerType === 'touch' && touchStateRef.current) {
            const wasMoved = touchStateRef.current.moved;
            touchStateRef.current = null;
            if (!wasMoved) {
              sendInput({ type: 'mousedown', x, y, button: 'left' });
              sendInput({ type: 'mouseup', x, y, button: 'left' });
            }
            return;
          }
          sendInput({ type: 'mouseup', x, y, button: mapButton(e.button) });
        }}
        onWheel={(e) => {
          e.preventDefault();
          const { x, y } = toCoords(e.clientX, e.clientY);
          sendInput({ type: 'wheel', x, y, deltaX: e.deltaX, deltaY: e.deltaY });
        }}
        onKeyDown={async (e) => {
          // Intercept host Ctrl+V / Cmd+V to sync clipboard straight into X11 before pasting
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
            e.preventDefault();
            try {
              const clip = await navigator.clipboard.readText();
              if (clip) {
                sendInput({ type: 'clipboard_set', text: clip });
              }
            } catch {}
            setTimeout(() => {
              sendInput({ type: 'keydown', key: 'Control', ctrlKey: true });
              sendInput({ type: 'keydown', key: 'v', ctrlKey: true });
              sendInput({ type: 'keyup', key: 'v', ctrlKey: true });
              sendInput({ type: 'keyup', key: 'Control', ctrlKey: false });
            }, 35);
            return;
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
            setTimeout(() => sendInput({ type: 'clipboard_get' }), 90);
          }
          e.preventDefault();
          sendInput({
            type: 'keydown',
            key: e.key,
            code: e.code,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
            shiftKey: e.shiftKey,
            metaKey: e.metaKey,
          });
        }}
        onKeyUp={(e) => {
          e.preventDefault();
          sendInput({
            type: 'keyup',
            key: e.key,
            code: e.code,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
            shiftKey: e.shiftKey,
            metaKey: e.metaKey,
          });
        }}
        style={{ cursor: cursorStyle }}
        className="w-full h-full block object-contain outline-none touch-none"
      />

      {!hasFrame && !errorMsg && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--os-bg)] text-[var(--os-text-muted)]">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--os-text)]" />
          <div className="text-xs font-medium text-[var(--os-text)]">{appName} başlatılıyor...</div>
          <div className="text-[11px] text-[var(--os-text-subtle)]">
            Linux çekirdeği üzerinde yerel pencere hazırlanıyor
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center bg-[var(--os-bg)]">
          <div className="text-xs font-semibold text-red-400">Uygulama Başlatılamadı</div>
          <div className="text-[11px] text-[var(--os-text-muted)] max-w-md">{errorMsg}</div>
        </div>
      )}
    </div>
  );
};
