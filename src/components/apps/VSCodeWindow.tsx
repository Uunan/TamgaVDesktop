import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { appsApi } from '../../services/osBridge';

interface VSCodeWindowProps {
  folderPath?: string;
}

export const VSCodeWindow: React.FC<VSCodeWindowProps> = ({ folderPath }) => {
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('VS Code hazırlanıyor...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    appsApi
      .startVSCodeWeb(folderPath)
      .then((res) => {
        if (!cancelled) setReadyUrl(res.url);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });

    const poll = setInterval(() => {
      appsApi
        .vscodeStatus()
        .then((st) => {
          if (!cancelled && st.statusMessage) setStatusMsg(st.statusMessage);
        })
        .catch(() => {});
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [folderPath]);

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-[var(--os-bg)] gap-2">
        <div className="text-xs font-semibold text-red-400">VS Code Başlatılamadı</div>
        <div className="text-[11px] text-[var(--os-text-muted)] max-w-md">{error}</div>
      </div>
    );
  }

  if (!readyUrl) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[var(--os-bg)] text-[var(--os-text)]">
        <Loader2 className="w-6 h-6 animate-spin" />
        <div className="text-xs font-medium">{statusMsg}</div>
        <div className="text-[11px] text-[var(--os-text-subtle)]">
          Görüntü aktarımı olmadan %100 yerli DOM editörü açılıyor
        </div>
      </div>
    );
  }

  return (
    <iframe
      src={readyUrl}
      title="Visual Studio Code"
      data-testid="vscode-web-iframe"
      allow="clipboard-read; clipboard-write"
      className="w-full h-full border-0 bg-[#1e1e1e]"
    />
  );
};
