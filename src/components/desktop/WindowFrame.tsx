import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, X } from 'lucide-react';
import type { OSWindow } from '../../types/os';

export interface ExternalDragInit {
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  sourceWindow?: Window | null;
}

interface WindowFrameControlContextValue {
  startExternalDrag: (init: ExternalDragInit) => void;
  toggleMaximize: () => void;
  focusWindow: () => void;
  setTitlebarMetrics: (top: number, height: number) => void;
}

const WindowFrameControlContext = createContext<WindowFrameControlContextValue | null>(null);

export function useWindowFrameControls(): WindowFrameControlContextValue | null {
  return useContext(WindowFrameControlContext);
}

interface WindowFrameProps {
  win: OSWindow;
  isFocused: boolean;
  isDropHighlighted?: boolean;
  dropDatasetProps?: Record<string, string>;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onToggleMaximize: (id: string) => void;
  onUpdateBounds: (
    id: string,
    bounds: Partial<Pick<OSWindow, 'x' | 'y' | 'width' | 'height' | 'maximized' | 'snap'>>
  ) => void;
  headerContent?: React.ReactNode;
  overlayTitlebar?: boolean;
  minWidth?: number;
  minHeight?: number;
  children: React.ReactNode;
}

const EDGE_PAD = 14;
const BOTTOM_BAR_RESERVE = 76;

export const WindowFrame: React.FC<WindowFrameProps> = ({
  win,
  isFocused,
  isDropHighlighted = false,
  dropDatasetProps,
  onFocus,
  onClose,
  onMinimize,
  onToggleMaximize,
  onUpdateBounds,
  headerContent,
  overlayTitlebar = false,
  minWidth = 380,
  minHeight = 280,
  children,
}) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const [snapPreview, setSnapPreview] = useState<'left' | 'right' | 'max' | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const [titlebarMetrics, setTitlebarMetricsState] = useState<{ top: number; height: number }>({
    top: 0,
    height: 35,
  });
  const snapRef = useRef<'left' | 'right' | 'max' | null>(null);

  const winRef = useRef(win);
  winRef.current = win;

  const interactionRef = useRef<
    | {
        mode: 'drag';
        pointerId: number | null;
        useScreenCoords: boolean;
        sourceWindow?: Window | null;
        startX: number;
        startY: number;
        origX: number;
        origY: number;
        origW: number;
        origH: number;
        currX: number;
        currY: number;
        currW: number;
        currH: number;
        wasMaximized: boolean;
      }
    | {
        mode: 'resize';
        dir: string;
        pointerId: number;
        startX: number;
        startY: number;
        origX: number;
        origY: number;
        origW: number;
        origH: number;
        currX: number;
        currY: number;
        currW: number;
        currH: number;
      }
    | null
  >(null);

  const finishInteraction = useCallback(() => {
    const state = interactionRef.current;
    if (!state) return;
    interactionRef.current = null;
    setIsInteracting(false);

    const vw = window.innerWidth;
    const vh = window.innerHeight - BOTTOM_BAR_RESERVE;
    const activeSnap = snapRef.current;
    snapRef.current = null;
    setSnapPreview(null);

    if (state.mode === 'drag') {
      if (activeSnap === 'max') {
        onUpdateBounds(win.id, { maximized: true, snap: null });
      } else if (activeSnap === 'left') {
        onUpdateBounds(win.id, {
          maximized: false,
          snap: 'left',
          x: EDGE_PAD,
          y: EDGE_PAD,
          width: Math.round((vw - EDGE_PAD * 3) / 2),
          height: vh - EDGE_PAD,
        });
      } else if (activeSnap === 'right') {
        const halfW = Math.round((vw - EDGE_PAD * 3) / 2);
        onUpdateBounds(win.id, {
          maximized: false,
          snap: 'right',
          x: vw - halfW - EDGE_PAD,
          y: EDGE_PAD,
          width: halfW,
          height: vh - EDGE_PAD,
        });
      } else if (!state.wasMaximized) {
        onUpdateBounds(win.id, {
          maximized: false,
          snap: null,
          x: Math.round(state.currX),
          y: Math.round(state.currY),
          width: Math.round(state.currW),
        });
      }
    } else if (state.mode === 'resize') {
      onUpdateBounds(win.id, {
        maximized: false,
        snap: null,
        x: Math.round(state.currX),
        y: Math.round(state.currY),
        width: Math.round(state.currW),
        height: Math.round(state.currH),
      });
    }
  }, [win.id, onUpdateBounds]);

  useEffect(() => {
    const handleMoveCoords = (
      coordX: number,
      coordY: number,
      viewportClientX: number,
      viewportClientY: number
    ) => {
      const state = interactionRef.current;
      const el = frameRef.current;
      if (!state || !el) return;

      const vw = window.innerWidth;
      const vh = window.innerHeight - BOTTOM_BAR_RESERVE;
      const dx = coordX - state.startX;
      const dy = coordY - state.startY;

      if (state.mode === 'drag') {
        if (state.wasMaximized && Math.hypot(dx, dy) > 8) {
          state.wasMaximized = false;
          const restoredW = Math.min(state.origW, vw - EDGE_PAD * 2);
          state.origX = Math.max(
            EDGE_PAD,
            Math.min(vw - restoredW - EDGE_PAD, viewportClientX - restoredW / 2)
          );
          state.origY = Math.max(EDGE_PAD, viewportClientY - 18);
          state.currW = restoredW;
          state.startX = coordX;
          state.startY = coordY;
          el.style.width = `${restoredW}px`;
          el.style.height = `${state.origH}px`;
        }

        if (state.wasMaximized) return;

        const nextX = state.origX + (coordX - state.startX);
        const nextY = Math.max(EDGE_PAD - 6, Math.min(vh - 36, state.origY + (coordY - state.startY)));
        state.currX = nextX;
        state.currY = nextY;

        el.style.left = `${nextX}px`;
        el.style.top = `${nextY}px`;

        let nextSnap: 'left' | 'right' | 'max' | null = null;
        if (viewportClientY <= 10) nextSnap = 'max';
        else if (viewportClientX <= 12) nextSnap = 'left';
        else if (viewportClientX >= vw - 12) nextSnap = 'right';

        if (snapRef.current !== nextSnap) {
          snapRef.current = nextSnap;
          setSnapPreview(nextSnap);
        }
      } else if (state.mode === 'resize') {
        let nx = state.origX;
        let ny = state.origY;
        let nw = state.origW;
        let nh = state.origH;

        if (state.dir.includes('e')) nw = Math.max(minWidth, state.origW + dx);
        if (state.dir.includes('s')) nh = Math.max(minHeight, state.origH + dy);
        if (state.dir.includes('w')) {
          const proposedW = Math.max(minWidth, state.origW - dx);
          nx = state.origX + (state.origW - proposedW);
          nw = proposedW;
        }
        if (state.dir.includes('n')) {
          const proposedH = Math.max(minHeight, state.origH - dy);
          ny = Math.max(EDGE_PAD - 6, state.origY + (state.origH - proposedH));
          nh = proposedH;
        }

        state.currX = nx;
        state.currY = ny;
        state.currW = nw;
        state.currH = nh;

        el.style.left = `${nx}px`;
        el.style.top = `${ny}px`;
        el.style.width = `${nw}px`;
        el.style.height = `${nh}px`;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const state = interactionRef.current;
      if (!state) return;
      if (state.pointerId !== null && e.pointerId !== state.pointerId) return;
      if (state.mode === 'drag' && state.useScreenCoords) {
        handleMoveCoords(e.screenX, e.screenY, e.clientX, e.clientY);
      } else {
        handleMoveCoords(e.clientX, e.clientY, e.clientX, e.clientY);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const state = interactionRef.current;
      if (!state) return;
      if (state.pointerId !== null && e.pointerId !== state.pointerId) return;
      finishInteraction();
    };

    const onMouseMove = (e: MouseEvent) => {
      const state = interactionRef.current;
      if (!state || state.mode !== 'drag' || !state.useScreenCoords) return;
      if (e.buttons === 0) {
        finishInteraction();
        return;
      }
      handleMoveCoords(e.screenX, e.screenY, e.clientX, e.clientY);
    };

    const onMouseUp = () => {
      const state = interactionRef.current;
      if (!state || state.mode !== 'drag' || !state.useScreenCoords) return;
      finishInteraction();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [minWidth, minHeight, finishInteraction]);

  const startExternalDrag = useCallback(
    (init: ExternalDragInit) => {
      const w = winRef.current;
      onFocus(w.id);
      setIsInteracting(true);
      interactionRef.current = {
        mode: 'drag',
        pointerId: null,
        useScreenCoords: true,
        sourceWindow: init.sourceWindow || null,
        startX: init.screenX,
        startY: init.screenY,
        origX: w.x,
        origY: w.y,
        origW: w.width,
        origH: w.height,
        currX: w.x,
        currY: w.y,
        currW: w.width,
        currH: w.height,
        wasMaximized: w.maximized,
      };

      // Also track move/up on the originating iframe window while mouse capture is held by the iframe
      const childWin = init.sourceWindow;
      if (childWin && childWin !== window) {
        const onChildMove = (ev: MouseEvent) => {
          const state = interactionRef.current;
          const el = frameRef.current;
          if (!state || state.mode !== 'drag' || !el) return;
          if (ev.buttons === 0) {
            cleanupChild();
            finishInteraction();
            return;
          }
          const rect = el.getBoundingClientRect();
          const vcx = rect.left + ev.clientX;
          const vcy = rect.top + ev.clientY;
          const vw = window.innerWidth;
          const vh = window.innerHeight - BOTTOM_BAR_RESERVE;
          const dx = ev.screenX - state.startX;
          const dy = ev.screenY - state.startY;

          if (state.wasMaximized && Math.hypot(dx, dy) > 8) {
            state.wasMaximized = false;
            const restoredW = Math.min(state.origW, vw - EDGE_PAD * 2);
            state.origX = Math.max(EDGE_PAD, Math.min(vw - restoredW - EDGE_PAD, vcx - restoredW / 2));
            state.origY = Math.max(EDGE_PAD, vcy - 18);
            state.currW = restoredW;
            state.startX = ev.screenX;
            state.startY = ev.screenY;
            el.style.width = `${restoredW}px`;
            el.style.height = `${state.origH}px`;
          }
          if (state.wasMaximized) return;

          const nextX = state.origX + (ev.screenX - state.startX);
          const nextY = Math.max(EDGE_PAD - 6, Math.min(vh - 36, state.origY + (ev.screenY - state.startY)));
          state.currX = nextX;
          state.currY = nextY;
          el.style.left = `${nextX}px`;
          el.style.top = `${nextY}px`;

          let nextSnap: 'left' | 'right' | 'max' | null = null;
          if (vcy <= 10) nextSnap = 'max';
          else if (vcx <= 12) nextSnap = 'left';
          else if (vcx >= vw - 12) nextSnap = 'right';

          if (snapRef.current !== nextSnap) {
            snapRef.current = nextSnap;
            setSnapPreview(nextSnap);
          }
        };

        const onChildUp = () => {
          cleanupChild();
          finishInteraction();
        };

        const cleanupChild = () => {
          try {
            childWin.removeEventListener('mousemove', onChildMove, true);
            childWin.removeEventListener('mouseup', onChildUp, true);
          } catch {}
        };

        childWin.addEventListener('mousemove', onChildMove, true);
        childWin.addEventListener('mouseup', onChildUp, true);
      }
    },
    [onFocus, finishInteraction]
  );

  const setTitlebarMetrics = useCallback((top: number, height: number) => {
    setTitlebarMetricsState((prev) =>
      prev.top === top && prev.height === height ? prev : { top, height }
    );
  }, []);

  const controlCtx = useMemo<WindowFrameControlContextValue>(
    () => ({
      startExternalDrag,
      toggleMaximize: () => onToggleMaximize(win.id),
      focusWindow: () => onFocus(win.id),
      setTitlebarMetrics,
    }),
    [startExternalDrag, onToggleMaximize, onFocus, setTitlebarMetrics, win.id]
  );

  if (win.minimized) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = (typeof window !== 'undefined' ? window.innerHeight : 900) - BOTTOM_BAR_RESERVE;

  const computedStyle: React.CSSProperties = win.maximized
    ? {
        left: EDGE_PAD,
        top: EDGE_PAD,
        width: Math.max(320, vw - EDGE_PAD * 2),
        height: Math.max(240, vh - EDGE_PAD),
        zIndex: win.zIndex,
      }
    : {
        left: win.x,
        top: win.y,
        width: win.width,
        height: win.height,
        zIndex: win.zIndex,
      };

  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if ((e.target as HTMLElement).closest('[data-no-drag="true"]')) return;
    onFocus(win.id);
    setIsInteracting(true);
    interactionRef.current = {
      mode: 'drag',
      pointerId: e.pointerId,
      useScreenCoords: false,
      startX: e.clientX,
      startY: e.clientY,
      origX: win.x,
      origY: win.y,
      origW: win.width,
      origH: win.height,
      currX: win.x,
      currY: win.y,
      currW: win.width,
      currH: win.height,
      wasMaximized: win.maximized,
    };
  };

  const startResize = (dir: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onFocus(win.id);
    setIsInteracting(true);
    interactionRef.current = {
      mode: 'resize',
      dir,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: win.x,
      origY: win.y,
      origW: win.width,
      origH: win.height,
      currX: win.x,
      currY: win.y,
      currW: win.width,
      currH: win.height,
    };
  };

  const renderTrafficLights = (compact = false) => (
    <div
      data-no-drag="true"
      data-testid={overlayTitlebar ? 'vscode-traffic-lights' : undefined}
      className="group flex items-center gap-2 shrink-0"
    >
      <button
        onClick={() => onClose(win.id)}
        title="Kapat"
        data-testid={overlayTitlebar ? 'vscode-close-btn' : undefined}
        className={`${
          compact ? 'w-3 h-3' : 'w-3.5 h-3.5'
        } rounded-full bg-[#ff5f57] flex items-center justify-center text-black/70 hover:brightness-110`}
      >
        <X className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 stroke-[2.8]" />
      </button>
      <button
        onClick={() => onMinimize(win.id)}
        title="Küçült"
        data-testid={overlayTitlebar ? 'vscode-minimize-btn' : undefined}
        className={`${
          compact ? 'w-3 h-3' : 'w-3.5 h-3.5'
        } rounded-full bg-[#febc2e] flex items-center justify-center text-black/70 hover:brightness-110`}
      >
        <Minus className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 stroke-[2.8]" />
      </button>
      <button
        onClick={() => onToggleMaximize(win.id)}
        title={win.maximized ? 'Önceki Boyut' : 'Büyüt'}
        data-testid={overlayTitlebar ? 'vscode-maximize-btn' : undefined}
        className={`${
          compact ? 'w-3 h-3' : 'w-3.5 h-3.5'
        } rounded-full bg-[#28c840] flex items-center justify-center text-black/70 hover:brightness-110`}
      >
        <Maximize2 className="w-2 h-2 opacity-0 group-hover:opacity-100 stroke-[2.8]" />
      </button>
    </div>
  );

  return (
    <WindowFrameControlContext.Provider value={controlCtx}>
      {snapPreview && (
        <div
          style={{
            zIndex: win.zIndex - 1,
            left: snapPreview === 'right' ? '50%' : EDGE_PAD,
            top: EDGE_PAD,
            width:
              snapPreview === 'max'
                ? `calc(100vw - ${EDGE_PAD * 2}px)`
                : `calc(50vw - ${EDGE_PAD * 1.5}px)`,
            height: `calc(100vh - ${BOTTOM_BAR_RESERVE + EDGE_PAD}px)`,
          }}
          className="fixed rounded-2xl bg-[var(--os-active)] border border-[var(--os-border-strong)] pointer-events-none"
        />
      )}

      <div
        ref={frameRef}
        style={{
          ...computedStyle,
          boxShadow: isFocused ? 'var(--os-shadow)' : 'var(--os-dock-shadow)',
        }}
        onPointerDown={() => onFocus(win.id)}
        {...(dropDatasetProps || {})}
        className={`fixed flex flex-col overflow-hidden rounded-2xl bg-[var(--os-surface)] text-[var(--os-text)] transition-shadow ${
          isDropHighlighted
            ? 'ring-2 ring-[var(--os-accent-bg)]'
            : isFocused
            ? 'border border-[var(--os-border-strong)]'
            : 'border border-[var(--os-border)] opacity-[0.97]'
        }`}
      >
        {!win.maximized && (
          <>
            <div onPointerDown={startResize('n')} className="absolute top-0 left-3 right-3 h-1.5 cursor-ns-resize z-30 touch-none" />
            <div onPointerDown={startResize('s')} className="absolute bottom-0 left-3 right-3 h-2 cursor-ns-resize z-30 touch-none" />
            <div onPointerDown={startResize('w')} className="absolute left-0 top-3 bottom-3 w-2 cursor-ew-resize z-30 touch-none" />
            <div onPointerDown={startResize('e')} className="absolute right-0 top-3 bottom-3 w-2 cursor-ew-resize z-30 touch-none" />
            <div onPointerDown={startResize('nw')} className="absolute top-0 left-0 w-3.5 h-3.5 cursor-nwse-resize z-40 touch-none" />
            <div onPointerDown={startResize('ne')} className="absolute top-0 right-0 w-3.5 h-3.5 cursor-nesw-resize z-40 touch-none" />
            <div onPointerDown={startResize('sw')} className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize z-40 touch-none" />
            <div onPointerDown={startResize('se')} className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-40 touch-none" />
          </>
        )}

        {overlayTitlebar ? (
          /* Native Window-Controls-Overlay: traffic lights sit directly inside the app's own titlebar */
          <div
            style={{
              top: titlebarMetrics.top,
              height: titlebarMetrics.height,
            }}
            className="absolute left-3.5 z-30 flex items-center select-none pointer-events-auto"
          >
            {renderTrafficLights(true)}
          </div>
        ) : (
          /* Minimalist macOS-Style Titlebar */
          <div
            onPointerDown={startDrag}
            onDoubleClick={() => onToggleMaximize(win.id)}
            className="flex items-center gap-3 min-h-[42px] px-3.5 select-none touch-none bg-[var(--os-surface-2)] border-b border-[var(--os-border)]"
          >
            {renderTrafficLights(false)}

            {headerContent ? (
              <div className="flex-1 min-w-0 flex items-center">{headerContent}</div>
            ) : (
              <div className="flex-1 text-center pr-12 min-w-0">
                <span className="text-xs font-medium text-[var(--os-text)] truncate">{win.title}</span>
              </div>
            )}
          </div>
        )}

        <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
          {isInteracting && <div className="absolute inset-0 z-50 cursor-grabbing" />}
          {children}
        </div>
      </div>
    </WindowFrameControlContext.Provider>
  );
};
