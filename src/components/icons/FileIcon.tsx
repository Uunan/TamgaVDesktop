import React, { useState } from 'react';
import type { VFSNode } from '../../types/os';
import { buildAppIconUrl, buildRawFileUrl } from '../../services/osBridge';

export function ChromiumLogoIcon({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-sm">
      <defs>
        <linearGradient id="cr-top" x1="12" y1="6" x2="54" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563EB" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
        <linearGradient id="cr-right" x1="34" y1="24" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60A5FA" />
          <stop offset="1" stopColor="#3B82F6" />
        </linearGradient>
        <linearGradient id="cr-left" x1="6" y1="18" x2="32" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#93C5FD" />
          <stop offset="1" stopColor="#38BDF8" />
        </linearGradient>
        <radialGradient id="cr-core" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(32 32) scale(13)">
          <stop stopColor="#38BDF8" />
          <stop offset="1" stopColor="#1D4ED8" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="28" fill="url(#cr-left)" />
      <path d="M32 4C44.2 4 54.6 11.8 58.4 22.7H32C25.5 22.7 20 26.8 18 32.6L9.5 17.9C14.5 9.5 22.7 4 32 4Z" fill="url(#cr-top)" />
      <path d="M58.4 22.7C59.4 25.6 60 28.7 60 32C60 47.5 47.5 60 32 60L29.5 59.8L41.8 38.5C43.2 36.6 44 34.4 44 32C44 27.6 41.6 23.8 38 21.8L58.4 22.7Z" fill="url(#cr-right)" />
      <circle cx="32" cy="32" r="13.5" fill="#F8FAFC" />
      <circle cx="32" cy="32" r="10.2" fill="url(#cr-core)" />
      <circle cx="29" cy="29" r="3" fill="white" fillOpacity="0.45" />
    </svg>
  );
}

export function GoogleChromeLogoIcon({ size = 48 }: { size?: number }) {
  return (
    <img
      src="/app-icons/chrome.svg"
      alt="Google Chrome"
      style={{ width: size, height: size }}
      className="object-contain shrink-0 drop-shadow-sm select-none"
      draggable={false}
    />
  );
}

export function ComputeSystemIcon({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-sm">
      <rect x="7" y="10" width="50" height="35" rx="7" fill="#1C1C1E" stroke="#D4D4D8" strokeWidth="2" />
      <rect x="11" y="14" width="42" height="27" rx="4" fill="#2C2C2E" />
      <rect x="16" y="20" width="14" height="10" rx="2" fill="#E4E4E7" fillOpacity="0.9" />
      <rect x="34" y="20" width="14" height="4" rx="1.5" fill="#71717A" />
      <rect x="34" y="26" width="10" height="4" rx="1.5" fill="#52525B" />
      <path d="M26 45L23 53H41L38 45" fill="#A1A1AA" />
      <rect x="19" y="52.5" width="26" height="3.5" rx="1.75" fill="#D4D4D8" />
    </svg>
  );
}

export function RecycleBinIcon({ size = 48, hasItems = false }: { size?: number; hasItems?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-sm">
      {hasItems && (
        <g>
          <rect x="19" y="9" width="13" height="14" rx="2" transform="rotate(-14 19 9)" fill="#F4F4F5" stroke="#A1A1AA" />
          <rect x="31" y="7" width="13" height="14" rx="2" transform="rotate(12 31 7)" fill="#D4D4D8" />
          <rect x="24" y="10" width="14" height="12" rx="2" transform="rotate(3 24 10)" fill="#E4E4E7" />
        </g>
      )}
      <path d="M15 17H49L45.8 54.5C45.6 56.6 43.8 58.2 41.7 58.2H22.3C20.2 58.2 18.4 56.6 18.2 54.5L15 17Z" fill="#27272A" stroke="#A1A1AA" strokeWidth="1.8" />
      <rect x="12" y="13" width="40" height="4.5" rx="2.25" fill="#52525B" stroke="#D4D4D8" strokeWidth="1" />
      <path d="M25 26V48M32 26V48M39 26V48" stroke="#A1A1AA" strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function hashExtensionHue(ext: string): number {
  let hash = 0;
  for (let i = 0; i < ext.length; i++) {
    hash = ext.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

interface FileIconProps {
  node: Pick<VFSNode, 'name' | 'path' | 'isDir' | 'extension' | 'size' | 'childCount' | 'modifiedAt'>;
  size?: number;
}

export const FileIcon: React.FC<FileIconProps> = ({ node, size = 48 }) => {
  const [imgError, setImgError] = useState(false);
  const rawUid = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');

  if (node.path === '/.trash') {
    return <RecycleBinIcon size={size} hasItems={node.childCount > 0} />;
  }

  // 1. FOLDERS (with populated inner document sheets & special folder emblems!)
  if (node.isDir) {
    const hasFiles = (node.childCount || 0) > 0;
    const isDownloads = node.path === '/Downloads';
    const isDocuments = node.path === '/Documents';
    const isProjects = node.path === '/Projects' || node.name.toLowerCase().includes('proje');

    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-md">
        <defs>
          <linearGradient id={`fld-back-${rawUid}`} x1="6" y1="10" x2="58" y2="52" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0284C7" />
            <stop offset="1" stopColor="#1D4ED8" />
          </linearGradient>
          <linearGradient id={`fld-front-${rawUid}`} x1="6" y1="22" x2="58" y2="56" gradientUnits="userSpaceOnUse">
            <stop stopColor="#38BDF8" />
            <stop offset="1" stopColor="#2563EB" />
          </linearGradient>
        </defs>
        {/* Back folder tab */}
        <path
          d="M6 16C6 13.2 8.2 11 11 11H24.5C26.1 11 27.6 11.8 28.5 13.1L31.2 17H53C55.8 17 58 19.2 58 22V50C58 52.8 55.8 55 53 55H11C8.2 55 6 52.8 6 50V16Z"
          fill={`url(#fld-back-${rawUid})`}
        />
        {/* Populated files peeking out */}
        {hasFiles && (
          <g>
            <rect x="13" y="16" width="34" height="16" rx="2.5" fill="#E2E8F0" transform="rotate(-2 13 16)" />
            <rect x="17" y="18" width="34" height="16" rx="2.5" fill="#FFFFFF" />
            <line x1="22" y1="22" x2="43" y2="22" stroke="#94A3B8" strokeWidth="1.8" strokeLinecap="round" />
          </g>
        )}
        {/* Front pocket */}
        <rect
          x="6"
          y="23"
          width="52"
          height="32"
          rx="6"
          fill={`url(#fld-front-${rawUid})`}
          stroke="#7DD3FC"
          strokeOpacity="0.45"
          strokeWidth="1.2"
        />
        {/* Folder emblem */}
        {isDownloads && (
          <path d="M32 31V44M32 44L27 39M32 44L37 39M25 47H39" stroke="white" strokeOpacity="0.88" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {isDocuments && (
          <path d="M24 33H40M24 39H40M24 45H33" stroke="white" strokeOpacity="0.85" strokeWidth="2.4" strokeLinecap="round" />
        )}
        {isProjects && !isDownloads && !isDocuments && (
          <path d="M27 34L22 39L27 44M37 34L42 39L37 44M34 32L30 46" stroke="white" strokeOpacity="0.88" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    );
  }

  const ext = (node.extension || '').toLowerCase();

  // 2. IMAGES (.png, .jpg, .jpeg, .gif, .webp, .svg, .ico, .bmp) — Live Thumbnail Frame!
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) {
    const canPreview = node.size > 0 && Boolean(node.path) && !imgError;
    const badgeColor = ext === 'svg' ? '#F59E0B' : ext === 'png' ? '#06B6D4' : ext === 'gif' ? '#EC4899' : '#10B981';

    return (
      <div style={{ width: size, height: size }} className="relative flex items-center justify-center drop-shadow-md">
        <div className="w-[88%] h-[84%] rounded-lg bg-slate-900 border-2 border-slate-200/90 overflow-hidden shadow-inner flex items-center justify-center relative">
          {canPreview ? (
            <img
              src={buildRawFileUrl(node.path, `&t=${encodeURIComponent(node.modifiedAt || '')}`)}
              alt={node.name}
              onError={() => setImgError(true)}
              className="w-full h-full object-cover"
              draggable={false}
            />
          ) : (
            <svg viewBox="0 0 64 56" className="w-full h-full" fill="none">
              <rect width="64" height="56" fill="#0F172A" />
              <circle cx="46" cy="16" r="6" fill="#FBBF24" />
              <path d="M4 48L22 26L35 40L45 30L60 48H4Z" fill="#0284C7" />
              <path d="M4 48L22 26L32 37L18 48H4Z" fill="#38BDF8" />
            </svg>
          )}
        </div>
        <span
          style={{ backgroundColor: badgeColor }}
          className="absolute -bottom-0.5 right-0.5 px-1.5 py-[1px] rounded text-[9px] font-bold tracking-wider text-white shadow"
        >
          {ext.toUpperCase()}
        </span>
      </div>
    );
  }

  // 3. ARCHIVES (.zip, .rar, .7z, .tar, .gz, .tar.gz) — Parcel Box with Metallic Zipper!
  if (['zip', 'rar', '7z', 'tar', 'gz', 'tar.gz', 'bz2'].includes(ext)) {
    const boxTop = ext === 'rar' ? '#9333EA' : ext === '7z' ? '#0D9488' : '#D97706';
    const boxBot = ext === 'rar' ? '#6B21A8' : ext === '7z' ? '#115E59' : '#92400E';
    const label = ext === 'tar.gz' ? 'TGZ' : ext.toUpperCase();

    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-md">
        <rect x="10" y="8" width="44" height="48" rx="7" fill={boxTop} />
        <path d="M10 26H54V49C54 52.9 50.9 56 47 56H17C13.1 56 10 52.9 10 49V26Z" fill={boxBot} />
        {/* Compression belt */}
        <rect x="10" y="24" width="44" height="4" fill="#FDE68A" fillOpacity="0.35" />
        {/* Metallic Zipper Track */}
        <rect x="28" y="8" width="8" height="32" fill="#1E293B" fillOpacity="0.45" />
        <path d="M29 11H32M32 14H35M29 17H32M32 20H35M29 23H32M32 26H35M29 29H32" stroke="#F8FAFC" strokeWidth="2" strokeLinecap="round" />
        {/* Zipper Pull */}
        <rect x="28.5" y="31" width="7" height="10" rx="2" fill="#F8FAFC" />
        <circle cx="32" cy="37.5" r="1.5" fill="#334155" />
        {/* Badge */}
        <rect x="16" y="44" width="32" height="9" rx="2.5" fill="#0F172A" fillOpacity="0.65" />
        <text x="32" y="50.8" fill="#FEF3C7" fontSize="7.5" fontWeight="800" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
          {label}
        </text>
      </svg>
    );
  }

  // 4. OPTICAL DISC (.iso, .img)
  if (['iso', 'img'].includes(ext)) {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-md">
        <circle cx="32" cy="32" r="25" fill="#1E293B" stroke="#94A3B8" strokeWidth="2" />
        <path d="M32 7A25 25 0 0 1 57 32H32V7Z" fill="#38BDF8" fillOpacity="0.35" />
        <path d="M32 57A25 25 0 0 1 7 32H32V57Z" fill="#A855F7" fillOpacity="0.35" />
        <circle cx="32" cy="32" r="9" fill="#0F172A" stroke="#CBD5E1" strokeWidth="2" />
        <circle cx="32" cy="32" r="3.5" fill="#94A3B8" />
        <rect x="20" y="46" width="24" height="10" rx="3" fill="#0EA5E9" />
        <text x="32" y="53.3" fill="white" fontSize="7.5" fontWeight="800" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
          {ext.toUpperCase()}
        </text>
      </svg>
    );
  }

  // 5. EXECUTABLE / PACKAGE (.exe, .app, .dmg, .msi, .deb, .apk, .bin)
  if (['exe', 'app', 'dmg', 'msi', 'deb', 'apk', 'bin'].includes(ext)) {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-md">
        <rect x="8" y="10" width="48" height="44" rx="8" fill="#0F172A" stroke="#475569" strokeWidth="2" />
        <rect x="8" y="10" width="48" height="11" rx="6" fill="#1E293B" />
        <circle cx="15" cy="15.5" r="2" fill="#F43F5E" />
        <circle cx="21" cy="15.5" r="2" fill="#FBBF24" />
        <circle cx="27" cy="15.5" r="2" fill="#10B981" />
        <rect x="23" y="26" width="18" height="16" rx="4" fill="#0284C7" fillOpacity="0.25" stroke="#38BDF8" strokeWidth="1.8" />
        <path d="M29 31L35 34L29 37V31Z" fill="#38BDF8" />
        <rect x="18" y="45" width="28" height="9" rx="2.5" fill="#3B82F6" />
        <text x="32" y="51.8" fill="white" fontSize="7.5" fontWeight="800" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
          {ext.toUpperCase()}
        </text>
      </svg>
    );
  }

  // 6. AUDIO (.mp3, .wav, .ogg, .flac, .m4a)
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(ext)) {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-md">
        <defs>
          <linearGradient id="aud-grad" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
            <stop stopColor="#EC4899" />
            <stop offset="1" stopColor="#7C3AED" />
          </linearGradient>
        </defs>
        <rect x="10" y="8" width="44" height="48" rx="9" fill="url(#aud-grad)" />
        {/* Equalizer bars */}
        <rect x="19" y="26" width="3.5" height="12" rx="1.75" fill="white" />
        <rect x="25" y="18" width="3.5" height="22" rx="1.75" fill="white" />
        <rect x="31" y="22" width="3.5" height="16" rx="1.75" fill="white" />
        <rect x="37" y="15" width="3.5" height="25" rx="1.75" fill="white" />
        <rect x="43" y="24" width="3.5" height="13" rx="1.75" fill="white" />
        <rect x="17" y="44" width="30" height="8.5" rx="2.5" fill="#0F172A" fillOpacity="0.55" />
        <text x="32" y="50.3" fill="white" fontSize="7.2" fontWeight="800" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
          {ext.toUpperCase()}
        </text>
      </svg>
    );
  }

  // 7. VIDEO (.mp4, .webm, .mov, .mkv, .avi) — Film Strip Card!
  if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-md">
        <rect x="9" y="8" width="46" height="48" rx="7" fill="#0F172A" stroke="#6366F1" strokeWidth="1.8" />
        {/* Film perforations left & right */}
        {[14, 22, 30, 38, 46].map((y) => (
          <React.Fragment key={y}>
            <rect x="12" y={y} width="3.5" height="4.5" rx="1" fill="#818CF8" fillOpacity="0.65" />
            <rect x="48.5" y={y} width="3.5" height="4.5" rx="1" fill="#818CF8" fillOpacity="0.65" />
          </React.Fragment>
        ))}
        <circle cx="32" cy="27" r="10" fill="#4F46E5" />
        <path d="M29.5 22.5L37.5 27L29.5 31.5V22.5Z" fill="white" />
        <rect x="19" y="42" width="26" height="9" rx="2.5" fill="#6366F1" />
        <text x="32" y="48.6" fill="white" fontSize="7.2" fontWeight="800" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
          {ext.toUpperCase()}
        </text>
      </svg>
    );
  }

  // 8. SPREADSHEET / TABULAR (.csv, .xlsx, .xls, .tsv)
  if (['csv', 'xlsx', 'xls', 'tsv'].includes(ext)) {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-md">
        <path d="M12 10C12 7.8 13.8 6 16 6H40L52 18V54C52 56.2 50.2 58 48 58H16C13.8 58 12 56.2 12 54V10Z" fill="#ECFDF5" />
        <path d="M40 6V15C40 16.7 41.3 18 43 18H52L40 6Z" fill="#6EE7B7" />
        {/* Spreadsheet Grid */}
        <rect x="18" y="21" width="28" height="20" rx="2" fill="white" stroke="#10B981" strokeWidth="1.6" />
        <rect x="18" y="21" width="28" height="5.5" fill="#10B981" />
        <line x1="27" y1="21" x2="27" y2="41" stroke="#10B981" strokeWidth="1.2" />
        <line x1="37" y1="21" x2="37" y2="41" stroke="#10B981" strokeWidth="1.2" />
        <line x1="18" y1="31" x2="46" y2="31" stroke="#10B981" strokeWidth="1.2" />
        <line x1="18" y1="36" x2="46" y2="36" stroke="#10B981" strokeWidth="1.2" />
        <rect x="16" y="45" width="32" height="9" rx="2.5" fill="#059669" />
        <text x="32" y="51.7" fill="white" fontSize="7.5" fontWeight="800" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
          {ext.toUpperCase()}
        </text>
      </svg>
    );
  }

  // 9. DATABASE (.sql, .db, .sqlite)
  if (['sql', 'db', 'sqlite', 'sqlite3'].includes(ext)) {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-md">
        <rect x="11" y="6" width="42" height="52" rx="7" fill="#0F172A" stroke="#6366F1" strokeWidth="1.8" />
        {/* Cylinder Stack */}
        <ellipse cx="32" cy="17" rx="13" ry="4.5" fill="#818CF8" />
        <path d="M19 17V25C19 27.5 24.8 29.5 32 29.5C39.2 29.5 45 27.5 45 25V17" stroke="#818CF8" strokeWidth="2" />
        <path d="M19 25V33C19 35.5 24.8 37.5 32 37.5C39.2 37.5 45 35.5 45 33V25" stroke="#38BDF8" strokeWidth="2" />
        <rect x="17" y="44" width="30" height="9" rx="2.5" fill="#4F46E5" />
        <text x="32" y="50.7" fill="white" fontSize="7.5" fontWeight="800" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
          {ext.toUpperCase()}
        </text>
      </svg>
    );
  }

  // 10. PDF & OFFICE DOCUMENTS (.pdf, .doc, .docx, .ppt, .pptx)
  if (ext === 'pdf') {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-md">
        <path d="M12 10C12 7.8 13.8 6 16 6H40L52 18V54C52 56.2 50.2 58 48 58H16C13.8 58 12 56.2 12 54V10Z" fill="#FFF1F2" />
        <path d="M40 6V15C40 16.7 41.3 18 43 18H52L40 6Z" fill="#FDA4AF" />
        <path d="M22 36C27 25 32 19 34 23C36 27 25 37 39 34C44 33 41 28 33 30C25 32 20 39 22 36Z" stroke="#E11D48" strokeWidth="2.2" strokeLinecap="round" />
        <rect x="15" y="44" width="34" height="9.5" rx="2.5" fill="#E11D48" />
        <text x="32" y="51" fill="white" fontSize="8" fontWeight="800" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
          PDF
        </text>
      </svg>
    );
  }

  if (['doc', 'docx', 'rtf'].includes(ext)) {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-md">
        <path d="M12 10C12 7.8 13.8 6 16 6H40L52 18V54C52 56.2 50.2 58 48 58H16C13.8 58 12 56.2 12 54V10Z" fill="#EFF6FF" />
        <path d="M40 6V15C40 16.7 41.3 18 43 18H52L40 6Z" fill="#93C5FD" />
        <path d="M19 23H45M19 29H45M19 35H38" stroke="#2563EB" strokeWidth="2.4" strokeLinecap="round" />
        <rect x="15" y="44" width="34" height="9.5" rx="2.5" fill="#1D4ED8" />
        <text x="32" y="51" fill="white" fontSize="7.5" fontWeight="800" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
          {ext.toUpperCase()}
        </text>
      </svg>
    );
  }

  if (['ppt', 'pptx'].includes(ext)) {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-md">
        <path d="M12 10C12 7.8 13.8 6 16 6H40L52 18V54C52 56.2 50.2 58 48 58H16C13.8 58 12 56.2 12 54V10Z" fill="#FFF7ED" />
        <path d="M40 6V15C40 16.7 41.3 18 43 18H52L40 6Z" fill="#FDBA74" />
        <circle cx="27" cy="30" r="7" fill="#FB923C" />
        <path d="M27 23A7 7 0 0 1 34 30H27V23Z" fill="#EA580C" />
        <rect x="38" y="25" width="7" height="12" rx="1" fill="#EA580C" />
        <rect x="15" y="44" width="34" height="9.5" rx="2.5" fill="#EA580C" />
        <text x="32" y="51" fill="white" fontSize="7.5" fontWeight="800" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
          {ext.toUpperCase()}
        </text>
      </svg>
    );
  }

  // 11. PLAIN TEXT & LOG (.txt, .log)
  if (ext === 'txt' || ext === '') {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-md">
        <path d="M12 10C12 7.8 13.8 6 16 6H40L52 18V54C52 56.2 50.2 58 48 58H16C13.8 58 12 56.2 12 54V10Z" fill="#F8FAFC" />
        <path d="M40 6V15C40 16.7 41.3 18 43 18H52L40 6Z" fill="#CBD5E1" />
        {/* Margin rule & notepad lines */}
        <line x1="19" y1="12" x2="19" y2="54" stroke="#F87171" strokeOpacity="0.55" strokeWidth="1.2" />
        <path d="M23 22H45M23 28H45M23 34H42M23 40H36" stroke="#64748B" strokeWidth="2" strokeLinecap="round" />
        {ext === 'txt' && (
          <>
            <rect x="20" y="45" width="24" height="8.5" rx="2" fill="#475569" />
            <text x="32" y="51.2" fill="white" fontSize="7.2" fontWeight="800" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
              TXT
            </text>
          </>
        )}
      </svg>
    );
  }

  // 12. CODE, WEB, CONFIG & MARKDOWN SHEETS (Unique dark studio cards per language!)
  const codeThemeMap: Record<
    string,
    { accent: string; fold: string; symbol: string; badge: string; bg?: string }
  > = {
    html: { accent: '#F97316', fold: '#EA580C', symbol: '</>', badge: 'HTML' },
    htm: { accent: '#F97316', fold: '#EA580C', symbol: '</>', badge: 'HTM' },
    css: { accent: '#0EA5E9', fold: '#0284C7', symbol: '{#}', badge: 'CSS' },
    scss: { accent: '#EC4899', fold: '#DB2777', symbol: '$:', badge: 'SCSS' },
    js: { accent: '#EAB308', fold: '#CA8A04', symbol: 'JS', badge: 'JS' },
    mjs: { accent: '#EAB308', fold: '#CA8A04', symbol: 'ES', badge: 'MJS' },
    ts: { accent: '#3B82F6', fold: '#2563EB', symbol: 'TS', badge: 'TS' },
    tsx: { accent: '#06B6D4', fold: '#0891B2', symbol: '⚛', badge: 'TSX' },
    jsx: { accent: '#22D3EE', fold: '#06B6D4', symbol: '⚛', badge: 'JSX' },
    py: { accent: '#FACC15', fold: '#2563EB', symbol: 'def', badge: 'PY' },
    json: { accent: '#10B981', fold: '#059669', symbol: '{:}', badge: 'JSON' },
    md: { accent: '#94A3B8', fold: '#475569', symbol: 'M↓', badge: 'MD' },
    sh: { accent: '#22C55E', fold: '#15803D', symbol: '$_', badge: 'SH', bg: '#050811' },
    zsh: { accent: '#22C55E', fold: '#15803D', symbol: '%_', badge: 'ZSH', bg: '#050811' },
    yaml: { accent: '#A855F7', fold: '#7E22CE', symbol: '≡', badge: 'YAML' },
    yml: { accent: '#A855F7', fold: '#7E22CE', symbol: '≡', badge: 'YML' },
    toml: { accent: '#FB7185', fold: '#E11D48', symbol: '[]', badge: 'TOML' },
    env: { accent: '#F59E0B', fold: '#B45309', symbol: '🔑', badge: 'ENV' },
    xml: { accent: '#F59E0B', fold: '#D97706', symbol: '<>', badge: 'XML' },
    log: { accent: '#34D399', fold: '#047857', symbol: '•••', badge: 'LOG' },
    rs: { accent: '#FB923C', fold: '#C2410C', symbol: 'fn', badge: 'RS' },
    go: { accent: '#22D3EE', fold: '#0284C7', symbol: 'go', badge: 'GO' },
    cpp: { accent: '#60A5FA', fold: '#1D4ED8', symbol: 'C++', badge: 'CPP' },
    c: { accent: '#93C5FD', fold: '#2563EB', symbol: 'C', badge: 'C' },
    java: { accent: '#F87171', fold: '#DC2626', symbol: 'JV', badge: 'JAVA' },
    php: { accent: '#818CF8', fold: '#4F46E5', symbol: '<?', badge: 'PHP' },
    rb: { accent: '#FB7185', fold: '#BE123C', symbol: 'rb', badge: 'RB' },
  };

  if (codeThemeMap[ext]) {
    const cfg = codeThemeMap[ext];
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-md">
        <path
          d="M12 10C12 7.8 13.8 6 16 6H40L52 18V54C52 56.2 50.2 58 48 58H16C13.8 58 12 56.2 12 54V10Z"
          fill={cfg.bg || '#0F172A'}
          stroke={cfg.accent}
          strokeOpacity="0.6"
          strokeWidth="1.5"
        />
        <path d="M40 6V15C40 16.7 41.3 18 43 18H52L40 6Z" fill={cfg.fold} />
        <text
          x="32"
          y="33"
          fill={cfg.accent}
          fontSize="13.5"
          fontWeight="800"
          fontFamily="JetBrains Mono, monospace"
          textAnchor="middle"
        >
          {cfg.symbol}
        </text>
        <line x1="19" y1="39" x2="45" y2="39" stroke="#334155" strokeWidth="2" strokeLinecap="round" />
        <rect x="16" y="44" width="32" height="9.5" rx="2.5" fill={cfg.accent} />
        <text
          x="32"
          y="51"
          fill="#020617"
          fontSize="7.6"
          fontWeight="800"
          fontFamily="JetBrains Mono, monospace"
          textAnchor="middle"
        >
          {cfg.badge}
        </text>
      </svg>
    );
  }

  // 13. DYNAMIC CUSTOM EXTENSION GENERATOR (for ANY user-invented extension e.g. .compute, .ai, .paket)
  const hue = hashExtensionHue(ext);
  const accentHsl = `hsl(${hue}, 82%, 56%)`;
  const darkHsl = `hsl(${hue}, 65%, 24%)`;
  const shortBadge = ext.slice(0, 6).toUpperCase();

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-md">
      <path
        d="M12 10C12 7.8 13.8 6 16 6H40L52 18V54C52 56.2 50.2 58 48 58H16C13.8 58 12 56.2 12 54V10Z"
        fill="#1E293B"
        stroke={accentHsl}
        strokeWidth="1.6"
      />
      <path d="M40 6V15C40 16.7 41.3 18 43 18H52L40 6Z" fill={accentHsl} />
      <circle cx="32" cy="29" r="8" fill={darkHsl} stroke={accentHsl} strokeWidth="2" />
      <circle cx="32" cy="29" r="2.8" fill={accentHsl} />
      <rect x="15" y="44" width="34" height="9.5" rx="2.5" fill={accentHsl} />
      <text
        x="32"
        y="50.8"
        fill="#020617"
        fontSize="7.2"
        fontWeight="800"
        fontFamily="JetBrains Mono, monospace"
        textAnchor="middle"
      >
        .{shortBadge}
      </text>
    </svg>
  );
};

export const FirefoxLogoIcon: React.FC<{ size?: number }> = ({ size = 48 }) => (
  <img
    src="/app-icons/firefox.svg"
    alt="Mozilla Firefox"
    style={{ width: size, height: size }}
    className="object-contain shrink-0 drop-shadow-sm select-none"
    draggable={false}
  />
);

export const TerminalAppIcon: React.FC<{ size?: number }> = ({ size = 48 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-md">
    <rect x="6" y="8" width="52" height="48" rx="13" fill="#1C1C1F" stroke="#52525B" strokeWidth="1.5" />
    <path d="M18 24L28 32L18 40" stroke="#F4F4F5" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="33" y1="40" x2="46" y2="40" stroke="#A1A1AA" strokeWidth="3.6" strokeLinecap="round" />
  </svg>
);

export const AppStoreIcon: React.FC<{ size?: number }> = ({ size = 48 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-md">
    <rect x="6" y="8" width="52" height="48" rx="13" fill="#27272A" stroke="#52525B" strokeWidth="1.5" />
    <rect x="17" y="18" width="12" height="12" rx="3.5" fill="#F4F4F5" />
    <rect x="35" y="18" width="12" height="12" rx="3.5" fill="#A1A1AA" />
    <rect x="17" y="34" width="12" height="12" rx="3.5" fill="#A1A1AA" />
    <rect x="35" y="34" width="12" height="12" rx="3.5" fill="#F4F4F5" />
  </svg>
);

export const SettingsAppIcon: React.FC<{ size?: number }> = ({ size = 48 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="drop-shadow-md">
    <rect x="6" y="8" width="52" height="48" rx="13" fill="#1F1F23" stroke="#52525B" strokeWidth="1.5" />
    <line x1="18" y1="23" x2="46" y2="23" stroke="#71717A" strokeWidth="2.8" strokeLinecap="round" />
    <circle cx="28" cy="23" r="4.5" fill="#F4F4F5" />
    <line x1="18" y1="33" x2="46" y2="33" stroke="#71717A" strokeWidth="2.8" strokeLinecap="round" />
    <circle cx="38" cy="33" r="4.5" fill="#34D399" />
    <line x1="18" y1="43" x2="46" y2="43" stroke="#71717A" strokeWidth="2.8" strokeLinecap="round" />
    <circle cx="24" cy="43" r="4.5" fill="#A1A1AA" />
  </svg>
);

export const VSCodeLogoIcon: React.FC<{ size?: number }> = ({ size = 48 }) => (
  <img
    src="/app-icons/vscode.svg"
    alt="Visual Studio Code"
    style={{ width: size, height: size }}
    className="object-contain shrink-0 drop-shadow-sm select-none"
    draggable={false}
  />
);

export const AntigravityLogoIcon: React.FC<{ size?: number }> = ({ size = 48 }) => (
  <img
    src="/app-icons/antigravity.svg"
    alt="Google Antigravity"
    style={{ width: size, height: size }}
    className="object-contain shrink-0 drop-shadow-sm select-none"
    draggable={false}
  />
);

const BUNDLED_APP_ICON_MAP: Record<string, string> = {
  // Browsers
  chrome: 'chrome',
  'google-chrome': 'chrome',
  'google-chrome-stable': 'chrome',
  firefox: 'firefox',
  'firefox-esr': 'firefox',
  'org.mozilla.firefox': 'firefox',
  brave: 'brave',
  'brave-browser': 'brave',
  'com.brave.browser': 'brave',

  // AI & IDEs / Development
  antigravity: 'antigravity',
  'antigravity-cli': 'antigravity',
  'antigravity-web': 'antigravity',
  agy: 'antigravity',
  'google-antigravity': 'antigravity',
  codex: 'codex',
  'openai-codex': 'codex',
  '@openai/codex': 'codex',
  'claude-code': 'claude-code',
  claude: 'claude-code',
  '@anthropic-ai/claude-code': 'claude-code',
  cursor: 'cursor',
  'gemini-cli': 'gemini-cli',
  gemini: 'gemini-cli',
  '@google/gemini-cli': 'gemini-cli',
  vscode: 'vscode',
  'vscode-web': 'vscode',
  code: 'vscode',
  'code-tunnel': 'vscode',
  'visual-studio-code': 'vscode',
  'com.visualstudio.code': 'vscode',
  vscodium: 'vscodium',
  codium: 'vscodium',
  'com.vscodium.codium': 'vscodium',
  sublime: 'sublime',
  'sublime-text': 'sublime',
  sublime_text: 'sublime',
  subl: 'sublime',
  geany: 'geany',
  filezilla: 'filezilla',
  'org.filezilla-project.filezilla': 'filezilla',
  sqlitebrowser: 'sqlitebrowser',
  'org.sqlitebrowser.sqlitebrowser': 'sqlitebrowser',
  meld: 'meld',
  'org.gnome.meld': 'meld',

  // Design & Media
  gimp: 'gimp',
  'gimp-2.10': 'gimp',
  'gimp-3.0': 'gimp',
  'org.gimp.gimp': 'gimp',
  inkscape: 'inkscape',
  'org.inkscape.inkscape': 'inkscape',
  krita: 'krita',
  'org.kde.krita': 'krita',
  blender: 'blender',
  'org.blender.blender': 'blender',
  vlc: 'vlc',
  'org.videolan.vlc': 'vlc',
  'obs-studio': 'obs-studio',
  obs: 'obs-studio',
  'com.obsproject.studio': 'obs-studio',
  audacity: 'audacity',
  'org.audacityteam.audacity': 'audacity',
  kdenlive: 'kdenlive',
  'org.kde.kdenlive': 'kdenlive',
  shotcut: 'shotcut',
  'org.shotcut.shotcut': 'shotcut',
  handbrake: 'handbrake',
  ghb: 'handbrake',
  'fr.handbrake.ghb': 'handbrake',
  'hb-icon': 'handbrake',

  // Office & Notes
  libreoffice: 'libreoffice',
  soffice: 'libreoffice',
  'libreoffice-startcenter': 'libreoffice',
  'libreoffice-writer': 'libreoffice',
  'libreoffice-calc': 'libreoffice',
  'libreoffice-impress': 'libreoffice',
  'libreoffice-draw': 'libreoffice',
  'libreoffice-math': 'libreoffice',
  'libreoffice-base': 'libreoffice',
  obsidian: 'obsidian',
  'md.obsidian.obsidian': 'obsidian',
  thunderbird: 'thunderbird',
  'org.mozilla.thunderbird': 'thunderbird',
  mousepad: 'mousepad',
  'org.xfce.mousepad': 'mousepad',
  gedit: 'mousepad',
  'org.gnome.gedit': 'mousepad',
  leafpad: 'mousepad',
  xournalpp: 'xournalpp',
  'com.github.xournalpp.xournalpp': 'xournalpp',

  // Communication
  discord: 'discord',
  'com.discordapp.discord': 'discord',
  telegram: 'telegram',
  'telegram-desktop': 'telegram',
  'org.telegram.desktop': 'telegram',

  // System & Utilities
  keepassxc: 'keepassxc',
  'org.keepassxc.keepassxc': 'keepassxc',
  transmission: 'transmission',
  'transmission-gtk': 'transmission',
  'com.transmissionbt.transmission': 'transmission',
  remmina: 'remmina',
  'org.remmina.remmina': 'remmina',
  bleachbit: 'bleachbit',
  'org.bleachbit.bleachbit': 'bleachbit',
  flameshot: 'flameshot',
  'org.flameshot.flameshot': 'flameshot',
};

export function resolveBundledAppIconUrl(rawKey?: string | null): string | null {
  if (!rawKey) return null;
  const trimmed = rawKey.trim().toLowerCase();
  if (!trimmed) return null;
  const base = trimmed
    .replace(/^desktop-/, '')
    .replace(/\.(svg|png|xpm|ico|desktop)$/i, '');
  const canonical = BUNDLED_APP_ICON_MAP[base] || BUNDLED_APP_ICON_MAP[trimmed];
  return canonical ? `/app-icons/${canonical}.svg` : null;
}

export interface OriginalAppIconProps {
  appId?: string;
  iconName?: string;
  name?: string;
  accent?: string;
  size?: number;
  className?: string;
}

function resolveVariantBadge(appId?: string, iconName?: string): 'CLI' | 'WEB' | null {
  const key = (iconName || appId || '').toLowerCase();
  if (key === 'antigravity-cli') return 'CLI';
  if (key === 'antigravity-web' || key === 'vscode-web') return 'WEB';
  return null;
}

export const OriginalAppIcon: React.FC<OriginalAppIconProps> = ({
  appId,
  iconName,
  name,
  accent,
  size = 40,
  className = '',
}) => {
  const [remoteFailed, setRemoteFailed] = useState(false);

  const bundledUrl =
    resolveBundledAppIconUrl(appId) ||
    resolveBundledAppIconUrl(iconName) ||
    resolveBundledAppIconUrl(name);

  const variantBadge = resolveVariantBadge(appId, iconName);

  if (bundledUrl) {
    const imgEl = (
      <img
        src={bundledUrl}
        alt={name || appId || ''}
        style={{ width: size, height: size }}
        className={`object-contain shrink-0 drop-shadow-sm select-none ${variantBadge ? '' : className}`}
        draggable={false}
      />
    );
    if (!variantBadge) return imgEl;
    return (
      <span
        style={{ width: size, height: size }}
        className={`relative inline-flex items-center justify-center shrink-0 select-none ${className}`}
      >
        {imgEl}
        <span
          className={`absolute -bottom-0.5 -right-1 px-1 py-[1px] rounded text-[7.5px] font-bold tracking-tight leading-none border shadow-sm ${
            variantBadge === 'WEB'
              ? 'bg-sky-500 text-white border-sky-300/60'
              : 'bg-zinc-900 text-emerald-300 border-zinc-600'
          }`}
        >
          {variantBadge}
        </span>
      </span>
    );
  }

  if (iconName && !remoteFailed) {
    return (
      <img
        src={buildAppIconUrl(iconName)}
        alt={name || iconName}
        onError={() => setRemoteFailed(true)}
        style={{ width: size, height: size }}
        className={`object-contain shrink-0 drop-shadow-sm select-none ${className}`}
        draggable={false}
      />
    );
  }

  const initial = (name || appId || 'U').trim().charAt(0).toUpperCase() || 'U';
  const bg = accent || '#3b82f6';
  const radius = Math.max(6, Math.round(size * 0.24));
  const fontSize = Math.max(11, Math.round(size * 0.44));

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: `linear-gradient(135deg, ${bg} 0%, rgba(24,24,27,0.9) 140%)`,
        fontSize,
      }}
      className={`shrink-0 flex items-center justify-center font-bold text-white shadow-sm select-none ${className}`}
    >
      {initial}
    </div>
  );
};


