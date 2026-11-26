import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  Eye,
  FileCode2,
  FileText,
  Film,
  Image as ImageIcon,
  Maximize2,
  Music,
  RotateCw,
  Save,
  Wallpaper,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { VFSNode } from '../../types/os';
import { buildRawFileUrl, vfsApi } from '../../services/osBridge';
import { formatBytes, getFileTypeLabel } from '../../utils/format';

interface PreviewWindowProps {
  initialPath: string;
  allNodes: VFSNode[];
  onTitleChange: (title: string, path: string) => void;
  onVfsSaved: () => void;
  onSetWallpaper?: (node: VFSNode) => void;
  onNotify?: (title: string, message: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']);
const PDF_EXTS = new Set(['pdf']);
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'py', 'sh', 'bash', 'zsh', 'css', 'scss', 'html', 'htm', 'xml', 'yml', 'yaml',
  'toml', 'ini', 'conf', 'cfg', 'env', 'log', 'csv', 'sql', 'c', 'cpp', 'h',
  'hpp', 'rs', 'go', 'java', 'kt', 'swift', 'php', 'rb', 'dockerfile', 'gitignore',
]);

function detectKind(node?: VFSNode): 'image' | 'video' | 'audio' | 'pdf' | 'html' | 'text' | 'binary' {
  if (!node) return 'binary';
  const ext = (node.extension || '').toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (PDF_EXTS.has(ext)) return 'pdf';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (TEXT_EXTS.has(ext) || !ext) return 'text';
  return 'binary';
}

export const PreviewWindow: React.FC<PreviewWindowProps> = ({
  initialPath,
  allNodes,
  onTitleChange,
  onVfsSaved,
  onSetWallpaper,
  onNotify,
}) => {
  const [activePath, setActivePath] = useState(initialPath);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);
  const [checkerboard, setCheckerboard] = useState(true);

  const [textContent, setTextContent] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [loadingText, setLoadingText] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [htmlRenderMode, setHtmlRenderMode] = useState(true);

  const imageStageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActivePath(initialPath);
  }, [initialPath]);

  const node = useMemo(
    () => allNodes.find((n) => n.path === activePath),
    [allNodes, activePath]
  );

  const siblings = useMemo(() => {
    if (!node) return [];
    return allNodes
      .filter((n) => !n.isDir && n.parentPath === node.parentPath)
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [allNodes, node]);

  const currentIdx = useMemo(
    () => siblings.findIndex((s) => s.path === activePath),
    [siblings, activePath]
  );

  const kind = useMemo(() => detectKind(node), [node]);
  const rawUrl = useMemo(
    () => (node ? buildRawFileUrl(node.path) : ''),
    [node]
  );

  useEffect(() => {
    if (node) {
      onTitleChange(`${node.name} — Önizleme`, node.path);
    }
    setZoom(1);
    setRotation(0);
    setNaturalDims(null);
    setEditing(false);
    setHtmlRenderMode(true);
  }, [node?.path]);

  // Load text content for text/html files
  useEffect(() => {
    if (!node || (kind !== 'text' && kind !== 'html')) {
      setTextContent('');
      setDraftContent('');
      return;
    }
    let cancelled = false;
    setLoadingText(true);
    vfsApi
      .readText(node.path)
      .then((res) => {
        if (cancelled) return;
        setTextContent(res.content || '');
        setDraftContent(res.content || '');
      })
      .catch(() => {
        if (!cancelled) {
          setTextContent('');
          setDraftContent('');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingText(false);
      });
    return () => {
      cancelled = true;
    };
  }, [node?.path, kind]);

  // Non-passive Cmd/Ctrl + Scroll zoom on image stage
  useEffect(() => {
    const el = imageStageRef.current;
    if (!el || kind !== 'image') return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        setZoom((z) => Math.max(0.15, Math.min(8, Number((z * factor).toFixed(3)))));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [kind]);

  const stepSibling = (dir: -1 | 1) => {
    if (siblings.length <= 1 || currentIdx === -1) return;
    const nextIdx = (currentIdx + dir + siblings.length) % siblings.length;
    setActivePath(siblings[nextIdx].path);
  };

  const handleSaveText = async () => {
    if (!node) return;
    setSaving(true);
    try {
      await vfsApi.writeText(node.path, draftContent);
      setTextContent(draftContent);
      setEditing(false);
      onVfsSaved();
      onNotify?.('Kaydedildi', `${node.name} güncellendi.`, 'success');
    } catch (e) {
      onNotify?.('Kaydedilemedi', (e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    if (!node) return;
    const a = document.createElement('a');
    a.href = buildRawFileUrl(node.path, '&download=1');
    a.download = node.name;
    a.click();
  };

  const handleCopyText = () => {
    navigator.clipboard?.writeText(editing ? draftContent : textContent).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!node) {
    return (
      <div
        data-testid="preview-window"
        className="flex-1 flex flex-col items-center justify-center bg-[var(--os-surface)] text-[var(--os-text-muted)] text-xs gap-2 p-8"
      >
        <FileText className="w-8 h-8 opacity-40" />
        <span>Dosya bulunamadı veya taşınmış olabilir.</span>
      </div>
    );
  }

  return (
    <div
      data-testid="preview-window"
      data-preview-kind={kind}
      className="flex-1 min-h-0 flex flex-col bg-[var(--os-surface)] text-[var(--os-text)] select-none"
    >
      {/* Minimalist macOS Preview Toolbar */}
      <div className="h-11 px-3 border-b border-[var(--os-border)] bg-[var(--os-sidebar)] flex items-center justify-between gap-2 shrink-0">
        {/* Left: Sibling Navigation + File Meta */}
        <div className="flex items-center gap-1.5 min-w-0">
          {siblings.length > 1 && (
            <div className="flex items-center rounded-lg bg-[var(--os-bg)] border border-[var(--os-border)] p-0.5 mr-1">
              <button
                onClick={() => stepSibling(-1)}
                title="Önceki Dosya"
                className="p-1 rounded-md hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)]"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-1.5 text-[10px] font-mono text-[var(--os-text-subtle)]">
                {currentIdx + 1}/{siblings.length}
              </span>
              <button
                onClick={() => stepSibling(1)}
                title="Sonraki Dosya"
                className="p-1 rounded-md hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)]"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <span className="text-xs font-medium truncate">{node.name}</span>
          <span className="text-[10px] font-mono text-[var(--os-text-subtle)] shrink-0">
            {formatBytes(node.size)}
            {naturalDims ? ` • ${naturalDims.w}×${naturalDims.h}` : ''}
          </span>
        </div>

        {/* Right: Context-Aware Controls */}
        <div className="flex items-center gap-1 shrink-0">
          {kind === 'image' && (
            <>
              <button
                onClick={() => setZoom((z) => Math.max(0.15, Number((z / 1.25).toFixed(2))))}
                title="Uzaklaştır"
                className="p-1.5 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)]"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setZoom(1)}
                title="Sığdır"
                className="px-2 py-1 rounded-lg bg-[var(--os-bg)] border border-[var(--os-border)] text-[10px] font-mono text-[var(--os-text-secondary)] hover:text-[var(--os-text)]"
              >
                %{Math.round(zoom * 100)}
              </button>
              <button
                onClick={() => setZoom((z) => Math.min(8, Number((z * 1.25).toFixed(2))))}
                title="Yakınlaştır"
                className="p-1.5 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)]"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setRotation((r) => (r + 90) % 360)}
                title="90° Döndür"
                className="p-1.5 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)]"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setCheckerboard((c) => !c)}
                title="Arka Plan Izgarası"
                className={`p-1.5 rounded-lg transition-colors ${
                  checkerboard
                    ? 'bg-[var(--os-surface-3)] text-[var(--os-text)]'
                    : 'hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)]'
                }`}
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              {onSetWallpaper && (
                <button
                  onClick={() => onSetWallpaper(node)}
                  title="Masaüstü Arka Planı Yap"
                  className="px-2.5 py-1.5 rounded-lg bg-[var(--os-bg)] hover:bg-[var(--os-surface-3)] border border-[var(--os-border)] text-[11px] font-medium flex items-center gap-1.5"
                >
                  <Wallpaper className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Arka Plan Yap</span>
                </button>
              )}
            </>
          )}

          {kind === 'html' && (
            <button
              onClick={() => {
                setEditing(false);
                setHtmlRenderMode((v) => !v);
              }}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--os-bg)] hover:bg-[var(--os-surface-3)] border border-[var(--os-border)] text-[11px] font-medium flex items-center gap-1.5"
            >
              {htmlRenderMode ? <FileCode2 className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{htmlRenderMode ? 'Kaynak Kodu' : 'Canlı Önizleme'}</span>
            </button>
          )}

          {(kind === 'text' || (kind === 'html' && !htmlRenderMode)) && (
            <>
              <button
                onClick={handleCopyText}
                title="Kopyala"
                className="p-1.5 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)]"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              {editing ? (
                <button
                  onClick={handleSaveText}
                  disabled={saving}
                  data-testid="preview-save-btn"
                  className="px-2.5 py-1.5 rounded-lg bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'Kaydediliyor...' : 'Kaydet'}</span>
                </button>
              ) : (
                <button
                  onClick={() => setEditing(true)}
                  data-testid="preview-edit-btn"
                  className="px-2.5 py-1.5 rounded-lg bg-[var(--os-bg)] hover:bg-[var(--os-surface-3)] border border-[var(--os-border)] text-[11px] font-medium flex items-center gap-1.5"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Düzenle</span>
                </button>
              )}
            </>
          )}

          <button
            onClick={handleDownload}
            title="Cihaza İndir"
            className="p-1.5 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-secondary)]"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Preview Body */}
      {kind === 'image' && (
        <div
          ref={imageStageRef}
          className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-6"
          style={
            checkerboard
              ? {
                  backgroundImage:
                    'linear-gradient(45deg, rgba(128,128,128,0.09) 25%, transparent 25%), linear-gradient(-45deg, rgba(128,128,128,0.09) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.09) 75%), linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.09) 75%)',
                  backgroundSize: '20px 20px',
                  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                }
              : undefined
          }
        >
          <img
            src={rawUrl}
            alt={node.name}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setNaturalDims({ w: img.naturalWidth, h: img.naturalHeight });
              }
            }}
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
              transition: 'transform 140ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
            className="max-w-full max-h-full object-contain rounded-lg shadow-lg select-none"
            draggable={false}
          />
        </div>
      )}

      {kind === 'pdf' && (
        <iframe
          src={rawUrl}
          title={node.name}
          className="flex-1 w-full h-full border-0 bg-white"
        />
      )}

      {kind === 'html' && htmlRenderMode && (
        <iframe
          src={rawUrl}
          title={node.name}
          sandbox="allow-scripts allow-same-origin"
          className="flex-1 w-full h-full border-0 bg-white"
        />
      )}

      {kind === 'video' && (
        <div className="flex-1 min-h-0 flex items-center justify-center bg-black p-4">
          <video
            src={rawUrl}
            controls
            autoPlay
            className="max-w-full max-h-full rounded-lg outline-none"
          />
        </div>
      )}

      {kind === 'audio' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 bg-[var(--os-bg)]">
          <div className="w-24 h-24 rounded-3xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] flex items-center justify-center shadow-lg">
            <Music className="w-10 h-10 text-[var(--os-text-secondary)]" />
          </div>
          <div className="text-center space-y-1">
            <div className="text-sm font-semibold">{node.name}</div>
            <div className="text-xs text-[var(--os-text-muted)]">
              {getFileTypeLabel(node)} • {formatBytes(node.size)}
            </div>
          </div>
          <audio src={rawUrl} controls autoPlay className="w-full max-w-md" />
        </div>
      )}

      {(kind === 'text' || (kind === 'html' && !htmlRenderMode)) && (
        <div className="flex-1 min-h-0 flex flex-col bg-[var(--os-bg)] select-text">
          {loadingText ? (
            <div className="flex-1 flex items-center justify-center text-xs text-[var(--os-text-subtle)]">
              Yükleniyor...
            </div>
          ) : editing ? (
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              spellCheck={false}
              className="flex-1 w-full p-4 bg-transparent font-mono text-xs leading-relaxed text-[var(--os-text)] focus:outline-none resize-none"
            />
          ) : (
            <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
              {textContent ? (
                <table className="w-full border-collapse">
                  <tbody>
                    {textContent.split('\n').map((line, i) => (
                      <tr key={i} className="hover:bg-[var(--os-hover)]/40">
                        <td className="pr-4 text-right select-none text-[var(--os-text-subtle)] opacity-55 align-top w-10">
                          {i + 1}
                        </td>
                        <td className="whitespace-pre-wrap break-words text-[var(--os-text)]">
                          {line || '\u00A0'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-[var(--os-text-subtle)] italic">Boş dosya</div>
              )}
            </div>
          )}
        </div>
      )}

      {kind === 'binary' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 bg-[var(--os-bg)] text-center">
          <div className="w-16 h-16 rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] flex items-center justify-center">
            {node.extension === 'mp4' ? (
              <Film className="w-7 h-7 text-[var(--os-text-muted)]" />
            ) : (
              <ImageIcon className="w-7 h-7 text-[var(--os-text-muted)]" />
            )}
          </div>
          <div className="space-y-1">
            <div className="text-sm font-semibold">{node.name}</div>
            <div className="text-xs text-[var(--os-text-muted)]">
              {getFileTypeLabel(node)} • {formatBytes(node.size)}
            </div>
          </div>
          <button
            onClick={handleDownload}
            className="px-4 py-2 rounded-xl bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] text-xs font-semibold flex items-center gap-2"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Dosyayı İndir</span>
          </button>
        </div>
      )}
    </div>
  );
};
