import React, { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { remoteAudio } from '../../services/audioPlayer';
import { appsApi, vfsApi } from '../../services/osBridge';
import { useWindowFrameControls } from '../desktop/WindowFrame';

export interface ExtraLinuxWindowEvent {
  view: string;
  title: string;
  width: number;
  height: number;
}

interface LinuxAppWindowProps {
  sessionId: string;
  viewId?: string;
  appName: string;
  isFocused?: boolean;
  externalDropHighlighted?: boolean;
  onTitleChange?: (title: string) => void;
  onReady?: () => void;
  onAppExit?: () => void;
  onWindowOpened?: (extra: ExtraLinuxWindowEvent) => void;
  onVfsChanged?: () => void;
  onNotify?: (title: string, message: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const LinuxAppWindow: React.FC<LinuxAppWindowProps> = ({
  sessionId,
  viewId = 'main',
  appName,
  isFocused = true,
  externalDropHighlighted = false,
  onTitleChange,
  onReady,
  onAppExit,
  onWindowOpened,
  onVfsChanged,
  onNotify,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastMoveTsRef = useRef(0);
  const touchStateRef = useRef<{ lastY: number; moved: boolean } | null>(null);
  const dimsRef = useRef({ width: 720, height: 480 });
  const hasGeometryRef = useRef(false);
  const serverDimsRef = useRef({ width: 0, height: 0 });
  const readyFiredRef = useRef(false);

  const frameControls = useWindowFrameControls();
  const controlsRef = useRef(frameControls);
  controlsRef.current = frameControls;
  const onTitleRef = useRef(onTitleChange);
  onTitleRef.current = onTitleChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onExitRef = useRef(onAppExit);
  onExitRef.current = onAppExit;
  const onWindowOpenedRef = useRef(onWindowOpened);
  onWindowOpenedRef.current = onWindowOpened;

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cursorStyle, setCursorStyle] = useState<string>('default');
  const [nativeDragOver, setNativeDragOver] = useState(false);

  const sendInput = (payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  useEffect(() => {
    if (isFocused) {
      sendInput({ type: 'focus' });
    }
  }, [isFocused]);

  useEffect(() => {
    let closed = false;
    hasGeometryRef.current = false;
    serverDimsRef.current = { width: 0, height: 0 };
    readyFiredRef.current = false;
    ctxRef.current = null;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${proto}//${window.location.host}/ws/app?sessionId=${encodeURIComponent(sessionId)}&view=${encodeURIComponent(viewId)}`
    );
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    type QueuedFrame = {
      kind: 'full' | 'rect';
      rx: number;
      ry: number;
      fullW: number;
      fullH: number;
      bitmapPromise: Promise<ImageBitmap>;
    };

    const queue: QueuedFrame[] = [];
    let draining = false;

    const getCtx = (canvas: HTMLCanvasElement) => {
      if (!ctxRef.current) {
        ctxRef.current =
          canvas.getContext('2d', { alpha: false, desynchronized: true }) ||
          canvas.getContext('2d');
      }
      return ctxRef.current;
    };

    const drainQueue = async () => {
      if (draining) return;
      draining = true;
      try {
        while (queue.length > 0 && !closed) {
          const item = queue.shift()!;
          let bitmap: ImageBitmap | null = null;
          try {
            bitmap = await item.bitmapPromise;
            const canvas = canvasRef.current;
            if (canvas && !closed) {
              const targetW = item.kind === 'full' ? bitmap.width : item.fullW;
              const targetH = item.kind === 'full' ? bitmap.height : item.fullH;
              if (targetW > 0 && targetH > 0 && (canvas.width !== targetW || canvas.height !== targetH)) {
                canvas.width = targetW;
                canvas.height = targetH;
                ctxRef.current = null;
              }
              const ctx = getCtx(canvas);
              if (ctx) {
                if (item.kind === 'full') {
                  ctx.drawImage(bitmap, 0, 0);
                } else {
                  ctx.drawImage(bitmap, item.rx, item.ry);
                }
              }
              if (!readyFiredRef.current) {
                readyFiredRef.current = true;
                onReadyRef.current?.();
              }
            }
          } catch {
            // ignore malformed frame
          } finally {
            bitmap?.close();
          }
        }
      } finally {
        draining = false;
      }
    };

    const enqueueFullFrame = (bytes: Uint8Array) => {
      // A newer full keyframe supersedes any older queued frames/patches -> drop stale frames for lowest latency
      while (queue.length > 0) {
        const stale = queue.shift()!;
        stale.bitmapPromise.then((b) => b.close()).catch(() => {});
      }
      const blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' });
      queue.push({
        kind: 'full',
        rx: 0,
        ry: 0,
        fullW: 0,
        fullH: 0,
        bitmapPromise: createImageBitmap(blob),
      });
      drainQueue();
    };

    const enqueueRectFrame = (buf: ArrayBuffer) => {
      if (buf.byteLength <= 13) return;
      const dv = new DataView(buf);
      const rx = dv.getUint16(1, false);
      const ry = dv.getUint16(3, false);
      const fullW = dv.getUint16(9, false);
      const fullH = dv.getUint16(11, false);
      const jpegBytes = new Uint8Array(buf, 13);
      const blob = new Blob([jpegBytes as BlobPart], { type: 'image/jpeg' });
      queue.push({
        kind: 'rect',
        rx,
        ry,
        fullW,
        fullH,
        bitmapPromise: createImageBitmap(blob),
      });
      drainQueue();
    };

    ws.onopen = () => {
      if (isFocused) {
        sendInput({ type: 'focus' });
      }
    };

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        const buf = ev.data;
        if (buf.byteLength < 2) return;
        const header = new Uint8Array(buf, 0, 1)[0];
        if (header === 0x01) {
          enqueueFullFrame(new Uint8Array(buf, 1));
        } else if (header === 0x03) {
          enqueueRectFrame(buf);
        } else if (header === 0x02) {
          remoteAudio.pushPcm16(buf.slice(1));
        }
        return;
      }
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === 'title' && typeof msg.title === 'string') {
          onTitleRef.current?.(msg.title);
        } else if (msg.type === 'cursor' && typeof msg.cursor === 'string') {
          setCursorStyle(msg.cursor);
        } else if (msg.type === 'view_geometry' && msg.width && msg.height) {
          const nw = Math.round(Number(msg.width));
          const nh = Math.round(Number(msg.height));
          hasGeometryRef.current = true;
          serverDimsRef.current = { width: nw, height: nh };
          dimsRef.current = { width: nw, height: nh };
          controlsRef.current?.resizeFrame(nw, nh, { center: Boolean(msg.initial) });
        } else if (msg.type === 'view_maximize') {
          hasGeometryRef.current = true;
          controlsRef.current?.setMaximized(true);
        } else if (msg.type === 'window_opened' && typeof msg.view === 'string') {
          onWindowOpenedRef.current?.({
            view: msg.view,
            title: String(msg.title || appName),
            width: Number(msg.width) || 900,
            height: Number(msg.height) || 640,
          });
        } else if (msg.type === 'app_exit') {
          onExitRef.current?.();
        } else if (msg.type === 'error' && msg.message) {
          setErrorMsg(String(msg.message));
          if (!readyFiredRef.current) {
            readyFiredRef.current = true;
            onReadyRef.current?.();
          }
        } else if (msg.type === 'clipboard' && typeof msg.text === 'string') {
          navigator.clipboard?.writeText(msg.text).catch(() => {});
        }
      } catch {}
    };

    return () => {
      closed = true;
      while (queue.length > 0) {
        const stale = queue.shift()!;
        stale.bitmapPromise.then((b) => b.close()).catch(() => {});
      }
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId, viewId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 120 || rect.height < 120) return;
      if (!hasGeometryRef.current) return;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (
        Math.abs(w - serverDimsRef.current.width) <= 3 &&
        Math.abs(h - serverDimsRef.current.height) <= 3
      ) {
        return;
      }
      dimsRef.current = { width: w, height: h };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (
          Math.abs(w - serverDimsRef.current.width) <= 3 &&
          Math.abs(h - serverDimsRef.current.height) <= 3
        ) {
          return;
        }
        serverDimsRef.current = { width: w, height: h };
        sendInput({ type: 'resize', width: w, height: h });
      }, 200);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, viewId]);

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

  // Non-passive native wheel listener with 16ms delta coalescing so high-Hz trackpads & Cmd+Scroll zoom feel silky smooth
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingWheel: {
      x: number;
      y: number;
      deltaX: number;
      deltaY: number;
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
      altKey: boolean;
    } | null = null;

    const flushWheel = () => {
      wheelTimer = null;
      if (!pendingWheel) return;
      const w = pendingWheel;
      pendingWheel = null;
      sendInput({ type: 'wheel', ...w });
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const { x, y } = toCoords(e.clientX, e.clientY);
      const ctrl = e.ctrlKey || e.metaKey;
      // Send modifier-zoom ticks immediately for snappy GIMP zoom; coalesce rapid plain scroll deltas over 16ms
      if (ctrl) {
        flushWheel();
        sendInput({
          type: 'wheel',
          x,
          y,
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          ctrlKey: true,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
        });
        return;
      }
      if (pendingWheel) {
        pendingWheel.x = x;
        pendingWheel.y = y;
        pendingWheel.deltaX += e.deltaX;
        pendingWheel.deltaY += e.deltaY;
      } else {
        pendingWheel = {
          x,
          y,
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          ctrlKey: false,
          metaKey: false,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
        };
      }
      if (!wheelTimer) {
        wheelTimer = setTimeout(flushWheel, 16);
      }
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      if (wheelTimer) clearTimeout(wheelTimer);
    };
  }, [sessionId, viewId]);

  const handleNativeDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setNativeDragOver(false);

    // 1. Files dragged from Tamga FolderWindow
    const vfsRaw = e.dataTransfer.getData('application/x-runcompute-paths');
    if (vfsRaw) {
      try {
        const paths = JSON.parse(vfsRaw) as string[];
        if (paths.length > 0) {
          await appsApi.openFiles(sessionId, paths);
          onNotify?.(appName, `${paths.length} dosya uygulamaya aktarıldı.`, 'success');
        }
      } catch (err) {
        onNotify?.('Dosya Açılamadı', (err as Error).message, 'error');
      }
      return;
    }

    // 2. Files dragged directly from the user's host computer (Mac/Windows Finder/Explorer)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      try {
        const up = await vfsApi.uploadFiles('/Downloads', e.dataTransfer.files);
        onVfsChanged?.();
        const savedPaths = up.saved.map((n) => n.path);
        if (savedPaths.length > 0) {
          await appsApi.openFiles(sessionId, savedPaths);
          onNotify?.(appName, `${savedPaths.length} dosya yüklendi ve açıldı.`, 'success');
        }
      } catch (err) {
        onNotify?.('Dosya Aktarılamadı', (err as Error).message, 'error');
      }
    }
  };

  const mapButton = (btn: number) => (btn === 2 ? 'right' : btn === 1 ? 'middle' : 'left');
  const showDropBanner = nativeDragOver || externalDropHighlighted;

  return (
    <div
      ref={containerRef}
      data-testid="linux-app-window"
      data-app-session={sessionId}
      data-app-view={viewId}
      data-drop-linux-app={sessionId}
      onDragOver={(e) => {
        if (
          e.dataTransfer.types.includes('application/x-runcompute-paths') ||
          e.dataTransfer.types.includes('Files')
        ) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
          if (!nativeDragOver) setNativeDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setNativeDragOver(false);
        }
      }}
      onDrop={handleNativeDrop}
      className="relative w-full h-full overflow-hidden bg-[var(--os-bg)] select-none"
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          remoteAudio.ensureContext();
          canvasRef.current?.focus();
          sendInput({ type: 'focus' });
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
        onKeyDown={async (e) => {
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

      {showDropBanner && (
        <div className="pointer-events-none absolute inset-3 rounded-2xl border-2 border-dashed border-[var(--os-accent-bg)] bg-black/55 backdrop-blur-sm flex flex-col items-center justify-center gap-2 text-white">
          <Upload className="w-7 h-7" />
          <div className="text-xs font-semibold">{appName} ile açmak için dosyayı bırakın</div>
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
