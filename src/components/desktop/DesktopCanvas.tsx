import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ClipboardState, DesktopMeta, VFSNode } from '../../types/os';
import {
  ComputeSystemIcon,
  FileIcon,
  FirefoxLogoIcon,
  GoogleChromeLogoIcon,
  RecycleBinIcon,
  TerminalAppIcon,
} from '../icons/FileIcon';
import type { ContextMenuItemTarget } from './ContextMenu';

interface DesktopCanvasProps {
  desktopNodes: VFSNode[];
  trashCount: number;
  meta: DesktopMeta;
  clipboard: ClipboardState | null;
  selectedPaths: string[];
  onSelectPaths: (paths: string[]) => void;
  renamingPath: string | null;
  onSetRenamingPath: (path: string | null) => void;
  onRenameCommit: (path: string, newName: string) => void;
  onOpenNode: (node: VFSNode) => void;
  primaryBrowserLabel?: string;
  useFirefoxIcon?: boolean;
  onOpenChromium: (initialUrl?: string) => void;
  onOpenTerminal: () => void;
  onOpenAppStore?: () => void;
  onOpenFolderWindow: (path: string) => void;
  onMoveNodesToFolder: (paths: string[], targetDir: string) => void;
  onTrashNodes: (paths: string[]) => void;
  onSaveIconPosition: (path: string, pos: { x: number; y: number }) => void;
  onUploadHostFiles: (files: FileList) => void;
  onContextMenu: (x: number, y: number, target: ContextMenuItemTarget) => void;
  onExternalDropHover?: (target: string | null) => void;
  onDropFilesOnLinuxApp?: (sessionId: string, paths: string[]) => void;
}

const PAD_X = 26;
const PAD_Y = 26;

type ActiveGhostState =
  | {
      kind: 'vfs';
      node: VFSNode;
      count: number;
      initialX: number;
      initialY: number;
    }
  | {
      kind: 'system';
      sysId: string;
      label: string;
      initialX: number;
      initialY: number;
    };

type DragState =
  | {
      kind: 'vfs';
      pointerId: number;
      node: VFSNode;
      dragPaths: string[];
      startMouseX: number;
      startMouseY: number;
      origX: number;
      origY: number;
      currX: number;
      currY: number;
      moved: boolean;
      hoverTarget: string | null;
    }
  | {
      kind: 'system';
      pointerId: number;
      sysId: string;
      label: string;
      startMouseX: number;
      startMouseY: number;
      origX: number;
      origY: number;
      currX: number;
      currY: number;
      moved: boolean;
      hoverTarget: null;
    };

export const DesktopCanvas: React.FC<DesktopCanvasProps> = ({
  desktopNodes,
  trashCount,
  meta,
  clipboard,
  selectedPaths,
  onSelectPaths,
  renamingPath,
  onSetRenamingPath,
  onRenameCommit,
  onOpenNode,
  primaryBrowserLabel = 'Chromium',
  useFirefoxIcon = false,
  onOpenChromium,
  onOpenTerminal,
  onOpenFolderWindow,
  onMoveNodesToFolder,
  onTrashNodes,
  onSaveIconPosition,
  onUploadHostFiles,
  onContextMenu,
  onExternalDropHover,
  onDropFilesOnLinuxApp,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const ghostElRef = useRef<HTMLDivElement>(null);
  const lastTapRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [renameDraft, setRenameDraft] = useState('');
  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  const [dropHoverTarget, setDropHoverTarget] = useState<string | null>(null);
  const [hostDragActive, setHostDragActive] = useState(false);

  const [marquee, setMarquee] = useState<{
    pointerId: number;
    startX: number;
    startY: number;
    currX: number;
    currY: number;
  } | null>(null);

  // Active floating drag ghost rendered in document.body portal above ALL windows
  const [activeGhost, setActiveGhost] = useState<ActiveGhostState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

  const sizeConfig = useMemo(() => {
    switch (meta.preferences.iconSize) {
      case 'sm':
        return { cellW: 92, cellH: 96, iconPx: 40, textClass: 'text-[11px]' };
      case 'lg':
        return { cellW: 120, cellH: 122, iconPx: 58, textClass: 'text-xs' };
      default:
        return { cellW: 104, cellH: 108, iconPx: 48, textClass: 'text-xs' };
    }
  }, [meta.preferences.iconSize]);

  const sortedNodes = useMemo(() => {
    const copy = [...desktopNodes];
    const srt = meta.preferences.sortBy;
    copy.sort((a, b) => {
      if (srt === 'extension') {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return (
          (a.extension || '').localeCompare(b.extension || '', 'tr') ||
          a.name.localeCompare(b.name, 'tr')
        );
      }
      if (srt === 'size') return b.size - a.size;
      if (srt === 'modifiedAt') {
        return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
      }
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, 'tr');
    });
    return copy;
  }, [desktopNodes, meta.preferences.sortBy]);

  const systemIcons = useMemo(
    () => [
      {
        id: 'sys-browser',
        label: primaryBrowserLabel,
        row: 0,
        dropFolder: undefined as string | undefined,
        renderIcon: () =>
          useFirefoxIcon ? (
            <FirefoxLogoIcon size={sizeConfig.iconPx} />
          ) : (
            <GoogleChromeLogoIcon size={sizeConfig.iconPx} />
          ),
        onOpen: () => onOpenChromium(),
        onContext: (x: number, y: number) =>
          onContextMenu(x, y, {
            kind: 'system-icon',
            dirPath: '/Desktop',
            systemAction: 'open-chromium',
          }),
      },
      {
        id: 'sys-terminal',
        label: 'Terminal',
        row: 1,
        dropFolder: undefined as string | undefined,
        renderIcon: () => <TerminalAppIcon size={sizeConfig.iconPx} />,
        onOpen: () => onOpenTerminal(),
        onContext: (x: number, y: number) =>
          onContextMenu(x, y, {
            kind: 'system-icon',
            dirPath: '/Desktop',
            systemAction: 'open-terminal',
          }),
      },
      {
        id: 'sys-compute',
        label: 'Dosyalar',
        row: 2,
        dropFolder: undefined as string | undefined,
        renderIcon: () => <ComputeSystemIcon size={sizeConfig.iconPx} />,
        onOpen: () => onOpenFolderWindow('/'),
        onContext: (x: number, y: number) =>
          onContextMenu(x, y, {
            kind: 'system-icon',
            dirPath: '/Desktop',
            systemAction: 'open-compute',
          }),
      },
      {
        id: 'sys-trash',
        label: 'Çöp Kutusu',
        row: 3,
        dropFolder: '/.trash' as string | undefined,
        renderIcon: () => <RecycleBinIcon size={sizeConfig.iconPx} hasItems={trashCount > 0} />,
        onOpen: () => onOpenFolderWindow('/.trash'),
        onContext: (x: number, y: number) =>
          onContextMenu(x, y, {
            kind: 'recycle-bin-icon',
            dirPath: '/.trash',
          }),
      },
    ],
    [
      primaryBrowserLabel,
      useFirefoxIcon,
      sizeConfig.iconPx,
      trashCount,
      onOpenChromium,
      onOpenTerminal,
      onOpenFolderWindow,
      onContextMenu,
    ]
  );

  const clampDesktopPos = (pos: { x: number; y: number }) => {
    const maxX = Math.max(
      PAD_X,
      (typeof window !== 'undefined' ? window.innerWidth : 1280) - sizeConfig.cellW - 8
    );
    const maxY = Math.max(
      PAD_Y,
      (typeof window !== 'undefined' ? window.innerHeight : 800) - 86 - sizeConfig.cellH
    );
    return {
      x: Math.max(10, Math.min(maxX, Math.round(pos.x))),
      y: Math.max(10, Math.min(maxY, Math.round(pos.y))),
    };
  };

  const systemPositions = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    systemIcons.forEach((sys) => {
      const saved = !meta.preferences.autoArrange ? meta.positions[sys.id] : undefined;
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        map[sys.id] = clampDesktopPos(saved);
      } else {
        map[sys.id] = {
          x: PAD_X,
          y: PAD_Y + sys.row * sizeConfig.cellH,
        };
      }
    });
    return map;
  }, [systemIcons, meta.positions, meta.preferences.autoArrange, sizeConfig]);

  const nodePositions = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    const usableHeight = Math.max(
      340,
      (typeof window !== 'undefined' ? window.innerHeight : 860) - 165
    );
    const maxRows = Math.max(3, Math.floor(usableHeight / sizeConfig.cellH));

    sortedNodes.forEach((node, idx) => {
      const saved = !meta.preferences.autoArrange ? meta.positions[node.path] : undefined;
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        map[node.path] = clampDesktopPos(saved);
      } else {
        const slotIndex = idx + systemIcons.length;
        const col = Math.floor(slotIndex / maxRows);
        const row = slotIndex % maxRows;
        map[node.path] = {
          x: PAD_X + col * sizeConfig.cellW,
          y: PAD_Y + row * sizeConfig.cellH,
        };
      }
    });
    return map;
  }, [sortedNodes, systemIcons.length, meta.positions, meta.preferences.autoArrange, sizeConfig]);

  useEffect(() => {
    if (!renamingPath) return;
    const node = desktopNodes.find((n) => n.path === renamingPath);
    if (!node) return;
    setRenameDraft(node.name);
    requestAnimationFrame(() => {
      const el = renameInputRef.current;
      if (!el) return;
      el.focus();
      const dotIdx = !node.isDir ? node.name.lastIndexOf('.') : -1;
      if (dotIdx > 0) el.setSelectionRange(0, dotIdx);
      else el.select();
    });
  }, [renamingPath, desktopNodes]);

  const finishRename = (path: string) => {
    const trimmed = renameDraft.trim();
    onSetRenamingPath(null);
    if (trimmed) onRenameCommit(path, trimmed);
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (marquee && e.pointerId === marquee.pointerId) {
        const next = { ...marquee, currX: e.clientX, currY: e.clientY };
        setMarquee(next);
        const minX = Math.min(next.startX, next.currX);
        const maxX = Math.max(next.startX, next.currX);
        const minY = Math.min(next.startY, next.currY);
        const maxY = Math.max(next.startY, next.currY);

        const hits: string[] = [];
        for (const node of sortedNodes) {
          const p = nodePositions[node.path];
          if (!p) continue;
          if (
            p.x < maxX &&
            p.x + sizeConfig.cellW - 8 > minX &&
            p.y < maxY &&
            p.y + sizeConfig.cellH - 8 > minY
          ) {
            hits.push(node.path);
          }
        }
        onSelectPaths(hits);
        return;
      }

      const ds = dragStateRef.current;
      if (!ds || e.pointerId !== ds.pointerId) return;

      const dx = e.clientX - ds.startMouseX;
      const dy = e.clientY - ds.startMouseY;

      if (!ds.moved && Math.hypot(dx, dy) > 6) {
        clearLongPress();
        ds.moved = true;
        const cRect = containerRef.current?.getBoundingClientRect();
        const offX = cRect ? cRect.left : 0;
        const offY = cRect ? cRect.top : 0;
        if (ds.kind === 'vfs') {
          setActiveGhost({
            kind: 'vfs',
            node: ds.node,
            count: ds.dragPaths.length,
            initialX: offX + ds.origX + dx,
            initialY: offY + ds.origY + dy,
          });
        } else {
          setActiveGhost({
            kind: 'system',
            sysId: ds.sysId,
            label: ds.label,
            initialX: offX + ds.origX + dx,
            initialY: offY + ds.origY + dy,
          });
        }
      }

      if (!ds.moved) return;

      const cRect = containerRef.current?.getBoundingClientRect();
      const offX = cRect ? cRect.left : 0;
      const offY = cRect ? cRect.top : 0;
      const contW = cRect ? cRect.width : window.innerWidth;
      const contH = cRect ? cRect.height : window.innerHeight - 84;
      const nextX = Math.max(10, Math.min(contW - sizeConfig.cellW, ds.origX + dx));
      const nextY = Math.max(10, Math.min(contH - sizeConfig.cellH, ds.origY + dy));
      ds.currX = nextX;
      ds.currY = nextY;

      if (ghostElRef.current) {
        ghostElRef.current.style.transform = `translate3d(${offX + nextX}px, ${offY + nextY}px, 0) scale(1.04)`;
      }

      // System icons can ONLY be repositioned on desktop — NEVER dropped into folders, Trash, or apps!
      if (ds.kind === 'system') {
        if (dropHoverTarget !== null) {
          setDropHoverTarget(null);
          onExternalDropHover?.(null);
        }
        return;
      }

      // Inspect element directly underneath pointer (works across open Folder & Browser windows!)
      const hitEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      let detectedTarget: string | null = null;

      if (hitEl) {
        const linuxAppAttrEl = hitEl.closest('[data-drop-linux-app]') as HTMLElement | null;
        const folderAttrEl = hitEl.closest('[data-drop-folder]') as HTMLElement | null;
        const browserAttrEl = hitEl.closest('[data-drop-browser]') as HTMLElement | null;
        if (linuxAppAttrEl && !ds.node.isDir) {
          const sid = linuxAppAttrEl.getAttribute('data-drop-linux-app');
          if (sid) detectedTarget = `linux-app:${sid}`;
        } else if (folderAttrEl) {
          const folderPath = folderAttrEl.getAttribute('data-drop-folder');
          if (folderPath && folderPath !== '/' && !ds.dragPaths.includes(folderPath)) {
            detectedTarget = `folder:${folderPath}`;
          }
        } else if (browserAttrEl && !ds.node.isDir) {
          detectedTarget = 'browser';
        }
      }

      if (ds.hoverTarget !== detectedTarget) {
        ds.hoverTarget = detectedTarget;
        setDropHoverTarget(detectedTarget);
        onExternalDropHover?.(detectedTarget);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      clearLongPress();
      if (marquee && e.pointerId === marquee.pointerId) {
        setMarquee(null);
      }

      const ds = dragStateRef.current;
      if (ds && e.pointerId === ds.pointerId) {
        dragStateRef.current = null;
        setActiveGhost(null);
        setDropHoverTarget(null);
        onExternalDropHover?.(null);

        if (ds.moved) {
          if (ds.kind === 'system') {
            // Hard Guard: system icons can NEVER be dropped into folders, Trash, or open windows
            const hitEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
            const overDesktop = Boolean(hitEl && containerRef.current?.contains(hitEl));
            const hitFolder = hitEl?.closest('[data-drop-folder]') as HTMLElement | null;
            const droppedIntoAnotherFolder =
              Boolean(hitFolder) && hitFolder?.getAttribute('data-system-id') !== ds.sysId;
            if (overDesktop && !droppedIntoAnotherFolder) {
              onSaveIconPosition(ds.sysId, {
                x: Math.round(ds.currX),
                y: Math.round(ds.currY),
              });
            }
            return;
          }

          if (ds.hoverTarget?.startsWith('linux-app:') && !ds.node.isDir) {
            const sid = ds.hoverTarget.slice('linux-app:'.length);
            onDropFilesOnLinuxApp?.(sid, ds.dragPaths);
          } else if (ds.hoverTarget === 'folder:/.trash') {
            onTrashNodes(ds.dragPaths);
          } else if (ds.hoverTarget?.startsWith('folder:')) {
            const destDir = ds.hoverTarget.slice('folder:'.length);
            onMoveNodesToFolder(ds.dragPaths, destDir);
          } else if (ds.hoverTarget === 'browser' && !ds.node.isDir) {
            onOpenChromium(`file://${ds.node.path}`);
          } else {
            // Check if released over an obstructing window (if so, don't move desktop icon underneath it)
            const hitEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
            const overDesktop = hitEl && containerRef.current?.contains(hitEl);
            if (overDesktop) {
              onSaveIconPosition(ds.node.path, {
                x: Math.round(ds.currX),
                y: Math.round(ds.currY),
              });
            }
          }
        }
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
  }, [
    marquee,
    sortedNodes,
    nodePositions,
    sizeConfig,
    dropHoverTarget,
    onSelectPaths,
    onTrashNodes,
    onMoveNodesToFolder,
    onOpenChromium,
    onSaveIconPosition,
    onExternalDropHover,
    onDropFilesOnLinuxApp,
  ]);

  const cutSet = useMemo(
    () => new Set(clipboard?.mode === 'cut' ? clipboard.paths : []),
    [clipboard]
  );

  const handleTapOrDoubleOpen = (id: string, pointerType: string, action: () => void) => {
    if (pointerType === 'mouse') return; // mouse uses native onDoubleClick
    const now = Date.now();
    if (lastTapRef.current.id === id && now - lastTapRef.current.time < 360) {
      lastTapRef.current = { id: '', time: 0 };
      action();
    } else {
      lastTapRef.current = { id, time: now };
    }
  };

  const dockPos = meta.preferences.dock?.position || 'bottom';
  const dockInsetClass =
    dockPos === 'top'
      ? 'inset-0 top-[74px]'
      : dockPos === 'left'
      ? 'inset-0 left-[78px]'
      : dockPos === 'right'
      ? 'inset-0 right-[78px]'
      : 'inset-0 bottom-[74px]';

  const activeGhostSystem =
    activeGhost?.kind === 'system'
      ? systemIcons.find((s) => s.id === activeGhost.sysId)
      : undefined;

  return (
    <div
      ref={containerRef}
      data-testid="desktop-canvas"
      onPointerDown={(e) => {
        if (e.target !== containerRef.current) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        setSelectedSystemId(null);
        onSelectPaths([]);
        if (renamingPath) onSetRenamingPath(null);

        if (e.pointerType === 'touch') {
          clearLongPress();
          const cx = e.clientX;
          const cy = e.clientY;
          longPressTimerRef.current = setTimeout(() => {
            onContextMenu(cx, cy, {
              kind: 'desktop',
              dirPath: '/Desktop',
              spawnPos: { x: cx - 40, y: cy - 40 },
            });
          }, 520);
          return;
        }

        setMarquee({
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          currX: e.clientX,
          currY: e.clientY,
        });
      }}
      onContextMenu={(e) => {
        if (e.target !== containerRef.current) return;
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY, {
          kind: 'desktop',
          dirPath: '/Desktop',
          spawnPos: { x: e.clientX - 40, y: e.clientY - 40 },
        });
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('Files')) setHostDragActive(true);
      }}
      onDragLeave={(e) => {
        if (e.target === containerRef.current) setHostDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setHostDragActive(false);
        if (e.dataTransfer.files?.length) {
          onUploadHostFiles(e.dataTransfer.files);
          return;
        }
        const rawPaths = e.dataTransfer.getData('application/x-runcompute-paths');
        if (rawPaths) {
          try {
            const parsed: string[] = JSON.parse(rawPaths);
            onMoveNodesToFolder(parsed, '/Desktop');
          } catch {}
        }
      }}
      className={`fixed ${dockInsetClass} overflow-hidden select-none touch-none`}
    >
      {hostDragActive && (
        <div className="absolute inset-6 rounded-3xl border-2 border-dashed border-white/40 bg-black/35 flex items-center justify-center z-40 pointer-events-none">
          <div className="px-6 py-3.5 rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] text-sm font-medium text-[var(--os-text)] shadow-2xl">
            Dosyaları masaüstüne yüklemek için bırakın
          </div>
        </div>
      )}

      {/* Draggable System Desktop Icons (Google Chrome, Terminal, Dosyalar, Çöp Kutusu — cannot be dropped into folders) */}
      {systemIcons.map((sys) => {
        const pos = systemPositions[sys.id] || { x: PAD_X, y: PAD_Y + sys.row * sizeConfig.cellH };
        const isSel = selectedSystemId === sys.id;
        const isBeingDragged = activeGhost?.kind === 'system' && activeGhost.sysId === sys.id;
        const isBinHover = sys.id === 'sys-trash' && dropHoverTarget === 'folder:/.trash';
        return (
          <div
            key={sys.id}
            data-testid={`desktop-icon-${sys.id}`}
            data-system-id={sys.id}
            data-drop-folder={sys.dropFolder}
            style={{
              left: pos.x,
              top: pos.y,
              width: sizeConfig.cellW - 6,
              zIndex: isSel ? 10 : 1,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.pointerType === 'mouse' && e.button !== 0) return;
              setSelectedSystemId(sys.id);
              onSelectPaths([]);
              handleTapOrDoubleOpen(sys.id, e.pointerType, sys.onOpen);

              if (e.pointerType === 'touch') {
                clearLongPress();
                const cx = e.clientX;
                const cy = e.clientY;
                longPressTimerRef.current = setTimeout(() => {
                  dragStateRef.current = null;
                  sys.onContext(cx, cy);
                }, 520);
              }

              dragStateRef.current = {
                kind: 'system',
                pointerId: e.pointerId,
                sysId: sys.id,
                label: sys.label,
                startMouseX: e.clientX,
                startMouseY: e.clientY,
                origX: pos.x,
                origY: pos.y,
                currX: pos.x,
                currY: pos.y,
                moved: false,
                hoverTarget: null,
              };
            }}
            onDoubleClick={sys.onOpen}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSelectedSystemId(sys.id);
              sys.onContext(e.clientX, e.clientY);
            }}
            className={`absolute flex flex-col items-center p-2 rounded-2xl cursor-pointer transition-opacity ${
              isBinHover
                ? 'bg-white/20 ring-2 ring-white/75 scale-105'
                : isSel
                ? 'bg-black/18 ring-1 ring-white/25'
                : 'hover:bg-black/10'
            } ${isBeingDragged ? 'opacity-35' : ''}`}
          >
            <div className="mb-1.5">{sys.renderIcon()}</div>
            <span
              className={`${sizeConfig.textClass} font-medium text-center px-1.5 py-0.5 rounded-md line-clamp-2 leading-tight ${
                isSel
                  ? 'bg-white/90 text-neutral-950 font-semibold'
                  : 'bg-transparent text-white desktop-label-shadow'
              }`}
            >
              {sys.label}
            </span>
          </div>
        );
      })}

      {/* User VFS Desktop Files & Folders */}
      {sortedNodes.map((node) => {
        const basePos = nodePositions[node.path] || { x: 140, y: PAD_Y };
        const isBeingDragged = activeGhost?.kind === 'vfs' && activeGhost.node.path === node.path;
        const isSelected = selectedPaths.includes(node.path);
        const isRenaming = renamingPath === node.path;
        const isCut = cutSet.has(node.path);
        const isFolderHover = dropHoverTarget === `folder:${node.path}`;

        return (
          <div
            key={node.path}
            data-testid={`desktop-node-${node.name}`}
            data-drop-folder={node.isDir ? node.path : undefined}
            style={{
              left: basePos.x,
              top: basePos.y,
              width: sizeConfig.cellW - 6,
              zIndex: isSelected || isRenaming ? 10 : 1,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              if ((e.pointerType === 'mouse' && e.button !== 0) || isRenaming) return;
              setSelectedSystemId(null);

              let nextSel = selectedPaths;
              if (e.metaKey || e.ctrlKey) {
                nextSel = isSelected
                  ? selectedPaths.filter((p) => p !== node.path)
                  : [...selectedPaths, node.path];
                onSelectPaths(nextSel);
              } else if (!isSelected) {
                nextSel = [node.path];
                onSelectPaths(nextSel);
              }

              handleTapOrDoubleOpen(node.path, e.pointerType, () => onOpenNode(node));

              if (e.pointerType === 'touch') {
                clearLongPress();
                const cx = e.clientX;
                const cy = e.clientY;
                longPressTimerRef.current = setTimeout(() => {
                  dragStateRef.current = null;
                  const targetNodes = sortedNodes.filter((n) => nextSel.includes(n.path));
                  onContextMenu(cx, cy, {
                    kind: 'nodes',
                    dirPath: '/Desktop',
                    nodes: targetNodes,
                  });
                }, 520);
              }

              dragStateRef.current = {
                kind: 'vfs',
                pointerId: e.pointerId,
                node,
                dragPaths: nextSel.includes(node.path) ? nextSel : [node.path],
                startMouseX: e.clientX,
                startMouseY: e.clientY,
                origX: basePos.x,
                origY: basePos.y,
                currX: basePos.x,
                currY: basePos.y,
                moved: false,
                hoverTarget: null,
              };
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (!isRenaming) onOpenNode(node);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSelectedSystemId(null);
              const nextSel = isSelected ? selectedPaths : [node.path];
              onSelectPaths(nextSel);
              const targetNodes = sortedNodes.filter((n) => nextSel.includes(n.path));
              onContextMenu(e.clientX, e.clientY, {
                kind: 'nodes',
                dirPath: '/Desktop',
                nodes: targetNodes,
              });
            }}
            className={`absolute flex flex-col items-center p-2 rounded-2xl cursor-pointer transition-opacity ${
              isFolderHover
                ? 'bg-white/20 ring-2 ring-white/75 scale-105'
                : isSelected
                ? 'bg-black/18 ring-1 ring-white/25'
                : 'hover:bg-black/10'
            } ${isCut || isBeingDragged ? 'opacity-35' : ''}`}
          >
            <div className="mb-1.5">
              <FileIcon node={node} size={sizeConfig.iconPx} />
            </div>

            {isRenaming ? (
              <input
                ref={renameInputRef}
                value={renameDraft}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => finishRename(node.path)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') finishRename(node.path);
                  if (e.key === 'Escape') onSetRenamingPath(null);
                }}
                className="w-full px-1.5 py-0.5 rounded-md bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] text-[11px] text-center text-[var(--os-text)] focus:outline-none shadow-lg"
              />
            ) : (
              <span
                className={`${sizeConfig.textClass} font-medium text-center px-1.5 py-0.5 rounded-md line-clamp-2 break-all leading-tight ${
                  isSelected
                    ? 'bg-white/90 text-neutral-950 font-semibold'
                    : 'bg-transparent text-white desktop-label-shadow'
                }`}
              >
                {node.name}
              </span>
            )}
          </div>
        );
      })}

      {/* Marquee Selection Box */}
      {marquee && (
        <div
          style={{
            left: Math.min(marquee.startX, marquee.currX),
            top: Math.min(marquee.startY, marquee.currY),
            width: Math.abs(marquee.currX - marquee.startX),
            height: Math.abs(marquee.currY - marquee.startY),
          }}
          className="fixed z-30 bg-white/15 border border-white/50 rounded-md pointer-events-none"
        />
      )}

      {/* Top-Layer Portal Drag Ghost — ALWAYS floats above open windows! */}
      {activeGhost &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={ghostElRef}
            style={{
              left: 0,
              top: 0,
              width: sizeConfig.cellW - 6,
              transform: `translate3d(${activeGhost.initialX}px, ${activeGhost.initialY}px, 0) scale(1.04)`,
            }}
            className="fixed z-[9999] pointer-events-none flex flex-col items-center p-2 rounded-2xl"
          >
            <div className="relative mb-1.5">
              {activeGhost.kind === 'vfs' ? (
                <>
                  <FileIcon node={activeGhost.node} size={sizeConfig.iconPx} />
                  {activeGhost.count > 1 && (
                    <span className="absolute -top-1 -right-2 px-1.5 py-0.5 rounded-full bg-white text-neutral-950 text-[10px] font-bold shadow">
                      {activeGhost.count}
                    </span>
                  )}
                </>
              ) : (
                activeGhostSystem?.renderIcon()
              )}
            </div>
            <span className="text-xs font-medium text-center text-white desktop-label-shadow line-clamp-1 break-all px-1">
              {activeGhost.kind === 'vfs' ? activeGhost.node.name : activeGhost.label}
            </span>
          </div>,
          document.body
        )}
    </div>
  );
};
