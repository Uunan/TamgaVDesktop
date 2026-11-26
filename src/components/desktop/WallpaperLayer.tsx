import React, { useEffect, useRef, useState } from 'react';
import { buildWallpaperUrl } from '../../services/osBridge';

interface WallpaperSpec {
  key: string;
  wallpaperId: string;
  customUrl?: string;
}

const MonoPeaksSvg: React.FC = () => (
  <div className="w-full h-full bg-[#c8c9ce]">
    <svg
      viewBox="0 0 1920 1080"
      preserveAspectRatio="xMidYMid slice"
      className="w-full h-full block"
      fill="none"
    >
      <defs>
        <linearGradient id="mono-sky" x1="960" y1="0" x2="960" y2="720" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#D6D7DC" />
          <stop offset="50%" stopColor="#C7C8CE" />
          <stop offset="100%" stopColor="#B1B3BA" />
        </linearGradient>
        <radialGradient id="soft-sun" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1375 250) scale(170)">
          <stop offset="0%" stopColor="#ECECF0" stopOpacity="0.68" />
          <stop offset="45%" stopColor="#E2E3E8" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#D4D5DA" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="horizon-mist" x1="960" y1="450" x2="960" y2="780" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#C8C9CF" stopOpacity="0" />
          <stop offset="55%" stopColor="#C2C3C9" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#9A9CA4" stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id="valley-haze" x1="960" y1="680" x2="960" y2="1020" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6E7078" stopOpacity="0" />
          <stop offset="60%" stopColor="#3B3C42" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#1E1F23" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id="lit-main-a" x1="650" y1="270" x2="800" y2="920" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#D1D2D7" />
          <stop offset="100%" stopColor="#B4B6BD" />
        </linearGradient>
        <linearGradient id="lit-main-b" x1="620" y1="620" x2="850" y2="980" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#C1C2C9" />
          <stop offset="100%" stopColor="#9FA1AA" />
        </linearGradient>
        <linearGradient id="lit-side" x1="180" y1="420" x2="360" y2="920" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#C8C9D0" />
          <stop offset="100%" stopColor="#A6A8B0" />
        </linearGradient>
        <linearGradient id="lit-right" x1="1380" y1="435" x2="1520" y2="960" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#C3C5CC" />
          <stop offset="100%" stopColor="#A1A3AC" />
        </linearGradient>
        <linearGradient id="shd-main-a" x1="940" y1="265" x2="1360" y2="940" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#45464D" />
          <stop offset="100%" stopColor="#2F3036" />
        </linearGradient>
        <linearGradient id="shd-main-b" x1="990" y1="575" x2="1220" y2="980" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#56575F" />
          <stop offset="100%" stopColor="#3B3C42" />
        </linearGradient>
        <linearGradient id="shd-main-c" x1="1080" y1="640" x2="1460" y2="980" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38393F" />
          <stop offset="100%" stopColor="#28292E" />
        </linearGradient>
        <linearGradient id="shd-left" x1="340" y1="420" x2="640" y2="910" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4D4E55" />
          <stop offset="100%" stopColor="#36373D" />
        </linearGradient>
        <linearGradient id="shd-right" x1="1565" y1="435" x2="1920" y2="980" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#42434A" />
          <stop offset="100%" stopColor="#2B2C31" />
        </linearGradient>
        <linearGradient id="fg-slope-a" x1="300" y1="760" x2="300" y2="1080" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3B3C42" />
          <stop offset="100%" stopColor="#232428" />
        </linearGradient>
        <linearGradient id="fg-slope-b" x1="900" y1="835" x2="900" y2="1080" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#46474E" />
          <stop offset="100%" stopColor="#26272B" />
        </linearGradient>
        <linearGradient id="fg-slope-c" x1="1600" y1="845" x2="1600" y2="1080" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#35363C" />
          <stop offset="100%" stopColor="#1F2024" />
        </linearGradient>
      </defs>

      <rect width="1920" height="1080" fill="url(#mono-sky)" />
      <circle cx="1375" cy="250" r="170" fill="url(#soft-sun)" />

      <polygon points="0,690 260,520 510,655 790,478 1080,632 1430,498 1720,625 1920,550 1920,860 0,860" fill="#9FA1A9" />
      <polygon points="260,520 510,655 390,695" fill="#82848D" />
      <polygon points="790,478 1080,632 895,682" fill="#7C7E87" />
      <polygon points="1430,498 1720,625 1545,682" fill="#83858E" />
      <rect y="450" width="1920" height="330" fill="url(#horizon-mist)" />

      <polygon points="-80,920 340,425 395,920" fill="url(#lit-side)" />
      <polygon points="150,645 340,425 285,720" fill="#D0D1D7" />
      <polygon points="340,425 720,890 395,920" fill="url(#shd-left)" />
      <polygon points="340,425 475,675 395,730" fill="#5C5D66" />

      <polygon points="410,980 940,272 865,640" fill="url(#lit-main-a)" />
      <polygon points="410,980 865,640 735,980" fill="url(#lit-main-b)" />
      <polygon points="735,980 865,640 975,980" fill="#AEB0B8" />
      <polygon points="865,640 940,272 995,575" fill="#C9CAD1" />

      <polygon points="940,272 1490,980 995,575" fill="url(#shd-main-a)" />
      <polygon points="995,575 1235,770 975,980" fill="url(#shd-main-b)" />
      <polygon points="995,575 1490,980 1235,770" fill="url(#shd-main-c)" />
      <polygon points="1235,770 1490,980 975,980" fill="#323339" />

      <polygon points="1160,990 1565,442 1515,760" fill="url(#lit-right)" />
      <polygon points="1160,990 1515,760 1440,990" fill="#A9ABB3" />
      <polygon points="1565,442 2020,990 1515,760" fill="url(#shd-right)" />
      <polygon points="1515,760 2020,990 1440,990" fill="#2E2F35" />

      <rect y="680" width="1920" height="340" fill="url(#valley-haze)" />

      <polygon points="0,1080 0,808 460,936 240,1080" fill="url(#fg-slope-a)" />
      <polygon points="0,808 210,752 460,936" fill="#52535B" />
      <polygon points="210,752 595,976 460,936" fill="#323338" />

      <polygon points="240,1080 760,838 1090,1080" fill="url(#fg-slope-b)" />
      <polygon points="760,838 920,966 620,1080" fill="#4C4D55" />
      <polygon points="760,838 1290,1080 920,966" fill="#2B2C31" />

      <polygon points="1090,1080 1650,848 1920,962 1920,1080" fill="url(#fg-slope-c)" />
      <polygon points="1650,848 1920,962 1740,1080" fill="#25262B" />
      <rect y="1022" width="1920" height="58" fill="#1F2024" />
    </svg>
  </div>
);

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
  if (spec.wallpaperId === 'graphite-flat') {
    return <div className="w-full h-full bg-[#26262a]" />;
  }
  if (spec.wallpaperId === 'obsidian-flat') {
    return <div className="w-full h-full bg-[#131316]" />;
  }
  return <MonoPeaksSvg />;
}

export const WallpaperLayer: React.FC<{
  wallpaperId: string;
  customWallpaper?: string;
}> = React.memo(({ wallpaperId, customWallpaper }) => {
  const targetUrl =
    wallpaperId === 'custom' && customWallpaper ? buildWallpaperUrl(customWallpaper) : undefined;
  const targetKey = `${wallpaperId}:${targetUrl || ''}`;

  const [current, setCurrent] = useState<WallpaperSpec>({
    key: targetKey,
    wallpaperId,
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
        customUrl: targetUrl,
      });
      setAnimating(true);
      timerRef.current = setTimeout(() => {
        setPrevious(null);
        setAnimating(false);
      }, 720);
    };

    // Preload custom image before starting crossfade so it never flashes blank
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
  }, [targetKey, wallpaperId, targetUrl, current]);

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
