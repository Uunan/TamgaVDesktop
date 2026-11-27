import React, { useId } from 'react';

export interface ExtraWallpaperProps {
  id: string;
  theme: 'dark' | 'light';
  hour: number;
}

interface DayPhaseColors {
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  orbColor: string;
  orbGlow: string;
  isNight: boolean;
  isGolden: boolean;
  orbX: number;
  orbY: number;
}

function getTimeOfDayPalette(hour: number, theme: 'dark' | 'light'): DayPhaseColors {
  // Hour smoothly drives sky & sun/moon arc: dawn (5-7), day (8-16), sunset (17-19), night (20-4)
  const h = ((hour % 24) + 24) % 24;
  if (h >= 20 || h < 5) {
    return {
      skyTop: '#060a18',
      skyMid: '#0f1730',
      skyHorizon: '#1e2747',
      orbColor: '#f1f5f9',
      orbGlow: '#93c5fd',
      isNight: true,
      isGolden: false,
      orbX: 1460,
      orbY: 220,
    };
  }
  if (h >= 5 && h < 8) {
    return {
      skyTop: theme === 'dark' ? '#1e2948' : '#7ea6d6',
      skyMid: '#d98a7c',
      skyHorizon: '#fbd3a2',
      orbColor: '#fff3d6',
      orbGlow: '#fb923c',
      isNight: false,
      isGolden: true,
      orbX: 1380,
      orbY: 470,
    };
  }
  if (h >= 17 && h < 20) {
    return {
      skyTop: '#241838',
      skyMid: '#9a3b58',
      skyHorizon: '#f59e0b',
      orbColor: '#fde68a',
      orbGlow: '#f97316',
      isNight: false,
      isGolden: true,
      orbX: 520,
      orbY: 495,
    };
  }
  return {
    skyTop: theme === 'dark' ? '#1c4f82' : '#5399d8',
    skyMid: theme === 'dark' ? '#3d7bb3' : '#8ac3f0',
    skyHorizon: theme === 'dark' ? '#b8d7e8' : '#e6f2d8',
    orbColor: '#fffbeb',
    orbGlow: '#fde047',
    isNight: false,
    isGolden: false,
    orbX: 1350,
    orbY: 210,
  };
}

/* 1. BUĞDAY TARLASI (Canlı Saat & Rüzgar Animasyonlu) */
const WheatFieldSvg: React.FC<{ theme: 'dark' | 'light'; hour: number }> = ({ theme, hour }) => {
  const uid = useId().replace(/:/g, '');
  const tod = getTimeOfDayPalette(hour, theme);
  const stalkColor = tod.isNight ? '#4f5438' : tod.isGolden ? '#d98a2b' : '#cfa334';
  const stalkLight = tod.isNight ? '#7a835a' : tod.isGolden ? '#fbbf24' : '#f3d062';

  return (
    <div className="w-full h-full" style={{ background: tod.skyTop }}>
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full block" fill="none">
        <defs>
          <linearGradient id={`${uid}-sky`} x1="960" y1="0" x2="960" y2="700" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={tod.skyTop} />
            <stop offset="55%" stopColor={tod.skyMid} />
            <stop offset="100%" stopColor={tod.skyHorizon} />
          </linearGradient>
          <radialGradient id={`${uid}-orb`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform={`translate(${tod.orbX} ${tod.orbY}) scale(240)`}>
            <stop offset="0%" stopColor={tod.orbColor} stopOpacity="0.95" />
            <stop offset="35%" stopColor={tod.orbGlow} stopOpacity="0.4" />
            <stop offset="100%" stopColor={tod.orbGlow} stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="1920" height="1080" fill={`url(#${uid}-sky)`} />
        <circle cx={tod.orbX} cy={tod.orbY} r="240" fill={`url(#${uid}-orb)`} />
        <circle cx={tod.orbX} cy={tod.orbY} r={tod.isNight ? 36 : 54} fill={tod.orbColor} />

        {tod.isNight && (
          <g fill="#e2e8f0">
            {[
              [180, 110, 2], [350, 165, 1.5], [580, 95, 2], [810, 180, 1.4],
              [1040, 115, 1.8], [1230, 160, 1.4], [1690, 140, 2.1], [1810, 230, 1.5],
            ].map(([cx, cy, r], idx) => (
              <circle key={idx} cx={cx} cy={cy} r={r} className="wp-twinkle" style={{ animationDelay: `${idx * 0.45}s` }} />
            ))}
          </g>
        )}

        {/* Distant rolling hills */}
        <path d="M0 640 C420 560, 860 610, 1280 570 C1580 540, 1780 595, 1920 620 L1920 1080 L0 1080 Z" fill={tod.isNight ? '#1b221c' : tod.isGolden ? '#8c5a2b' : '#967b36'} />
        <path d="M0 735 C380 680, 920 770, 1380 705 C1660 665, 1800 725, 1920 740 L1920 1080 L0 1080 Z" fill={tod.isNight ? '#262d20' : tod.isGolden ? '#b06d24' : '#b48a2e'} />
        <path d="M0 845 C460 795, 980 875, 1480 825 C1730 800, 1840 835, 1920 855 L1920 1080 L0 1080 Z" fill={tod.isNight ? '#171c15' : tod.isGolden ? '#7d4918' : '#8a661f'} />

        {/* Swaying wheat stalks wave rows */}
        <g>
          {Array.from({ length: 34 }, (_, i) => {
            const x = 35 + i * 56;
            const yBase = 890 + (i % 3) * 38;
            const h = 150 + (i % 4) * 28;
            const cls = i % 2 === 0 ? 'wp-sway' : 'wp-sway-b';
            return (
              <g key={i} className={cls} style={{ animationDelay: `${(i % 7) * -0.55}s` }}>
                <path
                  d={`M ${x} ${yBase + 160} Q ${x + 12} ${yBase + 40} ${x + 18} ${yBase - h}`}
                  stroke={stalkColor}
                  strokeWidth="3.2"
                  strokeLinecap="round"
                />
                <ellipse cx={x + 18} cy={yBase - h + 6} rx="7" ry="20" transform={`rotate(12 ${x + 18} ${yBase - h + 6})`} fill={stalkLight} />
                <ellipse cx={x + 14} cy={yBase - h + 28} rx="6" ry="15" transform={`rotate(-8 ${x + 14} ${yBase - h + 28})`} fill={stalkColor} />
              </g>
            );
          })}
        </g>

        {/* Sun motes / fireflies */}
        <g className="wp-float">
          {[
            [290, 690, 4], [620, 740, 3.5], [980, 710, 4.5], [1340, 760, 3.5], [1640, 680, 4],
          ].map(([cx, cy, r], i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill={tod.isNight ? '#bef264' : '#fef08a'} opacity="0.72" />
          ))}
        </g>
      </svg>
    </div>
  );
};

/* 2. OKYANUS UFKU (Canlı Saat & Dalgalar) */
const OceanHorizonSvg: React.FC<{ theme: 'dark' | 'light'; hour: number }> = ({ theme, hour }) => {
  const uid = useId().replace(/:/g, '');
  const tod = getTimeOfDayPalette(hour, theme);
  return (
    <div className="w-full h-full" style={{ background: tod.skyTop }}>
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full block" fill="none">
        <defs>
          <linearGradient id={`${uid}-sky`} x1="960" y1="0" x2="960" y2="590" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={tod.skyTop} />
            <stop offset="60%" stopColor={tod.skyMid} />
            <stop offset="100%" stopColor={tod.skyHorizon} />
          </linearGradient>
          <linearGradient id={`${uid}-sea`} x1="960" y1="580" x2="960" y2="1080" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={tod.isNight ? '#0d2238' : '#0284c7'} />
            <stop offset="100%" stopColor={tod.isNight ? '#040a14' : '#0c4a6e'} />
          </linearGradient>
        </defs>
        <rect width="1920" height="600" fill={`url(#${uid}-sky)`} />
        <circle cx={tod.orbX} cy={Math.min(460, tod.orbY + 80)} r={tod.isNight ? 42 : 66} fill={tod.orbColor} opacity="0.9" />
        <rect y="580" width="1920" height="500" fill={`url(#${uid}-sea)`} />
        <g className="wp-wave">
          <path d="M-80 650 C280 620, 620 680, 960 650 C1300 620, 1620 680, 2000 645 L2000 1080 L-80 1080 Z" fill={tod.isNight ? '#0a1929' : '#0369a1'} opacity="0.65" />
        </g>
        <g className="wp-wave-b">
          <path d="M-80 780 C340 740, 740 820, 1140 775 C1480 735, 1760 800, 2000 770 L2000 1080 L-80 1080 Z" fill={tod.isNight ? '#06111e' : '#075985'} opacity="0.82" />
        </g>
        <path d="M-40 910 C440 870, 960 950, 1480 895 C1720 870, 1860 910, 1980 920 L1980 1080 L-40 1080 Z" fill={tod.isNight ? '#030812' : '#0c4a6e'} />
      </svg>
    </div>
  );
};

/* Helper for geometric & nature layered SVG scenes */
interface LayeredSceneSpec {
  bg: string;
  sky: [string, string, string];
  orb?: { cx: number; cy: number; r: number; color: string; glow?: string };
  waves: Array<{ d: string; fill: string; cls?: string; opacity?: number }>;
  particles?: Array<{ cx: number; cy: number; r: number; color: string; cls: string }>;
  rain?: boolean;
  grid?: string;
}

const LayeredSceneSvg: React.FC<{ spec: LayeredSceneSpec }> = ({ spec }) => {
  const uid = useId().replace(/:/g, '');
  return (
    <div className="w-full h-full" style={{ background: spec.bg }}>
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full block" fill="none">
        <defs>
          <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="960" y2="1080" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={spec.sky[0]} />
            <stop offset="52%" stopColor={spec.sky[1]} />
            <stop offset="100%" stopColor={spec.sky[2]} />
          </linearGradient>
          {spec.orb && (
            <radialGradient id={`${uid}-orb`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform={`translate(${spec.orb.cx} ${spec.orb.cy}) scale(${spec.orb.r * 3.4})`}>
              <stop offset="0%" stopColor={spec.orb.glow || spec.orb.color} stopOpacity="0.6" />
              <stop offset="100%" stopColor={spec.orb.glow || spec.orb.color} stopOpacity="0" />
            </radialGradient>
          )}
        </defs>
        <rect width="1920" height="1080" fill={`url(#${uid}-sky)`} />
        {spec.grid && (
          <g stroke={spec.grid} strokeOpacity="0.22" strokeWidth="1.5">
            {Array.from({ length: 16 }, (_, i) => (
              <line key={`v-${i}`} x1={960 + (i - 7.5) * 140} y1="620" x2={960 + (i - 7.5) * 440} y2="1080" />
            ))}
            {[640, 680, 730, 795, 875, 975].map((y) => (
              <line key={`h-${y}`} x1="0" y1={y} x2="1920" y2={y} />
            ))}
          </g>
        )}
        {spec.orb && (
          <g className="wp-float">
            <circle cx={spec.orb.cx} cy={spec.orb.cy} r={spec.orb.r * 3.2} fill={`url(#${uid}-orb)`} />
            <circle cx={spec.orb.cx} cy={spec.orb.cy} r={spec.orb.r} fill={spec.orb.color} />
          </g>
        )}
        {spec.waves.map((w, idx) => (
          <path key={idx} d={w.d} fill={w.fill} fillOpacity={w.opacity ?? 1} className={w.cls} />
        ))}
        {spec.particles?.map((p, i) => (
          <circle
            key={i}
            cx={p.cx}
            cy={p.cy}
            r={p.r}
            fill={p.color}
            className={p.cls}
            style={{ animationDelay: `${(i % 7) * -1.1}s` }}
          />
        ))}
        {spec.rain && (
          <g stroke="#bae6fd" strokeOpacity="0.38" strokeWidth="2">
            {Array.from({ length: 24 }, (_, i) => (
              <line
                key={i}
                x1={80 + i * 82}
                y1={-(i % 5) * 60}
                x2={55 + i * 82}
                y2={85 - (i % 5) * 60}
                className="wp-rain"
                style={{ animationDelay: `${(i % 6) * -0.28}s` }}
              />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
};

export function renderExtraWallpaper(id: string, theme: 'dark' | 'light', hour: number): React.ReactNode | null {
  const dark = theme === 'dark';
  const tod = getTimeOfDayPalette(hour, theme);

  switch (id) {
    case 'wheat-field':
      return <WheatFieldSvg theme={theme} hour={hour} />;
    case 'ocean-horizon':
      return <OceanHorizonSvg theme={theme} hour={hour} />;

    case 'cherry-blossom':
      return (
        <LayeredSceneSvg
          spec={{
            bg: dark ? '#1a0d19' : '#fce7f3',
            sky: dark ? ['#160c18', '#2c162e', '#4b1f3e'] : ['#fdf2f8', '#fbcfe8', '#f9a8d4'],
            orb: { cx: 1420, cy: 250, r: 95, color: dark ? '#fce7f3' : '#fff1f2', glow: '#f472b6' },
            waves: [
              { d: 'M0 740 L520 490 L980 710 L1460 440 L1920 680 L1920 1080 L0 1080 Z', fill: dark ? '#241226' : '#e2a3c2' },
              { d: 'M0 840 C460 760, 1020 900, 1920 790 L1920 1080 L0 1080 Z', fill: dark ? '#150816' : '#be6994' },
            ],
            particles: [
              { cx: 340, cy: 10, r: 7, color: '#fbcfe8', cls: 'wp-fall' },
              { cx: 740, cy: 40, r: 6, color: '#f9a8d4', cls: 'wp-fall' },
              { cx: 1120, cy: 20, r: 8, color: '#fce7f3', cls: 'wp-fall' },
              { cx: 1520, cy: 35, r: 6, color: '#f472b6', cls: 'wp-fall' },
            ],
          }}
        />
      );

    case 'bamboo-breeze':
      return (
        <div className="w-full h-full" style={{ background: dark ? '#081710' : '#dcfce7' }}>
          <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full block" fill="none">
            <rect width="1920" height="1080" fill={dark ? '#091a12' : '#d1fae5'} />
            <circle cx="1450" cy="240" r="180" fill={dark ? '#10b981' : '#ffffff'} fillOpacity="0.18" className="wp-float" />
            {[220, 410, 680, 960, 1210, 1480, 1690].map((x, idx) => (
              <g key={x} className={idx % 2 === 0 ? 'wp-sway' : 'wp-sway-b'}>
                <rect x={x} y="-20" width={idx % 3 === 0 ? 22 : 14} height="1140" rx="6" fill={dark ? '#14532d' : '#16a34a'} fillOpacity={0.55 + (idx % 3) * 0.14} />
                {[180, 390, 610, 830].map((y) => (
                  <line key={y} x1={x - 3} y1={y} x2={x + 25} y2={y} stroke={dark ? '#4ade80' : '#dcfce7'} strokeOpacity="0.35" strokeWidth="3" />
                ))}
              </g>
            ))}
          </svg>
        </div>
      );

    case 'rainy-forest':
      return (
        <LayeredSceneSvg
          spec={{
            bg: dark ? '#081216' : '#cbd5e1',
            sky: dark ? ['#071014', '#102229', '#1b353f'] : ['#cbd5e1', '#94a3b8', '#64748b'],
            waves: [
              { d: 'M0 780 L190 540 L370 770 L590 480 L810 780 L1080 510 L1320 790 L1610 490 L1920 780 L1920 1080 L0 1080 Z', fill: dark ? '#0d1d22' : '#475569' },
              { d: 'M0 910 C460 850, 1180 940, 1920 870 L1920 1080 L0 1080 Z', fill: dark ? '#060d10' : '#334155', cls: 'wp-wave' },
            ],
            rain: true,
          }}
        />
      );

    case 'snowy-pines':
      return (
        <LayeredSceneSvg
          spec={{
            bg: dark ? '#0c1524' : '#e2e8f0',
            sky: dark ? ['#09101d', '#142238', '#223856'] : ['#e2e8f0', '#f1f5f9', '#cbd5e1'],
            orb: { cx: 480, cy: 230, r: 58, color: '#f8fafc', glow: '#93c5fd' },
            waves: [
              { d: 'M0 840 L220 560 L440 840 L720 520 L1010 850 L1340 530 L1640 840 L1920 620 L1920 1080 L0 1080 Z', fill: dark ? '#16283d' : '#64748b' },
              { d: 'M0 930 C520 870, 1340 950, 1920 890 L1920 1080 L0 1080 Z', fill: dark ? '#e2e8f0' : '#ffffff', opacity: dark ? 0.18 : 0.85 },
            ],
            particles: [
              { cx: 210, cy: 10, r: 4, color: '#ffffff', cls: 'wp-fall' },
              { cx: 590, cy: 20, r: 5, color: '#e2e8f0', cls: 'wp-fall' },
              { cx: 990, cy: 5, r: 4, color: '#ffffff', cls: 'wp-fall' },
              { cx: 1480, cy: 30, r: 5, color: '#e2e8f0', cls: 'wp-fall' },
            ],
          }}
        />
      );

    case 'lavender-valley':
      return (
        <LayeredSceneSvg
          spec={{
            bg: tod.skyTop,
            sky: [tod.skyTop, tod.isNight ? '#2a1847' : '#a78bfa', tod.isNight ? '#44266e' : '#ddd6fe'],
            orb: { cx: tod.orbX, cy: tod.orbY, r: 54, color: tod.orbColor, glow: '#c084fc' },
            waves: [
              { d: 'M0 640 C440 570, 960 680, 1920 610 L1920 1080 L0 1080 Z', fill: tod.isNight ? '#341d58' : '#7c3aed', opacity: 0.72, cls: 'wp-wave' },
              { d: 'M0 780 C520 710, 1280 830, 1920 755 L1920 1080 L0 1080 Z', fill: tod.isNight ? '#241242' : '#6d28d9', cls: 'wp-wave-b' },
              { d: 'M0 905 C620 855, 1380 950, 1920 890 L1920 1080 L0 1080 Z', fill: tod.isNight ? '#140928' : '#4c1d95' },
            ],
          }}
        />
      );

    case 'starry-nebula':
      return (
        <LayeredSceneSvg
          spec={{
            bg: '#050412',
            sky: dark ? ['#04030e', '#140c30', '#1e1042'] : ['#1e1b4b', '#312e81', '#4c1d95'],
            orb: { cx: 1220, cy: 360, r: 160, color: '#6366f1', glow: '#ec4899' },
            waves: [
              { d: 'M0 540 C480 420, 1140 690, 1920 460 L1920 1080 L0 1080 Z', fill: '#a855f7', opacity: 0.16, cls: 'wp-wave' },
              { d: 'M0 780 C560 660, 1240 860, 1920 710 L1920 1080 L0 1080 Z', fill: '#080518', opacity: 0.85 },
            ],
            particles: [
              { cx: 220, cy: 140, r: 2.2, color: '#ffffff', cls: 'wp-twinkle' },
              { cx: 490, cy: 240, r: 1.8, color: '#c4b5fd', cls: 'wp-twinkle' },
              { cx: 880, cy: 120, r: 2.5, color: '#ffffff', cls: 'wp-twinkle' },
              { cx: 1490, cy: 190, r: 2.0, color: '#f9a8d4', cls: 'wp-twinkle' },
              { cx: 1730, cy: 320, r: 1.8, color: '#ffffff', cls: 'wp-twinkle' },
            ],
          }}
        />
      );

    case 'red-canyon':
      return (
        <LayeredSceneSvg
          spec={{
            bg: tod.skyTop,
            sky: [tod.skyTop, tod.isNight ? '#3a1816' : '#ea580c', tod.isNight ? '#5c231a' : '#fed7aa'],
            orb: { cx: tod.orbX, cy: Math.min(440, tod.orbY + 40), r: 64, color: tod.orbColor, glow: '#f97316' },
            waves: [
              { d: 'M0 640 L380 510 L540 510 L760 650 L1180 470 L1440 470 L1720 620 L1920 570 L1920 1080 L0 1080 Z', fill: tod.isNight ? '#451a14' : '#c2410c' },
              { d: 'M0 790 L460 700 L960 820 L1520 690 L1920 790 L1920 1080 L0 1080 Z', fill: tod.isNight ? '#2b0f0c' : '#9a3412' },
              { d: 'M0 925 C540 870, 1280 960, 1920 900 L1920 1080 L0 1080 Z', fill: tod.isNight ? '#170706' : '#7c2d12' },
            ],
          }}
        />
      );

    case 'solar-eclipse':
      return (
        <LayeredSceneSvg
          spec={{
            bg: '#040509',
            sky: dark ? ['#030408', '#0c1020', '#151226'] : ['#18181b', '#27272a', '#3f3f46'],
            orb: { cx: 960, cy: 480, r: 148, color: '#05060a', glow: '#f59e0b' },
            waves: [
              { d: 'M0 890 C540 845, 1380 920, 1920 875 L1920 1080 L0 1080 Z', fill: '#08090e' },
            ],
            particles: [
              { cx: 260, cy: 190, r: 2, color: '#fde68a', cls: 'wp-twinkle' },
              { cx: 1640, cy: 210, r: 2, color: '#fde68a', cls: 'wp-twinkle' },
            ],
          }}
        />
      );

    case 'glacial-mirror':
      return (
        <LayeredSceneSvg
          spec={{
            bg: dark ? '#07141c' : '#e0f2fe',
            sky: dark ? ['#06131c', '#0e2838', '#153b50'] : ['#e0f2fe', '#bae6fd', '#7dd3fc'],
            waves: [
              { d: 'M0 640 L340 310 L680 640 L1020 260 L1440 640 L1740 380 L1920 640 Z', fill: dark ? '#38bdf8' : '#ffffff', opacity: dark ? 0.35 : 0.8 },
              { d: 'M0 640 L1920 640 L1920 1080 L0 1080 Z', fill: dark ? '#081b26' : '#0284c7', opacity: dark ? 0.85 : 0.35 },
              { d: 'M0 640 L340 970 L680 640 L1020 1020 L1440 640 L1740 900 L1920 640 Z', fill: dark ? '#0ea5e9' : '#e0f2fe', opacity: 0.2, cls: 'wp-wave' },
            ],
          }}
        />
      );

    case 'moonlit-lake':
      return (
        <LayeredSceneSvg
          spec={{
            bg: tod.skyTop,
            sky: [tod.skyTop, tod.skyMid, tod.skyHorizon],
            orb: { cx: tod.orbX, cy: Math.min(340, tod.orbY), r: 52, color: tod.orbColor, glow: tod.orbGlow },
            waves: [
              { d: 'M0 620 L420 460 L820 590 L1320 420 L1920 610 L1920 680 L0 680 Z', fill: tod.isNight ? '#0f172a' : '#334155' },
              { d: 'M0 660 L1920 660 L1920 1080 L0 1080 Z', fill: tod.isNight ? '#07101f' : '#1e3a5f', cls: 'wp-wave' },
            ],
          }}
        />
      );

    case 'cyber-grid':
      return (
        <LayeredSceneSvg
          spec={{
            bg: '#080416',
            sky: dark ? ['#070312', '#190a36', '#2e1065'] : ['#1e1b4b', '#3b0764', '#581c87'],
            orb: { cx: 960, cy: 480, r: 165, color: '#ec4899', glow: '#f43f5e' },
            grid: '#22d3ee',
            waves: [
              { d: 'M0 620 L1920 620 L1920 626 L0 626 Z', fill: '#22d3ee' },
            ],
          }}
        />
      );

    case 'silk-flow':
      return (
        <LayeredSceneSvg
          spec={{
            bg: dark ? '#0d0d14' : '#f4f4f9',
            sky: dark ? ['#0b0b12', '#18162b', '#10192b'] : ['#f8fafc', '#ede9fe', '#e0f2fe'],
            waves: [
              { d: 'M-80 420 C380 180, 960 700, 2000 320 L2000 1080 L-80 1080 Z', fill: dark ? '#6366f1' : '#818cf8', opacity: 0.28, cls: 'wp-wave' },
              { d: 'M-80 620 C520 340, 1260 880, 2000 540 L2000 1080 L-80 1080 Z', fill: dark ? '#ec4899' : '#f472b6', opacity: 0.22, cls: 'wp-wave-b' },
              { d: 'M-80 820 C480 660, 1340 960, 2000 760 L2000 1080 L-80 1080 Z', fill: dark ? '#14b8a6' : '#38bdf8', opacity: 0.22 },
            ],
          }}
        />
      );

    case 'glass-orbs':
      return (
        <LayeredSceneSvg
          spec={{
            bg: dark ? '#090b10' : '#f1f5f9',
            sky: dark ? ['#090b10', '#121726', '#18182b'] : ['#f8fafc', '#e2e8f0', '#dbeafe'],
            waves: [],
            particles: [
              { cx: 520, cy: 360, r: 190, color: dark ? '#38bdf8' : '#60a5fa', cls: 'wp-float' },
              { cx: 1320, cy: 480, r: 240, color: dark ? '#818cf8' : '#a78bfa', cls: 'wp-float-b' },
              { cx: 920, cy: 760, r: 150, color: dark ? '#34d399' : '#38bdf8', cls: 'wp-float' },
            ],
          }}
        />
      );

    case 'golden-waves':
      return (
        <LayeredSceneSvg
          spec={{
            bg: dark ? '#120f08' : '#fef3c7',
            sky: dark ? ['#0e0c06', '#211a0c', '#362910'] : ['#fffbeb', '#fef3c7', '#fde68a'],
            waves: [
              { d: 'M-60 480 C440 340, 1120 660, 1980 440 L1980 1080 L-60 1080 Z', fill: dark ? '#785a20' : '#f59e0b', opacity: 0.35, cls: 'wp-wave' },
              { d: 'M-60 690 C520 550, 1280 840, 1980 650 L1980 1080 L-60 1080 Z', fill: dark ? '#b48324' : '#d97706', opacity: 0.4, cls: 'wp-wave-b' },
              { d: 'M-60 880 C560 790, 1340 980, 1980 860 L1980 1080 L-60 1080 Z', fill: dark ? '#1c1507' : '#92400e', opacity: 0.72 },
            ],
          }}
        />
      );

    case 'dark-fractal':
      return (
        <div className="w-full h-full" style={{ background: dark ? '#08080c' : '#e4e4e7' }}>
          <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full block" fill="none">
            <rect width="1920" height="1080" fill={dark ? '#08080c' : '#e4e4e7'} />
            <g className="wp-float">
              {[420, 320, 220, 130].map((r, i) => (
                <polygon
                  key={r}
                  points={`960,${540 - r} ${960 + r * 1.4},540 960,${540 + r} ${960 - r * 1.4},540`}
                  fill={dark ? '#181825' : '#ffffff'}
                  fillOpacity={0.28 + i * 0.14}
                  stroke={dark ? '#a5b4fc' : '#52525b'}
                  strokeOpacity={0.22 + i * 0.1}
                  strokeWidth="2"
                />
              ))}
            </g>
          </svg>
        </div>
      );

    case 'volcanic-glow':
      return (
        <LayeredSceneSvg
          spec={{
            bg: '#0c0606',
            sky: dark ? ['#090404', '#260b09', '#45120c'] : ['#27110d', '#5c1912', '#991b1b'],
            orb: { cx: 960, cy: 620, r: 190, color: '#ef4444', glow: '#f97316' },
            waves: [
              { d: 'M0 780 L380 560 L760 740 L1220 510 L1640 730 L1920 620 L1920 1080 L0 1080 Z', fill: '#120808' },
              { d: 'M0 910 C540 860, 1380 960, 1920 890 L1920 1080 L0 1080 Z', fill: '#080404' },
            ],
            particles: [
              { cx: 640, cy: 520, r: 4, color: '#fb923c', cls: 'wp-float' },
              { cx: 1180, cy: 480, r: 3.5, color: '#fde047', cls: 'wp-float-b' },
            ],
          }}
        />
      );

    case 'nordic-sea':
      return (
        <LayeredSceneSvg
          spec={{
            bg: dark ? '#0a1218' : '#dbe4ea',
            sky: dark ? ['#081016', '#12212c', '#1c3240'] : ['#dbe4ea', '#cbd5e1', '#94a3b8'],
            waves: [
              { d: 'M0 680 L280 410 L560 660 L920 450 L1340 690 L1700 420 L1920 610 L1920 1080 L0 1080 Z', fill: dark ? '#162733' : '#475569' },
              { d: 'M0 790 C440 740, 1140 850, 1920 770 L1920 1080 L0 1080 Z', fill: dark ? '#0c1922' : '#334155', cls: 'wp-wave' },
              { d: 'M0 920 C520 885, 1320 960, 1920 905 L1920 1080 L0 1080 Z', fill: dark ? '#050c12' : '#1e293b' },
            ],
          }}
        />
      );

    case 'prism-spectrum':
      return (
        <div className="w-full h-full" style={{ background: dark ? '#09090d' : '#f4f4f5' }}>
          <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full block" fill="none">
            <rect width="1920" height="1080" fill={dark ? '#09090d' : '#f4f4f5'} />
            <g className="wp-kenburns">
              <polygon points="0,0 820,0 1480,1080 340,1080" fill="#6366f1" fillOpacity="0.24" />
              <polygon points="440,0 1120,0 1780,1080 960,1080" fill="#ec4899" fillOpacity="0.2" />
              <polygon points="940,0 1620,0 1920,640 1320,1080" fill="#22d3ee" fillOpacity="0.2" />
            </g>
          </svg>
        </div>
      );

    default:
      return null;
  }
}
