import React, { useEffect, useState } from 'react';
import { Check, FolderOpen, X } from 'lucide-react';
import type { VFSNode } from '../../types/os';
import { FileIcon } from '../icons/FileIcon';
import {
  formatBytes,
  formatDateTimeTR,
  getFileTypeLabel,
  translateFolderDisplayName,
} from '../../utils/format';

interface NewCustomFileModalProps {
  parentPath: string;
  onClose: () => void;
  onCreate: (fileName: string) => void;
}

const PRESET_EXTENSIONS = [
  { ext: 'txt', label: 'Metin' },
  { ext: 'html', label: 'HTML' },
  { ext: 'py', label: 'Python' },
  { ext: 'tsx', label: 'TSX' },
  { ext: 'json', label: 'JSON' },
  { ext: 'csv', label: 'CSV' },
  { ext: 'sql', label: 'SQL' },
  { ext: 'md', label: 'Markdown' },
  { ext: 'pdf', label: 'PDF' },
  { ext: 'zip', label: 'ZIP' },
  { ext: 'mp3', label: 'MP3' },
  { ext: 'mp4', label: 'MP4' },
  { ext: 'exe', label: 'EXE' },
  { ext: 'iso', label: 'ISO' },
  { ext: 'env', label: '.env' },
  { ext: 'sh', label: 'Shell' },
];

export const NewCustomFileModal: React.FC<NewCustomFileModalProps> = ({
  parentPath,
  onClose,
  onCreate,
}) => {
  const [fileName, setFileName] = useState('yeni-dosya.txt');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const clean = fileName.trim() || 'adsiz.txt';
  const lower = clean.toLowerCase();
  const ext = lower.endsWith('.tar.gz')
    ? 'tar.gz'
    : lower.startsWith('.') && !lower.slice(1).includes('.')
    ? lower.slice(1)
    : lower.includes('.')
    ? lower.slice(lower.lastIndexOf('.') + 1)
    : '';

  const previewNode: VFSNode = {
    name: clean,
    path: '',
    parentPath,
    isDir: false,
    extension: ext,
    size: 0,
    childCount: 0,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };

  return (
    <div
      className="fixed inset-0 z-[9990] bg-black/45 flex items-center justify-center p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (clean) onCreate(clean);
        }}
        style={{ boxShadow: 'var(--os-shadow)' }}
        className="w-full max-w-md rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] overflow-hidden text-[var(--os-text)]"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--os-border)]">
          <span className="text-xs font-semibold">Yeni Dosya</span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[var(--os-hover)] text-[var(--os-text-muted)] hover:text-[var(--os-text)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-4 p-3.5 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)]">
            <div className="w-14 h-14 rounded-xl bg-[var(--os-surface-2)] flex items-center justify-center shrink-0">
              <FileIcon node={previewNode} size={46} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-[var(--os-text)] truncate">{clean}</div>
              <div className="text-xs text-[var(--os-text-muted)] mt-0.5">
                {getFileTypeLabel(previewNode)}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-[var(--os-text-muted)] mb-1.5">
              Dosya Adı ve Uzantısı
            </label>
            <input
              type="text"
              autoFocus
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="ornek: analiz.py, rapor.pdf, paket.zip..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border-strong)] focus:border-[var(--os-text-muted)] focus:outline-none text-sm text-[var(--os-text)] font-mono"
            />
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {PRESET_EXTENSIONS.map((p) => (
              <button
                type="button"
                key={p.ext}
                onClick={() => {
                  const stem = clean.includes('.')
                    ? clean.slice(0, clean.lastIndexOf('.')) || 'dosya'
                    : clean || 'dosya';
                  setFileName(p.ext === 'env' ? '.env' : `${stem}.${p.ext}`);
                }}
                className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors flex items-center justify-between border ${
                  ext === p.ext
                    ? 'bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] border-transparent font-semibold'
                    : 'bg-[var(--os-bg)] border-[var(--os-border)] text-[var(--os-text-secondary)] hover:bg-[var(--os-surface-3)]'
                }`}
              >
                <span className="truncate">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--os-border)] bg-[var(--os-sidebar)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-[var(--os-text-muted)] hover:bg-[var(--os-hover)]"
          >
            Vazgeç
          </button>
          <button
            type="submit"
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] hover:opacity-90 flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Oluştur</span>
          </button>
        </div>
      </form>
    </div>
  );
};

interface PropertiesPaneProps {
  node: VFSNode | undefined;
  onOpenNode: (node: VFSNode) => void;
  onClose: () => void;
}

export const PropertiesPane: React.FC<PropertiesPaneProps> = ({ node, onOpenNode, onClose }) => {
  if (!node) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-[var(--os-text-muted)] p-6">
        Öğe bulunamadı.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col justify-between p-5 bg-[var(--os-surface)] text-[var(--os-text)] select-text">
      <div className="space-y-4">
        <div className="flex items-center gap-4 pb-4 border-b border-[var(--os-border)]">
          <div className="w-16 h-16 rounded-2xl bg-[var(--os-bg)] border border-[var(--os-border)] flex items-center justify-center shrink-0">
            <FileIcon node={node} size={48} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold break-all">
              {translateFolderDisplayName(node.path, node.name)}
            </div>
            <div className="text-xs text-[var(--os-text-muted)] mt-0.5">
              {getFileTypeLabel(node)}
            </div>
          </div>
        </div>

        <div className="space-y-2.5 text-xs">
          <div className="flex justify-between gap-3">
            <span className="text-[var(--os-text-subtle)]">Konum</span>
            <span className="font-mono text-right break-all">{node.path}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[var(--os-text-subtle)]">Uzantı</span>
            <span className="font-mono">
              {node.isDir ? 'Klasör' : node.extension ? `.${node.extension}` : 'Yok'}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[var(--os-text-subtle)]">Boyut</span>
            <span>{formatBytes(node.size)}</span>
          </div>
          {node.isDir && (
            <div className="flex justify-between gap-3">
              <span className="text-[var(--os-text-subtle)]">Öğe Sayısı</span>
              <span>{node.childCount} öğe</span>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <span className="text-[var(--os-text-subtle)]">Oluşturulma</span>
            <span>{formatDateTimeTR(node.createdAt)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[var(--os-text-subtle)]">Değiştirilme</span>
            <span>{formatDateTimeTR(node.modifiedAt)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--os-border)]">
        <button
          onClick={() => {
            onOpenNode(node);
            onClose();
          }}
          className="px-3.5 py-2 rounded-xl bg-[var(--os-surface-3)] hover:bg-[var(--os-surface-4)] text-xs font-medium text-[var(--os-text)] flex items-center gap-1.5"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span>Aç</span>
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-xl bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] hover:opacity-90 text-xs font-semibold"
        >
          Tamam
        </button>
      </div>
    </div>
  );
};
