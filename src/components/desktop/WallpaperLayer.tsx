import React, { useEffect, useId, useRef, useState } from 'react';
import { buildWallpaperUrl } from '../../services/osBridge';

interface WallpaperSpec {
  key: string;
  wallpaperId: string;
  theme: 'dark' | 'light';
  customUrl?: string;
}

/* 1. GEOMETRİK DAĞ — Gece: Yıldızlı derin lacivert-obsidyen zirveler + ay ışığı | Gündüz: Gün doğumu pastel dağlar */
const MonoPeaksSvg: React.FC<{ theme: 'dark' | 'light' }> = ({ theme }) => {
  const uid = useId().replace(/:/g, '');
  const dark = theme === 'dark';
  return (
    <div className="w-full h-full" style={{ background: dark ? '#0b0e17' : '#d8dde8' }}>
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full block" fill="none">
        <defs>
          <linearGradient id={`${uid}-sky`} x1="960" y1="0" x2="960" y2="760" gradientUnits="userSpaceOnUse">
            {dark ? (
              <>
                <stop offset="0%" stopColor="#070a14" />
                <stop offset="52%" stopColor="#12182b" />
                <stop offset="100%" stopColor="#1f2740" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#cdd8ec" />
                <stop offset="52%" stopColor="#e5e9f2" />
                <stop offset="100%" stopColor="#f4e6db" />
              </>
            )}
          </linearGradient>
          <radialGradient id={`${uid}-orb`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1410 235) scale(190)">
            <stop offset="0%" stopColor={dark ? '#dbeafe' : '#fff7ed'} stopOpacity={dark ? '0.85' : '0.95'} />
            <stop offset="28%" stopColor={dark ? '#93c5fd' : '#fed7aa'} stopOpacity={dark ? '0.32' : '0.45'} />
            <stop offset="100%" stopColor={dark ? '#1e293b' : '#f4e6db'} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${uid}-mist`} x1="960" y1="450" x2="960" y2="820" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={dark ? '#1e293b' : '#ffffff'} stopOpacity="0" />
            <stop offset="60%" stopColor={dark ? '#312e81' : '#f8fafc'} stopOpacity={dark ? '0.28' : '0.45'} />
            <stop offset="100%" stopColor={dark ? '#0f172a' : '#cbd5e1'} stopOpacity="0.2" />
          </linearGradient>
        </defs>

        <rect width="1920" height="1080" fill={`url(#${uid}-sky)`} />
        <circle cx="1410" cy="235" r="190" fill={`url(#${uid}-orb)`} />
        <circle cx="1410" cy="235" r={dark ? '34' : '46'} fill={dark ? '#e2e8f0' : '#fffaf0'} opacity={dark ? '0.9' : '0.92'} />

        {/* Subtle geometric stars at night */}
        {dark && (
          <g fill="#e2e8f0">
            {[
              [210, 120, 2], [380, 180, 1.4], [540, 95, 1.8], [760, 160, 1.3],
              [980, 88, 2.2], [1160, 145, 1.5], [1640, 130, 1.8], [1780, 210, 1.4],
              [310, 280, 1.2], [650, 240, 1.5], [1080, 240, 1.3], [1690, 310, 1.2],
            ].map(([cx, cy, r], i) => (
              <circle key={i} cx={cx} cy={cy} r={r} opacity={0.45 + (i % 3) * 0.2} />
            ))}
          </g>
        )}

        {/* Distant mountain ridge */}
        <polygon points="0,690 260,515 510,655 790,470 1080,632 1430,492 1720,625 1920,545 1920,860 0,860" fill={dark ? '#1b2238' : '#b7c4d8'} />
        <polygon points="260,515 510,655 390,695" fill={dark ? '#141a2c' : '#96a7c2'} />
        <polygon points="790,470 1080,632 895,682" fill={dark ? '#131829' : '#8ea0bc'} />
        <polygon points="1430,492 1720,625 1545,682" fill={dark ? '#151b2d' : '#99a9c4'} />
        <rect y="450" width="1920" height="360" fill={`url(#${uid}-mist)`} />

        {/* Left Peak */}
        <polygon points="-80,920 340,425 395,920" fill={dark ? '#283352' : '#d2dceb'} />
        <polygon points="340,425 720,890 395,920" fill={dark ? '#151b2e' : '#7b8ca8'} />

        {/* Main Center Peak */}
        <polygon points="410,980 940,268 865,640" fill={dark ? '#334166' : '#e6edf7'} />
        <polygon points="410,980 865,640 735,980" fill={dark ? '#25304d' : '#cad6e8'} />
        <polygon points="865,640 940,268 995,575" fill={dark ? '#3f507a' : '#f1f5fb'} />
        <polygon points="940,268 1490,980 995,575" fill={dark ? '#141a2b' : '#64748b'} />
        <polygon points="995,575 1235,770 975,980" fill={dark ? '#1d253d' : '#7c8da6'} />
        <polygon points="995,575 1490,980 1235,770" fill={dark ? '#0f1422' : '#52627a'} />

        {/* Right Peak */}
        <polygon points="1160,990 1565,442 1515,760" fill={dark ? '#2c3858' : '#d8e1ef'} />
        <polygon points="1565,442 2020,990 1515,760" fill={dark ? '#121726' : '#5c6c84'} />

        {/* Foreground Slopes */}
        <polygon points="0,1080 0,805 460,936 240,1080" fill={dark ? '#0d111d' : '#475569'} />
        <polygon points="240,1080 760,838 1090,1080" fill={dark ? '#111626' : '#58677d'} />
        <polygon points="1090,1080 1650,848 1920,962 1920,1080" fill={dark ? '#0a0d17' : '#3d4a5e'} />
        <rect y="1025" width="1920" height="55" fill={dark ? '#090c14' : '#334155'} />
      </svg>
    </div>
  );
};

/* 2. ÇÖL KUMULLARI — Gece: Ay ışığı mor/indigo kumullar | Gündüz: Sıcak altın-şeftali çöl kumulları */
const GeoDunesSvg: React.FC<{ theme: 'dark' | 'light' }> = ({ theme }) => {
  const uid = useId().replace(/:/g, '');
  const dark = theme === 'dark';
  return (
    <div className="w-full h-full" style={{ background: dark ? '#120d1f' : '#f7e5d2' }}>
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full block" fill="none">
        <defs>
          <linearGradient id={`${uid}-sky`} x1="960" y1="0" x2="960" y2="700" gradientUnits="userSpaceOnUse">
            {dark ? (
              <>
                <stop offset="0%" stopColor="#0f0a1e" />
                <stop offset="55%" stopColor="#231642" />
                <stop offset="100%" stopColor="#3c235c" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#f3cfb6" />
                <stop offset="50%" stopColor="#fae0c8" />
                <stop offset="100%" stopColor="#fcecd8" />
              </>
            )}
          </linearGradient>
          <linearGradient id={`${uid}-d1`} x1="0" y1="520" x2="1920" y2="900" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={dark ? '#432863' : '#e6a87c'} />
            <stop offset="100%" stopColor={dark ? '#2b1945' : '#d68f63'} />
          </linearGradient>
          <linearGradient id={`${uid}-d2`} x1="0" y1="680" x2="1920" y2="1080" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={dark ? '#2d1a4a' : '#cc7d52'} />
            <stop offset="100%" stopColor={dark ? '#170d29' : '#a85b3a'} />
          </linearGradient>
        </defs>
        <rect width="1920" height="1080" fill={`url(#${uid}-sky)`} />
        <circle cx="520" cy="255" r={dark ? '56' : '78'} fill={dark ? '#e9d5ff' : '#fff7ed'} opacity="0.9" />
        {dark && <circle cx="542" cy="242" r="50" fill="#1b1133" />}

        <path d="M0 600 C360 470, 680 510, 1020 595 C1380 685, 1650 540, 1920 570 L1920 1080 L0 1080 Z" fill={dark ? '#311d4d' : '#ebb992'} />
        <path d="M0 710 C420 590, 760 760, 1210 640 C1520 555, 1740 650, 1920 690 L1920 1080 L0 1080 Z" fill={`url(#${uid}-d1)`} />
        <path d="M0 845 C390 740, 820 885, 1280 790 C1580 725, 1780 810, 1920 845 L1920 1080 L0 1080 Z" fill={`url(#${uid}-d2)`} />
        <path d="M0 950 C480 890, 980 1015, 1460 925 C1710 878, 1830 930, 1920 960 L1920 1080 L0 1080 Z" fill={dark ? '#11081f' : '#8c472d'} />
      </svg>
    </div>
  );
};

/* 3. KRİSTAL PRİZMA — Gece: Obsidyen & zümrüt kırılmalar | Gündüz: Buz mavisi & porselen cam fasetler */
const GeoPrismSvg: React.FC<{ theme: 'dark' | 'light' }> = ({ theme }) => {
  const uid = useId().replace(/:/g, '');
  const dark = theme === 'dark';
  return (
    <div className="w-full h-full" style={{ background: dark ? '#080c0d' : '#e6eef5' }}>
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full block" fill="none">
        <defs>
          <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="1920" y2="1080" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={dark ? '#070b0d' : '#f1f5f9'} />
            <stop offset="50%" stopColor={dark ? '#0d191c' : '#dde8f2'} />
            <stop offset="100%" stopColor={dark ? '#081214' : '#cbdce9'} />
          </linearGradient>
        </defs>
        <rect width="1920" height="1080" fill={`url(#${uid}-bg)`} />
        <polygon points="0,0 740,0 460,520 0,380" fill={dark ? '#102124' : '#dce8f5'} />
        <polygon points="740,0 1380,0 1060,460 460,520" fill={dark ? '#132a2e' : '#e8f0f8'} />
        <polygon points="1380,0 1920,0 1920,560 1060,460" fill={dark ? '#0d1d21' : '#cfdeed'} />
        <polygon points="0,380 460,520 260,1080 0,1080" fill={dark ? '#0b1619' : '#c4d6e8'} />
        <polygon points="460,520 1060,460 920,1080 260,1080" fill={dark ? '#16353a' : '#eff5fb'} />
        <polygon points="1060,460 1920,560 1540,1080 920,1080" fill={dark ? '#10262b' : '#d5e3f1'} />
        <polygon points="1920,560 1920,1080 1540,1080" fill={dark ? '#091518' : '#b7cce0'} />
        {/* Crisp prism edge accent */}
        <polygon points="460,520 1060,460 880,760" fill={dark ? '#10b981' : '#38bdf8'} fillOpacity={dark ? '0.16' : '0.18'} />
        <polyline points="0,380 460,520 1060,460 1920,560" stroke={dark ? '#34d399' : '#ffffff'} strokeOpacity={dark ? '0.22' : '0.7'} strokeWidth="2" />
        <polyline points="740,0 460,520 260,1080" stroke={dark ? '#6ee7b7' : '#ffffff'} strokeOpacity={dark ? '0.12' : '0.55'} strokeWidth="1.5" />
        <polyline points="1380,0 1060,460 920,1080" stroke={dark ? '#6ee7b7' : '#ffffff'} strokeOpacity={dark ? '0.15' : '0.55'} strokeWidth="1.5" />
      </svg>
    </div>
  );
};

/* 4. TOPO DALGALAR — Gece: Koyu arduvaz + gümüş/cyan katmanlı dalgalar | Gündüz: Ferah krem-gök katmanlar */
const GeoWavesSvg: React.FC<{ theme: 'dark' | 'light' }> = ({ theme }) => {
  const dark = theme === 'dark';
  const layers = dark
    ? ['#0d111a', '#121826', '#172033', '#1d2940', '#24334f', '#192438', '#111827']
    : ['#eff3f9', '#e3ebf6', '#d4e1f2', '#c3d5ec', '#afc7e4', '#9ab8dc', '#84a7d2'];
  return (
    <div className="w-full h-full" style={{ background: layers[0] }}>
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full block" fill="none">
        <rect width="1920" height="1080" fill={layers[0]} />
        {layers.slice(1).map((color, idx) => {
          const y = 190 + idx * 140;
          const amp = 75 + (idx % 2) * 35;
          return (
            <path
              key={idx}
              d={`M0 ${y} C 380 ${y - amp}, 740 ${y + amp}, 1120 ${y - amp * 0.6} C 1480 ${y - amp * 1.1}, 1720 ${y + amp * 0.7}, 1920 ${y - 20} L1920 1080 L0 1080 Z`}
              fill={color}
              stroke={dark ? '#60a5fa' : '#ffffff'}
              strokeOpacity={dark ? 0.08 + idx * 0.02 : 0.45}
              strokeWidth="1.5"
            />
          );
        })}
      </svg>
    </div>
  );
};

/* 5. KUZEY IŞIKLARI — Gece: Arktik gece + geometrik aurora şeritleri | Gündüz: Berrak sabah prizmatik huzmeleri */
const GeoAuroraSvg: React.FC<{ theme: 'dark' | 'light' }> = ({ theme }) => {
  const uid = useId().replace(/:/g, '');
  const dark = theme === 'dark';
  return (
    <div className="w-full h-full" style={{ background: dark ? '#050914' : '#e4f0f5' }}>
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full block" fill="none">
        <defs>
          <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="1920" y2="1080" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={dark ? '#040814' : '#dbeafe'} />
            <stop offset="50%" stopColor={dark ? '#091526' : '#e0f2fe'} />
            <stop offset="100%" stopColor={dark ? '#0d1024' : '#ede9fe'} />
          </linearGradient>
          <linearGradient id={`${uid}-band1`} x1="200" y1="100" x2="1700" y2="700" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={dark ? '#10b981' : '#38bdf8'} stopOpacity="0" />
            <stop offset="35%" stopColor={dark ? '#34d399' : '#60a5fa'} stopOpacity={dark ? '0.42' : '0.32'} />
            <stop offset="70%" stopColor={dark ? '#818cf8' : '#c084fc'} stopOpacity={dark ? '0.35' : '0.28'} />
            <stop offset="100%" stopColor={dark ? '#6366f1' : '#f472b6'} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-band2`} x1="100" y1="220" x2="1800" y2="820" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={dark ? '#06b6d4' : '#fbbf24'} stopOpacity="0" />
            <stop offset="45%" stopColor={dark ? '#22d3ee' : '#34d399'} stopOpacity={dark ? '0.32' : '0.24'} />
            <stop offset="100%" stopColor={dark ? '#a855f7' : '#818cf8'} stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="1920" height="1080" fill={`url(#${uid}-sky)`} />
        <polygon points="0,340 620,120 1340,290 1920,90 1920,460 1280,620 560,470 0,680" fill={`url(#${uid}-band1)`} />
        <polygon points="0,520 540,280 1240,440 1920,240 1920,620 1180,760 480,610 0,800" fill={`url(#${uid}-band2)`} />
        <polygon points="0,840 340,720 680,820 1090,690 1510,810 1920,710 1920,1080 0,1080" fill={dark ? '#070b14' : '#94a3b8'} fillOpacity={dark ? '0.96' : '0.35'} />
        <polygon points="0,920 440,835 960,940 1480,845 1920,910 1920,1080 0,1080" fill={dark ? '#04060c' : '#64748b'} fillOpacity={dark ? '1' : '0.38'} />
      </svg>
    </div>
  );
};

/* 6. MİNİMAL UFUK — Gece: Ay tutulması halkası + geometrik gece denizi | Gündüz: Mercan güneşi + sakin ufuk */
const GeoHorizonSvg: React.FC<{ theme: 'dark' | 'light' }> = ({ theme }) => {
  const uid = useId().replace(/:/g, '');
  const dark = theme === 'dark';
  return (
    <div className="w-full h-full" style={{ background: dark ? '#0a0a0f' : '#f5ece4' }}>
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full block" fill="none">
        <defs>
          <linearGradient id={`${uid}-sky`} x1="960" y1="0" x2="960" y2="620" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={dark ? '#09090e' : '#dbe5f0'} />
            <stop offset="65%" stopColor={dark ? '#171726' : '#f6dfd1'} />
            <stop offset="100%" stopColor={dark ? '#232038' : '#fbd4bd'} />
          </linearGradient>
          <linearGradient id={`${uid}-sea`} x1="960" y1="600" x2="960" y2="1080" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={dark ? '#141422' : '#c9b3ae'} />
            <stop offset="100%" stopColor={dark ? '#07070b' : '#7d737a'} />
          </linearGradient>
        </defs>
        <rect width="1920" height="620" fill={`url(#${uid}-sky)`} />
        {/* Celestial ring / sun */}
        <circle cx="960" cy="460" r="145" fill={dark ? '#0b0b12' : '#fb923c'} stroke={dark ? '#e2e8f0' : '#fff7ed'} strokeWidth={dark ? '5' : '0'} strokeOpacity="0.85" />
        <circle cx="960" cy="460" r="195" stroke={dark ? '#818cf8' : '#fdba74'} strokeOpacity="0.28" strokeWidth="1.5" />
        <circle cx="960" cy="460" r="260" stroke={dark ? '#818cf8' : '#fdba74'} strokeOpacity="0.14" strokeWidth="1" />

        {/* Horizon sea & reflection */}
        <rect y="600" width="1920" height="480" fill={`url(#${uid}-sea)`} />
        <line x1="0" y1="600" x2="1920" y2="600" stroke={dark ? '#a5b4fc' : '#ffffff'} strokeOpacity="0.35" strokeWidth="2" />
        {[635, 675, 725, 785, 855, 935].map((y, i) => (
          <line
            key={y}
            x1={960 - (140 - i * 18)}
            y1={y}
            x2={960 + (140 - i * 18)}
            y2={y}
            stroke={dark ? '#c7d2fe' : '#fff7ed'}
            strokeOpacity={0.34 - i * 0.045}
            strokeWidth="3"
            strokeLinecap="round"
          />
        ))}
      </svg>
    </div>
  );
};

function renderWallpaperContent(spec: WallpaperSpec) {
  if (spec.wallpaperId === 'custom' && spec.customUrl) {
    return (
      <img
        src={spec.customUrl}
        alt="Masaüstü Arka Planı"
        className="w-full h-full object-cover select-none"
        draggable={false}
      />
    );
  }
  switch (spec.wallpaperId) {
    case 'geo-dunes':
      return <GeoDunesSvg theme={spec.theme} />;
    case 'geo-prism':
      return <GeoPrismSvg theme={spec.theme} />;
    case 'geo-waves':
      return <GeoWavesSvg theme={spec.theme} />;
    case 'geo-aurora':
      return <GeoAuroraSvg theme={spec.theme} />;
    case 'geo-horizon':
      return <GeoHorizonSvg theme={spec.theme} />;
    case 'graphite-flat':
      return <div className="w-full h-full" style={{ background: spec.theme === 'dark' ? '#26262a' : '#e5e7eb' }} />;
    case 'obsidian-flat':
      return <div className="w-full h-full" style={{ background: spec.theme === 'dark' ? '#131316' : '#f4f4f5' }} />;
    case 'mono-peaks':
    default:
      return <MonoPeaksSvg theme={spec.theme} />;
  }
}

export const WallpaperThumb: React.FC<{
  wallpaperId: string;
  theme: 'dark' | 'light';
  className?: string;
}> = React.memo(({ wallpaperId, theme, className = 'w-full h-14' }) => (
  <div className={`overflow-hidden rounded-lg pointer-events-none ${className}`}>
    {renderWallpaperContent({ key: `${wallpaperId}:${theme}`, wallpaperId, theme })}
  </div>
));

export const WallpaperLayer: React.FC<{
  wallpaperId: string;
  theme: 'dark' | 'light';
  customWallpaper?: string;
}> = React.memo(({ wallpaperId, theme, customWallpaper }) => {
  const targetUrl =
    wallpaperId === 'custom' && customWallpaper ? buildWallpaperUrl(customWallpaper) : undefined;
  const targetKey = `${wallpaperId}:${theme}:${targetUrl || ''}`;

  const [current, setCurrent] = useState<WallpaperSpec>({
    key: targetKey,
    wallpaperId,
    theme,
    customUrl: targetUrl,
  });
  const [previous, setPrevious] = useState<WallpaperSpec | null>(null);
  const [animating, setAnimating] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (targetKey === current.key) return;

    let cancelled = false;

    const commitTransition = () => {
      if (cancelled) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      setPrevious(current);
      setCurrent({
        key: targetKey,
        wallpaperId,
        theme,
        customUrl: targetUrl,
      });
      setAnimating(true);
      timerRef.current = setTimeout(() => {
        setPrevious(null);
        setAnimating(false);
      }, 720);
    };

    if (wallpaperId === 'custom' && targetUrl) {
      const img = new Image();
      img.onload = commitTransition;
      img.onerror = commitTransition;
      img.src = targetUrl;
    } else {
      commitTransition();
    }

    return () => {
      cancelled = true;
    };
  }, [targetKey, wallpaperId, theme, targetUrl, current]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden bg-[var(--os-bg)]">
      {previous && (
        <div key={`prev-${previous.key}`} className="absolute inset-0">
          {renderWallpaperContent(previous)}
        </div>
      )}
      <div
        key={`curr-${current.key}`}
        className={`absolute inset-0 ${animating ? 'wallpaper-enter' : ''}`}
      >
        {renderWallpaperContent(current)}
      </div>
    </div>
  );
});
