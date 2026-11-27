import React, { useEffect, useId, useState } from 'react';
import { buildWallpaperUrl } from '../../services/osBridge';
import { WALLPAPERS } from '../../types/os';
import { ExtraWallpaperArt } from './ExtraWallpapers';

interface WallpaperLayerProps {
  wallpaperId: string;
  theme: 'dark' | 'light';
  customWallpaper?: string;
  className?: string;
  animated?: boolean;
}

const DYNAMIC_TIME_IDS = new Set(WALLPAPERS.filter((w) => w.dynamicTime).map((w) => w.id));

function useClockHour(enabled: boolean): number {
  const [hour, setHour] = useState(() => {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  });

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const d = new Date();
      setHour(d.getHours() + d.getMinutes() / 60);
    };
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [enabled]);

  return hour;
}

function getCorePalette(theme: 'dark' | 'light') {
  const dark = theme === 'dark';
  return { dark };
}

/**
 * Core 6 TamgaOS Flagship Wallpapers:
 * - mono-peaks   (Static Studio — Flagship faceted obsidian/alabaster monoliths)
 * - geo-dunes    (Static Studio — Architectural wind-swept dunes with crisp ridge lighting)
 * - geo-prism    (Static Studio — Optical studio glass monoliths with caustics & rim light)
 * - geo-waves    (Static Studio — High-precision cartographic topo elevation ridges)
 * - geo-aurora   (Animated Live — Deep arctic peaks under drifting multi-ribbon aurora)
 * - geo-horizon  (Static Studio — Minimalist architectural studio horizon & volumetric beam)
 */
const CoreWallpaperSvg: React.FC<{
  id: string;
  theme: 'dark' | 'light';
  uid: string;
  isAnim: boolean;
}> = ({ id, theme, uid, isAnim }) => {
  const { dark } = getCorePalette(theme);

  switch (id) {
    /* ─── 1. GEOMETRİK DAĞ (TamgaOS Flagship — Static Studio) ─── */
    case 'mono-peaks':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0.15" y2="1">
              <stop offset="0%" stopColor={dark ? '#05070c' : '#cbd5e1'} />
              <stop offset="48%" stopColor={dark ? '#0c1220' : '#dde6f0'} />
              <stop offset="82%" stopColor={dark ? '#172033' : '#eff4fa'} />
              <stop offset="100%" stopColor={dark ? '#0a0f18' : '#e2e8f0'} />
            </linearGradient>
            <radialGradient id={`${uid}-zenith`} cx="68%" cy="22%" r="55%">
              <stop offset="0%" stopColor={dark ? '#38bdf8' : '#ffffff'} stopOpacity={dark ? '0.16' : '0.88'} />
              <stop offset="45%" stopColor={dark ? '#6366f1' : '#e0f2fe'} stopOpacity={dark ? '0.07' : '0.42'} />
              <stop offset="100%" stopColor={dark ? '#05070c' : '#cbd5e1'} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-mist`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={dark ? '#38bdf8' : '#ffffff'} stopOpacity="0" />
              <stop offset="55%" stopColor={dark ? '#1e293b' : '#f8fafc'} stopOpacity={dark ? '0.52' : '0.78'} />
              <stop offset="100%" stopColor={dark ? '#06080f' : '#cbd5e1'} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${uid}-mfar`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={dark ? '#1f2b42' : '#94a3b8'} />
              <stop offset="100%" stopColor={dark ? '#0e1525' : '#cbd5e1'} />
            </linearGradient>
            <linearGradient id={`${uid}-mlit`} x1="0.1" y1="0" x2="0.9" y2="1">
              <stop offset="0%" stopColor={dark ? '#334155' : '#f8fafc'} />
              <stop offset="55%" stopColor={dark ? '#182235' : '#cbd5e1'} />
              <stop offset="100%" stopColor={dark ? '#0b101d' : '#94a3b8'} />
            </linearGradient>
            <linearGradient id={`${uid}-mshd`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={dark ? '#0d1424' : '#7b8ea4'} />
              <stop offset="100%" stopColor={dark ? '#04060b' : '#64748b'} />
            </linearGradient>
            <linearGradient id={`${uid}-fglit`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={dark ? '#233047' : '#e2e8f0'} />
              <stop offset="100%" stopColor={dark ? '#090d16' : '#94a3b8'} />
            </linearGradient>
            <linearGradient id={`${uid}-fgshd`} x1="0" y1="0" x2="0.8" y2="1">
              <stop offset="0%" stopColor={dark ? '#0b101b' : '#64748b'} />
              <stop offset="100%" stopColor={dark ? '#03050a' : '#475569'} />
            </linearGradient>
            <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={dark ? '#93c5fd' : '#ffffff'} stopOpacity={dark ? '0.52' : '0.92'} />
              <stop offset="100%" stopColor={dark ? '#38bdf8' : '#ffffff'} stopOpacity="0" />
            </linearGradient>
            <filter id={`${uid}-blur`} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="24" />
            </filter>
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-sky)`} />
          <rect width="1920" height="1080" fill={`url(#${uid}-zenith)`} />

          {/* Crisp astronomical starfield in dark mode */}
          {dark && (
            <g opacity="0.72">
              {[
                [190, 120, 1.3], [380, 74, 0.9], [520, 185, 1.1], [760, 96, 1.4],
                [990, 148, 0.9], [1180, 82, 1.6], [1560, 134, 1.1], [1690, 92, 1.4],
                [1810, 198, 1.1], [290, 260, 0.8], [860, 224, 1.0], [1540, 250, 0.9],
                [1120, 210, 1.2], [650, 142, 0.8],
              ].map(([cx, cy, r], i) => (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="#e2e8f0"
                  className={isAnim && i % 2 === 0 ? 'wp-twinkle' : undefined}
                  style={isAnim ? { animationDelay: `-${(i * 0.48).toFixed(2)}s` } : undefined}
                  opacity={0.38 + (i % 4) * 0.15}
                />
              ))}
            </g>
          )}

          {/* Sculpted Crescent Moon (Hilal Ay) & atmospheric moonlight corona */}
          <g className={isAnim ? 'wp-glow' : undefined}>
            <circle
              cx="1350"
              cy="198"
              r="145"
              fill={dark ? '#bae6fd' : '#94a3b8'}
              opacity={dark ? '0.075' : '0.16'}
              filter={`url(#${uid}-blur)`}
            />
            <circle
              cx="1350"
              cy="198"
              r="118"
              fill="none"
              stroke={dark ? '#7dd3fc' : '#64748b'}
              strokeWidth="0.75"
              opacity={dark ? '0.12' : '0.24'}
            />
            <g transform="translate(1350 198) rotate(-26)">
              <path
                d="M 0,-54 A 54,54 0 1,0 0,54 A 66,64 0 0,1 0,-54 Z"
                fill={dark ? '#f1f5f9' : '#7b90ab'}
                opacity={dark ? '0.92' : '0.94'}
              />
              <path
                d="M 0,-54 A 54,54 0 1,0 0,54 A 66,64 0 0,1 0,-54 Z"
                fill="none"
                stroke={dark ? '#bae6fd' : '#475569'}
                strokeWidth={dark ? '1' : '1.15'}
                opacity={dark ? '0.65' : '0.45'}
              />
            </g>
          </g>

          {/* Distant alpine massif */}
          <polygon points="-40,740 240,470 500,630 820,410 1110,590 1440,390 1720,560 1960,440 1960,1080 -40,1080" fill={`url(#${uid}-mfar)`} opacity="0.72" />
          {/* Atmospheric horizon mist */}
          <rect x="0" y="470" width="1920" height="310" fill={`url(#${uid}-mist)`} className={isAnim ? 'wp-mist' : undefined} />

          {/* Mid-ground architectural faceted peaks (lit & shadowed planes) */}
          <polygon points="140,1080 560,430 690,780 560,1080" fill={`url(#${uid}-mlit)`} />
          <polygon points="560,430 980,1080 690,780" fill={`url(#${uid}-mshd)`} />
          <polyline points="140,1080 560,430 690,780" fill="none" stroke={`url(#${uid}-rim)`} strokeWidth="1.6" />

          <polygon points="820,1080 1290,340 1370,730 1190,1080" fill={`url(#${uid}-mlit)`} />
          <polygon points="1290,340 1760,1080 1370,730" fill={`url(#${uid}-mshd)`} />
          <polyline points="820,1080 1290,340 1370,730" fill="none" stroke={`url(#${uid}-rim)`} strokeWidth="2" />

          {/* Secondary subtle glacier haze between mid & foreground */}
          <ellipse cx="960" cy="790" rx="880" ry="120" fill={dark ? '#1e293b' : '#f8fafc'} opacity={dark ? '0.32' : '0.52'} filter={`url(#${uid}-blur)`} className={isAnim ? 'wp-mist' : undefined} style={isAnim ? { animationDelay: '-8s' } : undefined} />

          {/* Foreground sculpted obsidian/alabaster peaks */}
          <polygon points="-60,1080 280,580 410,900 320,1080" fill={`url(#${uid}-fglit)`} />
          <polygon points="280,580 740,1080 410,900" fill={`url(#${uid}-fgshd)`} />
          <polyline points="-60,1080 280,580 410,900" fill="none" stroke={`url(#${uid}-rim)`} strokeWidth="1.4" />

          <polygon points="590,1080 940,620 1020,920 920,1080" fill={`url(#${uid}-fglit)`} />
          <polygon points="940,620 1390,1080 1020,920" fill={`url(#${uid}-fgshd)`} />
          <polyline points="590,1080 940,620 1020,920" fill="none" stroke={`url(#${uid}-rim)`} strokeWidth="1.5" />

          <polygon points="1310,1080 1650,530 1750,870 1640,1080" fill={`url(#${uid}-fglit)`} />
          <polygon points="1650,530 2020,1080 1750,870" fill={`url(#${uid}-fgshd)`} />
          <polyline points="1310,1080 1650,530 1750,870" fill="none" stroke={`url(#${uid}-rim)`} strokeWidth="1.6" />
        </svg>
      );

    /* ─── 2. ÇÖL KUMULLARI (Architectural Sculpted Dunes — Static Studio) ─── */
    case 'geo-dunes':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0.2" y2="1">
              <stop offset="0%" stopColor={dark ? '#0f0c14' : '#f7ead9'} />
              <stop offset="42%" stopColor={dark ? '#231824' : '#f2d3b1'} />
              <stop offset="76%" stopColor={dark ? '#4c2c28' : '#e8b688'} />
              <stop offset="100%" stopColor={dark ? '#181012' : '#d69c6d'} />
            </linearGradient>
            <radialGradient id={`${uid}-sun`} cx="74%" cy="32%" r="44%">
              <stop offset="0%" stopColor={dark ? '#fbbf24' : '#fff8eb'} stopOpacity={dark ? '0.42' : '0.92'} />
              <stop offset="35%" stopColor={dark ? '#f97316' : '#fed7aa'} stopOpacity={dark ? '0.18' : '0.48'} />
              <stop offset="100%" stopColor={dark ? '#181012' : '#f2d3b1'} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-d1`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={dark ? '#693d30' : '#dfa674'} />
              <stop offset="100%" stopColor={dark ? '#2b1817' : '#c68553'} />
            </linearGradient>
            <linearGradient id={`${uid}-d2lit`} x1="0" y1="0" x2="1" y2="0.8">
              <stop offset="0%" stopColor={dark ? '#9a5b3b' : '#efc092'} />
              <stop offset="60%" stopColor={dark ? '#5a3123' : '#d69764'} />
              <stop offset="100%" stopColor={dark ? '#261412' : '#b27042'} />
            </linearGradient>
            <linearGradient id={`${uid}-d2shd`} x1="0" y1="0" x2="0.6" y2="1">
              <stop offset="0%" stopColor={dark ? '#2a1617' : '#ab6c41'} />
              <stop offset="100%" stopColor={dark ? '#11090b' : '#854e2b'} />
            </linearGradient>
            <linearGradient id={`${uid}-d3lit`} x1="0.2" y1="0" x2="0.9" y2="1">
              <stop offset="0%" stopColor={dark ? '#b46f46' : '#f4cca3'} />
              <stop offset="55%" stopColor={dark ? '#562d20' : '#c98653'} />
              <stop offset="100%" stopColor={dark ? '#1c0f0e' : '#9a5c33'} />
            </linearGradient>
            <linearGradient id={`${uid}-d3shd`} x1="0" y1="0" x2="0.7" y2="1">
              <stop offset="0%" stopColor={dark ? '#1f1011' : '#965a33'} />
              <stop offset="100%" stopColor={dark ? '#090507' : '#6c3e20'} />
            </linearGradient>
            <linearGradient id={`${uid}-crest`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={dark ? '#fde68a' : '#fffbeb'} stopOpacity="0" />
              <stop offset="48%" stopColor={dark ? '#fde68a' : '#fffbeb'} stopOpacity={dark ? '0.55' : '0.88'} />
              <stop offset="100%" stopColor={dark ? '#fb923c' : '#fffbeb'} stopOpacity="0" />
            </linearGradient>
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-sky)`} />
          <g className={isAnim ? 'wp-glow' : undefined}>
            <rect width="1920" height="1080" fill={`url(#${uid}-sun)`} />
            <circle cx="1420" cy="340" r="64" fill={dark ? '#fde68a' : '#fffdf7'} opacity={dark ? '0.78' : '0.94'} />
          </g>

          {/* Far sweeping dune range */}
          <path d="M-40,590 C280,480 540,565 890,515 C1240,465 1560,550 1960,485 L1960,1080 L-40,1080 Z" fill={`url(#${uid}-d1)`} opacity="0.82" />

          {/* Mid-ground sculpted razor-ridge dune (lit & shadowed face) */}
          <path d="M-40,720 C310,560 660,530 1050,650 C1400,760 1680,620 1960,560 L1960,1080 L-40,1080 Z" fill={`url(#${uid}-d2lit)`} />
          <path d="M510,568 C675,655 770,795 920,1080 L-40,1080 L-40,720 C190,625 360,575 510,568 Z" fill={`url(#${uid}-d2shd)`} opacity="0.82" />
          <path d="M-40,720 C310,560 660,530 1050,650" fill="none" stroke={`url(#${uid}-crest)`} strokeWidth="2.2" />

          {/* Foreground iconic S-curve sand ridge */}
          <g className={isAnim ? 'wp-wave' : undefined}>
            <path d="M-80,860 C270,795 540,730 980,760 C1350,785 1620,665 2000,640 L2000,1080 L-80,1080 Z" fill={`url(#${uid}-d3lit)`} />
            <path d="M1260,746 C1410,835 1540,945 1680,1080 L2000,1080 L2000,640 C1685,660 1465,725 1260,746 Z" fill={`url(#${uid}-d3shd)`} opacity="0.88" />
            <path d="M-80,860 C270,795 540,730 980,760 C1350,785 1620,665 2000,640" fill="none" stroke={`url(#${uid}-crest)`} strokeWidth="2.4" />
          </g>
        </svg>
      );

    /* ─── 3. KRİSTAL PRİZMA (Optical Glass Monoliths — Studio & Screensaver Motion) ─── */
    case 'geo-prism':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={dark ? '#05070e' : '#e6edf6'} />
              <stop offset="50%" stopColor={dark ? '#0d1324' : '#f4f7fb'} />
              <stop offset="100%" stopColor={dark ? '#060a14' : '#d8e3f0'} />
            </linearGradient>
            <radialGradient id={`${uid}-caustic1`} cx="35%" cy="42%" r="48%">
              <stop offset="0%" stopColor={dark ? '#38bdf8' : '#7dd3fc'} stopOpacity={dark ? '0.26' : '0.42'} />
              <stop offset="55%" stopColor={dark ? '#6366f1' : '#a5b4fc'} stopOpacity={dark ? '0.12' : '0.22'} />
              <stop offset="100%" stopColor={dark ? '#05070e' : '#e6edf6'} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${uid}-caustic2`} cx="70%" cy="62%" r="44%">
              <stop offset="0%" stopColor={dark ? '#a855f7' : '#c4b5fd'} stopOpacity={dark ? '0.22' : '0.36'} />
              <stop offset="100%" stopColor={dark ? '#05070e' : '#e6edf6'} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-glassA`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={dark ? '#e0f2fe' : '#ffffff'} stopOpacity={dark ? '0.22' : '0.82'} />
              <stop offset="45%" stopColor={dark ? '#38bdf8' : '#cbd5e1'} stopOpacity={dark ? '0.10' : '0.45'} />
              <stop offset="100%" stopColor={dark ? '#0f172a' : '#94a3b8'} stopOpacity={dark ? '0.48' : '0.32'} />
            </linearGradient>
            <linearGradient id={`${uid}-glassB`} x1="0" y1="0" x2="0.2" y2="1">
              <stop offset="0%" stopColor={dark ? '#c4b5fd' : '#ffffff'} stopOpacity={dark ? '0.20' : '0.78'} />
              <stop offset="50%" stopColor={dark ? '#1e293b' : '#e2e8f0'} stopOpacity={dark ? '0.32' : '0.52'} />
              <stop offset="100%" stopColor={dark ? '#020617' : '#94a3b8'} stopOpacity={dark ? '0.58' : '0.28'} />
            </linearGradient>
            <linearGradient id={`${uid}-edge`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity={dark ? '0.68' : '0.96'} />
              <stop offset="50%" stopColor={dark ? '#7dd3fc' : '#93c5fd'} stopOpacity={dark ? '0.42' : '0.65'} />
              <stop offset="100%" stopColor={dark ? '#c084fc' : '#ffffff'} stopOpacity="0.1" />
            </linearGradient>
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-bg)`} />
          <rect width="1920" height="1080" fill={`url(#${uid}-caustic1)`} className={isAnim ? 'wp-glow' : undefined} />
          <rect width="1920" height="1080" fill={`url(#${uid}-caustic2)`} className={isAnim ? 'wp-float-b' : undefined} />

          {/* Architectural background light planes */}
          <polygon points="0,0 780,0 440,1080 0,1080" fill={`url(#${uid}-glassB)`} opacity="0.55" />
          <polygon points="1220,0 1920,0 1920,1080 960,1080" fill={`url(#${uid}-glassA)`} opacity="0.45" />

          {/* Hero refractive crystal monolith — 4 precision facets */}
          <g className={isAnim ? 'wp-float' : undefined}>
            <polygon points="960,120 620,560 960,720" fill={`url(#${uid}-glassA)`} />
            <polygon points="960,120 1320,560 960,720" fill={`url(#${uid}-glassB)`} />
            <polygon points="620,560 960,960 960,720" fill={`url(#${uid}-glassB)`} opacity="0.88" />
            <polygon points="1320,560 960,960 960,720" fill={`url(#${uid}-glassA)`} opacity="0.72" />
            <g fill="none" stroke={`url(#${uid}-edge)`} strokeWidth="1.6">
              <polygon points="960,120 620,560 960,960 1320,560" />
              <line x1="960" y1="120" x2="960" y2="960" opacity="0.75" />
              <line x1="620" y1="560" x2="960" y2="720" opacity="0.65" />
              <line x1="1320" y1="560" x2="960" y2="720" opacity="0.55" />
            </g>
          </g>

          {/* Secondary intersecting floating shards */}
          <g className={isAnim ? 'wp-float-b' : undefined}>
            <polygon points="410,240 660,460 520,860 220,620" fill={`url(#${uid}-glassA)`} opacity="0.6" />
            <polygon points="1460,200 1740,480 1560,880 1280,640" fill={`url(#${uid}-glassB)`} opacity="0.65" />
            <g fill="none" stroke={`url(#${uid}-edge)`} strokeWidth="1.6">
              <polygon points="410,240 660,460 520,860 220,620" opacity="0.48" />
              <polygon points="1460,200 1740,480 1560,880 1280,640" opacity="0.45" />
            </g>
          </g>
        </svg>
      );

    /* ─── 4. TOPO DALGALAR (Precision Cartographic Contour Ridges — Studio & Screensaver Motion) ─── */
    case 'geo-waves':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={dark ? '#060a10' : '#eef3f8'} />
              <stop offset="50%" stopColor={dark ? '#0d1520' : '#e2ebf4'} />
              <stop offset="100%" stopColor={dark ? '#070c13' : '#d4e1ee'} />
            </linearGradient>
            <radialGradient id={`${uid}-accent`} cx="64%" cy="38%" r="54%">
              <stop offset="0%" stopColor={dark ? '#2dd4bf' : '#0ea5e9'} stopOpacity={dark ? '0.18' : '0.16'} />
              <stop offset="60%" stopColor={dark ? '#3b82f6' : '#6366f1'} stopOpacity={dark ? '0.08' : '0.07'} />
              <stop offset="100%" stopColor={dark ? '#060a10' : '#eef3f8'} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-line`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={dark ? '#38bdf8' : '#334155'} stopOpacity="0.06" />
              <stop offset="45%" stopColor={dark ? '#5eead4' : '#0f172a'} stopOpacity={dark ? '0.46' : '0.28'} />
              <stop offset="78%" stopColor={dark ? '#93c5fd' : '#0284c7'} stopOpacity={dark ? '0.38' : '0.24'} />
              <stop offset="100%" stopColor={dark ? '#38bdf8' : '#334155'} stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id={`${uid}-band`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={dark ? '#162436' : '#cbd5e1'} stopOpacity="0.65" />
              <stop offset="100%" stopColor={dark ? '#070c14' : '#e2e8f0'} stopOpacity="0" />
            </linearGradient>
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-bg)`} />
          <rect width="1920" height="1080" fill={`url(#${uid}-accent)`} className={isAnim ? 'wp-glow' : undefined} />

          {/* Filled bathymetric depth bands */}
          <path d="M-80,460 C340,320 690,540 1120,390 C1480,265 1740,420 2020,350 L2020,1080 L-80,1080 Z" fill={`url(#${uid}-band)`} opacity="0.55" className={isAnim ? 'wp-wave' : undefined} />
          <path d="M-80,680 C380,550 780,760 1240,610 C1560,505 1780,660 2020,590 L2020,1080 L-80,1080 Z" fill={`url(#${uid}-band)`} opacity="0.72" className={isAnim ? 'wp-wave-b' : undefined} />

          {/* 18 precision topographic contour ridges */}
          {Array.from({ length: 18 }).map((_, i) => {
            const y = 90 + i * 56;
            const amp = 78 + (i % 5) * 18;
            const shift = (i - 9) * 28;
            const major = i % 4 === 0;
            return (
              <path
                key={i}
                d={`M-80,${y} C${320 + shift},${y - amp} ${680 - shift},${y + amp * 0.9} ${1080 + shift * 0.5},${y - amp * 0.65} C${1460 - shift * 0.4},${y - amp * 1.1} ${1720 + shift * 0.3},${y + amp * 0.55} 2020,${y - 24}`}
                fill="none"
                stroke={`url(#${uid}-line)`}
                strokeWidth={major ? 1.85 : 0.95}
                opacity={major ? 0.92 : 0.46}
                className={isAnim ? (i % 2 === 0 ? 'wp-wave' : 'wp-wave-b') : undefined}
                style={isAnim ? { animationDelay: `-${(i * 0.35).toFixed(2)}s` } : undefined}
              />
            );
          })}
        </svg>
      );

    /* ─── 5. KUZEY IŞIKLARI (Arctic Aurora Borealis — Static Desktop / Animated Screensaver) ─── */
    case 'geo-aurora':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={dark ? '#020611' : '#0b192c'} />
              <stop offset="52%" stopColor={dark ? '#071526' : '#132a46'} />
              <stop offset="82%" stopColor={dark ? '#0b2033' : '#1d3c5c'} />
              <stop offset="100%" stopColor={dark ? '#040a14' : '#0f1f33'} />
            </linearGradient>
            <linearGradient id={`${uid}-curtain1`} x1="0" y1="1" x2="0.18" y2="0">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.88" />
              <stop offset="42%" stopColor="#2dd4bf" stopOpacity="0.56" />
              <stop offset="78%" stopColor="#818cf8" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#c084fc" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${uid}-curtain2`} x1="0" y1="1" x2="-0.15" y2="0">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.72" />
              <stop offset="46%" stopColor="#a855f7" stopOpacity="0.44" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${uid}-lake`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#091d2d" />
              <stop offset="45%" stopColor="#0e2c3e" />
              <stop offset="100%" stopColor="#030812" />
            </linearGradient>
            <filter id={`${uid}-glow`} x="-25%" y="-25%" width="150%" height="150%">
              <feGaussianBlur stdDeviation="28" />
            </filter>
            <filter id={`${uid}-soft`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="12" />
            </filter>
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-sky)`} />

          {/* Starfield with subtle twinkle */}
          <g>
            {[
              [140, 88, 1.4], [290, 160, 1.1], [460, 74, 1.6], [640, 134, 1.0],
              [810, 68, 1.5], [1020, 118, 1.2], [1190, 62, 1.7], [1380, 146, 1.0],
              [1540, 82, 1.5], [1740, 128, 1.3], [1840, 210, 1.0], [210, 250, 1.0],
              [910, 210, 1.1], [1480, 220, 1.1], [1680, 260, 0.9], [520, 224, 0.9],
            ].map(([cx, cy, r], i) => (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                fill="#f8fafc"
                className={isAnim && i % 2 === 0 ? 'wp-twinkle' : undefined}
                style={isAnim ? { animationDelay: `${(i % 6) * 0.65}s` } : undefined}
                opacity={0.45 + (i % 4) * 0.15}
              />
            ))}
          </g>

          {/* Animated Multi-Ribbon Aurora Curtains */}
          <g className={isAnim ? 'wp-aurora' : undefined} filter={`url(#${uid}-glow)`}>
            <path
              d="M-120,470 C190,260 520,440 880,250 C1230,70 1560,310 2040,140 L2040,470 C1580,550 1240,340 890,490 C540,630 210,490 -120,610 Z"
              fill={`url(#${uid}-curtain1)`}
            />
          </g>
          <g className={isAnim ? 'wp-aurora-b' : undefined} filter={`url(#${uid}-glow)`}>
            <path
              d="M-80,340 C280,150 670,380 1090,190 C1450,35 1740,250 2020,160 L2020,420 C1700,480 1390,290 1040,420 C650,560 280,410 -80,520 Z"
              fill={`url(#${uid}-curtain2)`}
              opacity="0.82"
            />
          </g>
          {/* Crisp luminous aurora lower curtain edge */}
          <path
            d="M-60,480 C260,340 590,465 950,320 C1310,175 1620,345 1980,245"
            fill="none"
            stroke="#6ee7b7"
            strokeWidth="3.5"
            opacity="0.58"
            filter={`url(#${uid}-soft)`}
            className={isAnim ? 'wp-aurora' : undefined}
          />

          {/* Arctic fjord mountain silhouette with subtle aurora rim light */}
          <polygon points="-40,810 180,625 360,720 620,560 850,705 1120,545 1370,695 1640,585 1960,720 1960,830 -40,830" fill="#06111e" />
          <polyline
            points="-40,810 180,625 360,720 620,560 850,705 1120,545 1370,695 1640,585 1960,720"
            fill="none"
            stroke="#5eead4"
            strokeWidth="1.4"
            opacity="0.28"
          />

          {/* Glassy Fjord Lake & Aurora Water Reflection */}
          <rect x="0" y="810" width="1920" height="270" fill={`url(#${uid}-lake)`} />
          {/* Inverted mountain silhouette reflection */}
          <polygon points="-40,810 180,975 360,895 620,1040 850,910 1120,1055 1370,920 1640,1015 1960,890 1960,810" fill="#030914" opacity="0.58" />
          <g opacity="0.28" filter={`url(#${uid}-glow)`} className={isAnim ? 'wp-wave' : undefined}>
            <ellipse cx="620" cy="910" rx="540" ry="34" fill="#34d399" />
            <ellipse cx="1320" cy="940" rx="520" ry="32" fill="#38bdf8" />
            <ellipse cx="960" cy="995" rx="640" ry="26" fill="#a855f7" opacity="0.52" />
          </g>
          {/* Crisp shimmering aurora water reflection lines */}
          <g>
            {[
              [420, 845, 210, '#6ee7b7'],
              [740, 872, 260, '#5eead4'],
              [1180, 860, 290, '#7dd3fc'],
              [560, 912, 320, '#34d399'],
              [1040, 938, 340, '#818cf8'],
              [1420, 905, 240, '#67e8f9'],
              [820, 978, 380, '#a78bfa'],
              [340, 956, 220, '#34d399'],
            ].map(([rx, ry, rw, col], i) => (
              <rect
                key={i}
                x={Number(rx)}
                y={Number(ry)}
                width={Number(rw)}
                height={1.8}
                rx="1"
                fill={String(col)}
                opacity={0.34}
                className={isAnim ? 'wp-shimmer' : undefined}
                style={isAnim ? { animationDelay: `-${(i * 0.55).toFixed(2)}s` } : undefined}
              />
            ))}
          </g>
        </svg>
      );

    /* ─── 6. MİNİMAL UFUK (Architectural Studio Horizon — Studio & Screensaver Motion) ─── */
    case 'geo-horizon':
    default:
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-top`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={dark ? '#050608' : '#dde3ec'} />
              <stop offset="70%" stopColor={dark ? '#0e1118' : '#edf1f7'} />
              <stop offset="100%" stopColor={dark ? '#1c2331' : '#ffffff'} />
            </linearGradient>
            <linearGradient id={`${uid}-bot`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={dark ? '#131822' : '#cfd7e3'} />
              <stop offset="32%" stopColor={dark ? '#090b10' : '#dde4ee'} />
              <stop offset="100%" stopColor={dark ? '#030406' : '#c6cfdd'} />
            </linearGradient>
            <radialGradient id={`${uid}-halo`} cx="50%" cy="56%" r="48%">
              <stop offset="0%" stopColor={dark ? '#e2e8f0' : '#ffffff'} stopOpacity={dark ? '0.24' : '0.96'} />
              <stop offset="38%" stopColor={dark ? '#60a5fa' : '#cbd5e1'} stopOpacity={dark ? '0.10' : '0.35'} />
              <stop offset="100%" stopColor={dark ? '#050608' : '#dde3ec'} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-slit`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={dark ? '#ffffff' : '#0f172a'} stopOpacity="0" />
              <stop offset="22%" stopColor={dark ? '#94a3b8' : '#64748b'} stopOpacity={dark ? '0.35' : '0.22'} />
              <stop offset="50%" stopColor={dark ? '#ffffff' : '#ffffff'} stopOpacity={dark ? '0.92' : '1'} />
              <stop offset="78%" stopColor={dark ? '#94a3b8' : '#64748b'} stopOpacity={dark ? '0.35' : '0.22'} />
              <stop offset="100%" stopColor={dark ? '#ffffff' : '#0f172a'} stopOpacity="0" />
            </linearGradient>
            <filter id={`${uid}-glow`} x="-20%" y="-80%" width="140%" height="260%">
              <feGaussianBlur stdDeviation="16" />
            </filter>
          </defs>

          <rect x="0" y="0" width="1920" height="608" fill={`url(#${uid}-top)`} />
          <rect x="0" y="608" width="1920" height="472" fill={`url(#${uid}-bot)`} />
          <rect width="1920" height="1080" fill={`url(#${uid}-halo)`} className={isAnim ? 'wp-glow' : undefined} />

          {/* Architectural zenith arc */}
          <path
            d="M440,608 A520,520 0 0,1 1480,608"
            fill="none"
            stroke={dark ? '#e2e8f0' : '#475569'}
            strokeWidth="1"
            opacity={dark ? '0.16' : '0.18'}
          />
          <path
            d="M640,608 A320,320 0 0,1 1280,608"
            fill="none"
            stroke={dark ? '#93c5fd' : '#334155'}
            strokeWidth="1"
            opacity={dark ? '0.22' : '0.15'}
          />

          {/* Subtle architectural perspective reflection lines below horizon */}
          <g stroke={dark ? '#e2e8f0' : '#334155'} strokeWidth="0.9" opacity={dark ? '0.09' : '0.12'}>
            {[-480, -280, -130, 0, 130, 280, 480].map((dx, i) => (
              <line key={i} x1={960 + dx * 0.35} y1="608" x2={960 + dx * 2.4} y2="1080" />
            ))}
          </g>

          {/* Razor-crisp glowing horizon slit */}
          <rect x="180" y="600" width="1560" height="16" fill={`url(#${uid}-slit)`} filter={`url(#${uid}-glow)`} opacity="0.65" className={isAnim ? 'wp-glow' : undefined} />
          <rect x="0" y="607" width="1920" height="2.2" fill={`url(#${uid}-slit)`} />
        </svg>
      );
  }
};

export const WallpaperLayer: React.FC<WallpaperLayerProps> = ({
  wallpaperId,
  theme,
  customWallpaper,
  className = 'fixed inset-0 pointer-events-none',
  animated = false,
}) => {
  const rawUid = useId();
  const uid = rawUid.replace(/[^a-zA-Z0-9]/g, '');
  const activeId = wallpaperId || 'mono-peaks';
  const hour = useClockHour(DYNAMIC_TIME_IDS.has(activeId));
  // Wallpapers are always static on desktop (animated=false) and animate ONLY inside Screensaver (animated=true)
  const shouldAnimate = Boolean(animated);

  if (activeId === 'custom' && customWallpaper) {
    return (
      <div className={`${className} overflow-hidden`}>
        <img
          src={buildWallpaperUrl(customWallpaper)}
          alt="Masaüstü Arka Planı"
          className="w-full h-full object-cover"
        />
        <div
          className={`absolute inset-0 ${
            theme === 'dark' ? 'bg-black/22' : 'bg-white/10'
          }`}
        />
      </div>
    );
  }

  const isCore = [
    'mono-peaks',
    'geo-dunes',
    'geo-prism',
    'geo-waves',
    'geo-aurora',
    'geo-horizon',
  ].includes(activeId);

  return (
    <div
      data-wallpaper-id={activeId}
      data-wallpaper-animated={shouldAnimate ? 'true' : 'false'}
      className={`${className} overflow-hidden ${shouldAnimate ? 'wp-anim' : ''}`}
    >
      <div className="w-full h-full">
        {isCore ? (
          <CoreWallpaperSvg id={activeId} theme={theme} uid={uid} isAnim={shouldAnimate} />
        ) : (
          <ExtraWallpaperArt id={activeId} theme={theme} hour={hour} uid={uid} isAnim={shouldAnimate} />
        )}
      </div>
      {/* Subtle studio edge vignette so desktop labels & chrome remain crisp */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            theme === 'dark'
              ? 'radial-gradient(ellipse at 50% 45%, transparent 56%, rgba(0,0,0,0.34) 100%)'
              : 'radial-gradient(ellipse at 50% 45%, transparent 62%, rgba(15,23,42,0.10) 100%)',
        }}
      />
    </div>
  );
};

export const WallpaperThumb: React.FC<{
  wallpaperId: string;
  theme: 'dark' | 'light';
  className?: string;
  animated?: boolean;
}> = ({ wallpaperId, theme, className = 'w-full h-14', animated = false }) => (
  <div className={`relative overflow-hidden rounded-lg ${className}`}>
    <WallpaperLayer
      wallpaperId={wallpaperId}
      theme={theme}
      className="absolute inset-0"
      animated={animated}
    />
  </div>
);
