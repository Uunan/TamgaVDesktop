import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Code2,
  Download,
  FilePlus2,
  FileText,
  FolderPlus,
  HardDrive,
  LayoutGrid,
  List,
  Monitor,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ClipboardState, VFSNode } from '../../types/os';
import { FileIcon } from '../icons/FileIcon';
import {
  formatBytes,
  formatDateTimeTR,
  getFileTypeLabel,
  translateFolderDisplayName,
} from '../../utils/format';
import type { ContextMenuItemTarget } from './ContextMenu';

interface FolderWindowProps {
  initialPath: string;
  allNodes: VFSNode[];
  clipboard: ClipboardState | null;
  externalDropTarget?: string | null;
  renamingPath: string | null;
  onSetRenamingPath: (path: string | null) => void;
  onRenameCommit: (path: string, newName: string) => void;
  onOpenNode: (node: VFSNode) => void;
  onPathChangeTitle: (newTitle: string, newPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onOpenCustomFileDialog: (parentPath: string) => void;
  onUploadFiles: (parentPath: string, files: FileList) => void;
  onMoveNodes: (paths: string[], targetDir: string) => void;
  onTrashNodes: (nodes: VFSNode[]) => void;
  onRestoreNodes: (nodes: VFSNode[]) => void;
  onEmptyTrash: () => void;
  onContextMenu: (x: number, y: number, target: ContextMenuItemTarget) => void;
}

const SIDEBAR_ITEMS = [
  { path: '/', label: 'Disk', icon: HardDrive },
  { path: '/Desktop', label: 'Masaüstü', icon: Monitor },
  { path: '/Documents', label: 'Belgeler', icon: FileText },
  { path: '/Downloads', label: 'İndirilenler', icon: Download },
  { path: '/Projects', label: 'Projeler', icon: Code2 },
  { path: '/.trash', label: 'Çöp Kutusu', icon: Trash2 },
];

export const FolderWindow: React.FC<FolderWindowProps> = ({
  initialPath,
  allNodes,
  clipboard,
  externalDropTarget,
  renamingPath,
  onSetRenamingPath,
  onRenameCommit,
  onOpenNode,
  onPathChangeTitle,
  onCreateFolder,
  onOpenCustomFileDialog,
  onUploadFiles,
  onMoveNodes,
  onTrashNodes,
  onRestoreNodes,
  onEmptyTrash,
  onContextMenu,
}) => {
  const [history, setHistory] = useState<string[]>([initialPath || '/Desktop']);
  const [histIdx, setHistIdx] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'details'>('grid');
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const lastTapRef = useRef<{ path: string; time: number }>({ path: '', time: 0 });

  const currentPath = history[histIdx] || '/Desktop';

  useEffect(() => {
    const title = translateFolderDisplayName(
      currentPath,
      currentPath.split('/').filter(Boolean).pop() || 'Dosyalar'
    );
    onPathChangeTitle(title, currentPath);
    setSelectedPaths([]);
  }, [currentPath]);

  const navigateTo = (nextPath: string) => {
    const norm = nextPath || '/';
    if (norm === currentPath) return;
    const nextHist = [...history.slice(0, histIdx + 1), norm];
    setHistory(nextHist);
    setHistIdx(nextHist.length - 1);
    setSearchQuery('');
  };

  const visibleNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list: VFSNode[];
    if (q) {
      list = allNodes.filter((n) => {
        if (currentPath !== '/' && !n.path.startsWith(currentPath + '/')) return false;
        if (currentPath !== '/.trash' && n.path.startsWith('/.trash')) return false;
        return (
          n.name.toLowerCase().includes(q) ||
          n.extension.toLowerCase().includes(q) ||
          getFileTypeLabel(n).toLowerCase().includes(q)
        );
      });
    } else if (currentPath === '/') {
      list = allNodes.filter((n) => n.parentPath === '/');
    } else {
      list = allNodes.filter((n) => n.parentPath === currentPath);
    }

    return [...list].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, 'tr');
    });
  }, [allNodes, currentPath, searchQuery]);

  useEffect(() => {
    if (!renamingPath) return;
    const target = allNodes.find((n) => n.path === renamingPath);
    if (!target) return;
    setRenameDraft(target.name);
    requestAnimationFrame(() => {
      const el = renameInputRef.current;
      if (!el) return;
      el.focus();
      const dotIdx = !target.isDir ? target.name.lastIndexOf('.') : -1;
      if (dotIdx > 0) el.setSelectionRange(0, dotIdx);
      else el.select();
    });
  }, [renamingPath, allNodes]);

  const commitInlineRename = (originalPath: string) => {
    const trimmed = renameDraft.trim();
    onSetRenamingPath(null);
    if (trimmed) onRenameCommit(originalPath, trimmed);
  };

  const breadcrumbs = useMemo(() => {
    if (currentPath === '/') return [{ label: 'Disk', path: '/' }];
    const parts = currentPath.split('/').filter(Boolean);
    const items = [{ label: 'Disk', path: '/' }];
    let acc = '';
    for (const p of parts) {
      acc += `/${p}`;
      items.push({ label: translateFolderDisplayName(acc, p), path: acc });
    }
    return items;
  }, [currentPath]);

  const trashNode = allNodes.find((n) => n.path === '/.trash');

  const activateNode = (node: VFSNode) => {
    if (renamingPath === node.path) return;
    if (node.isDir) navigateTo(node.path);
    else onOpenNode(node);
  };

  const handleItemPointerDown = (e: React.PointerEvent, node: VFSNode) => {
    e.stopPropagation();
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    if (e.metaKey || e.ctrlKey) {
      setSelectedPaths((prev) =>
        prev.includes(node.path) ? prev.filter((p) => p !== node.path) : [...prev, node.path]
      );
    } else {
      setSelectedPaths([node.path]);
    }

    if (e.pointerType !== 'mouse') {
      const now = Date.now();
      if (lastTapRef.current.path === node.path && now - lastTapRef.current.time < 360) {
        lastTapRef.current = { path: '', time: 0 };
        activateNode(node);
      } else {
        lastTapRef.current = { path: node.path, time: now };
      }
    }
  };

  const handleItemContextMenu = (e: React.MouseEvent, node: VFSNode) => {
    e.preventDefault();
    e.stopPropagation();
    const nextSel = selectedPaths.includes(node.path) ? selectedPaths : [node.path];
    setSelectedPaths(nextSel);
    const nodes = allNodes.filter((n) => nextSel.includes(n.path));
    onContextMenu(e.clientX, e.clientY, {
      kind: 'nodes',
      dirPath: currentPath,
      nodes,
    });
  };

  const handleDropOnTarget = (e: React.DragEvent, destFolder: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(null);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onUploadFiles(destFolder === '/' ? '/Desktop' : destFolder, e.dataTransfer.files);
      return;
    }

    const rawPaths = e.dataTransfer.getData('application/x-runcompute-paths');
    if (rawPaths) {
      try {
        const parsed: string[] = JSON.parse(rawPaths);
        if (destFolder === '/.trash') {
          const toTrash = allNodes.filter((n) => parsed.includes(n.path));
          onTrashNodes(toTrash);
        } else if (destFolder !== '/') {
          onMoveNodes(parsed, destFolder);
        }
      } catch {}
    }
  };

  const cutSet = useMemo(
    () => new Set(clipboard?.mode === 'cut' ? clipboard.paths : []),
    [clipboard]
  );

  const isCanvasExternalHovered = externalDropTarget === `folder:${currentPath}`;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--os-surface)] text-[var(--os-text)] select-none">
      {/* Toolbar */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-[var(--os-surface-2)] border-b border-[var(--os-border)]">
        <div className="flex items-center gap-1">
          <button
            disabled={histIdx <= 0}
            onClick={() => setHistIdx((i) => Math.max(0, i - 1))}
            className="p-1.5 rounded-lg hover:bg-[var(--os-hover)] disabled:opacity-30 text-[var(--os-text-secondary)]"
            title="Geri"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            disabled={histIdx >= history.length - 1}
            onClick={() => setHistIdx((i) => Math.min(history.length - 1, i + 1))}
            className="p-1.5 rounded-lg hover:bg-[var(--os-hover)] disabled:opacity-30 text-[var(--os-text-secondary)]"
            title="İleri"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            disabled={currentPath === '/'}
            onClick={() => {
              const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
              navigateTo(parent);
            }}
            className="p-1.5 rounded-lg hover:bg-[var(--os-hover)] disabled:opacity-30 text-[var(--os-text-secondary)]"
            title="Üst Klasör"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-w-0 flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)] overflow-x-auto text-xs">
          {breadcrumbs.map((bc, idx) => (
            <React.Fragment key={bc.path}>
              {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-[var(--os-text-subtle)] shrink-0" />}
              <button
                onClick={() => navigateTo(bc.path)}
                className={`px-1.5 py-0.5 rounded-md hover:bg-[var(--os-hover)] truncate ${
                  idx === breadcrumbs.length - 1
                    ? 'text-[var(--os-text)] font-semibold'
                    : 'text-[var(--os-text-muted)]'
                }`}
              >
                {bc.label}
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className="relative w-44 sm:w-52 shrink-0">
          <Search className="w-3.5 h-3.5 text-[var(--os-text-subtle)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Ara..."
            className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)] focus:border-[var(--os-border-strong)] focus:outline-none text-xs text-[var(--os-text)]"
          />
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-[var(--os-surface-2)] border-b border-[var(--os-border)] text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          {currentPath !== '/' && currentPath !== '/.trash' && (
            <>
              <button
                onClick={() => onCreateFolder(currentPath)}
                className="px-3 py-1.5 rounded-lg bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] text-[var(--os-text)] flex items-center gap-1.5 font-medium transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                <span>Yeni Klasör</span>
              </button>
              <button
                onClick={() => onOpenCustomFileDialog(currentPath)}
                className="px-3 py-1.5 rounded-lg bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] text-[var(--os-text)] flex items-center gap-1.5 font-medium transition-colors"
              >
                <FilePlus2 className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                <span>Yeni Dosya</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-lg bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] text-[var(--os-text-secondary)] flex items-center gap-1.5 transition-colors"
              >
                <Upload className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                <span>Yükle</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    onUploadFiles(currentPath, e.target.files);
                    e.target.value = '';
                  }
                }}
              />
            </>
          )}

          {currentPath === '/.trash' && (
            <>
              <button
                disabled={!visibleNodes.length}
                onClick={() => onRestoreNodes(visibleNodes)}
                className="px-3 py-1.5 rounded-lg bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] text-[var(--os-text)] flex items-center gap-1.5 disabled:opacity-40"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Tümünü Geri Yükle</span>
              </button>
              <button
                disabled={!visibleNodes.length}
                onClick={onEmptyTrash}
                className="px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-500 flex items-center gap-1.5 disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Boşalt</span>
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-0.5 bg-[var(--os-bg)] p-0.5 rounded-lg border border-[var(--os-border)]">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded-md ${
              viewMode === 'grid'
                ? 'bg-[var(--os-surface-3)] text-[var(--os-text)]'
                : 'text-[var(--os-text-subtle)] hover:text-[var(--os-text)]'
            }`}
            title="Simgeler"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewMode('details')}
            className={`p-1.5 rounded-md ${
              viewMode === 'details'
                ? 'bg-[var(--os-surface-3)] text-[var(--os-text)]'
                : 'text-[var(--os-text-subtle)] hover:text-[var(--os-text)]'
            }`}
            title="Liste"
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Split Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-40 sm:w-44 shrink-0 bg-[var(--os-sidebar)] border-r border-[var(--os-border)] p-2.5 flex flex-col justify-between">
          <div className="space-y-0.5">
            <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--os-text-subtle)]">
              Konumlar
            </div>
            {SIDEBAR_ITEMS.map((item) => {
              const active = currentPath === item.path;
              const isDropTarget =
                dragOverPath === item.path || externalDropTarget === `folder:${item.path}`;
              const IconComp = item.icon;
              return (
                <button
                  key={item.path}
                  data-drop-folder={item.path !== '/' ? item.path : undefined}
                  onClick={() => navigateTo(item.path)}
                  onDragOver={(e) => {
                    if (item.path !== '/') {
                      e.preventDefault();
                      setDragOverPath(item.path);
                    }
                  }}
                  onDragLeave={() => setDragOverPath(null)}
                  onDrop={(e) => handleDropOnTarget(e, item.path)}
                  className={`w-full px-2.5 py-2 rounded-xl flex items-center justify-between text-xs transition-colors ${
                    isDropTarget
                      ? 'bg-[var(--os-active)] ring-1 ring-[var(--os-border-strong)] text-[var(--os-text)]'
                      : active
                      ? 'bg-[var(--os-surface-3)] text-[var(--os-text)] font-medium'
                      : 'text-[var(--os-text-muted)] hover:bg-[var(--os-hover)] hover:text-[var(--os-text)]'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <IconComp className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.path === '/.trash' && (trashNode?.childCount || 0) > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-[var(--os-active)] text-[var(--os-text-secondary)] text-[10px] font-mono">
                      {trashNode?.childCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* File Area */}
        <div
          data-drop-folder={currentPath !== '/' ? currentPath : undefined}
          onClick={() => {
            setSelectedPaths([]);
            if (renamingPath) onSetRenamingPath(null);
          }}
          onContextMenu={(e) => {
            if (currentPath === '/') return;
            e.preventDefault();
            onContextMenu(e.clientX, e.clientY, {
              kind: 'folder-bg',
              dirPath: currentPath,
            });
          }}
          onDragOver={(e) => {
            if (currentPath !== '/') e.preventDefault();
          }}
          onDrop={(e) => {
            if (currentPath !== '/') handleDropOnTarget(e, currentPath);
          }}
          className={`flex-1 min-w-0 overflow-y-auto p-4 transition-colors ${
            isCanvasExternalHovered ? 'bg-[var(--os-hover)] ring-2 ring-inset ring-[var(--os-border-strong)]' : ''
          }`}
        >
          {visibleNodes.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[var(--os-text-subtle)] text-xs">
              {searchQuery
                ? 'Eşleşen öğe bulunamadı.'
                : currentPath === '/.trash'
                ? 'Çöp Kutusu boş.'
                : 'Bu klasör boş.'}
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-3">
              {visibleNodes.map((node) => {
                const isSelected = selectedPaths.includes(node.path);
                const isRenaming = renamingPath === node.path;
                const isCut = cutSet.has(node.path);
                const isDropTarget =
                  dragOverPath === node.path || externalDropTarget === `folder:${node.path}`;

                return (
                  <div
                    key={node.path}
                    data-drop-folder={node.isDir ? node.path : undefined}
                    draggable={!isRenaming && currentPath !== '/'}
                    onDragStart={(e) => {
                      const dragList = isSelected ? selectedPaths : [node.path];
                      e.dataTransfer.setData(
                        'application/x-runcompute-paths',
                        JSON.stringify(dragList)
                      );
                    }}
                    onDragOver={(e) => {
                      if (node.isDir) {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOverPath(node.path);
                      }
                    }}
                    onDragLeave={() => setDragOverPath(null)}
                    onDrop={(e) => {
                      if (node.isDir) handleDropOnTarget(e, node.path);
                    }}
                    onPointerDown={(e) => handleItemPointerDown(e, node)}
                    onDoubleClick={() => activateNode(node)}
                    onContextMenu={(e) => handleItemContextMenu(e, node)}
                    className={`flex flex-col items-center p-2.5 rounded-2xl transition-colors cursor-pointer ${
                      isDropTarget
                        ? 'bg-[var(--os-active)] ring-1 ring-[var(--os-border-strong)]'
                        : isSelected
                        ? 'bg-[var(--os-surface-3)] ring-1 ring-[var(--os-border-strong)]'
                        : 'hover:bg-[var(--os-hover)]'
                    } ${isCut ? 'opacity-40' : ''}`}
                  >
                    <div className="mb-1.5">
                      <FileIcon node={node} size={48} />
                    </div>
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        value={renameDraft}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => commitInlineRename(node.path)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') commitInlineRename(node.path);
                          if (e.key === 'Escape') onSetRenamingPath(null);
                        }}
                        className="w-full px-1.5 py-0.5 rounded bg-[var(--os-bg)] border border-[var(--os-border-strong)] text-[11px] text-center text-[var(--os-text)] focus:outline-none"
                      />
                    ) : (
                      <span className="text-xs text-center text-[var(--os-text)] line-clamp-2 break-all leading-tight">
                        {translateFolderDisplayName(node.path, node.name)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--os-border)] text-[var(--os-text-subtle)] text-[11px]">
                  <th className="py-2 px-2 font-medium">Ad</th>
                  <th className="py-2 px-2 font-medium">Tür</th>
                  <th className="py-2 px-2 font-medium">Boyut</th>
                  <th className="py-2 px-2 font-medium">Değiştirilme</th>
                </tr>
              </thead>
              <tbody>
                {visibleNodes.map((node) => {
                  const isSelected = selectedPaths.includes(node.path);
                  const isRenaming = renamingPath === node.path;
                  return (
                    <tr
                      key={node.path}
                      data-drop-folder={node.isDir ? node.path : undefined}
                      onPointerDown={(e) => handleItemPointerDown(e, node)}
                      onDoubleClick={() => activateNode(node)}
                      onContextMenu={(e) => handleItemContextMenu(e, node)}
                      className={`border-b border-[var(--os-border)] cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--os-surface-3)] text-[var(--os-text)]'
                          : 'hover:bg-[var(--os-hover)] text-[var(--os-text)]'
                      }`}
                    >
                      <td className="py-2 px-2 flex items-center gap-2.5">
                        <FileIcon node={node} size={24} />
                        {isRenaming ? (
                          <input
                            ref={renameInputRef}
                            value={renameDraft}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onBlur={() => commitInlineRename(node.path)}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') commitInlineRename(node.path);
                              if (e.key === 'Escape') onSetRenamingPath(null);
                            }}
                            className="px-2 py-0.5 rounded bg-[var(--os-bg)] border border-[var(--os-border-strong)] text-xs text-[var(--os-text)] focus:outline-none"
                          />
                        ) : (
                          <span className="truncate font-medium">
                            {translateFolderDisplayName(node.path, node.name)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-[var(--os-text-muted)]">{getFileTypeLabel(node)}</td>
                      <td className="py-2 px-2 font-mono text-[var(--os-text-muted)]">
                        {node.isDir ? `${node.childCount} öğe` : formatBytes(node.size)}
                      </td>
                      <td className="py-2 px-2 text-[var(--os-text-muted)]">
                        {formatDateTimeTR(node.modifiedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Status Bar */}
      <div className="px-4 py-1.5 bg-[var(--os-sidebar)] border-t border-[var(--os-border)] flex items-center justify-between text-[11px] text-[var(--os-text-subtle)]">
        <span>
          {visibleNodes.length} öğe
          {selectedPaths.length > 0 && ` • ${selectedPaths.length} seçili`}
        </span>
        <span className="font-mono">{currentPath}</span>
      </div>
    </div>
  );
};
