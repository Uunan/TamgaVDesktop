import React from 'react';

interface ExtraWallpaperArtProps {
  id: string;
  theme: 'dark' | 'light';
  hour: number;
  uid: string;
  isAnim: boolean;
  lowDetail?: boolean;
}

type DayPhase = 'dawn' | 'day' | 'sunset' | 'night';

function getDayPhase(hour: number, theme: 'dark' | 'light'): DayPhase {
  if (hour >= 5.5 && hour < 8.5) return 'dawn';
  if (hour >= 8.5 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20.5) return 'sunset';
  return theme === 'light' && hour >= 7 && hour < 19 ? 'day' : 'night';
}

function getSkyByPhase(phase: DayPhase, dark: boolean) {
  if (phase === 'night') {
    return {
      top: '#030712',
      mid: '#0c162b',
      low: '#182946',
      orb: '#e2e8f0',
      orbGlow: '#60a5fa',
      orbY: 225,
      orbX: 1440,
      stars: true,
    };
  }
  if (phase === 'dawn') {
    return {
      top: dark ? '#181834' : '#313968',
      mid: dark ? '#5b3959' : '#b76c80',
      low: dark ? '#d98a5f' : '#f8c390',
      orb: '#fef3c7',
      orbGlow: '#fb923c',
      orbY: 445,
      orbX: 1360,
      stars: true,
    };
  }
  if (phase === 'sunset') {
    return {
      top: dark ? '#10142a' : '#252950',
      mid: dark ? '#6f2e49' : '#c04f5c',
      low: dark ? '#e07a3d' : '#fba564',
      orb: '#ffedd5',
      orbGlow: '#f97316',
      orbY: 460,
      orbX: 560,
      stars: false,
    };
  }
  return {
    top: dark ? '#0b2545' : '#1d6fa5',
    mid: dark ? '#1c4c7a' : '#5aa6d6',
    low: dark ? '#4d82a8' : '#c8e6f8',
    orb: '#fffbeb',
    orbGlow: '#fde68a',
    orbY: 210,
    orbX: 1410,
    stars: false,
  };
}

const STAR_COORDS: Array<[number, number, number]> = [
  [120, 82, 1.4], [240, 152, 1.0], [360, 68, 1.6], [490, 184, 1.1],
  [610, 96, 1.4], [740, 148, 0.9], [890, 74, 1.7], [1030, 134, 1.1],
  [1170, 62, 1.5], [1310, 174, 1.0], [1480, 84, 1.6], [1640, 140, 1.2],
  [1790, 76, 1.5], [1860, 206, 0.9], [190, 250, 1.0], [820, 232, 1.1],
  [1240, 240, 0.9], [1560, 252, 1.2], [440, 266, 0.9], [970, 214, 1.0],
];

const StarField: React.FC<{ isAnim: boolean; opacity?: number }> = ({ isAnim, opacity = 0.85 }) => (
  <g opacity={opacity}>
    {STAR_COORDS.map(([cx, cy, r], i) => (
      <circle
        key={i}
        cx={cx}
        cy={cy}
        r={r}
        fill="#f8fafc"
        className={isAnim && i % 2 === 0 ? 'wp-twinkle' : undefined}
        style={isAnim ? { animationDelay: `${(i % 7) * 0.52}s` } : undefined}
        opacity={0.4 + (i % 4) * 0.16}
      />
    ))}
  </g>
);

export const ExtraWallpaperArt: React.FC<ExtraWallpaperArtProps> = ({
  id,
  theme,
  hour,
  uid,
  isAnim,
  lowDetail = false,
}) => {
  const dark = theme === 'dark';
  const phase = getDayPhase(hour, theme);
  const sky = getSkyByPhase(phase, dark);
  const fUrl = (name: string) => (lowDetail ? undefined : `url(#${uid}-${name})`);

  switch (id) {
    /* ─── 1. BUĞDAY TARLASI (Living Golden Meadow — Animated + Clock-Aware) ─── */
    case 'wheat-field': {
      const hillFar =
        phase === 'night' ? '#0f1c2e' : phase === 'sunset' ? '#4a2b34' : phase === 'dawn' ? '#513c47' : '#3a624a';
      const hillMid =
        phase === 'night' ? '#14242b' : phase === 'sunset' ? '#5c3723' : phase === 'dawn' ? '#5f4929' : '#577333';
      const groundTop =
        phase === 'night' ? '#1c2419' : phase === 'sunset' ? '#8c5319' : phase === 'dawn' ? '#9a6d28' : '#b88622';
      const groundBot =
        phase === 'night' ? '#070b08' : phase === 'sunset' ? '#2c1708' : phase === 'dawn' ? '#33220d' : '#4a330a';
      const stalkLight =
        phase === 'night' ? '#94a3b8' : phase === 'sunset' ? '#fbbf24' : phase === 'dawn' ? '#fcd34d' : '#fde047';
      const stalkMid =
        phase === 'night' ? '#475569' : phase === 'sunset' ? '#d97706' : phase === 'dawn' ? '#ca8a04' : '#eab308';

      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={sky.top} />
              <stop offset="56%" stopColor={sky.mid} />
              <stop offset="100%" stopColor={sky.low} />
            </linearGradient>
            <radialGradient id={`${uid}-orb`} cx={`${(sky.orbX / 1920) * 100}%`} cy={`${(sky.orbY / 1080) * 100}%`} r="36%">
              <stop offset="0%" stopColor={sky.orb} stopOpacity="0.92" />
              <stop offset="28%" stopColor={sky.orbGlow} stopOpacity="0.45" />
              <stop offset="100%" stopColor={sky.orbGlow} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-field`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={groundTop} />
              <stop offset="100%" stopColor={groundBot} />
            </linearGradient>
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-sky)`} />
          <rect width="1920" height="1080" fill={`url(#${uid}-orb)`} />
          {sky.stars && <StarField isAnim={isAnim} opacity={phase === 'night' ? 0.9 : 0.4} />}
          <circle cx={sky.orbX} cy={sky.orbY} r={phase === 'night' ? 40 : 54} fill={sky.orb} opacity="0.94" />

          {/* Soft distant rolling hills */}
          <path d="M-40,660 C340,565 720,625 1120,575 C1480,530 1740,595 1960,555 L1960,1080 L-40,1080 Z" fill={hillFar} />
          <path d="M-40,715 C420,635 880,705 1380,645 C1660,610 1820,665 1960,640 L1960,1080 L-40,1080 Z" fill={hillMid} />
          <path d="M-40,760 C460,720 1020,780 1520,725 C1740,702 1860,735 1960,725 L1960,1080 L-40,1080 Z" fill={`url(#${uid}-field)`} />

          {/* 36 Depth-layered swaying golden wheat stalks */}
          <g>
            {Array.from({ length: 36 }).map((_, i) => {
              const x = 18 + i * 54 + ((i * 19) % 21);
              const depth = i % 3;
              const baseY = 1095 - depth * 12;
              const h = 215 + depth * 64 + ((i * 29) % 58);
              const curve = (i % 2 === 0 ? 1 : -1) * (16 + (i % 4) * 7);
              const color = depth === 2 ? stalkLight : stalkMid;
              const delay = ((i * 0.23) % 3.6).toFixed(2);
              return (
                <g
                  key={i}
                  className={isAnim ? (i % 2 === 0 ? 'wp-sway' : 'wp-sway-b') : undefined}
                  style={isAnim ? { animationDelay: `-${delay}s` } : undefined}
                  opacity={depth === 0 ? 0.56 : depth === 1 ? 0.78 : 0.96}
                >
                  <path
                    d={`M${x},${baseY} Q${x + curve * 0.45},${baseY - h * 0.55} ${x + curve},${baseY - h}`}
                    stroke={color}
                    strokeWidth={depth === 2 ? 3.2 : 2.2}
                    fill="none"
                    strokeLinecap="round"
                  />
                  {/* Sculpted grain head */}
                  <ellipse
                    cx={x + curve}
                    cy={baseY - h - 14}
                    rx={depth === 2 ? 6.5 : 4.8}
                    ry={depth === 2 ? 22 : 16}
                    fill={color}
                    transform={`rotate(${curve > 0 ? 11 : -11} ${x + curve} ${baseY - h - 14})`}
                  />
                  <ellipse
                    cx={x + curve * 0.85}
                    cy={baseY - h + 6}
                    rx={depth === 2 ? 5.2 : 4}
                    ry={depth === 2 ? 15 : 11}
                    fill={stalkLight}
                    opacity="0.72"
                    transform={`rotate(${curve > 0 ? 8 : -8} ${x + curve * 0.85} ${baseY - h + 6})`}
                  />
                </g>
              );
            })}
          </g>

          {/* Warm drifting pollen / firefly motes */}
          <g>
            {[
              [220, 740], [490, 690], [780, 760], [1060, 710], [1340, 750], [1610, 695], [1780, 770],
            ].map(([cx, cy], i) => (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={phase === 'night' ? 2.6 : 2.0}
                fill={phase === 'night' ? '#bef264' : '#fef08a'}
                className={isAnim ? 'wp-float' : undefined}
                style={isAnim ? { animationDelay: `-${i * 1.4}s` } : undefined}
                opacity={phase === 'night' ? 0.8 : 0.55}
              />
            ))}
          </g>
        </svg>
      );
    }

    /* ─── 2. OKYANUS UFKU (Living Ocean Swell & Reflection — Animated + Clock-Aware) ─── */
    case 'ocean-horizon': {
      const seaTop =
        phase === 'night' ? '#081a2f' : phase === 'sunset' ? '#2c2544' : phase === 'dawn' ? '#2a3756' : '#0e4d7a';
      const seaMid =
        phase === 'night' ? '#051122' : phase === 'sunset' ? '#171932' : phase === 'dawn' ? '#172844' : '#08375a';
      const seaBot =
        phase === 'night' ? '#020710' : '#051526';
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={sky.top} />
              <stop offset="60%" stopColor={sky.mid} />
              <stop offset="100%" stopColor={sky.low} />
            </linearGradient>
            <radialGradient id={`${uid}-glow`} cx={`${(sky.orbX / 1920) * 100}%`} cy="54%" r="42%">
              <stop offset="0%" stopColor={sky.orb} stopOpacity="0.65" />
              <stop offset="45%" stopColor={sky.orbGlow} stopOpacity="0.25" />
              <stop offset="100%" stopColor={sky.orbGlow} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-sea`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={seaTop} />
              <stop offset="45%" stopColor={seaMid} />
              <stop offset="100%" stopColor={seaBot} />
            </linearGradient>
            <linearGradient id={`${uid}-crest`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={sky.orb} stopOpacity="0" />
              <stop offset="50%" stopColor={sky.orb} stopOpacity="0.34" />
              <stop offset="100%" stopColor={sky.orb} stopOpacity="0" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width="1920" height="590" fill={`url(#${uid}-sky)`} />
          <rect x="0" y="0" width="1920" height="620" fill={`url(#${uid}-glow)`} />
          {sky.stars && <StarField isAnim={isAnim} opacity={0.85} />}
          <circle cx={sky.orbX} cy={Math.min(470, sky.orbY + 80)} r={phase === 'night' ? 38 : 54} fill={sky.orb} opacity="0.95" />

          {/* Distant coastal headland silhouettes */}
          <path d="M-20,588 L260,552 L480,578 L660,588 Z" fill={seaTop} opacity="0.72" />
          <path d="M1480,588 L1710,555 L1940,568 L1940,588 Z" fill={seaTop} opacity="0.66" />

          {/* Deep ocean body */}
          <rect x="0" y="586" width="1920" height="494" fill={`url(#${uid}-sea)`} />

          {/* Shimmering specular orb reflection path on water */}
          <g>
            {Array.from({ length: 14 }).map((_, i) => {
              const y = 602 + i * 31;
              const w = 130 + i * 24;
              return (
                <rect
                  key={i}
                  x={sky.orbX - w / 2}
                  y={y}
                  width={w}
                  height={2.6 + (i % 3)}
                  rx="2"
                  fill={sky.orb}
                  opacity={Math.max(0.08, 0.56 - i * 0.032)}
                  className={isAnim ? 'wp-shimmer' : undefined}
                  style={isAnim ? { animationDelay: `-${(i * 0.37).toFixed(2)}s` } : undefined}
                />
              );
            })}
          </g>

          {/* Multi-layered undulating ocean swells */}
          <g className={isAnim ? 'wp-wave' : undefined}>
            <path d="M-120,690 C280,662 660,712 1080,680 C1460,652 1740,702 2060,676 L2060,1080 L-120,1080 Z" fill={seaMid} opacity="0.58" />
            <path d="M-120,690 C280,662 660,712 1080,680 C1460,652 1740,702 2060,676" fill="none" stroke={`url(#${uid}-crest)`} strokeWidth="2" />
          </g>
          <g className={isAnim ? 'wp-wave-b' : undefined}>
            <path d="M-120,810 C320,778 720,836 1160,802 C1540,774 1800,828 2060,796 L2060,1080 L-120,1080 Z" fill={seaBot} opacity="0.68" />
            <path d="M-120,810 C320,778 720,836 1160,802 C1540,774 1800,828 2060,796" fill="none" stroke={`url(#${uid}-crest)`} strokeWidth="1.6" />
          </g>
          <g className={isAnim ? 'wp-wave' : undefined}>
            <path d="M-120,940 C360,912 780,964 1220,928 C1580,900 1820,952 2060,924 L2060,1080 L-120,1080 Z" fill="#02060d" opacity="0.72" />
          </g>
        </svg>
      );
    }

    /* ─── 3. AY IŞIĞI GÖLÜ (Alpine Mirror Lake — Animated + Clock-Aware) ─── */
    case 'moonlit-lake': {
      const mtnLit = phase === 'night' ? '#1e2c44' : phase === 'sunset' ? '#58344b' : '#4a607a';
      const mtnDark = phase === 'night' ? '#09111f' : phase === 'sunset' ? '#27172a' : '#25364a';
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={phase === 'night' ? '#040814' : sky.top} />
              <stop offset="55%" stopColor={phase === 'night' ? '#0f1c34' : sky.mid} />
              <stop offset="100%" stopColor={phase === 'night' ? '#22385c' : sky.low} />
            </linearGradient>
            <radialGradient id={`${uid}-moon`} cx="50%" cy="24%" r="36%">
              <stop offset="0%" stopColor={sky.orb} stopOpacity="0.78" />
              <stop offset="35%" stopColor={sky.orbGlow} stopOpacity="0.28" />
              <stop offset="100%" stopColor={sky.orbGlow} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-water`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={phase === 'night' ? '#152742' : '#28405c'} />
              <stop offset="50%" stopColor={phase === 'night' ? '#0a1527' : '#16283e'} />
              <stop offset="100%" stopColor="#030710" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width="1920" height="630" fill={`url(#${uid}-sky)`} />
          <rect x="0" y="0" width="1920" height="630" fill={`url(#${uid}-moon)`} />
          <StarField isAnim={isAnim} opacity={phase === 'day' ? 0.12 : 0.9} />
          <circle cx="960" cy="240" r="46" fill={sky.orb} opacity="0.96" />

          {/* Alpine cathedral peaks */}
          <polygon points="-40,630 220,415 470,545 760,340 960,475 1190,320 1470,520 1720,400 1960,630" fill={mtnDark} />
          <polygon points="760,340 845,455 680,505" fill={mtnLit} opacity="0.65" />
          <polygon points="1190,320 1285,465 1110,495" fill={mtnLit} opacity="0.72" />

          {/* Mirror lake */}
          <rect x="0" y="630" width="1920" height="450" fill={`url(#${uid}-water)`} />
          {/* Inverted mountain reflection */}
          <polygon points="-40,630 220,835 470,715 760,910 960,775 1190,930 1470,735 1720,850 1960,630" fill="#040a14" opacity="0.54" />

          {/* Shimmering water ripples under moon */}
          <g>
            {Array.from({ length: 13 }).map((_, i) => {
              const y = 650 + i * 31;
              const w = 90 + (i % 4) * 38 + i * 10;
              return (
                <rect
                  key={i}
                  x={960 - w / 2}
                  y={y}
                  width={w}
                  height={2.4}
                  rx="1.5"
                  fill={sky.orb}
                  opacity={Math.max(0.1, 0.62 - i * 0.036)}
                  className={isAnim ? 'wp-shimmer' : undefined}
                  style={isAnim ? { animationDelay: `-${(i * 0.31).toFixed(2)}s` } : undefined}
                />
              );
            })}
          </g>

          {/* Lakeside pine framing silhouettes */}
          <polygon points="-20,630 45,510 110,630 165,535 230,630" fill="#030710" />
          <polygon points="1690,630 1755,525 1825,630 1880,495 1950,630" fill="#030710" />
        </svg>
      );
    }

    /* ─── 4. YAĞMURLU ORMAN (Atmospheric Misty Pine Forest — Animated Live!) ─── */
    case 'rainy-forest':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={dark ? '#060c11' : '#334857'} />
              <stop offset="48%" stopColor={dark ? '#11212a' : '#587281'} />
              <stop offset="100%" stopColor={dark ? '#1b313b' : '#8da5b1'} />
            </linearGradient>
            <linearGradient id={`${uid}-fog`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={dark ? '#94a3b8' : '#f1f5f9'} stopOpacity="0" />
              <stop offset="50%" stopColor={dark ? '#64748b' : '#e2e8f0'} stopOpacity={dark ? '0.28' : '0.52'} />
              <stop offset="100%" stopColor={dark ? '#0f172a' : '#cbd5e1'} stopOpacity="0" />
            </linearGradient>
            {!lowDetail && (
              <filter id={`${uid}-blur`} x="-10%" y="-10%" width="120%" height="120%">
                <feGaussianBlur stdDeviation="22" />
              </filter>
            )}
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-sky)`} />

          {/* Distant hazy mountain & pine layer 1 */}
          <path d="M-40,560 C340,420 680,530 1120,415 C1480,330 1740,470 1960,425 L1960,1080 L-40,1080 Z" fill={dark ? '#14262e' : '#4a6572'} />
          <rect x="-80" y="420" width="2080" height="240" fill={`url(#${uid}-fog)`} className={isAnim ? 'wp-mist' : undefined} />

          {/* Mid-distant jagged spruce canopy layer 2 */}
          <path
            d="M-20,1080 L-20,660 L40,590 L95,650 L160,555 L225,645 L295,570 L365,650 L445,540 L520,635 L605,565 L685,648 L770,535 L855,635 L940,555 L1030,645 L1120,540 L1210,638 L1305,560 L1395,646 L1490,532 L1580,635 L1675,565 L1765,648 L1855,548 L1950,650 L1950,1080 Z"
            fill={dark ? '#0c1a20' : '#2f4954'}
          />
          <rect x="-80" y="590" width="2080" height="220" fill={`url(#${uid}-fog)`} className={isAnim ? 'wp-mist' : undefined} style={isAnim ? { animationDelay: '-7s' } : undefined} />

          {/* Foreground dark pine silhouettes */}
          <path
            d="M-20,1080 L-20,765 L55,645 L125,755 L205,610 L290,748 L380,655 L465,770 L560,620 L655,758 L755,670 L850,778 L955,635 L1055,765 L1160,660 L1265,775 L1375,625 L1480,762 L1590,655 L1695,770 L1805,620 L1940,760 L1940,1080 Z"
            fill={dark ? '#050c0f' : '#182b33'}
          />
          <ellipse cx="960" cy="960" rx="940" ry="110" fill={dark ? '#1e3a44' : '#cbd5e1'} opacity="0.22" filter={fUrl('blur')} />

          {/* Layered angled rain streaks */}
          <g stroke={dark ? '#bae6fd' : '#f8fafc'} strokeLinecap="round">
            {Array.from({ length: 34 }).map((_, i) => {
              const x = (i * 63 + 25) % 1960;
              const y = (i * 117) % 860;
              const len = 36 + (i % 4) * 16;
              return (
                <line
                  key={i}
                  x1={x}
                  y1={y}
                  x2={x - len * 0.22}
                  y2={y + len}
                  strokeWidth={i % 3 === 0 ? 1.5 : 0.95}
                  opacity={dark ? 0.34 : 0.42}
                  className={isAnim ? 'wp-rain' : undefined}
                  style={isAnim ? { animationDelay: `-${((i * 0.11) % 1.55).toFixed(2)}s` } : undefined}
                />
              );
            })}
          </g>
        </svg>
      );

    /* ─── 5. KİRAZ ÇİÇEĞİ (Twilight Sakura Bough & Drifting Petals — Animated Live!) ─── */
    case 'cherry-blossom':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0.2" y2="1">
              <stop offset="0%" stopColor={dark ? '#120c1c' : '#f7dce5'} />
              <stop offset="50%" stopColor={dark ? '#281730' : '#f9c7d8'} />
              <stop offset="100%" stopColor={dark ? '#442038' : '#fde7ef'} />
            </linearGradient>
            <radialGradient id={`${uid}-moon`} cx="68%" cy="32%" r="36%">
              <stop offset="0%" stopColor={dark ? '#fbcfe8' : '#ffffff'} stopOpacity={dark ? '0.42' : '0.88'} />
              <stop offset="50%" stopColor={dark ? '#f472b6' : '#fbcfe8'} stopOpacity={dark ? '0.14' : '0.35'} />
              <stop offset="100%" stopColor={dark ? '#281730' : '#f9c7d8'} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-hill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={dark ? '#26142a' : '#cfa0b5'} />
              <stop offset="100%" stopColor={dark ? '#100814' : '#b27f98'} />
            </linearGradient>
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-sky)`} />
          <rect width="1920" height="1080" fill={`url(#${uid}-moon)`} />
          <circle cx="1310" cy="340" r="68" fill={dark ? '#fdf2f8' : '#ffffff'} opacity={dark ? '0.82' : '0.92'} />

          {/* Layered misty twilight hills */}
          <path d="M-40,780 C360,645 780,740 1240,635 C1560,565 1780,680 1960,625 L1960,1080 L-40,1080 Z" fill={`url(#${uid}-hill)`} opacity="0.65" />
          <path d="M-40,885 C420,780 940,890 1440,790 C1700,740 1850,805 1960,785 L1960,1080 L-40,1080 Z" fill={dark ? '#120816' : '#8b5e76'} opacity="0.86" />

          {/* Graceful ink-style cherry bough sweeping in from upper-left */}
          <g>
            <path d="M-40,210 C190,190 420,255 680,195 C840,158 960,195 1090,165" stroke={dark ? '#1e0e1d' : '#4a2538'} strokeWidth="18" fill="none" strokeLinecap="round" />
            <path d="M290,220 C410,300 540,345 710,330" stroke={dark ? '#1e0e1d' : '#4a2538'} strokeWidth="10" fill="none" strokeLinecap="round" />
            <path d="M590,210 C670,135 760,95 875,92" stroke={dark ? '#1e0e1d' : '#4a2538'} strokeWidth="8" fill="none" strokeLinecap="round" />
            {/* Blossom clusters */}
            {[
              [160, 195, 36], [285, 220, 44], [430, 240, 40], [585, 205, 48],
              [715, 190, 38], [855, 100, 34], [965, 175, 42], [1085, 165, 32],
              [495, 315, 36], [645, 332, 42], [725, 325, 30], [340, 170, 30],
            ].map(([cx, cy, r], i) => (
              <g key={i}>
                <circle cx={cx} cy={cy} r={r} fill={dark ? '#f472b6' : '#f9a8d4'} opacity={dark ? 0.52 : 0.72} />
                <circle cx={cx - r * 0.25} cy={cy - r * 0.2} r={r * 0.65} fill="#fbcfe8" opacity="0.78" />
                <circle cx={cx + r * 0.2} cy={cy + r * 0.15} r={r * 0.45} fill="#fdf2f8" opacity="0.82" />
              </g>
            ))}
          </g>

          {/* 18 Sculpted drifting sakura petals across depth planes */}
          <g>
            {Array.from({ length: 18 }).map((_, i) => {
              const x = (i * 112 + 70) % 1840;
              const y = (i * 68) % 520;
              const s = 0.65 + (i % 4) * 0.28;
              return (
                <path
                  key={i}
                  d={`M${x},${y} C${x + 12 * s},${y - 8 * s} ${x + 22 * s},${y + 4 * s} ${x + 10 * s},${y + 14 * s} C${x + 2 * s},${y + 10 * s} ${x - 2 * s},${y + 4 * s} ${x},${y} Z`}
                  fill={i % 2 === 0 ? '#fbcfe8' : '#f9a8d4'}
                  opacity={0.78}
                  className={isAnim ? 'wp-petal' : undefined}
                  style={
                    isAnim
                      ? {
                          animationDelay: `-${((i * 0.75) % 12).toFixed(2)}s`,
                          animationDuration: `${10.5 + (i % 5) * 1.8}s`,
                        }
                      : undefined
                  }
                />
              );
            })}
          </g>
        </svg>
      );

    /* ─── 6. KARLI ÇAMLIK (Alpine Winter Twilight & Snowfall — Animated Live!) ─── */
    case 'snowy-pines':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={dark ? '#060d19' : '#8fb1ce'} />
              <stop offset="56%" stopColor={dark ? '#11223a' : '#bdd5e8'} />
              <stop offset="100%" stopColor={dark ? '#1e3a59' : '#e6f0f8'} />
            </linearGradient>
            <radialGradient id={`${uid}-halo`} cx="30%" cy="28%" r="36%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity={dark ? '0.32' : '0.85'} />
              <stop offset="55%" stopColor="#bae6fd" stopOpacity={dark ? '0.12' : '0.32'} />
              <stop offset="100%" stopColor="#bae6fd" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-snowhill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={dark ? '#cbd5e1' : '#ffffff'} />
              <stop offset="100%" stopColor={dark ? '#64748b' : '#cbd5e1'} />
            </linearGradient>
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-sky)`} />
          <rect width="1920" height="1080" fill={`url(#${uid}-halo)`} />
          <circle cx="575" cy="290" r="44" fill="#f8fafc" opacity={dark ? '0.88' : '0.95'} />

          {/* Snow-capped distant alpine massif */}
          <polygon points="-40,760 280,460 540,620 920,410 1280,590 1620,445 1960,640 1960,1080 -40,1080" fill={dark ? '#1c334c' : '#7a9ab8'} />
          <polygon points="280,460 355,540 215,545" fill="#f8fafc" opacity={dark ? '0.32' : '0.72'} />
          <polygon points="920,410 1010,505 845,510" fill="#f8fafc" opacity={dark ? '0.38' : '0.78'} />
          <polygon points="1620,445 1705,535 1555,535" fill="#f8fafc" opacity={dark ? '0.32' : '0.72'} />

          {/* Frosted snow drift foreground */}
          <path d="M-40,835 C380,745 860,860 1380,775 C1660,730 1840,795 1960,770 L1960,1080 L-40,1080 Z" fill={`url(#${uid}-snowhill)`} opacity={dark ? '0.26' : '0.88'} />

          {/* Frosted foreground pine silhouettes */}
          <path
            d="M-20,1080 L-20,760 L65,610 L150,760 L235,580 L325,755 L415,650 L505,785 L605,630 L705,780 L820,690 L930,810 L1060,675 L1175,800 L1295,645 L1405,775 L1520,605 L1630,760 L1745,575 L1860,750 L1960,635 L1960,1080 Z"
            fill={dark ? '#091522' : '#2a455c'}
          />

          {/* 26 Multi-depth drifting snowflakes */}
          <g fill="#ffffff">
            {Array.from({ length: 26 }).map((_, i) => {
              const cx = (i * 77 + 34) % 1900;
              const cy = (i * 93) % 920;
              const r = 1.6 + (i % 4) * 1.1;
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={r}
                  opacity={0.45 + (i % 4) * 0.14}
                  className={isAnim ? 'wp-snow' : undefined}
                  style={
                    isAnim
                      ? {
                          animationDelay: `-${((i * 0.55) % 13).toFixed(2)}s`,
                          animationDuration: `${11 + (i % 5) * 2.2}s`,
                        }
                      : undefined
                  }
                />
              );
            })}
          </g>
        </svg>
      );

    /* ─── 7. YILDIZLI NEBULA (Deep-Space Cosmic Clouds — Animated Live!) ─── */
    case 'starry-nebula':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-space`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#020309" />
              <stop offset="50%" stopColor="#070b1a" />
              <stop offset="100%" stopColor="#04050d" />
            </linearGradient>
            <radialGradient id={`${uid}-neb1`} cx="36%" cy="44%" r="48%">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.46" />
              <stop offset="48%" stopColor="#312e81" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#020309" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${uid}-neb2`} cx="68%" cy="56%" r="46%">
              <stop offset="0%" stopColor="#ec4899" stopOpacity="0.34" />
              <stop offset="45%" stopColor="#7e22ce" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#020309" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${uid}-neb3`} cx="54%" cy="32%" r="36%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.36" />
              <stop offset="50%" stopColor="#0284c7" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#020309" stopOpacity="0" />
            </radialGradient>
            {!lowDetail && (
              <filter id={`${uid}-cloud`} x="-25%" y="-25%" width="150%" height="150%">
                <feGaussianBlur stdDeviation="42" />
              </filter>
            )}
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-space)`} />
          <g className={isAnim ? 'wp-float' : undefined}>
            <rect width="1920" height="1080" fill={`url(#${uid}-neb1)`} />
            <ellipse cx="760" cy="490" rx="520" ry="220" transform="rotate(-18 760 490)" fill="#4f46e5" opacity="0.24" filter={fUrl('cloud')} />
          </g>
          <g className={isAnim ? 'wp-float-b' : undefined}>
            <rect width="1920" height="1080" fill={`url(#${uid}-neb2)`} />
            <ellipse cx="1220" cy="590" rx="460" ry="190" transform="rotate(14 1220 590)" fill="#db2777" opacity="0.22" filter={fUrl('cloud')} />
          </g>
          <g className={isAnim ? 'wp-glow' : undefined}>
            <rect width="1920" height="1080" fill={`url(#${uid}-neb3)`} />
            <ellipse cx="1010" cy="430" rx="280" ry="120" transform="rotate(-24 1010 430)" fill="#38bdf8" opacity="0.20" filter={fUrl('cloud')} />
          </g>

          {/* Dense multi-magnitude cosmic starfield */}
          <StarField isAnim={isAnim} opacity={0.95} />
          <g opacity="0.72">
            {[
              [260, 440, 1.2], [440, 620, 1.5], [680, 520, 1.8], [890, 430, 2.2],
              [1120, 580, 1.6], [1340, 460, 1.9], [1580, 640, 1.3], [1740, 490, 1.5],
              [310, 820, 1.1], [620, 880, 1.4], [980, 790, 1.7], [1420, 860, 1.2],
              [1690, 810, 1.5], [140, 690, 1.1], [1040, 350, 2.0],
            ].map(([cx, cy, r], i) => (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                fill={i % 3 === 0 ? '#bae6fd' : i % 3 === 1 ? '#fde68a' : '#f8fafc'}
                className={isAnim && i % 3 === 0 ? 'wp-twinkle' : undefined}
                style={isAnim ? { animationDelay: `-${(i * 0.42).toFixed(2)}s` } : undefined}
              />
            ))}
          </g>
        </svg>
      );

    /* ─── 8. İPEK AKIŞI (TamgaOS Signature Sculpted Liquid Silk — Animated Live!) ─── */
    case 'silk-flow':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={dark ? '#05060b' : '#ebeef5'} />
              <stop offset="50%" stopColor={dark ? '#0d101c' : '#f7f8fc'} />
              <stop offset="100%" stopColor={dark ? '#06070d' : '#dfe4f0'} />
            </linearGradient>
            <linearGradient id={`${uid}-s1`} x1="0" y1="0" x2="1" y2="0.6">
              <stop offset="0%" stopColor={dark ? '#1e1b4b' : '#c7d2fe'} stopOpacity="0.92" />
              <stop offset="45%" stopColor={dark ? '#4338ca' : '#818cf8'} stopOpacity={dark ? '0.68' : '0.48'} />
              <stop offset="80%" stopColor={dark ? '#0ea5e9' : '#38bdf8'} stopOpacity={dark ? '0.52' : '0.36'} />
              <stop offset="100%" stopColor={dark ? '#090b12' : '#e0e7ff'} stopOpacity="0.1" />
            </linearGradient>
            <linearGradient id={`${uid}-s2`} x1="1" y1="0" x2="0" y2="0.8">
              <stop offset="0%" stopColor={dark ? '#312e81' : '#e9d5ff'} stopOpacity="0.82" />
              <stop offset="52%" stopColor={dark ? '#7c3aed' : '#a855f7'} stopOpacity={dark ? '0.48' : '0.34'} />
              <stop offset="100%" stopColor={dark ? '#06080f' : '#f5f3ff'} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="35%" stopColor={dark ? '#bae6fd' : '#ffffff'} stopOpacity={dark ? '0.72' : '0.96'} />
              <stop offset="68%" stopColor={dark ? '#c4b5fd' : '#e0e7ff'} stopOpacity={dark ? '0.58' : '0.85'} />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
            {!lowDetail && (
              <filter id={`${uid}-soft`} x="-15%" y="-15%" width="130%" height="130%">
                <feGaussianBlur stdDeviation="16" />
              </filter>
            )}
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-bg)`} />

          {/* Sculpted satin ribbon 1 */}
          <g className={isAnim ? 'wp-silk' : undefined}>
            <path
              d="M-140,680 C240,390 640,860 1120,440 C1480,125 1780,460 2060,290 L2060,640 C1720,760 1440,460 1080,770 C620,1150 220,700 -140,960 Z"
              fill={`url(#${uid}-s1)`}
              filter={fUrl('soft')}
            />
            <path
              d="M-120,690 C250,405 645,865 1120,450 C1480,140 1775,468 2050,305"
              fill="none"
              stroke={`url(#${uid}-rim)`}
              strokeWidth="2.4"
            />
          </g>

          {/* Sculpted satin ribbon 2 */}
          <g className={isAnim ? 'wp-silk-b' : undefined}>
            <path
              d="M-140,380 C320,690 780,180 1290,540 C1620,770 1840,560 2060,640 L2060,920 C1780,820 1560,1040 1210,790 C740,455 290,940 -140,640 Z"
              fill={`url(#${uid}-s2)`}
              filter={fUrl('soft')}
            />
            <path
              d="M-120,395 C325,700 785,195 1290,552 C1615,780 1835,575 2050,652"
              fill="none"
              stroke={`url(#${uid}-rim)`}
              strokeWidth="1.8"
              opacity="0.72"
            />
          </g>
        </svg>
      );

    /* ─── 9. VOLKANİK PARILTI (Basalt Caldera & Rising Embers — Animated Live!) ─── */
    case 'volcanic-glow':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#070406" />
              <stop offset="52%" stopColor="#19080c" />
              <stop offset="86%" stopColor="#3b1112" />
              <stop offset="100%" stopColor="#140607" />
            </linearGradient>
            <radialGradient id={`${uid}-caldera`} cx="52%" cy="82%" r="54%">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.62" />
              <stop offset="32%" stopColor="#ea580c" stopOpacity="0.46" />
              <stop offset="68%" stopColor="#991b1b" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#070406" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-lava`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#dc2626" stopOpacity="0.1" />
              <stop offset="35%" stopColor="#f97316" stopOpacity="0.9" />
              <stop offset="52%" stopColor="#fef08a" stopOpacity="1" />
              <stop offset="70%" stopColor="#ea580c" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#dc2626" stopOpacity="0.1" />
            </linearGradient>
            {!lowDetail && (
              <filter id={`${uid}-glow`} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="14" />
              </filter>
            )}
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-sky)`} />
          <g className={isAnim ? 'wp-glow' : undefined}>
            <rect width="1920" height="1080" fill={`url(#${uid}-caldera)`} />
          </g>

          {/* Distant smoking obsidian ridge */}
          <polygon points="-40,760 320,560 660,670 980,520 1320,660 1650,550 1960,720 1960,1080 -40,1080" fill="#170709" />

          {/* Glowing molten fissure veins */}
          <path d="M580,820 C760,770 880,795 1010,750 C1140,785 1290,775 1440,835" fill="none" stroke={`url(#${uid}-lava)`} strokeWidth="9" filter={fUrl('glow')} className={isAnim ? 'wp-glow' : undefined} />
          <path d="M580,820 C760,770 880,795 1010,750 C1140,785 1290,775 1440,835" fill="none" stroke="#fef08a" strokeWidth="2.5" opacity="0.88" />

          {/* Foreground craggy basalt silhouette */}
          <polygon points="-40,1080 -40,790 290,715 560,840 780,795 1020,865 1280,790 1560,840 1790,720 1960,805 1960,1080" fill="#080305" />

          {/* 16 Rising glowing ember sparks */}
          <g>
            {Array.from({ length: 16 }).map((_, i) => {
              const cx = 340 + i * 82 + ((i * 23) % 35);
              const cy = 760 + (i % 4) * 45;
              const r = 1.6 + (i % 3) * 1.1;
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={i % 2 === 0 ? '#fde047' : '#fb923c'}
                  className={isAnim ? 'wp-ember' : undefined}
                  style={
                    isAnim
                      ? {
                          animationDelay: `-${((i * 0.58) % 7.5).toFixed(2)}s`,
                          animationDuration: `${6.2 + (i % 4) * 1.4}s`,
                        }
                      : undefined
                  }
                />
              );
            })}
          </g>
        </svg>
      );

    /* ─── 10. BAMBU KORUSU (Misty Ink-Wash Bamboo Grove — Static Studio) ─── */
    case 'bamboo-breeze':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0.3" y2="1">
              <stop offset="0%" stopColor={dark ? '#06120e' : '#dfeee5'} />
              <stop offset="52%" stopColor={dark ? '#0f271f' : '#c6e2d1'} />
              <stop offset="100%" stopColor={dark ? '#071712' : '#9fc9b1'} />
            </linearGradient>
            <linearGradient id={`${uid}-shaft`} x1="0" y1="0" x2="0.4" y2="1">
              <stop offset="0%" stopColor={dark ? '#a7f3d0' : '#ffffff'} stopOpacity={dark ? '0.16' : '0.58'} />
              <stop offset="100%" stopColor={dark ? '#a7f3d0' : '#ffffff'} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${uid}-stalk`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={dark ? '#062016' : '#2d5a42'} />
              <stop offset="42%" stopColor={dark ? '#1f5c41' : '#538a68'} />
              <stop offset="100%" stopColor={dark ? '#071c13' : '#234a35'} />
            </linearGradient>
            {!lowDetail && (
              <filter id={`${uid}-mist`} x="-10%" y="-10%" width="120%" height="120%">
                <feGaussianBlur stdDeviation="24" />
              </filter>
            )}
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-bg)`} />

          {/* Diagonal volumetric sunbeams filtering through the grove */}
          <polygon points="360,0 640,0 1120,1080 760,1080" fill={`url(#${uid}-shaft)`} />
          <polygon points="940,0 1160,0 1640,1080 1320,1080" fill={`url(#${uid}-shaft)`} opacity="0.72" />

          {/* Far atmospheric bamboo layer (soft depth) */}
          <g opacity={dark ? '0.28' : '0.32'}>
            {[120, 310, 520, 740, 990, 1210, 1460, 1690, 1840].map((x, i) => (
              <rect key={i} x={x} y="0" width={12 + (i % 3) * 4} height="1080" fill={dark ? '#143829' : '#4a7c5f'} transform={`rotate(${(i % 2 === 0 ? 1 : -1) * 1.6} ${x} 1080)`} />
            ))}
          </g>

          {/* Soft forest ground mist */}
          <ellipse cx="960" cy="860" rx="1020" ry="180" fill={dark ? '#134e3a' : '#f0fdf4'} opacity={dark ? '0.26' : '0.62'} filter={fUrl('mist')} className={isAnim ? 'wp-mist' : undefined} />

          {/* Sculpted foreground segmented bamboo stalks with joints & lance leaf clusters */}
          {[
            { x: 185, w: 30, tilt: -2.4, opacity: 0.92 },
            { x: 350, w: 22, tilt: 1.8, opacity: 0.78 },
            { x: 640, w: 26, tilt: -1.4, opacity: 0.82 },
            { x: 1320, w: 24, tilt: 2.1, opacity: 0.80 },
            { x: 1580, w: 34, tilt: -2.0, opacity: 0.94 },
            { x: 1755, w: 26, tilt: 1.5, opacity: 0.88 },
          ].map((s, idx) => (
            <g
              key={idx}
              opacity={s.opacity}
              className={isAnim ? (idx % 2 === 0 ? 'wp-sway' : 'wp-sway-b') : undefined}
              style={isAnim ? { animationDelay: `-${(idx * 0.7).toFixed(2)}s` } : undefined}
            >
              <g transform={`rotate(${s.tilt} ${s.x} 1080)`}>
              <rect x={s.x - s.w / 2} y="-20" width={s.w} height="1120" rx="4" fill={`url(#${uid}-stalk)`} />
              {[150, 340, 535, 735, 925].map((ny, j) => (
                <g key={j}>
                  <rect x={s.x - s.w / 2 - 2} y={ny} width={s.w + 4} height="5" rx="2.5" fill={dark ? '#6ee7b7' : '#d1fae5'} opacity={dark ? '0.35' : '0.72'} />
                  <rect x={s.x - s.w / 2 - 2} y={ny + 5} width={s.w + 4} height="3" rx="1.5" fill="#030d09" opacity="0.45" />
                  {(idx + j) % 2 === 0 && (
                    <g transform={`translate(${s.x + (idx % 2 === 0 ? s.w / 2 : -s.w / 2)}, ${ny})`}>
                      <path
                        d={idx % 2 === 0 ? 'M0,0 Q42,-28 96,-14 Q48,8 0,0 Z' : 'M0,0 Q-42,-28 -96,-14 Q-48,8 0,0 Z'}
                        fill={dark ? '#1c533c' : '#3a7253'}
                      />
                      <path
                        d={idx % 2 === 0 ? 'M0,2 Q56,-4 108,24 Q46,24 0,2 Z' : 'M0,2 Q-56,-4 -108,24 Q-46,24 0,2 Z'}
                        fill={dark ? '#287052' : '#4d8b68'}
                        opacity="0.86"
                      />
                    </g>
                  )}
                </g>
              ))}
              </g>
            </g>
          ))}
        </svg>
      );

    /* ─── 11. LAVANTA VADİSİ (Provence Perspective Rows — Static Desktop / Animated Screensaver) ─── */
    case 'lavender-valley': {
      const rowA = phase === 'night' ? '#3b1f5e' : '#6d28d9';
      const rowB = phase === 'night' ? '#581c87' : '#8b5cf6';
      const ground = phase === 'night' ? '#120b20' : '#2e1645';
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={phase === 'night' ? '#09071a' : phase === 'day' ? '#4338ca' : '#1f1238'} />
              <stop offset="56%" stopColor={phase === 'night' ? '#241442' : phase === 'day' ? '#818cf8' : '#7e3a6b'} />
              <stop offset="100%" stopColor={phase === 'night' ? '#3d245e' : phase === 'day' ? '#e0e7ff' : '#f5b085'} />
            </linearGradient>
            <radialGradient id={`${uid}-glow`} cx="50%" cy="48%" r="44%">
              <stop offset="0%" stopColor={phase === 'night' ? '#c084fc' : '#fde68a'} stopOpacity="0.45" />
              <stop offset="100%" stopColor="#4c1d95" stopOpacity="0" />
            </radialGradient>
          </defs>

          <rect width="1920" height="580" fill={`url(#${uid}-sky)`} />
          <rect width="1920" height="620" fill={`url(#${uid}-glow)`} className={isAnim ? 'wp-glow' : undefined} />
          {phase === 'night' && <StarField isAnim={isAnim} opacity={0.75} />}

          {/* Rolling Provence foothills */}
          <path d="M-40,560 C340,470 720,520 1120,468 C1480,422 1740,510 1960,480 L1960,600 L-40,600 Z" fill={phase === 'night' ? '#1f153a' : '#58447e'} />
          <path d="M-40,585 C420,520 960,565 1480,525 C1720,506 1860,545 1960,535 L1960,620 L-40,620 Z" fill={phase === 'night' ? '#160d2b' : '#3e2760'} />

          {/* Perspective lavender field vanishing at (960, 560) */}
          <rect x="0" y="560" width="1920" height="520" fill={ground} />
          {[-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
            const topX = 960 + i * 32;
            const botX = 960 + i * 240;
            const wTop = 10;
            const wBot = 92;
            return (
              <g key={i}>
                <polygon
                  points={`${topX - wTop / 2},564 ${topX + wTop / 2},564 ${botX + wBot / 2},1080 ${botX - wBot / 2},1080`}
                  fill={i % 2 === 0 ? rowA : rowB}
                  opacity={0.86}
                />
                <line
                  x1={topX}
                  y1={564}
                  x2={botX}
                  y2={1080}
                  stroke="#ddd6fe"
                  strokeWidth={Math.abs(i) < 3 ? 2.2 : 1.3}
                  opacity="0.32"
                />
              </g>
            );
          })}
          {/* Soft valley horizon haze */}
          <rect x="0" y="535" width="1920" height="68" fill={phase === 'night' ? '#3b245e' : '#f5d0fe'} opacity="0.22" className={isAnim ? 'wp-mist' : undefined} />
        </svg>
      );
    }

    /* ─── 12. KIZIL KANYON (Stratified Sandstone Mesas — Static Desktop / Animated Screensaver) ─── */
    case 'red-canyon': {
      const rockFar = phase === 'night' ? '#2c1318' : '#8c3b2c';
      const rockMid = phase === 'night' ? '#200c11' : '#73291f';
      const rockLit = phase === 'night' ? '#4f1e22' : '#c95c38';
      const rockFg = phase === 'night' ? '#0e0507' : '#3a130f';
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={phase === 'night' ? '#0c0712' : '#2d142c'} />
              <stop offset="48%" stopColor={phase === 'night' ? '#2b1322' : '#9e3836'} />
              <stop offset="86%" stopColor={phase === 'night' ? '#522224' : '#ea7d4b'} />
              <stop offset="100%" stopColor={phase === 'night' ? '#240f12' : '#fbc687'} />
            </linearGradient>
            <radialGradient id={`${uid}-sun`} cx="62%" cy="46%" r="38%">
              <stop offset="0%" stopColor={phase === 'night' ? '#f8fafc' : '#fff7ed'} stopOpacity={phase === 'night' ? '0.32' : '0.88'} />
              <stop offset="45%" stopColor="#fb923c" stopOpacity={phase === 'night' ? '0.08' : '0.35'} />
              <stop offset="100%" stopColor="#9e3836" stopOpacity="0" />
            </radialGradient>
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-sky)`} />
          <rect width="1920" height="1080" fill={`url(#${uid}-sun)`} className={isAnim ? 'wp-glow' : undefined} />
          {phase === 'night' && <StarField isAnim={isAnim} opacity={0.7} />}

          {/* Iconic flat-top sandstone mesas */}
          <polygon points="-20,660 190,660 235,510 510,510 555,650 860,650 915,470 1190,470 1245,640 1560,640 1605,530 1830,530 1875,660 1960,660 1960,1080 -20,1080" fill={rockFar} />
          {/* Sunlit mesa rim highlights */}
          <polygon points="915,470 1190,470 1175,495 925,495" fill={rockLit} opacity="0.82" />
          <polygon points="235,510 510,510 495,532 245,532" fill={rockLit} opacity="0.72" />

          {/* Mid canyon stratified cliffs */}
          <path d="M-40,760 L340,680 L610,745 L980,695 L1340,750 L1660,670 L1960,740 L1960,1080 L-40,1080 Z" fill={rockMid} />
          {/* Sedimentary strata bands */}
          <path d="M-40,795 L340,720 L610,782 L980,735 L1340,788 L1660,710 L1960,775" fill="none" stroke={rockLit} strokeWidth="6" opacity="0.34" />
          <path d="M-40,845 L340,775 L610,835 L980,788 L1340,840 L1660,765 L1960,828" fill="none" stroke={rockLit} strokeWidth="4" opacity="0.24" />

          {/* Foreground framing canyon gorge walls */}
          <polygon points="-40,1080 -40,610 185,680 340,860 560,1080" fill={rockFg} />
          <polygon points="1960,1080 1960,600 1745,690 1560,875 1340,1080" fill={rockFg} />
          <path d="M520,1080 C760,940 1140,940 1380,1080 Z" fill="#1a0808" opacity="0.65" />
        </svg>
      );
    }

    /* ─── 13. GÜNEŞ TUTULMASI (Astronomical Totality & Diamond Ring — Static Desktop / Animated Screensaver) ─── */
    case 'solar-eclipse':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <radialGradient id={`${uid}-space`} cx="50%" cy="48%" r="68%">
              <stop offset="0%" stopColor="#14182a" />
              <stop offset="42%" stopColor="#070912" />
              <stop offset="100%" stopColor="#020306" />
            </radialGradient>
            <radialGradient id={`${uid}-corona`} cx="50%" cy="48%" r="42%">
              <stop offset="28%" stopColor="#fff7ed" stopOpacity="0.96" />
              <stop offset="35%" stopColor="#fdba74" stopOpacity="0.62" />
              <stop offset="52%" stopColor="#60a5fa" stopOpacity="0.22" />
              <stop offset="76%" stopColor="#1e3a8a" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#020306" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${uid}-diamond`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
              <stop offset="28%" stopColor="#fef08a" stopOpacity="0.88" />
              <stop offset="65%" stopColor="#fb923c" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#fb923c" stopOpacity="0" />
            </radialGradient>
            {!lowDetail && (
              <>
                <filter id={`${uid}-blur`} x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="24" />
                </filter>
                <filter id={`${uid}-fine`} x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="5" />
                </filter>
              </>
            )}
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-space)`} />
          <StarField isAnim={isAnim} opacity={0.72} />

          {/* Asymmetric pearlescent solar corona plasma streamers */}
          <g className={isAnim ? 'wp-glow' : undefined}>
            <ellipse cx="960" cy="518" rx="680" ry="155" transform="rotate(-14 960 518)" fill="#bae6fd" opacity="0.16" filter={fUrl('blur')} />
            <ellipse cx="960" cy="518" rx="520" ry="195" transform="rotate(11 960 518)" fill="#fed7aa" opacity="0.14" filter={fUrl('blur')} />
            <rect width="1920" height="1080" fill={`url(#${uid}-corona)`} />
          </g>

          {/* Crisp inner chromosphere ring */}
          <circle cx="960" cy="518" r="196" fill="none" stroke="#fff7ed" strokeWidth="5.5" opacity="0.92" filter={fUrl('fine')} />
          <circle cx="960" cy="518" r="194" fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.96" />

          {/* Velvety obsidian lunar disc */}
          <circle cx="960" cy="518" r="191" fill="#030408" />

          {/* Diamond-ring flare on upper-right limb */}
          <g className={isAnim ? 'wp-twinkle' : undefined}>
            <circle cx="1102" cy="390" r="95" fill={`url(#${uid}-diamond)`} />
            <line x1="990" y1="390" x2="1214" y2="390" stroke="#ffffff" strokeWidth="1.6" opacity="0.72" />
            <line x1="1102" y1="278" x2="1102" y2="502" stroke="#ffffff" strokeWidth="1.6" opacity="0.72" />
            <circle cx="1102" cy="390" r="11" fill="#ffffff" />
          </g>
        </svg>
      );

    /* ─── 14. BUZUL YANSIMASI (Arctic Faceted Glacier & Mirror Fjord — Static Desktop / Animated Screensaver) ─── */
    case 'glacial-mirror':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={dark ? '#05101c' : '#9ac4de'} />
              <stop offset="56%" stopColor={dark ? '#0d253a' : '#c6e2f2'} />
              <stop offset="100%" stopColor={dark ? '#17425c' : '#ecf7fc'} />
            </linearGradient>
            <linearGradient id={`${uid}-iceLit`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={dark ? '#e0f2fe' : '#ffffff'} />
              <stop offset="60%" stopColor={dark ? '#7dd3fc' : '#bae6fd'} />
              <stop offset="100%" stopColor={dark ? '#0284c7' : '#38bdf8'} />
            </linearGradient>
            <linearGradient id={`${uid}-iceShd`} x1="0" y1="0" x2="0.6" y2="1">
              <stop offset="0%" stopColor={dark ? '#0f3b57' : '#3885b2'} />
              <stop offset="100%" stopColor={dark ? '#071b2c' : '#1b5074'} />
            </linearGradient>
            <linearGradient id={`${uid}-water`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={dark ? '#0b2539' : '#639ec0'} />
              <stop offset="45%" stopColor={dark ? '#061523' : '#386f94'} />
              <stop offset="100%" stopColor={dark ? '#020810' : '#1c4461'} />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width="1920" height="620" fill={`url(#${uid}-sky)`} />
          {/* Main faceted iceberg & glacier massif */}
          <polygon points="120,620 430,340 530,620" fill={`url(#${uid}-iceLit)`} />
          <polygon points="430,340 720,620 530,620" fill={`url(#${uid}-iceShd)`} />

          <polygon points="620,620 980,235 1090,620" fill={`url(#${uid}-iceLit)`} />
          <polygon points="980,235 1380,620 1090,620" fill={`url(#${uid}-iceShd)`} />
          <polygon points="980,235 885,440 1045,480" fill="#ffffff" opacity="0.45" />

          <polygon points="1260,620 1560,365 1640,620" fill={`url(#${uid}-iceLit)`} />
          <polygon points="1560,365 1860,620 1640,620" fill={`url(#${uid}-iceShd)`} />

          {/* Mirror fjord water */}
          <rect x="0" y="620" width="1920" height="460" fill={`url(#${uid}-water)`} />
          {/* Clean glacier reflection */}
          <g opacity="0.34">
            <polygon points="120,620 430,890 720,620" fill="#7dd3fc" />
            <polygon points="620,620 980,990 1380,620" fill="#bae6fd" />
            <polygon points="1260,620 1560,870 1860,620" fill="#7dd3fc" />
          </g>
          {/* Crisp water surface sheen lines */}
          <g stroke="#e0f2fe" strokeWidth="1.2" opacity="0.28">
            <line x1="0" y1="620" x2="1920" y2="620" strokeWidth="2" opacity="0.65" />
            <line x1="340" y1="710" x2="1520" y2="710" className={isAnim ? 'wp-shimmer' : undefined} />
            <line x1="560" y1="815" x2="1380" y2="815" className={isAnim ? 'wp-shimmer' : undefined} style={isAnim ? { animationDelay: '-1.5s' } : undefined} />
            <line x1="720" y1="910" x2="1220" y2="910" className={isAnim ? 'wp-shimmer' : undefined} style={isAnim ? { animationDelay: '-2.8s' } : undefined} />
          </g>
        </svg>
      );

    /* ─── 15. SİBER IZGARA (Architectural Dark-Synth Vector Horizon — Static Desktop / Animated Screensaver) ─── */
    case 'cyber-grid':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#04030d" />
              <stop offset="52%" stopColor="#140929" />
              <stop offset="86%" stopColor="#32114a" />
              <stop offset="100%" stopColor="#631b5c" />
            </linearGradient>
            <linearGradient id={`${uid}-sun`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fde047" />
              <stop offset="46%" stopColor="#fb7185" />
              <stop offset="100%" stopColor="#a855f7" />
            </linearGradient>
            <linearGradient id={`${uid}-floor`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1a0930" />
              <stop offset="100%" stopColor="#05030b" />
            </linearGradient>
            <linearGradient id={`${uid}-glow`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.15" />
              <stop offset="50%" stopColor="#f472b6" stopOpacity="0.92" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.15" />
            </linearGradient>
            <clipPath id={`${uid}-sunclip`}>
              <circle cx="960" cy="468" r="188" />
            </clipPath>
          </defs>

          <rect x="0" y="0" width="1920" height="600" fill={`url(#${uid}-sky)`} />
          <StarField isAnim={isAnim} opacity={0.78} />

          {/* Banded twilight retro-modern sun */}
          <g clipPath={`url(#${uid}-sunclip)`} className={isAnim ? 'wp-glow' : undefined}>
            <circle cx="960" cy="468" r="188" fill={`url(#${uid}-sun)`} />
            {[492, 516, 540, 566, 592, 620].map((y, i) => (
              <rect key={i} x="760" y={y} width="400" height={5 + i * 2.8} fill="#1b0a33" />
            ))}
          </g>

          {/* Faceted dark-chrome mountain skyline */}
          <polygon points="-40,600 180,465 370,545 580,445 770,575 960,545 1170,575 1350,435 1560,545 1740,465 1960,600" fill="#0d061b" />
          <polyline points="-40,600 180,465 370,545 580,445 770,575 960,545 1170,575 1350,435 1560,545 1740,465 1960,600" fill="none" stroke="#e879f9" strokeWidth="1.6" opacity="0.65" />

          {/* Perspective vector grid plane */}
          <rect x="0" y="600" width="1920" height="480" fill={`url(#${uid}-floor)`} />
          <g stroke="#22d3ee" strokeWidth="1.3" opacity="0.48">
            {Array.from({ length: 19 }).map((_, i) => {
              const offset = (i - 9) * 140;
              return <line key={i} x1={960 + offset * 0.22} y1="600" x2={960 + offset * 2.4} y2="1080" />;
            })}
          </g>
          <g stroke="#e879f9" strokeWidth="1.2" opacity="0.44">
            {[616, 638, 668, 708, 758, 822, 902, 1002].map((y, i) => (
              <line key={i} x1="0" y1={y} x2="1920" y2={y} />
            ))}
          </g>
          <rect x="0" y="598" width="1920" height="3.5" fill={`url(#${uid}-glow)`} className={isAnim ? 'wp-glow' : undefined} />
        </svg>
      );

    /* ─── 16. CAM KÜRELER (Studio 3D Frosted Glass Spheres — Static Desktop / Animated Screensaver) ─── */
    case 'glass-orbs':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={dark ? '#070910' : '#dfe7f2'} />
              <stop offset="50%" stopColor={dark ? '#111626' : '#eff4fa'} />
              <stop offset="100%" stopColor={dark ? '#080b14' : '#d5e0ee'} />
            </linearGradient>
            <radialGradient id={`${uid}-amb1`} cx="32%" cy="44%" r="44%">
              <stop offset="0%" stopColor={dark ? '#38bdf8' : '#7dd3fc'} stopOpacity={dark ? '0.24' : '0.42'} />
              <stop offset="100%" stopColor={dark ? '#070910' : '#dfe7f2'} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${uid}-amb2`} cx="68%" cy="56%" r="42%">
              <stop offset="0%" stopColor={dark ? '#818cf8' : '#a5b4fc'} stopOpacity={dark ? '0.24' : '0.38'} />
              <stop offset="100%" stopColor={dark ? '#070910' : '#dfe7f2'} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${uid}-orbA`} cx="32%" cy="28%" r="72%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity={dark ? '0.68' : '0.96'} />
              <stop offset="22%" stopColor={dark ? '#7dd3fc' : '#bae6fd'} stopOpacity={dark ? '0.36' : '0.68'} />
              <stop offset="68%" stopColor={dark ? '#1e293b' : '#94a3b8'} stopOpacity={dark ? '0.58' : '0.45'} />
              <stop offset="100%" stopColor={dark ? '#020617' : '#64748b'} stopOpacity={dark ? '0.88' : '0.55'} />
            </radialGradient>
            <radialGradient id={`${uid}-orbB`} cx="30%" cy="26%" r="72%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity={dark ? '0.62' : '0.96'} />
              <stop offset="25%" stopColor={dark ? '#c4b5fd' : '#ddd6fe'} stopOpacity={dark ? '0.34' : '0.65'} />
              <stop offset="70%" stopColor={dark ? '#1e1b4b' : '#94a3b8'} stopOpacity={dark ? '0.62' : '0.42'} />
              <stop offset="100%" stopColor={dark ? '#09091a' : '#475569'} stopOpacity={dark ? '0.90' : '0.52'} />
            </radialGradient>
            <radialGradient id={`${uid}-orbC`} cx="34%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity={dark ? '0.58' : '0.95'} />
              <stop offset="26%" stopColor={dark ? '#5eead4' : '#99f6e4'} stopOpacity={dark ? '0.32' : '0.60'} />
              <stop offset="72%" stopColor={dark ? '#0f2933' : '#94a3b8'} stopOpacity={dark ? '0.62' : '0.42'} />
              <stop offset="100%" stopColor={dark ? '#040c12' : '#475569'} stopOpacity={dark ? '0.90' : '0.50'} />
            </radialGradient>
            {!lowDetail && (
              <>
                <filter id={`${uid}-shadow`} x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="28" />
                </filter>
                <filter id={`${uid}-spec`} x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="8" />
                </filter>
              </>
            )}
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-bg)`} />
          <rect width="1920" height="1080" fill={`url(#${uid}-amb1)`} />
          <rect width="1920" height="1080" fill={`url(#${uid}-amb2)`} />

          {/* Studio glass sphere 1 — Background right */}
          <g className={isAnim ? 'wp-float-b' : undefined}>
            <ellipse cx="1360" cy="690" rx="190" ry="42" fill="#020617" opacity={dark ? '0.55' : '0.16'} filter={fUrl('shadow')} />
            <circle cx="1360" cy="430" r="235" fill={`url(#${uid}-orbB)`} stroke="#ffffff" strokeOpacity={dark ? '0.24' : '0.85'} strokeWidth="1.5" />
            <ellipse cx="1270" cy="330" rx="76" ry="38" transform="rotate(-32 1270 330)" fill="#ffffff" opacity={dark ? '0.28' : '0.72'} filter={fUrl('spec')} />
          </g>

          {/* Studio glass sphere 2 — Hero center-left */}
          <g className={isAnim ? 'wp-float' : undefined}>
            <ellipse cx="740" cy="865" rx="260" ry="52" fill="#020617" opacity={dark ? '0.68' : '0.20'} filter={fUrl('shadow')} />
            <circle cx="740" cy="545" r="295" fill={`url(#${uid}-orbA)`} stroke="#ffffff" strokeOpacity={dark ? '0.32' : '0.92'} strokeWidth="1.8" />
            <ellipse cx="628" cy="415" rx="102" ry="48" transform="rotate(-34 628 415)" fill="#ffffff" opacity={dark ? '0.34' : '0.82'} filter={fUrl('spec')} />
            <path d="M525,675 A250,250 0 0,0 915,725" fill="none" stroke="#7dd3fc" strokeWidth="3.5" opacity={dark ? '0.32' : '0.52'} filter={fUrl('spec')} />
          </g>

          {/* Studio glass sphere 3 — Foreground accent */}
          <g className={isAnim ? 'wp-float-b' : undefined} style={isAnim ? { animationDelay: '-2.2s' } : undefined}>
            <ellipse cx="1140" cy="860" rx="132" ry="28" fill="#020617" opacity={dark ? '0.62' : '0.18'} filter={fUrl('shadow')} />
            <circle cx="1140" cy="700" r="142" fill={`url(#${uid}-orbC)`} stroke="#ffffff" strokeOpacity={dark ? '0.34' : '0.90'} strokeWidth="1.5" />
            <ellipse cx="1090" cy="642" rx="46" ry="22" transform="rotate(-32 1090 642)" fill="#ffffff" opacity={dark ? '0.38' : '0.84'} filter={fUrl('spec')} />
          </g>
        </svg>
      );

    /* ─── 17. ALTIN DALGALAR (Brushed Champagne-Gold Architectural Ribbons — Static Desktop / Animated Screensaver) ─── */
    case 'golden-waves':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={dark ? '#080706' : '#f4efe6'} />
              <stop offset="50%" stopColor={dark ? '#14110c' : '#ebe3d3'} />
              <stop offset="100%" stopColor={dark ? '#090806' : '#dfd4be'} />
            </linearGradient>
            <linearGradient id={`${uid}-gold1`} x1="0" y1="0" x2="1" y2="0.4">
              <stop offset="0%" stopColor="#78350f" stopOpacity="0.1" />
              <stop offset="32%" stopColor="#b45309" stopOpacity={dark ? '0.55' : '0.45'} />
              <stop offset="56%" stopColor="#fcd34d" stopOpacity={dark ? '0.78' : '0.72'} />
              <stop offset="78%" stopColor="#d97706" stopOpacity={dark ? '0.48' : '0.42'} />
              <stop offset="100%" stopColor="#78350f" stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#fef3c7" stopOpacity="0" />
              <stop offset="50%" stopColor="#fef3c7" stopOpacity={dark ? '0.88' : '0.95'} />
              <stop offset="100%" stopColor="#fef3c7" stopOpacity="0" />
            </linearGradient>
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-bg)`} />

          {/* Sweeping sculpted metallic champagne ribbons */}
          {[0, 1, 2, 3, 4].map((i) => {
            const y0 = 260 + i * 135;
            const dTop = `M-80,${y0 + 180} C360,${y0 - 95} 780,${y0 + 265} 1260,${y0 - 45} C1560,${y0 - 180} 1780,${y0 + 80} 2020,${y0 - 20}`;
            const dBot = `L2020,${y0 + 75} C1760,${y0 + 175} 1540,${y0 - 75} 1240,${y0 + 70} C760,${y0 + 375} 340,${y0 + 15} -80,${y0 + 290} Z`;
            return (
              <g
                key={i}
                opacity={0.42 + (i % 3) * 0.2}
                className={isAnim ? (i % 2 === 0 ? 'wp-silk' : 'wp-silk-b') : undefined}
                style={isAnim ? { animationDelay: `-${i * 2.1}s` } : undefined}
              >
                <path d={`${dTop} ${dBot}`} fill={`url(#${uid}-gold1)`} />
                <path d={dTop} fill="none" stroke={`url(#${uid}-rim)`} strokeWidth={i === 2 ? 2.2 : 1.2} />
              </g>
            );
          })}
        </svg>
      );

    /* ─── 18. KARANLIK FRAKTAL (Recursive Architectural Lattice — Static Desktop / Animated Screensaver) ─── */
    case 'dark-fractal':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <radialGradient id={`${uid}-bg`} cx="50%" cy="50%" r="65%">
              <stop offset="0%" stopColor={dark ? '#171c2b' : '#f1f5f9'} />
              <stop offset="55%" stopColor={dark ? '#0a0d16' : '#dfe7f1'} />
              <stop offset="100%" stopColor={dark ? '#030408' : '#cbd5e1'} />
            </radialGradient>
            <linearGradient id={`${uid}-stroke`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={dark ? '#93c5fd' : '#334155'} stopOpacity="0.85" />
              <stop offset="50%" stopColor={dark ? '#e2e8f0' : '#0f172a'} stopOpacity="0.45" />
              <stop offset="100%" stopColor={dark ? '#a5b4fc' : '#475569'} stopOpacity="0.85" />
            </linearGradient>
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-bg)`} />

          {/* 14 Recursive rotated precision geometric lattice frames */}
          <g transform="translate(960 540)">
            <g className={isAnim ? 'wp-glow' : undefined}>
            {Array.from({ length: 14 }).map((_, i) => {
              const size = 940 * Math.pow(0.835, i);
              const rot = i * 11.25;
              const half = size / 2;
              return (
                <g key={i} transform={`rotate(${rot})`}>
                  <rect
                    x={-half}
                    y={-half}
                    width={size}
                    height={size}
                    rx={size * 0.04}
                    fill={dark ? '#0f172a' : '#ffffff'}
                    fillOpacity={dark ? 0.14 : 0.18}
                    stroke={`url(#${uid}-stroke)`}
                    strokeWidth={i % 3 === 0 ? 1.6 : 0.9}
                    opacity={Math.max(0.18, 0.92 - i * 0.045)}
                  />
                </g>
              );
            })}
            {/* Precision center vanishing core */}
            <circle cx="0" cy="0" r="24" fill={dark ? '#93c5fd' : '#0f172a'} opacity={dark ? '0.28' : '0.16'} />
            <circle cx="0" cy="0" r="6" fill={dark ? '#e0f2fe' : '#0f172a'} opacity="0.85" />
            </g>
          </g>
        </svg>
      );

    /* ─── 19. KUZEY DENİZİ (Moody Scandinavian Basalt Cliffs & Fjord — Static Desktop / Animated Screensaver) ─── */
    case 'nordic-sea':
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={dark ? '#0c151c' : '#8ea4b2'} />
              <stop offset="56%" stopColor={dark ? '#1c2f3b' : '#b8cbd6'} />
              <stop offset="100%" stopColor={dark ? '#314c59' : '#dde8ee'} />
            </linearGradient>
            <linearGradient id={`${uid}-sea`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={dark ? '#1b3540' : '#4a6f7f'} />
              <stop offset="52%" stopColor={dark ? '#0e212b' : '#2f5060'} />
              <stop offset="100%" stopColor={dark ? '#050d12' : '#1b3440'} />
            </linearGradient>
            <linearGradient id={`${uid}-fog`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e2e8f0" stopOpacity="0" />
              <stop offset="50%" stopColor="#cbd5e1" stopOpacity={dark ? '0.28' : '0.62'} />
              <stop offset="100%" stopColor="#cbd5e1" stopOpacity="0" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width="1920" height="630" fill={`url(#${uid}-sky)`} />
          {/* Distant Nordic fjord peaks */}
          <polygon points="-40,630 290,410 560,550 860,465 1120,565 1440,420 1710,545 1960,465 1960,630" fill={dark ? '#152530' : '#65808f'} />
          {/* Framing steep basalt cliffs */}
          <polygon points="-40,630 -40,290 195,380 430,630" fill={dark ? '#0a141b' : '#354e5b'} />
          <polygon points="1960,630 1960,310 1710,405 1495,630" fill={dark ? '#0b161e' : '#3b5664'} />
          {/* Atmospheric sea mist band */}
          <rect x="0" y="535" width="1920" height="165" fill={`url(#${uid}-fog)`} className={isAnim ? 'wp-mist' : undefined} />

          {/* Deep North Sea water with subtle swells */}
          <rect x="0" y="628" width="1920" height="452" fill={`url(#${uid}-sea)`} />
          <path d="M-80,735 C380,715 760,758 1180,728 C1540,702 1780,745 2020,725 L2020,1080 L-80,1080 Z" fill={dark ? '#0a1921' : '#24414f'} opacity="0.65" className={isAnim ? 'wp-wave' : undefined} />
          <path d="M-80,865 C420,842 840,886 1280,856 C1600,834 1820,872 2020,854 L2020,1080 L-80,1080 Z" fill={dark ? '#040b10' : '#162b36'} opacity="0.72" className={isAnim ? 'wp-wave-b' : undefined} />
        </svg>
      );

    /* ─── 20. PRİZMA IŞIĞI (Optical Darkroom Beam & Dispersion Prism — Static Desktop / Animated Screensaver) ─── */
    case 'prism-spectrum':
    default:
      return (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <defs>
            <radialGradient id={`${uid}-bg`} cx="48%" cy="50%" r="68%">
              <stop offset="0%" stopColor={dark ? '#111524' : '#f8fafc'} />
              <stop offset="56%" stopColor={dark ? '#070910' : '#e6edf6'} />
              <stop offset="100%" stopColor={dark ? '#020306' : '#d2dce9'} />
            </radialGradient>
            <linearGradient id={`${uid}-beamIn`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={dark ? '#ffffff' : '#0f172a'} stopOpacity="0.06" />
              <stop offset="100%" stopColor={dark ? '#ffffff' : '#1e293b'} stopOpacity={dark ? '0.95' : '0.68'} />
            </linearGradient>
            <linearGradient id={`${uid}-glass`} x1="0.2" y1="0" x2="0.8" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity={dark ? '0.26' : '0.86'} />
              <stop offset="48%" stopColor={dark ? '#38bdf8' : '#cbd5e1'} stopOpacity={dark ? '0.10' : '0.45'} />
              <stop offset="100%" stopColor={dark ? '#0f172a' : '#94a3b8'} stopOpacity={dark ? '0.54' : '0.32'} />
            </linearGradient>
            {!lowDetail && (
              <filter id={`${uid}-bloom`} x="-20%" y="-40%" width="140%" height="180%">
                <feGaussianBlur stdDeviation="14" />
              </filter>
            )}
          </defs>

          <rect width="1920" height="1080" fill={`url(#${uid}-bg)`} />

          {/* Refracted spectral dispersion fan exiting right face of prism */}
          <g opacity={dark ? '0.82' : '0.72'} className={isAnim ? 'wp-glow' : undefined}>
            {[
              ['#ef4444', 525, 365, 425],
              ['#f97316', 536, 425, 488],
              ['#facc15', 548, 488, 552],
              ['#22c55e', 560, 552, 616],
              ['#38bdf8', 572, 616, 682],
              ['#818cf8', 584, 682, 748],
              ['#c084fc', 596, 748, 818],
            ].map(([color, py, yTop, yBot], i) => (
              <polygon
                key={i}
                points={`1058,${py} 1960,${yTop} 1960,${yBot} 1058,${Number(py) + 14}`}
                fill={String(color)}
                opacity={dark ? 0.62 : 0.48}
                filter={fUrl('bloom')}
              />
            ))}
          </g>

          {/* Crisp incoming white optical ray */}
          <polygon points="-40,660 842,520 842,542 -40,688" fill={`url(#${uid}-beamIn)`} filter={fUrl('bloom')} opacity="0.65" />
          <line x1="-20" y1="674" x2="846" y2="531" stroke={dark ? '#ffffff' : '#1e293b'} strokeWidth="4" opacity={dark ? '0.94' : '0.68'} />

          {/* Internal dispersion beam inside crystal prism */}
          <polygon points="846,527 1058,524 1068,610 846,536" fill="#ffffff" opacity={dark ? '0.28' : '0.52'} filter={fUrl('bloom')} />

          {/* Precision equilateral optical glass prism */}
          <polygon points="940,255 695,725 1185,725" fill={`url(#${uid}-glass)`} />
          <polygon points="940,255 940,725 1185,725" fill="#000000" opacity={dark ? '0.24' : '0.07'} />
          <polygon
            points="940,255 695,725 1185,725"
            fill="none"
            stroke="#ffffff"
            strokeOpacity={dark ? '0.65' : '0.95'}
            strokeWidth="2.2"
          />
          <line x1="940" y1="255" x2="940" y2="725" stroke="#ffffff" strokeOpacity={dark ? '0.22' : '0.55'} strokeWidth="1" />
        </svg>
      );
  }
};
