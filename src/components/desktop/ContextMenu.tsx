import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Check,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileCode,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  ImagePlus,
  Info,
  LayoutGrid,
  PackageOpen,
  Pencil,
  RefreshCw,
  RotateCcw,
  Scissors,
  Settings,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ClipboardState, DesktopMeta, LinuxAppInfo, SettingsTabId, VFSNode } from '../../types/os';
import { isImageExtension } from '../../utils/format';
import {
  getExtensionKey,
  getOpenWithOptions,
  type OpenWithOption,
  type OpenWithTargetId,
} from '../../utils/openWith';
import { OriginalAppIcon, TerminalAppIcon } from '../icons/FileIcon';

export interface ContextMenuItemTarget {
  kind: 'desktop' | 'folder-bg' | 'nodes' | 'recycle-bin-icon' | 'system-icon';
  dirPath: string;
  nodes?: VFSNode[];
  systemAction?: 'open-chromium' | 'open-compute' | 'open-terminal';
  spawnPos?: { x: number; y: number };
}

interface ContextMenuProps {
  x: number;
  y: number;
  target: ContextMenuItemTarget;
  clipboard: ClipboardState | null;
  preferences: DesktopMeta['preferences'];
  hasTrashItems: boolean;
  linuxApps: LinuxAppInfo[];
  linuxGuiReady: boolean;
  onClose: () => void;
  onCreateFolder: (dirPath: string, pos?: { x: number; y: number }) => void;
  onCreateQuickFile: (dirPath: string, fileName: string, pos?: { x: number; y: number }) => void;
  onOpenCustomFileDialog: (dirPath: string, pos?: { x: number; y: number }) => void;
  onTriggerUpload: (dirPath: string) => void;
  onTriggerWallpaperUpload: () => void;
  onSetWallpaperFromNode: (node: VFSNode) => void;
  onOpenNode: (node: VFSNode) => void;
  onOpenNodeWith: (node: VFSNode, targetId: OpenWithTargetId) => void;
  onSetDefaultOpenWith: (node: VFSNode, targetId: OpenWithTargetId, label: string) => void;
  onStartRename: (node: VFSNode) => void;
  onCopy: (nodes: VFSNode[]) => void;
  onCut: (nodes: VFSNode[]) => void;
  onDuplicate: (nodes: VFSNode[]) => void;
  onPaste: (dirPath: string) => void;
  onTrash: (nodes: VFSNode[]) => void;
  onRestore: (nodes: VFSNode[]) => void;
  onDeletePermanent: (nodes: VFSNode[]) => void;
  onEmptyTrash: () => void;
  onCompressZip: (nodes: VFSNode[], dirPath: string) => void;
  onExtractZip: (node: VFSNode) => void;
  onDownloadHost: (node: VFSNode) => void;
  onShowProperties: (node: VFSNode) => void;
  onOpenChromium: () => void;
  onOpenFolderWindow: (path: string) => void;
  onOpenTerminalInDir: (dirPath: string) => void;
  onOpenSettings: (tab?: SettingsTabId) => void;
  onUpdatePreferences: (partial: Partial<DesktopMeta['preferences']>) => void;
  onCycleWallpaper: () => void;
  onRefresh: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  target,
  clipboard,
  preferences,
  hasTrashItems,
  linuxApps,
  linuxGuiReady,
  onClose,
  onCreateFolder,
  onCreateQuickFile,
  onOpenCustomFileDialog,
  onTriggerUpload,
  onTriggerWallpaperUpload,
  onSetWallpaperFromNode,
  onOpenNode,
  onOpenNodeWith,
  onSetDefaultOpenWith,
  onStartRename,
  onCopy,
  onCut,
  onDuplicate,
  onPaste,
  onTrash,
  onRestore,
  onDeletePermanent,
  onEmptyTrash,
  onCompressZip,
  onExtractZip,
  onDownloadHost,
  onShowProperties,
  onOpenChromium,
  onOpenFolderWindow,
  onOpenTerminalInDir,
  onOpenSettings,
  onUpdatePreferences,
  onCycleWallpaper,
  onRefresh,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [subMenu, setSubMenu] = useState<'new-file' | 'view' | 'open-with' | null>(null);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight - 72;
    setPos({
      left: Math.max(12, Math.min(x, vw - rect.width - 12)),
      top: Math.max(12, Math.min(y, vh - rect.height - 12)),
    });
  }, [x, y]);

  useEffect(() => {
    const handleOutside = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('pointerdown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  const run = (fn: () => void) => {
    fn();
    onClose();
  };

  const selectedNodes = target.nodes || [];
  const firstNode = selectedNodes[0];
  const isInTrash = target.dirPath === '/.trash' || Boolean(firstNode?.path.startsWith('/.trash/'));
  const flipSubLeft = pos.left + 490 > window.innerWidth;
  const flipSubUp = pos.top + 400 > window.innerHeight - 84;
  const canSetAsWallpaper =
    selectedNodes.length === 1 &&
    Boolean(firstNode) &&
    !firstNode.isDir &&
    !isInTrash &&
    (isImageExtension(firstNode.extension) || firstNode.extension === 'avif');
  const canOpenWith =
    target.kind === 'nodes' &&
    selectedNodes.length === 1 &&
    Boolean(firstNode) &&
    !firstNode.isDir &&
    !isInTrash;

  const openWithOptions = useMemo(
    () =>
      canOpenWith && firstNode
        ? getOpenWithOptions(firstNode, linuxApps, linuxGuiReady, preferences.defaultApps)
        : [],
    [canOpenWith, firstNode, linuxApps, linuxGuiReady, preferences.defaultApps]
  );

  const recommendedOpenWith = useMemo(
    () => openWithOptions.filter((o) => o.recommended || o.isDefault),
    [openWithOptions]
  );
  const otherOpenWith = useMemo(
    () => openWithOptions.filter((o) => !o.recommended && !o.isDefault),
    [openWithOptions]
  );
  const defaultOpenWith = openWithOptions.find((o) => o.isDefault) || openWithOptions[0];

  const renderOpenWithIcon = (opt: OpenWithOption) => {
    if (opt.iconKind === 'preview') {
      return <Eye className="w-4 h-4 text-[var(--os-text-muted)] shrink-0" />;
    }
    if (opt.iconKind === 'terminal') {
      return <TerminalAppIcon size={16} />;
    }
    const cleanIconId = opt.id === 'vscode-web' ? 'vscode' : opt.iconAppId;
    return (
      <OriginalAppIcon
        appId={cleanIconId}
        iconName={cleanIconId}
        name={opt.label}
        size={16}
      />
    );
  };

  const renderOpenWithRow = (opt: OpenWithOption) => (
    <div
      key={opt.id}
      className="group/ow flex items-center gap-1 rounded-lg hover:bg-[var(--os-hover)] transition-colors pr-1.5"
    >
      <button
        data-testid={`ctx-open-with-${opt.id}`}
        onClick={() => firstNode && run(() => onOpenNodeWith(firstNode, opt.id))}
        className="flex-1 min-w-0 px-2.5 py-2 flex items-center gap-2.5 text-left text-[var(--os-text)]"
      >
        <span className="w-4 h-4 flex items-center justify-center shrink-0">
          {renderOpenWithIcon(opt)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium leading-tight">{opt.label}</span>
          <span className="block truncate text-[10px] text-[var(--os-text-subtle)] leading-tight mt-0.5">
            {opt.subtitle}
          </span>
        </span>
      </button>
      {opt.isDefault ? (
        <span className="px-1.5 py-0.5 rounded bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] text-[9px] font-semibold shrink-0 flex items-center gap-0.5">
          <Check className="w-2.5 h-2.5" />
          Varsayılan
        </span>
      ) : (
        <button
          type="button"
          data-testid={`ctx-set-default-${opt.id}`}
          title={`.${getExtensionKey(firstNode!)} için varsayılan yap`}
          onClick={(e) => {
            e.stopPropagation();
            if (firstNode) {
              run(() => onSetDefaultOpenWith(firstNode, opt.id, opt.label));
            }
          }}
          className="px-1.5 py-0.5 rounded border border-[var(--os-border-strong)] bg-[var(--os-bg)] hover:bg-[var(--os-surface-3)] text-[9px] font-medium text-[var(--os-text-muted)] hover:text-[var(--os-text)] opacity-0 group-hover/ow:opacity-100 focus:opacity-100 transition-opacity shrink-0"
        >
          Varsayılan Yap
        </button>
      )}
    </div>
  );

  const itemCls =
    'w-full px-3 py-2 rounded-lg flex items-center justify-between hover:bg-[var(--os-hover)] text-[var(--os-text)] transition-colors';

  return (
    <div
      ref={menuRef}
      style={{ left: pos.left, top: pos.top, boxShadow: 'var(--os-shadow)' }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[9995] w-60 rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] p-1.5 text-xs text-[var(--os-text)] select-none"
    >
      {target.kind === 'system-icon' && (
        <button
          onClick={() =>
            run(() =>
              target.systemAction === 'open-chromium'
                ? onOpenChromium()
                : target.systemAction === 'open-terminal'
                ? onOpenTerminalInDir('/Desktop')
                : onOpenFolderWindow('/')
            )
          }
          className={itemCls}
        >
          <span className="flex items-center gap-2.5">
            <ExternalLink className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
            <span>Aç</span>
          </span>
        </button>
      )}

      {target.kind === 'recycle-bin-icon' && (
        <>
          <button onClick={() => run(() => onOpenFolderWindow('/.trash'))} className={itemCls}>
            <span className="flex items-center gap-2.5">
              <FolderOpen className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
              <span>Aç</span>
            </span>
          </button>
          <div className="my-1 border-t border-[var(--os-border)]" />
          <button
            disabled={!hasTrashItems}
            onClick={() => run(onEmptyTrash)}
            className={`${itemCls} text-red-500 disabled:opacity-35 disabled:pointer-events-none`}
          >
            <span className="flex items-center gap-2.5">
              <Trash2 className="w-3.5 h-3.5 text-red-500" />
              <span>Çöp Kutusunu Boşalt</span>
            </span>
          </button>
        </>
      )}

      {target.kind === 'nodes' && firstNode && (
        <>
          {!isInTrash && (
            <>
              <button
                data-testid="ctx-open-node"
                onClick={() => run(() => onOpenNode(firstNode))}
                className={itemCls}
              >
                <span className="flex items-center gap-2.5 font-medium">
                  <FolderOpen className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                  <span>Aç</span>
                </span>
                {canOpenWith && defaultOpenWith && (
                  <span className="text-[10px] text-[var(--os-text-subtle)] truncate max-w-[96px]">
                    {defaultOpenWith.label}
                  </span>
                )}
              </button>

              {canOpenWith && (
                <div onMouseEnter={() => setSubMenu('open-with')} className="relative">
                  <button
                    data-testid="ctx-open-with"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSubMenu((s) => (s === 'open-with' ? null : 'open-with'));
                    }}
                    className={itemCls}
                  >
                    <span className="flex items-center gap-2.5 font-medium">
                      <ExternalLink className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                      <span>Birlikte Aç</span>
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-[var(--os-text-subtle)]" />
                  </button>

                  {subMenu === 'open-with' && (
                    <div
                      data-testid="ctx-open-with-submenu"
                      style={{ boxShadow: 'var(--os-shadow)' }}
                      className={`absolute ${flipSubUp ? 'bottom-0' : 'top-0'} ${
                        flipSubLeft ? 'right-full mr-1.5' : 'left-full ml-1.5'
                      } w-72 max-h-[min(360px,68vh)] overflow-y-auto rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] p-1.5 z-10`}
                    >
                      {recommendedOpenWith.map(renderOpenWithRow)}
                      {otherOpenWith.length > 0 && (
                        <>
                          <div className="my-1 border-t border-[var(--os-border)]" />
                          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--os-text-subtle)]">
                            Diğer Uygulamalar
                          </div>
                          {otherOpenWith.map(renderOpenWithRow)}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {selectedNodes.length === 1 && firstNode.isDir && (
                <button
                  data-testid="ctx-open-terminal-node"
                  onClick={() => run(() => onOpenTerminalInDir(firstNode.path))}
                  className={itemCls}
                >
                  <span className="flex items-center gap-2.5">
                    <Terminal className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                    <span>Uç Birim</span>
                  </span>
                </button>
              )}

              {canSetAsWallpaper && (
                <button
                  onClick={() => run(() => onSetWallpaperFromNode(firstNode))}
                  className={itemCls}
                >
                  <span className="flex items-center gap-2.5 font-medium">
                    <ImageIcon className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                    <span>Masaüstü Arka Planı Yap</span>
                  </span>
                </button>
              )}

              {selectedNodes.length === 1 && (
                <button onClick={() => run(() => onStartRename(firstNode))} className={itemCls}>
                  <span className="flex items-center gap-2.5">
                    <Pencil className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                    <span>Yeniden Adlandır</span>
                  </span>
                  <span className="text-[10px] text-[var(--os-text-subtle)] font-mono">F2</span>
                </button>
              )}

              <div className="my-1 border-t border-[var(--os-border)]" />

              <button onClick={() => run(() => onCut(selectedNodes))} className={itemCls}>
                <span className="flex items-center gap-2.5">
                  <Scissors className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                  <span>Kes</span>
                </span>
                <span className="text-[10px] text-[var(--os-text-subtle)] font-mono">⌘X</span>
              </button>

              <button onClick={() => run(() => onCopy(selectedNodes))} className={itemCls}>
                <span className="flex items-center gap-2.5">
                  <Copy className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                  <span>Kopyala</span>
                </span>
                <span className="text-[10px] text-[var(--os-text-subtle)] font-mono">⌘C</span>
              </button>

              <button onClick={() => run(() => onDuplicate(selectedNodes))} className={itemCls}>
                <span className="flex items-center gap-2.5">
                  <Copy className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                  <span>Çoğalt</span>
                </span>
              </button>

              <div className="my-1 border-t border-[var(--os-border)]" />

              <button
                onClick={() => run(() => onCompressZip(selectedNodes, firstNode.parentPath))}
                className={itemCls}
              >
                <span className="flex items-center gap-2.5">
                  <Archive className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                  <span>Sıkıştır (.zip)</span>
                </span>
              </button>

              {selectedNodes.length === 1 && firstNode.extension === 'zip' && (
                <button onClick={() => run(() => onExtractZip(firstNode))} className={itemCls}>
                  <span className="flex items-center gap-2.5">
                    <PackageOpen className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                    <span>Buraya Ayıkla</span>
                  </span>
                </button>
              )}

              {selectedNodes.length === 1 && !firstNode.isDir && (
                <button onClick={() => run(() => onDownloadHost(firstNode))} className={itemCls}>
                  <span className="flex items-center gap-2.5">
                    <Download className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                    <span>İndir</span>
                  </span>
                </button>
              )}

              <div className="my-1 border-t border-[var(--os-border)]" />

              <button
                onClick={() => run(() => onTrash(selectedNodes))}
                className={`${itemCls} text-red-500 hover:bg-red-500/12`}
              >
                <span className="flex items-center gap-2.5">
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  <span>Çöp Kutusuna Taşı</span>
                </span>
              </button>
            </>
          )}

          {isInTrash && (
            <>
              <button onClick={() => run(() => onRestore(selectedNodes))} className={itemCls}>
                <span className="flex items-center gap-2.5">
                  <RotateCcw className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                  <span>Geri Yükle</span>
                </span>
              </button>
              <button
                onClick={() => run(() => onDeletePermanent(selectedNodes))}
                className={`${itemCls} text-red-500 hover:bg-red-500/12`}
              >
                <span className="flex items-center gap-2.5">
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  <span>Kalıcı Olarak Sil</span>
                </span>
              </button>
            </>
          )}

          {selectedNodes.length === 1 && (
            <>
              <div className="my-1 border-t border-[var(--os-border)]" />
              <button onClick={() => run(() => onShowProperties(firstNode))} className={itemCls}>
                <span className="flex items-center gap-2.5">
                  <Info className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                  <span>Bilgi Ver</span>
                </span>
              </button>
            </>
          )}
        </>
      )}

      {(target.kind === 'desktop' || target.kind === 'folder-bg') && (
        <>
          {target.dirPath === '/.trash' ? (
            <button
              disabled={!hasTrashItems}
              onClick={() => run(onEmptyTrash)}
              className={`${itemCls} text-red-500 disabled:opacity-40`}
            >
              <span className="flex items-center gap-2.5">
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
                <span>Çöp Kutusunu Boşalt</span>
              </span>
            </button>
          ) : (
            <>
              <button
                onClick={() => run(() => onCreateFolder(target.dirPath, target.spawnPos))}
                className={itemCls}
              >
                <span className="flex items-center gap-2.5">
                  <FolderPlus className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                  <span>Yeni Klasör</span>
                </span>
              </button>

              <div
                onMouseEnter={() => setSubMenu('new-file')}
                onMouseLeave={() => setSubMenu(null)}
                className="relative"
              >
                <button
                  onClick={() => run(() => onOpenCustomFileDialog(target.dirPath, target.spawnPos))}
                  className={itemCls}
                >
                  <span className="flex items-center gap-2.5">
                    <FilePlus2 className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                    <span>Yeni Dosya</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-[var(--os-text-subtle)]" />
                </button>

                {subMenu === 'new-file' && (
                  <div
                    style={{ boxShadow: 'var(--os-shadow)' }}
                    className={`absolute top-0 ${
                      flipSubLeft ? 'right-full mr-1.5' : 'left-full ml-1.5'
                    } w-52 rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] p-1.5 z-50`}
                  >
                    <button
                      onClick={() =>
                        run(() => onOpenCustomFileDialog(target.dirPath, target.spawnPos))
                      }
                      className={`${itemCls} font-medium`}
                    >
                      <span>Özel Uzantı Seç...</span>
                    </button>
                    <div className="my-1 border-t border-[var(--os-border)]" />
                    {[
                      { name: 'notlar.txt', label: 'Metin (.txt)', icon: FileText },
                      { name: 'sayfa.html', label: 'HTML (.html)', icon: FileCode },
                      { name: 'betik.py', label: 'Python (.py)', icon: FileCode },
                      { name: 'veri.json', label: 'JSON (.json)', icon: FileCode },
                      { name: 'belge.md', label: 'Markdown (.md)', icon: FileText },
                      { name: 'tablo.csv', label: 'Tablo (.csv)', icon: FileSpreadsheet },
                    ].map((tpl) => (
                      <button
                        key={tpl.name}
                        onClick={() =>
                          run(() => onCreateQuickFile(target.dirPath, tpl.name, target.spawnPos))
                        }
                        className={itemCls}
                      >
                        <span className="flex items-center gap-2">
                          <tpl.icon className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                          <span>{tpl.label}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => run(() => onTriggerUpload(target.dirPath))}
                className={itemCls}
              >
                <span className="flex items-center gap-2.5">
                  <Upload className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                  <span>Dosya Yükle...</span>
                </span>
              </button>

              <div className="my-1 border-t border-[var(--os-border)]" />

              <button
                data-testid="ctx-open-terminal"
                onClick={() => run(() => onOpenTerminalInDir(target.dirPath))}
                className={itemCls}
              >
                <span className="flex items-center gap-2.5 font-medium">
                  <Terminal className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                  <span>Uç Birim</span>
                </span>
              </button>

              <div className="my-1 border-t border-[var(--os-border)]" />

              <button
                disabled={!clipboard?.paths.length}
                onClick={() => run(() => onPaste(target.dirPath))}
                className={`${itemCls} disabled:opacity-35 disabled:pointer-events-none`}
              >
                <span className="flex items-center gap-2.5">
                  <ClipboardPaste className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                  <span>Yapıştır</span>
                </span>
                <span className="text-[10px] text-[var(--os-text-subtle)] font-mono">⌘V</span>
              </button>
            </>
          )}

          {target.kind === 'desktop' && (
            <>
              <div className="my-1 border-t border-[var(--os-border)]" />
              <div
                onMouseEnter={() => setSubMenu('view')}
                onMouseLeave={() => setSubMenu(null)}
                className="relative"
              >
                <button className={itemCls}>
                  <span className="flex items-center gap-2.5">
                    <LayoutGrid className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                    <span>Görünüm ve Sıralama</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-[var(--os-text-subtle)]" />
                </button>
                {subMenu === 'view' && (
                  <div
                    style={{ boxShadow: 'var(--os-shadow)' }}
                    className={`absolute top-0 ${
                      flipSubLeft ? 'right-full mr-1.5' : 'left-full ml-1.5'
                    } w-48 rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] p-1.5 z-50`}
                  >
                    {(
                      [
                        ['sm', 'Küçük Simgeler'],
                        ['md', 'Orta Simgeler'],
                        ['lg', 'Büyük Simgeler'],
                      ] as const
                    ).map(([sz, label]) => (
                      <button
                        key={sz}
                        onClick={() => run(() => onUpdatePreferences({ iconSize: sz }))}
                        className={itemCls}
                      >
                        <span>{label}</span>
                        {preferences.iconSize === sz && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--os-text)]" />
                        )}
                      </button>
                    ))}
                    <div className="my-1 border-t border-[var(--os-border)]" />
                    {(
                      [
                        ['name', 'Ada Göre Sırala'],
                        ['extension', 'Türe Göre Sırala'],
                        ['size', 'Boyuta Göre Sırala'],
                        ['modifiedAt', 'Tarihe Göre Sırala'],
                      ] as const
                    ).map(([srt, label]) => (
                      <button
                        key={srt}
                        onClick={() =>
                          run(() => onUpdatePreferences({ sortBy: srt, autoArrange: true }))
                        }
                        className={itemCls}
                      >
                        <span>{label}</span>
                        {preferences.sortBy === srt && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--os-text)]" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={() => run(onTriggerWallpaperUpload)} className={itemCls}>
                <span className="flex items-center gap-2.5">
                  <ImagePlus className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                  <span>Arka Plan Resmi Seç...</span>
                </span>
              </button>

              <button onClick={() => run(onCycleWallpaper)} className={itemCls}>
                <span className="flex items-center gap-2.5">
                  <ImageIcon className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                  <span>Hazır Arka Planı Değiştir</span>
                </span>
              </button>

              <button
                data-testid="ctx-open-settings"
                onClick={() => run(() => onOpenSettings('stream'))}
                className={itemCls}
              >
                <span className="flex items-center gap-2.5">
                  <Settings className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                  <span>Ayarlar & Akış Kalitesi</span>
                </span>
              </button>
            </>
          )}

          <div className="my-1 border-t border-[var(--os-border)]" />
          <button onClick={() => run(onRefresh)} className={itemCls}>
            <span className="flex items-center gap-2.5">
              <RefreshCw className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
              <span>Yenile</span>
            </span>
          </button>
        </>
      )}
    </div>
  );
};
