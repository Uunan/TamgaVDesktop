import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { remoteAudio } from '../../services/audioPlayer';
import { appsApi, vfsApi } from '../../services/osBridge';
import {
  copyTextToHostClipboard,
  getCachedClipboardText,
  readHostClipboardSilently,
  setCachedClipboardText,
} from '../../utils/clipboardBridge';
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
  scrollSensitivity?: number;
  smoothBuffer?: boolean;
  pingMs?: number;
  onTitleChange?: (title: string) => void;
  onReady?: () => void;
  onAppExit?: () => void;
  onWindowOpened?: (extra: ExtraLinuxWindowEvent) => void;
  onVfsChanged?: () => void;
  onClipboardSync?: (text: string) => void;
  onLockScreen?: () => void;
  onNotify?: (title: string, message: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
}

const IS_MAC_HOST =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

export const LinuxAppWindow: React.FC<LinuxAppWindowProps> = ({
  sessionId,
  viewId = 'main',
  appName,
  isFocused = true,
  externalDropHighlighted = false,
  scrollSensitivity = 1.0,
  smoothBuffer = false,
  pingMs = 20,
  onTitleChange,
  onReady,
  onAppExit,
  onWindowOpened,
  onVfsChanged,
  onClipboardSync,
  onLockScreen,
  onNotify,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputSinkRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const lastPasteShiftRef = useRef(false);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastMoveTsRef = useRef(0);
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null);
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const onClipSyncRef = useRef(onClipboardSync);
  onClipSyncRef.current = onClipboardSync;
  const onLockScreenRef = useRef(onLockScreen);
  onLockScreenRef.current = onLockScreen;
  const scrollSensRef = useRef(scrollSensitivity);
  scrollSensRef.current = scrollSensitivity;
  const smoothBufferRef = useRef(smoothBuffer);
  smoothBufferRef.current = smoothBuffer;
  const pingMsRef = useRef(pingMs);
  pingMsRef.current = pingMs;

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cursorStyle, setCursorStyle] = useState<string>('default');
  const [nativeDragOver, setNativeDragOver] = useState(false);

  const sendInput = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  useEffect(() => {
    if (!Number.isFinite(pingMs) || pingMs <= 0) return;
    sendInput({ type: 'net_stats', rttMs: Math.round(pingMs) });
  }, [pingMs, sendInput]);

  const focusInputSink = useCallback(() => {
    const sink = inputSinkRef.current;
    if (sink && document.activeElement !== sink) {
      try {
        sink.focus({ preventScroll: true });
      } catch {}
    }
  }, []);

  const syncHostClipboardToRemote = useCallback(() => {
    readHostClipboardSilently().then((txt) => {
      if (txt) {
        sendInput({ type: 'clipboard_set', text: txt });
      }
    });
  }, [sendInput]);

  useEffect(() => {
    if (isFocused) {
      sendInput({ type: 'focus' });
      focusInputSink();
      syncHostClipboardToRemote();
    }
  }, [isFocused, sendInput, focusInputSink, syncHostClipboardToRemote]);

  useEffect(() => {
    const onWinFocus = () => {
      if (isFocused) {
        focusInputSink();
        syncHostClipboardToRemote();
      }
    };
    window.addEventListener('focus', onWinFocus);
    return () => window.removeEventListener('focus', onWinFocus);
  }, [isFocused, focusInputSink, syncHostClipboardToRemote]);

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

    type PaintPatch = { rx: number; ry: number; bitmap: ImageBitmap };
    type DecodedSlot = {
      seq: number;
      kind: 'full' | 'patches';
      fullW: number;
      fullH: number;
      arrivedAt: number;
      patches?: PaintPatch[];
      failed?: boolean;
    };

    const readySlots = new Map<number, DecodedSlot>();
    let nextSeq = 1;
    let nextPaintSeq = 1;
    let rafId: number | null = null;
    let pendingAckCount = 0;

    // Adaptive PLL jitter-buffer state (active when smoothBuffer is enabled)
    let lastArrivalAt = 0;
    let avgIntervalMs = 33;
    let jitterMs = 15;
    let lastPaintedAt = 0;
    let nextDueAt = 0;
    let primed = false;

    const getCtx = (canvas: HTMLCanvasElement) => {
      if (!ctxRef.current) {
        ctxRef.current =
          canvas.getContext('2d', { alpha: false, desynchronized: true }) ||
          canvas.getContext('2d');
      }
      return ctxRef.current;
    };

    const disposeSlot = (slot: DecodedSlot) => {
      if (slot.patches) {
        for (const p of slot.patches) {
          try { p.bitmap.close(); } catch {}
        }
      }
    };

    const flushAcks = () => {
      if (pendingAckCount <= 0 || closed || ws.readyState !== WebSocket.OPEN) {
        pendingAckCount = 0;
        return;
      }
      const count = pendingAckCount;
      pendingAckCount = 0;
      ws.send(count === 1 ? '{"type":"ack"}' : JSON.stringify({ type: 'ack', count }));
    };

    const recordFrameArrival = (): number => {
      const now = performance.now();
      if (lastArrivalAt > 0) {
        const dt = now - lastArrivalAt;
        if (dt > 5 && dt < 260) {
          avgIntervalMs = avgIntervalMs * 0.85 + dt * 0.15;
          const dev = Math.abs(dt - avgIntervalMs);
          jitterMs = Math.min(140, jitterMs * 0.85 + dev * 0.15);
        }
      }
      lastArrivalAt = now;
      return now;
    };

    const paintSlot = (canvas: HTMLCanvasElement | null, slot: DecodedSlot): boolean => {
      if (!slot.failed && canvas && slot.patches && slot.patches.length > 0) {
        const targetW =
          slot.kind === 'full' ? slot.patches[0].bitmap.width : slot.fullW;
        const targetH =
          slot.kind === 'full' ? slot.patches[0].bitmap.height : slot.fullH;
        if (targetW > 0 && targetH > 0 && (canvas.width !== targetW || canvas.height !== targetH)) {
          canvas.width = targetW;
          canvas.height = targetH;
          ctxRef.current = null;
        }
        const ctx = getCtx(canvas);
        if (ctx) {
          for (const p of slot.patches) {
            ctx.drawImage(p.bitmap, p.rx, p.ry);
          }
        }
        return true;
      }
      return false;
    };

    const paintLoop = () => {
      rafId = null;
      if (closed) return;
      const canvas = canvasRef.current;
      let paintedAny = false;
      const now = performance.now();

      if (!smoothBufferRef.current) {
        primed = false;
        nextDueAt = 0;
        while (readySlots.has(nextPaintSeq)) {
          const slot = readySlots.get(nextPaintSeq)!;
          readySlots.delete(nextPaintSeq);
          nextPaintSeq += 1;
          if (paintSlot(canvas, slot)) {
            paintedAny = true;
            lastPaintedAt = now;
          }
          disposeSlot(slot);
        }
        if (paintedAny && !readyFiredRef.current) {
          readyFiredRef.current = true;
          onReadyRef.current?.();
        }
        flushAcks();
        return;
      }

      // True PLL Adaptive Smooth Clock Pacer:
      // 1) Matches actual source FPS cadence (avgIntervalMs) instead of draining at 60Hz and starving.
      // 2) Gently stretches pace (+25% max) when cushion dips and gently compresses (-22% max) when cushion grows.
      // 3) Paints immediately on first click/keystroke from idle so responsiveness stays snappy.
      const sourceStepMs = Math.max(16, Math.min(85, avgIntervalMs));
      const targetBufferMs = Math.min(260, Math.max(75, pingMsRef.current * 0.65 + jitterMs * 2.0 + 35));
      const targetFrames = Math.max(2.5, Math.min(10, targetBufferMs / sourceStepMs));

      if (!readySlots.has(nextPaintSeq)) {
        if (readySlots.size > 0) {
          // A newer sequence arrived while earlier bitmap is still decoding — keep rAF alive
          schedulePaint();
        }
        return;
      }

      const queuedCount = readySlots.size;
      const head = readySlots.get(nextPaintSeq)!;
      const headAge = now - head.arrivedAt;
      const wasIdle = lastPaintedAt === 0 || now - lastPaintedAt > 320;

      // Guard against extreme queue growth (>20): jump directly to newest full keyframe safely
      if (queuedCount > 20) {
        let latestFullSeq = -1;
        for (const [k, s] of readySlots.entries()) {
          if (s.kind === 'full' && k > latestFullSeq) latestFullSeq = k;
        }
        if (latestFullSeq > nextPaintSeq) {
          dropStaleBefore(latestFullSeq);
        }
      }

      const curQueued = readySlots.size;
      const err = curQueued - targetFrames;
      // Smooth proportional clock speed adjustment (zero sudden stops!)
      const rateFactor = Math.max(0.76, Math.min(1.26, 1.0 - err * 0.085));
      const paceMs = Math.max(15, sourceStepMs * rateFactor);

      // Brief one-time cushion prime only when continuous motion starts (queued >= 2)
      if (!primed) {
        if (!readyFiredRef.current || (wasIdle && curQueued === 1)) {
          // Instant response on very first frame or single idle click/keystroke
          nextDueAt = now;
        } else if (curQueued >= Math.ceil(targetFrames * 0.7) || headAge >= targetBufferMs * 0.75) {
          primed = true;
          nextDueAt = now;
        } else {
          schedulePaint();
          if (curQueued <= 16) flushAcks();
          return;
        }
      }

      // Snap within 4.5ms of display VSync to avoid 16.6ms quantization skips
      if (nextDueAt === 0 || now >= nextDueAt - 4.5) {
        const slot = readySlots.get(nextPaintSeq)!;
        readySlots.delete(nextPaintSeq);
        nextPaintSeq += 1;
        if (paintSlot(canvas, slot)) {
          paintedAny = true;
          lastPaintedAt = now;
        }
        disposeSlot(slot);

        // Advance phase-locked schedule cleanly without accumulating drift
        const baseTime = nextDueAt > 0 && Math.abs(now - nextDueAt) < paceMs * 1.4 ? nextDueAt : now;
        nextDueAt = baseTime + paceMs;
        if (readySlots.size > targetFrames + 4) {
          // Gently pull schedule forward if excess frames accumulated
          nextDueAt = now + Math.max(15, sourceStepMs * 0.72);
        }
      }

      if (readySlots.size > 0) {
        schedulePaint();
      } else if (now - lastArrivalAt > 300) {
        primed = false;
        nextDueAt = 0;
      }

      if (paintedAny && !readyFiredRef.current) {
        readyFiredRef.current = true;
        onReadyRef.current?.();
      }
      if (readySlots.size <= 16) {
        flushAcks();
      }
    };

    const schedulePaint = () => {
      if (rafId === null && !closed) {
        rafId = window.requestAnimationFrame(paintLoop);
      }
    };

    const dropStaleBefore = (minSeq: number) => {
      if (nextPaintSeq < minSeq) {
        nextPaintSeq = minSeq;
      }
      for (const [k, slot] of readySlots.entries()) {
        if (k < minSeq) {
          readySlots.delete(k);
          disposeSlot(slot);
        }
      }
    };

    const enqueueFullFrame = (bytes: Uint8Array) => {
      const arrivedAt = recordFrameArrival();
      const seq = nextSeq++;
      if (!smoothBufferRef.current) {
        dropStaleBefore(seq);
      }
      pendingAckCount += 1;
      const blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' });
      createImageBitmap(blob, { colorSpaceConversion: 'none' })
        .then((bitmap) => {
          if (closed || seq < nextPaintSeq) {
            bitmap.close();
            flushAcks();
            return;
          }
          readySlots.set(seq, {
            seq,
            kind: 'full',
            fullW: bitmap.width,
            fullH: bitmap.height,
            arrivedAt,
            patches: [{ rx: 0, ry: 0, bitmap }],
          });
          if (smoothBufferRef.current && readySlots.size <= 16) {
            flushAcks();
          }
          schedulePaint();
        })
        .catch(() => {
          readySlots.set(seq, { seq, kind: 'full', fullW: 0, fullH: 0, arrivedAt, failed: true });
          schedulePaint();
        });
    };

    const enqueueRectFrame = (buf: ArrayBuffer) => {
      if (buf.byteLength <= 13) return;
      const arrivedAt = recordFrameArrival();
      const seq = nextSeq++;
      pendingAckCount += 1;
      const dv = new DataView(buf);
      const rx = dv.getUint16(1, false);
      const ry = dv.getUint16(3, false);
      const fullW = dv.getUint16(9, false);
      const fullH = dv.getUint16(11, false);
      const blob = new Blob([new Uint8Array(buf, 13) as BlobPart], { type: 'image/jpeg' });
      createImageBitmap(blob, { colorSpaceConversion: 'none' })
        .then((bitmap) => {
          if (closed || seq < nextPaintSeq) {
            bitmap.close();
            flushAcks();
            return;
          }
          readySlots.set(seq, {
            seq,
            kind: 'patches',
            fullW,
            fullH,
            arrivedAt,
            patches: [{ rx, ry, bitmap }],
          });
          if (smoothBufferRef.current && readySlots.size <= 16) {
            flushAcks();
          }
          schedulePaint();
        })
        .catch(() => {
          readySlots.set(seq, { seq, kind: 'patches', fullW, fullH, arrivedAt, failed: true });
          schedulePaint();
        });
    };

    const enqueueMultiRectFrame = (buf: ArrayBuffer) => {
      if (buf.byteLength <= 7) return;
      const arrivedAt = recordFrameArrival();
      const dv = new DataView(buf);
      const count = dv.getUint16(1, false);
      const fullW = dv.getUint16(3, false);
      const fullH = dv.getUint16(5, false);
      if (count === 0) return;

      const seq = nextSeq++;
      pendingAckCount += 1;
      let off = 7;
      const jobs: Array<Promise<PaintPatch>> = [];
      for (let i = 0; i < count; i++) {
        if (off + 12 > buf.byteLength) break;
        const rx = dv.getUint16(off, false);
        const ry = dv.getUint16(off + 2, false);
        const jlen = dv.getUint32(off + 8, false);
        off += 12;
        if (jlen <= 0 || off + jlen > buf.byteLength) break;
        const blob = new Blob([new Uint8Array(buf, off, jlen) as BlobPart], { type: 'image/jpeg' });
        off += jlen;
        jobs.push(createImageBitmap(blob, { colorSpaceConversion: 'none' }).then((bitmap) => ({ rx, ry, bitmap })));
      }
      if (jobs.length === 0) {
        readySlots.set(seq, { seq, kind: 'patches', fullW, fullH, arrivedAt, failed: true });
        schedulePaint();
        return;
      }
      Promise.all(jobs)
        .then((patches) => {
          if (closed || seq < nextPaintSeq) {
            for (const p of patches) p.bitmap.close();
            flushAcks();
            return;
          }
          readySlots.set(seq, { seq, kind: 'patches', fullW, fullH, arrivedAt, patches });
          if (smoothBufferRef.current && readySlots.size <= 16) {
            flushAcks();
          }
          schedulePaint();
        })
        .catch(() => {
          readySlots.set(seq, { seq, kind: 'patches', fullW, fullH, arrivedAt, failed: true });
          schedulePaint();
        });
    };

    ws.onopen = () => {
      if (pingMsRef.current > 0) {
        sendInput({ type: 'net_stats', rttMs: Math.round(pingMsRef.current) });
      }
      if (isFocused) {
        sendInput({ type: 'focus' });
        focusInputSink();
        syncHostClipboardToRemote();
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
        } else if (header === 0x04) {
          enqueueMultiRectFrame(buf);
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
        } else if (msg.type === 'clipboard' && typeof msg.text === 'string' && msg.text) {
          copyTextToHostClipboard(msg.text);
          onClipSyncRef.current?.(msg.text);
        }
      } catch {}
    };

    return () => {
      closed = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      for (const slot of readySlots.values()) {
        disposeSlot(slot);
      }
      readySlots.clear();
      if (moveTimerRef.current) {
        clearTimeout(moveTimerRef.current);
        moveTimerRef.current = null;
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

  useEffect(() => {
    const onShortcut = (ev: Event) => {
      const detail = (ev as CustomEvent<{
        sessionId?: string;
        viewId?: string;
        key?: string;
        ctrlKey?: boolean;
        altKey?: boolean;
        shiftKey?: boolean;
      }>).detail;
      if (!detail || detail.sessionId !== sessionId) return;
      if (detail.viewId && detail.viewId !== viewId) return;
      if (detail.key) {
        sendInput({
          type: 'shortcut',
          key: detail.key,
          ctrlKey: Boolean(detail.ctrlKey),
          altKey: Boolean(detail.altKey),
          shiftKey: Boolean(detail.shiftKey),
        });
      }
    };
    window.addEventListener('tamga-linux-shortcut', onShortcut);
    return () => window.removeEventListener('tamga-linux-shortcut', onShortcut);
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

  // Non-passive native wheel listener with pixel-faithful Mac trackpad accumulator (~10x smoother vs raw 1-click-per-event)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    let accumX = 0;
    let accumY = 0;
    let lastWheelAt = 0;
    let pendingCoords = { x: 0, y: 0, shiftKey: false, altKey: false };

    const flushWheel = () => {
      wheelTimer = null;
      const sens = Math.max(0.25, Math.min(3.0, Number(scrollSensRef.current) || 1.0));
      const pxPerTickY = 105 / sens;
      const pxPerTickX = 115 / sens;

      let ticksY = 0;
      if (Math.abs(accumY) >= pxPerTickY) {
        const count = Math.min(6, Math.floor(Math.abs(accumY) / pxPerTickY));
        ticksY = Math.sign(accumY) * count;
        accumY -= ticksY * pxPerTickY;
      }

      let ticksX = 0;
      if (Math.abs(accumX) >= pxPerTickX) {
        const count = Math.min(4, Math.floor(Math.abs(accumX) / pxPerTickX));
        ticksX = Math.sign(accumX) * count;
        accumX -= ticksX * pxPerTickX;
      }

      if (ticksY !== 0 || ticksX !== 0) {
        sendInput({
          type: 'wheel',
          x: pendingCoords.x,
          y: pendingCoords.y,
          deltaX: ticksX * pxPerTickX,
          deltaY: ticksY * pxPerTickY,
          ticksX: Math.abs(ticksX),
          ticksY: Math.abs(ticksY),
          ctrlKey: false,
          metaKey: false,
          shiftKey: pendingCoords.shiftKey,
          altKey: pendingCoords.altKey,
        });
      }
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const { x, y } = toCoords(e.clientX, e.clientY);
      const ctrl = e.ctrlKey || e.metaKey;
      const modeScale = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? 480 : 1;
      let dx = e.deltaX * modeScale;
      const dy = e.deltaY * modeScale;

      if (ctrl) {
        accumX = 0;
        accumY = 0;
        sendInput({
          type: 'wheel',
          x,
          y,
          deltaX: dx,
          deltaY: dy,
          ticksY: Math.abs(dy) >= 2 ? 1 : 0,
          ticksX: 0,
          ctrlKey: true,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
        });
        return;
      }

      const now = performance.now();
      if (now - lastWheelAt > 320) {
        accumX = 0;
        accumY = 0;
      }
      lastWheelAt = now;

      // Suppress accidental horizontal drift during primarily vertical two-finger Mac trackpad swipes
      if (Math.abs(dx) < Math.abs(dy) * 0.45 && Math.abs(dx) < 14) {
        dx = 0;
      }

      // Reset residual accumulator immediately when scroll direction reverses
      if (dy !== 0 && accumY !== 0 && Math.sign(dy) !== Math.sign(accumY)) {
        accumY = 0;
      }
      if (dx !== 0 && accumX !== 0 && Math.sign(dx) !== Math.sign(accumX)) {
        accumX = 0;
      }

      accumX += dx;
      accumY += dy;
      pendingCoords = { x, y, shiftKey: e.shiftKey, altKey: e.altKey };

      const sens = Math.max(0.25, Math.min(3.0, Number(scrollSensRef.current) || 1.0));
      const thresholdY = 105 / sens;
      if (Math.abs(accumY) >= thresholdY || Math.abs(accumX) >= 115 / sens) {
        if (wheelTimer) {
          clearTimeout(wheelTimer);
          wheelTimer = null;
        }
        flushWheel();
      } else if (!wheelTimer) {
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
      {/* Hidden host keyboard & clipboard input sink: captures exact host layout characters (Turkish i/ı/İ/ş/ğ/ü/ö/ç/@, IME, dead keys) and native HTTP/HTTPS paste events */}
      <textarea
        ref={inputSinkRef}
        data-testid="linux-app-input-sink"
        aria-label={`${appName} klavye girişi`}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        tabIndex={0}
        onCompositionStart={() => {
          isComposingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          isComposingRef.current = false;
          const composed = e.data || inputSinkRef.current?.value || '';
          if (inputSinkRef.current) inputSinkRef.current.value = '';
          if (composed) {
            sendInput({ type: 'text', text: composed });
          }
        }}
        onInput={(e) => {
          if (isComposingRef.current) return;
          const el = e.currentTarget;
          const val = el.value;
          if (val) {
            el.value = '';
            sendInput({ type: 'text', text: val });
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (inputSinkRef.current) inputSinkRef.current.value = '';
          const pasted = e.clipboardData?.getData('text/plain') ?? '';
          if (pasted) {
            setCachedClipboardText(pasted);
            onClipSyncRef.current?.(pasted);
            sendInput({ type: 'paste_text', text: pasted, shiftKey: lastPasteShiftRef.current });
          } else {
            sendInput({ type: 'shortcut', key: 'v', ctrlKey: true, shiftKey: lastPasteShiftRef.current });
          }
        }}
        onCopy={(e) => {
          const cached = getCachedClipboardText();
          if (cached && e.clipboardData) {
            e.preventDefault();
            e.clipboardData.setData('text/plain', cached);
          }
        }}
        onCut={(e) => {
          const cached = getCachedClipboardText();
          if (cached && e.clipboardData) {
            e.preventDefault();
            e.clipboardData.setData('text/plain', cached);
          }
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.key === 'Process') return;
          const isAltGraph = Boolean(e.getModifierState?.('AltGraph')) || (e.ctrlKey && e.altKey);
          const hasCmdOrCtrl = (e.ctrlKey || e.metaKey) && !isAltGraph;

          // Let Cmd+V / Ctrl+V trigger the browser's native `onPaste` event on this textarea (works on both HTTP and HTTPS!)
          if (hasCmdOrCtrl && e.key.toLowerCase() === 'v') {
            lastPasteShiftRef.current = e.shiftKey;
            return;
          }

          // Cmd+L on macOS (or Ctrl+Alt+L elsewhere) locks TamgaOS even while an X11 Linux window is focused; Ctrl+L remains Chrome URL bar / terminal clear
          if (
            e.key.toLowerCase() === 'l' &&
            !e.shiftKey &&
            (IS_MAC_HOST ? e.metaKey && !e.ctrlKey && !e.altKey : e.ctrlKey && e.altKey && !e.metaKey)
          ) {
            e.preventDefault();
            e.stopPropagation();
            onLockScreenRef.current?.();
            return;
          }

          // Translate macOS Cmd+<key> & Windows/Linux Ctrl+<key> shortcuts cleanly into X11 shortcuts
          if (
            hasCmdOrCtrl &&
            e.key !== 'Control' &&
            e.key !== 'Meta' &&
            e.key !== 'Shift' &&
            e.key !== 'Alt'
          ) {
            e.preventDefault();
            e.stopPropagation();
            sendInput({
              type: 'shortcut',
              key: e.key,
              ctrlKey: true,
              shiftKey: e.shiftKey,
              altKey: !isAltGraph && e.altKey,
            });
            return;
          }

          // Linux Alt+<mnemonic> on non-Mac hosts (while keeping Mac Option+Q=@ and Windows AltGr+Q=@ intact!)
          if (
            e.altKey &&
            !isAltGraph &&
            !IS_MAC_HOST &&
            e.key.length === 1 &&
            /^[a-z0-9]$/i.test(e.key)
          ) {
            e.preventDefault();
            e.stopPropagation();
            sendInput({
              type: 'shortcut',
              key: e.key,
              ctrlKey: false,
              shiftKey: e.shiftKey,
              altKey: true,
            });
            return;
          }

          // Let all printable host characters (including Turkish i, ı, İ, I, ğ, ü, ş, ö, ç, @, {, }, dead keys) flow through `onInput`
          if (e.key === 'Dead' || (e.key.length === 1 && !hasCmdOrCtrl)) {
            return;
          }

          if (e.key === 'Meta') {
            e.preventDefault();
            return;
          }

          e.preventDefault();
          e.stopPropagation();
          sendInput({
            type: 'keydown',
            key: e.key,
            code: e.code,
            ctrlKey: e.ctrlKey && !isAltGraph,
            altKey: e.altKey && !isAltGraph,
            shiftKey: e.shiftKey,
            metaKey: false,
          });
        }}
        onKeyUp={(e) => {
          if (e.nativeEvent.isComposing || e.key === 'Process') return;
          if (e.key === 'Dead' || e.key === 'Meta' || e.key.length === 1) {
            return;
          }
          const isAltGraph = Boolean(e.getModifierState?.('AltGraph')) || (e.ctrlKey && e.altKey);
          e.preventDefault();
          e.stopPropagation();
          sendInput({
            type: 'keyup',
            key: e.key,
            code: e.code,
            ctrlKey: e.ctrlKey && !isAltGraph,
            altKey: e.altKey && !isAltGraph,
            shiftKey: e.shiftKey,
            metaKey: false,
          });
        }}
        className="fixed -left-[9999px] top-0 w-px h-px opacity-0 pointer-events-none"
      />

      <canvas
        ref={canvasRef}
        onContextMenu={(e) => e.preventDefault()}
        onMouseDown={(e) => {
          e.preventDefault();
          focusInputSink();
        }}
        onPointerEnter={() => {
          if (isFocused) syncHostClipboardToRemote();
        }}
        onPointerDown={(e) => {
          remoteAudio.ensureContext();
          focusInputSink();
          sendInput({ type: 'focus' });
          if (moveTimerRef.current) {
            clearTimeout(moveTimerRef.current);
            moveTimerRef.current = null;
          }
          pendingMoveRef.current = null;
          const { x, y } = toCoords(e.clientX, e.clientY);
          if (e.pointerType === 'touch') {
            touchStateRef.current = { lastY: e.clientY, moved: false };
            sendInput({ type: 'mousemove', x, y });
            return;
          }
          sendInput({ type: 'mousedown', x, y, button: mapButton(e.button) });
        }}
        onPointerMove={(e) => {
          const { x, y } = toCoords(e.clientX, e.clientY);
          if (e.pointerType === 'touch' && touchStateRef.current) {
            const dy = touchStateRef.current.lastY - e.clientY;
            if (Math.abs(dy) >= 24) {
              touchStateRef.current.moved = true;
              touchStateRef.current.lastY = e.clientY;
              sendInput({ type: 'wheel', x, y, deltaY: dy, deltaX: 0, ticksY: 1, ticksX: 0 });
            }
            return;
          }
          const now = performance.now();
          if (now - lastMoveTsRef.current >= 8) {
            lastMoveTsRef.current = now;
            if (moveTimerRef.current) {
              clearTimeout(moveTimerRef.current);
              moveTimerRef.current = null;
            }
            pendingMoveRef.current = null;
            sendInput({ type: 'mousemove', x, y });
          } else {
            pendingMoveRef.current = { x, y };
            if (!moveTimerRef.current) {
              const wait = Math.max(2, 8 - (now - lastMoveTsRef.current));
              moveTimerRef.current = setTimeout(() => {
                moveTimerRef.current = null;
                const next = pendingMoveRef.current;
                pendingMoveRef.current = null;
                if (next) {
                  lastMoveTsRef.current = performance.now();
                  sendInput({ type: 'mousemove', x: next.x, y: next.y });
                }
              }, wait);
            }
          }
        }}
        onPointerUp={(e) => {
          focusInputSink();
          if (moveTimerRef.current) {
            clearTimeout(moveTimerRef.current);
            moveTimerRef.current = null;
          }
          pendingMoveRef.current = null;
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
