import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Minus, X } from 'lucide-react';
import type { OSWindow } from '../../types/os';

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
  minWidth = 380,
  minHeight = 280,
  children,
}) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const [snapPreview, setSnapPreview] = useState<'left' | 'right' | 'max' | null>(null);
  const snapRef = useRef<'left' | 'right' | 'max' | null>(null);

  const interactionRef = useRef<
    | {
        mode: 'drag';
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

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const state = interactionRef.current;
      const el = frameRef.current;
      if (!state || !el || e.pointerId !== state.pointerId) return;

      const vw = window.innerWidth;
      const vh = window.innerHeight - BOTTOM_BAR_RESERVE;
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;

      if (state.mode === 'drag') {
        if (state.wasMaximized && Math.hypot(dx, dy) > 8) {
          state.wasMaximized = false;
          const restoredW = Math.min(state.origW, vw - EDGE_PAD * 2);
          state.origX = Math.max(EDGE_PAD, Math.min(vw - restoredW - EDGE_PAD, e.clientX - restoredW / 2));
          state.origY = Math.max(EDGE_PAD, e.clientY - 20);
          state.currW = restoredW;
          state.startX = e.clientX;
          state.startY = e.clientY;
          el.style.width = `${restoredW}px`;
          el.style.height = `${state.origH}px`;
        }

        if (state.wasMaximized) return;

        const nextX = state.origX + (e.clientX - state.startX);
        const nextY = Math.max(EDGE_PAD - 6, Math.min(vh - 36, state.origY + (e.clientY - state.startY)));
        state.currX = nextX;
        state.currY = nextY;

        // Direct DOM update -> 0 React re-renders during drag (120fps smooth!)
        el.style.left = `${nextX}px`;
        el.style.top = `${nextY}px`;

        let nextSnap: 'left' | 'right' | 'max' | null = null;
        if (e.clientY <= 10) nextSnap = 'max';
        else if (e.clientX <= 12) nextSnap = 'left';
        else if (e.clientX >= vw - 12) nextSnap = 'right';

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

    const onPointerUp = (e: PointerEvent) => {
      const state = interactionRef.current;
      if (!state || e.pointerId !== state.pointerId) return;
      interactionRef.current = null;

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
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [win.id, minWidth, minHeight, onUpdateBounds]);

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
    interactionRef.current = {
      mode: 'drag',
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
      wasMaximized: win.maximized,
    };
  };

  const startResize = (dir: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onFocus(win.id);
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

  return (
    <>
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
            <div onPointerDown={startResize('n')} className="absolute top-0 left-3 right-3 h-2 cursor-ns-resize z-30 touch-none" />
            <div onPointerDown={startResize('s')} className="absolute bottom-0 left-3 right-3 h-2 cursor-ns-resize z-30 touch-none" />
            <div onPointerDown={startResize('w')} className="absolute left-0 top-3 bottom-3 w-2 cursor-ew-resize z-30 touch-none" />
            <div onPointerDown={startResize('e')} className="absolute right-0 top-3 bottom-3 w-2 cursor-ew-resize z-30 touch-none" />
            <div onPointerDown={startResize('nw')} className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize z-40 touch-none" />
            <div onPointerDown={startResize('ne')} className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize z-40 touch-none" />
            <div onPointerDown={startResize('sw')} className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize z-40 touch-none" />
            <div onPointerDown={startResize('se')} className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-40 touch-none" />
          </>
        )}

        {/* Minimalist macOS-Style Titlebar */}
        <div
          onPointerDown={startDrag}
          onDoubleClick={() => onToggleMaximize(win.id)}
          className="flex items-center gap-3 min-h-[42px] px-3.5 select-none touch-none bg-[var(--os-surface-2)] border-b border-[var(--os-border)]"
        >
          {/* macOS Traffic Lights */}
          <div data-no-drag="true" className="group flex items-center gap-2 shrink-0">
            <button
              onClick={() => onClose(win.id)}
              title="Kapat"
              className="w-3.5 h-3.5 rounded-full bg-[#ff5f57] flex items-center justify-center text-black/70 hover:brightness-110"
            >
              <X className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 stroke-[2.8]" />
            </button>
            <button
              onClick={() => onMinimize(win.id)}
              title="Küçült"
              className="w-3.5 h-3.5 rounded-full bg-[#febc2e] flex items-center justify-center text-black/70 hover:brightness-110"
            >
              <Minus className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 stroke-[2.8]" />
            </button>
            <button
              onClick={() => onToggleMaximize(win.id)}
              title={win.maximized ? 'Önceki Boyut' : 'Büyüt'}
              className="w-3.5 h-3.5 rounded-full bg-[#28c840] flex items-center justify-center text-black/70 hover:brightness-110"
            >
              <Maximize2 className="w-2 h-2 opacity-0 group-hover:opacity-100 stroke-[2.8]" />
            </button>
          </div>

          {headerContent ? (
            <div className="flex-1 min-w-0 flex items-center">{headerContent}</div>
          ) : (
            <div className="flex-1 text-center pr-12 min-w-0">
              <span className="text-xs font-medium text-[var(--os-text)] truncate">{win.title}</span>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
      </div>
    </>
  );
};
