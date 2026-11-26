import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Globe,
  Home,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Search,
  Volume2,
  X,
} from 'lucide-react';
import type { TabSummary, VFSNode } from '../../types/os';
import { ChromiumLogoIcon, FileIcon } from '../icons/FileIcon';
import {
  formatBytes,
  getFileTypeLabel,
  isAudioExtension,
  isImageExtension,
  isTextEditableExtension,
  isVideoExtension,
} from '../../utils/format';
import { buildRawFileUrl, vfsApi } from '../../services/osBridge';
import { remoteAudio } from '../../services/audioPlayer';

export type VideoFrameSubscriber = (cb: (jpegBytes: Uint8Array) => void) => () => void;

interface ChromiumWindowBodyProps {
  tabs: TabSummary[];
  activeTabId: string | null;
  subscribeVideoFrame: VideoFrameSubscriber;
  desktopNodes: VFSNode[];
  allNodes: VFSNode[];
  volume: number;
  muted: boolean;
  sendWs: (msg: Record<string, unknown>) => void;
  onOpenFolder: (path: string) => void;
  onVfsSaved: () => void;
  onNotify: (title: string, message: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const ChromiumTabStrip: React.FC<{
  tabs: TabSummary[];
  activeTabId: string | null;
  sendWs: (msg: Record<string, unknown>) => void;
}> = ({ tabs, activeTabId, sendWs }) => {
  return (
    <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto no-scrollbar py-0.5">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            data-no-drag="true"
            onClick={() => {
              remoteAudio.ensureContext();
              sendWs({ type: 'browser_activate_tab', tabId: tab.id });
            }}
            onAuxClick={(e) => {
              if (e.button === 1) sendWs({ type: 'browser_close_tab', tabId: tab.id });
            }}
            className={`group flex items-center gap-2 px-3 py-1 rounded-lg max-w-[200px] min-w-[110px] text-xs cursor-pointer transition-colors ${
              active
                ? 'bg-[var(--os-surface-3)] text-[var(--os-text)]'
                : 'bg-transparent text-[var(--os-text-muted)] hover:bg-[var(--os-hover)] hover:text-[var(--os-text)]'
            }`}
          >
            {tab.isLoading ? (
              <Loader2 className="w-3.5 h-3.5 text-[var(--os-text-muted)] animate-spin shrink-0" />
            ) : tab.favicon ? (
              <img src={tab.favicon} alt="" className="w-3.5 h-3.5 rounded-xs shrink-0" />
            ) : tab.mode === 'file' ? (
              <FileText className="w-3.5 h-3.5 text-[var(--os-text-muted)] shrink-0" />
            ) : (
              <Globe className="w-3.5 h-3.5 text-[var(--os-text-muted)] shrink-0" />
            )}
            <span className="truncate flex-1 text-[11px] font-medium">
              {tab.title || 'Yeni Sekme'}
            </span>
            {tab.isPlayingAudio && (
              <Volume2 className="w-3 h-3 text-[var(--os-text)] shrink-0 animate-pulse" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                sendWs({ type: 'browser_close_tab', tabId: tab.id });
              }}
              className="p-0.5 rounded hover:bg-[var(--os-active)] text-[var(--os-text-muted)] hover:text-[var(--os-text)] opacity-70 group-hover:opacity-100"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
      <button
        data-no-drag="true"
        onClick={() => sendWs({ type: 'browser_new_tab', url: 'compute://newtab' })}
        title="Yeni Sekme"
        className="p-1.5 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-muted)] hover:text-[var(--os-text)] shrink-0"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

const QUICK_SITES = [
  { name: 'Google', url: 'https://www.google.com', host: 'google.com' },
  { name: 'YouTube', url: 'https://www.youtube.com', host: 'youtube.com' },
  { name: 'GitHub', url: 'https://github.com', host: 'github.com' },
  { name: 'Vikipedi', url: 'https://tr.wikipedia.org', host: 'wikipedia.org' },
  { name: 'Hacker News', url: 'https://news.ycombinator.com', host: 'news.ycombinator.com' },
  { name: 'MDN', url: 'https://developer.mozilla.org', host: 'developer.mozilla.org' },
];

export const ChromiumWindowBody: React.FC<ChromiumWindowBodyProps> = ({
  tabs,
  activeTabId,
  subscribeVideoFrame,
  desktopNodes,
  allNodes,
  volume,
  muted,
  sendWs,
  onOpenFolder,
  onVfsSaved,
  onNotify,
}) => {
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const [addressInput, setAddressInput] = useState('');
  const [newTabQuery, setNewTabQuery] = useState('');
  const viewportContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const localMediaRef = useRef<HTMLMediaElement | null>(null);
  const lastMoveSentRef = useRef<number>(0);

  // Touch gesture tracking for smooth tablet scrolling inside Chromium canvas
  const touchTrackRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    scrolled: boolean;
  } | null>(null);

  const [fileContent, setFileContent] = useState<string>('');
  const [fileDirty, setFileDirty] = useState(false);
  const [fileViewTab, setFileViewTab] = useState<'preview' | 'edit'>('preview');
  const [savingFile, setSavingFile] = useState(false);

  useEffect(() => {
    if (!activeTab) return;
    setAddressInput(activeTab.url === 'compute://newtab' ? '' : activeTab.url);
  }, [activeTab?.id, activeTab?.url]);

  // Sync local HTML5 audio/video volume with OS volume
  useEffect(() => {
    if (localMediaRef.current) {
      localMediaRef.current.volume = muted ? 0 : Math.max(0, Math.min(1, volume / 100));
      localMediaRef.current.muted = muted;
    }
  }, [volume, muted, activeTab?.id]);

  // Direct zero-rerender GPU bitmap canvas renderer
  useEffect(() => {
    let decoding = false;
    let pendingBytes: Uint8Array | null = null;

    const paintBytes = async (bytes: Uint8Array) => {
      if (decoding) {
        pendingBytes = bytes;
        return;
      }
      decoding = true;
      try {
        let current: Uint8Array | null = bytes;
        while (current) {
          const nextToPaint = current;
          pendingBytes = null;
          const canvas = canvasRef.current;
          if (canvas) {
            const blob = new Blob([nextToPaint as BlobPart], { type: 'image/jpeg' });
            const bmp = await createImageBitmap(blob);
            if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
              canvas.width = bmp.width;
              canvas.height = bmp.height;
            }
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx?.drawImage(bmp, 0, 0);
            bmp.close();
          }
          current = pendingBytes;
        }
      } catch {
        // ignore transient frame error
      } finally {
        decoding = false;
      }
    };

    return subscribeVideoFrame(paintBytes);
  }, [subscribeVideoFrame, activeTab?.id, activeTab?.mode]);

  // Sync viewport size cleanly
  useEffect(() => {
    const el = viewportContainerRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 120 || rect.height < 120) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        sendWs({
          type: 'browser_viewport',
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }, 150);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [sendWs]);

  const localNode =
    activeTab?.mode === 'file' ? allNodes.find((n) => n.path === activeTab.filePath) : undefined;

  useEffect(() => {
    if (activeTab?.mode !== 'file' || !activeTab.filePath) return;
    const ext = (localNode?.extension || '').toLowerCase();
    setFileDirty(false);
    if (['html', 'htm', 'svg', 'csv'].includes(ext)) {
      setFileViewTab('preview');
    } else if (isTextEditableExtension(ext)) {
      setFileViewTab('edit');
    } else {
      setFileViewTab('preview');
    }

    if (isTextEditableExtension(ext)) {
      vfsApi
        .readText(activeTab.filePath)
        .then((res) => setFileContent(res.content))
        .catch(() => setFileContent(''));
    }
  }, [activeTab?.id, activeTab?.mode, activeTab?.filePath, localNode?.extension]);

  const handleSaveLocalFile = async () => {
    if (!activeTab?.filePath) return;
    setSavingFile(true);
    try {
      await vfsApi.writeText(activeTab.filePath, fileContent);
      setFileDirty(false);
      onVfsSaved();
      onNotify('Kaydedildi', `${activeTab.filePath} güncellendi.`, 'success');
    } catch (err) {
      onNotify('Hata', (err as Error).message, 'error');
    } finally {
      setSavingFile(false);
    }
  };

  const navigateActive = (targetUrl: string) => {
    if (!activeTab) return;
    remoteAudio.ensureContext();
    sendWs({
      type: 'browser_navigate',
      tabId: activeTab.id,
      url: targetUrl,
    });
  };

  const computeCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = (canvas.width || rect.width) / rect.width;
    const scaleY = (canvas.height || rect.height) / rect.height;
    return {
      x: Math.round((clientX - rect.left) * scaleX),
      y: Math.round((clientY - rect.top) * scaleY),
    };
  };

  const getModifiersMask = (e: {
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }) => {
    let m = 0;
    if (e.altKey) m |= 1;
    if (e.ctrlKey) m |= 2;
    if (e.metaKey) m |= 4;
    if (e.shiftKey) m |= 8;
    return m;
  };

  const mapButton = (btn: number): 'left' | 'middle' | 'right' => {
    if (btn === 1) return 'middle';
    if (btn === 2) return 'right';
    return 'left';
  };

  if (!activeTab) return null;

  return (
    <div
      data-drop-browser="true"
      className="flex-1 min-h-0 flex flex-col bg-[var(--os-surface)] text-[var(--os-text)] select-none"
    >
      {/* Navigation & Address Bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--os-surface-2)] border-b border-[var(--os-border)]">
        <div className="flex items-center gap-0.5">
          <button
            disabled={!activeTab.canGoBack}
            onClick={() => sendWs({ type: 'browser_back', tabId: activeTab.id })}
            className="p-1.5 rounded-lg hover:bg-[var(--os-hover)] disabled:opacity-30 text-[var(--os-text-secondary)]"
            title="Geri"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            disabled={!activeTab.canGoForward}
            onClick={() => sendWs({ type: 'browser_forward', tabId: activeTab.id })}
            className="p-1.5 rounded-lg hover:bg-[var(--os-hover)] disabled:opacity-30 text-[var(--os-text-secondary)]"
            title="İleri"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => sendWs({ type: 'browser_reload', tabId: activeTab.id })}
            className="p-1.5 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)]"
            title="Yenile"
          >
            <RefreshCw className={`w-4 h-4 ${activeTab.isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => navigateActive('compute://newtab')}
            className="p-1.5 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)]"
            title="Başlangıç"
          >
            <Home className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigateActive(addressInput || 'compute://newtab');
            canvasRef.current?.focus();
          }}
          className="flex-1 flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)] focus-within:border-[var(--os-border-strong)] transition-colors"
        >
          {activeTab.mode === 'file' ? (
            <span className="px-2 py-0.5 rounded-md bg-[var(--os-surface-3)] text-[var(--os-text)] text-[10px] font-medium shrink-0">
              Dosya
            </span>
          ) : activeTab.isSecure ? (
            <Lock className="w-3.5 h-3.5 text-[var(--os-text-muted)] shrink-0" />
          ) : (
            <Globe className="w-3.5 h-3.5 text-[var(--os-text-subtle)] shrink-0" />
          )}
          <input
            type="text"
            value={addressInput}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setAddressInput(e.target.value)}
            placeholder="Web adresi veya arama terimi yazın..."
            className="flex-1 bg-transparent text-xs text-[var(--os-text)] focus:outline-none"
          />
        </form>

        <button
          onClick={() => onOpenFolder('/Downloads')}
          title="İndirilenler"
          className="px-3 py-1.5 rounded-xl bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] text-xs text-[var(--os-text)] flex items-center gap-1.5 shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">İndirilenler</span>
        </button>
      </div>

      {activeTab.isLoading && (
        <div className="h-[2px] w-full bg-[var(--os-surface-2)] overflow-hidden">
          <div className="h-full w-1/2 bg-[var(--os-text-muted)] animate-pulse" />
        </div>
      )}

      {/* Viewport */}
      <div ref={viewportContainerRef} className="flex-1 min-h-0 relative overflow-hidden flex flex-col">
        {/* MODE 1: MINIMAL NEW TAB */}
        {activeTab.mode === 'newtab' && (
          <div className="flex-1 overflow-y-auto bg-[var(--os-surface)] p-6 sm:p-10 flex flex-col items-center justify-center">
            <div className="w-full max-w-xl space-y-8">
              <div className="flex flex-col items-center text-center space-y-2">
                <ChromiumLogoIcon size={54} />
                <h1 className="text-xl font-semibold text-[var(--os-text)] tracking-tight">Chromium</h1>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newTabQuery.trim()) {
                    navigateActive(newTabQuery);
                    setNewTabQuery('');
                  }
                }}
                className="relative"
              >
                <Search className="w-4 h-4 text-[var(--os-text-subtle)] absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  value={newTabQuery}
                  onChange={(e) => setNewTabQuery(e.target.value)}
                  placeholder="Google'da arayın veya adres girin..."
                  className="w-full pl-11 pr-20 py-3.5 rounded-2xl bg-[var(--os-bg)] border border-[var(--os-border-strong)] focus:border-[var(--os-text-muted)] focus:outline-none text-sm text-[var(--os-text)]"
                />
                <button
                  type="submit"
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-2 rounded-xl bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] hover:opacity-90 text-xs font-semibold"
                >
                  Git
                </button>
              </form>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
                {QUICK_SITES.map((site) => (
                  <button
                    key={site.url}
                    onClick={() => navigateActive(site.url)}
                    className="p-3 rounded-2xl bg-[var(--os-surface-2)] hover:bg-[var(--os-surface-3)] border border-[var(--os-border)] flex flex-col items-center gap-2 transition-colors"
                  >
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${site.host}&sz=64`}
                      alt={site.name}
                      className="w-6 h-6 rounded"
                    />
                    <span className="text-[11px] text-[var(--os-text-secondary)] font-medium truncate w-full text-center">
                      {site.name}
                    </span>
                  </button>
                ))}
              </div>

              {desktopNodes.filter((n) => !n.isDir).length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] text-[var(--os-text-subtle)] font-medium px-1">
                    Masaüstündeki Dosyalar
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {desktopNodes
                      .filter((n) => !n.isDir)
                      .slice(0, 6)
                      .map((f) => (
                        <button
                          key={f.path}
                          onClick={() => navigateActive(`file://${f.path}`)}
                          className="p-2.5 rounded-xl bg-[var(--os-surface-2)] hover:bg-[var(--os-surface-3)] border border-[var(--os-border)] flex items-center gap-2.5 text-left"
                        >
                          <FileIcon node={f} size={28} />
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-[var(--os-text)] truncate">
                              {f.name}
                            </div>
                            <div className="text-[10px] text-[var(--os-text-subtle)] truncate">
                              {formatBytes(f.size)}
                            </div>
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* MODE 2: LOCAL FILE VIEWER / EDITOR */}
        {activeTab.mode === 'file' && (
          <div className="flex-1 min-h-0 flex flex-col bg-[var(--os-surface)]">
            {!localNode ? (
              <div className="flex-1 flex items-center justify-center text-[var(--os-text-subtle)] text-xs">
                Dosya bulunamadı: {activeTab.filePath}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-4 py-2 bg-[var(--os-surface-2)] border-b border-[var(--os-border)] text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileIcon node={localNode} size={26} />
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--os-text)] truncate">{localNode.name}</div>
                      <div className="text-[11px] text-[var(--os-text-subtle)]">
                        {getFileTypeLabel(localNode)} • {formatBytes(localNode.size)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {['html', 'htm', 'svg', 'csv'].includes(localNode.extension) && (
                      <div className="flex items-center bg-[var(--os-bg)] p-0.5 rounded-lg border border-[var(--os-border)]">
                        <button
                          onClick={() => setFileViewTab('preview')}
                          className={`px-2.5 py-1 rounded-md flex items-center gap-1 ${
                            fileViewTab === 'preview'
                              ? 'bg-[var(--os-surface-3)] text-[var(--os-text)] font-medium'
                              : 'text-[var(--os-text-muted)]'
                          }`}
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Önizleme</span>
                        </button>
                        <button
                          onClick={() => setFileViewTab('edit')}
                          className={`px-2.5 py-1 rounded-md flex items-center gap-1 ${
                            fileViewTab === 'edit'
                              ? 'bg-[var(--os-surface-3)] text-[var(--os-text)] font-medium'
                              : 'text-[var(--os-text-muted)]'
                          }`}
                        >
                          <Code2 className="w-3.5 h-3.5" />
                          <span>Kaynak</span>
                        </button>
                      </div>
                    )}

                    {isTextEditableExtension(localNode.extension) && fileViewTab === 'edit' && (
                      <button
                        onClick={handleSaveLocalFile}
                        disabled={savingFile}
                        className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 ${
                          fileDirty
                            ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] hover:opacity-90'
                            : 'bg-[var(--os-surface-3)] text-[var(--os-text-muted)]'
                        }`}
                      >
                        {fileDirty ? <Save className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                        <span>{savingFile ? 'Kaydediliyor...' : fileDirty ? 'Kaydet' : 'Kaydedildi'}</span>
                      </button>
                    )}

                    <a
                      href={buildRawFileUrl(localNode.path, '&download=1')}
                      className="px-2.5 py-1.5 rounded-lg bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] text-[var(--os-text)] flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>İndir</span>
                    </a>
                  </div>
                </div>

                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  {fileViewTab === 'edit' && isTextEditableExtension(localNode.extension) ? (
                    <textarea
                      value={fileContent}
                      onChange={(e) => {
                        setFileContent(e.target.value);
                        setFileDirty(true);
                      }}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                          e.preventDefault();
                          handleSaveLocalFile();
                        }
                      }}
                      spellCheck={false}
                      className="flex-1 w-full p-4 bg-[var(--os-bg)] text-[var(--os-text)] font-mono text-xs leading-relaxed focus:outline-none resize-none select-text"
                      placeholder="Dosya içeriğini düzenleyin (⌘S / Ctrl+S ile kaydet)..."
                    />
                  ) : ['html', 'htm'].includes(localNode.extension) ? (
                    <iframe
                      title={localNode.name}
                      srcDoc={fileContent}
                      className="flex-1 w-full bg-white border-0"
                    />
                  ) : localNode.extension === 'csv' ? (
                    <div className="flex-1 overflow-auto p-4 select-text">
                      <table className="w-full border-collapse text-xs">
                        <tbody>
                          {fileContent
                            .trim()
                            .split('\n')
                            .map((row, rIdx) => (
                              <tr
                                key={rIdx}
                                className={
                                  rIdx === 0
                                    ? 'bg-[var(--os-surface-3)] text-[var(--os-text)] font-semibold'
                                    : 'border-b border-[var(--os-border)] text-[var(--os-text-secondary)]'
                                }
                              >
                                {row.split(',').map((cell, cIdx) => (
                                  <td key={cIdx} className="px-3 py-2 border border-[var(--os-border)]">
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ) : isImageExtension(localNode.extension) ? (
                    <div className="flex-1 flex items-center justify-center p-6 bg-[var(--os-bg)] overflow-auto">
                      <img
                        src={buildRawFileUrl(
                          localNode.path,
                          `&t=${encodeURIComponent(localNode.modifiedAt)}`
                        )}
                        alt={localNode.name}
                        className="max-w-full max-h-full object-contain rounded-lg"
                      />
                    </div>
                  ) : isVideoExtension(localNode.extension) ? (
                    <div className="flex-1 flex items-center justify-center p-6 bg-black">
                      <video
                        ref={(el) => {
                          localMediaRef.current = el;
                        }}
                        controls
                        autoPlay
                        src={buildRawFileUrl(localNode.path)}
                        className="max-w-full max-h-full rounded-lg"
                      />
                    </div>
                  ) : isAudioExtension(localNode.extension) ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 bg-[var(--os-bg)]">
                      <FileIcon node={localNode} size={80} />
                      <div className="text-sm font-medium text-[var(--os-text)]">{localNode.name}</div>
                      <audio
                        ref={(el) => {
                          localMediaRef.current = el;
                        }}
                        controls
                        autoPlay
                        src={buildRawFileUrl(localNode.path)}
                        className="w-full max-w-md"
                      />
                    </div>
                  ) : localNode.extension === 'pdf' ? (
                    <iframe
                      title={localNode.name}
                      src={buildRawFileUrl(localNode.path)}
                      className="flex-1 w-full border-0 bg-white"
                    />
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
                      <FileIcon node={localNode} size={76} />
                      <div>
                        <div className="text-sm font-medium text-[var(--os-text)]">{localNode.name}</div>
                        <div className="text-xs text-[var(--os-text-muted)] mt-1">
                          {getFileTypeLabel(localNode)} • {formatBytes(localNode.size)}
                        </div>
                      </div>
                      <button
                        onClick={() => onOpenFolder(localNode.parentPath)}
                        className="px-4 py-2 rounded-xl bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] text-xs text-[var(--os-text)] flex items-center gap-2"
                      >
                        <FolderOpen className="w-4 h-4" />
                        <span>Bulunduğu Klasörü Aç</span>
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* MODE 3: REAL CHROMIUM VIDEO + AUDIO STREAM */}
        {activeTab.mode === 'web' && (
          <div className="flex-1 min-h-0 relative bg-white flex items-center justify-center overflow-hidden">
            <canvas
              ref={canvasRef}
              tabIndex={0}
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={(e) => {
                remoteAudio.ensureContext();
                e.currentTarget.focus();

                if (e.pointerType === 'touch') {
                  touchTrackRef.current = {
                    pointerId: e.pointerId,
                    startX: e.clientX,
                    startY: e.clientY,
                    lastX: e.clientX,
                    lastY: e.clientY,
                    scrolled: false,
                  };
                  return;
                }

                const { x, y } = computeCanvasCoords(e.clientX, e.clientY);
                sendWs({
                  type: 'browser_input',
                  tabId: activeTab.id,
                  kind: 'mouse',
                  eventType: 'mousePressed',
                  x,
                  y,
                  button: mapButton(e.button),
                  clickCount: e.detail || 1,
                  modifiers: getModifiersMask(e),
                });
              }}
              onPointerMove={(e) => {
                if (e.pointerType === 'touch') {
                  const tt = touchTrackRef.current;
                  if (!tt || tt.pointerId !== e.pointerId) return;
                  const dx = tt.lastX - e.clientX;
                  const dy = tt.lastY - e.clientY;
                  if (!tt.scrolled && Math.hypot(e.clientX - tt.startX, e.clientY - tt.startY) > 7) {
                    tt.scrolled = true;
                  }
                  if (tt.scrolled) {
                    tt.lastX = e.clientX;
                    tt.lastY = e.clientY;
                    const { x, y } = computeCanvasCoords(e.clientX, e.clientY);
                    sendWs({
                      type: 'browser_input',
                      tabId: activeTab.id,
                      kind: 'mouse',
                      eventType: 'mouseWheel',
                      x,
                      y,
                      deltaX: dx * 1.4,
                      deltaY: dy * 1.4,
                    });
                  }
                  return;
                }

                const now = performance.now();
                if (now - lastMoveSentRef.current < 20) return;
                lastMoveSentRef.current = now;
                const { x, y } = computeCanvasCoords(e.clientX, e.clientY);
                sendWs({
                  type: 'browser_input',
                  tabId: activeTab.id,
                  kind: 'mouse',
                  eventType: 'mouseMoved',
                  x,
                  y,
                  button: e.buttons === 1 ? 'left' : 'none',
                  modifiers: getModifiersMask(e),
                });
              }}
              onPointerUp={(e) => {
                if (e.pointerType === 'touch') {
                  const tt = touchTrackRef.current;
                  touchTrackRef.current = null;
                  if (tt && !tt.scrolled) {
                    const { x, y } = computeCanvasCoords(e.clientX, e.clientY);
                    sendWs({
                      type: 'browser_input',
                      tabId: activeTab.id,
                      kind: 'mouse',
                      eventType: 'mousePressed',
                      x,
                      y,
                      button: 'left',
                      clickCount: 1,
                    });
                    sendWs({
                      type: 'browser_input',
                      tabId: activeTab.id,
                      kind: 'mouse',
                      eventType: 'mouseReleased',
                      x,
                      y,
                      button: 'left',
                      clickCount: 1,
                    });
                  }
                  return;
                }

                const { x, y } = computeCanvasCoords(e.clientX, e.clientY);
                sendWs({
                  type: 'browser_input',
                  tabId: activeTab.id,
                  kind: 'mouse',
                  eventType: 'mouseReleased',
                  x,
                  y,
                  button: mapButton(e.button),
                  clickCount: e.detail || 1,
                  modifiers: getModifiersMask(e),
                });
              }}
              onWheel={(e) => {
                const { x, y } = computeCanvasCoords(e.clientX, e.clientY);
                sendWs({
                  type: 'browser_input',
                  tabId: activeTab.id,
                  kind: 'mouse',
                  eventType: 'mouseWheel',
                  x,
                  y,
                  deltaX: e.deltaX,
                  deltaY: e.deltaY,
                  modifiers: getModifiersMask(e),
                });
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') return;
                e.preventDefault();
                e.stopPropagation();
                sendWs({
                  type: 'browser_input',
                  tabId: activeTab.id,
                  kind: 'key',
                  key: e.key,
                  ctrlKey: e.ctrlKey,
                  metaKey: e.metaKey,
                  shiftKey: e.shiftKey,
                  altKey: e.altKey,
                });
              }}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text');
                if (pasted) {
                  e.preventDefault();
                  sendWs({
                    type: 'browser_input',
                    tabId: activeTab.id,
                    kind: 'paste',
                    text: pasted,
                  });
                }
              }}
              className="w-full h-full object-fill focus:outline-none touch-none cursor-default"
            />
          </div>
        )}
      </div>
    </div>
  );
};
