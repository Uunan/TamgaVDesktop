import React, { useState } from 'react';
import { ArrowRight, Lock } from 'lucide-react';
import { authApi } from '../../services/osBridge';
import { WallpaperLayer } from '../desktop/WallpaperLayer';

interface LoginScreenProps {
  serverName?: string;
  hostname?: string;
  version?: string;
  onSuccess: (username: string) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  serverName = 'TamgaVDesktop',
  hostname,
  version,
  onSuccess,
}) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.login(username, password);
      onSuccess(res.username);
    } catch (err) {
      setError((err as Error).message || 'Giriş başarısız.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden select-none flex items-center justify-center bg-[var(--os-bg)] text-[var(--os-text)]">
      <WallpaperLayer wallpaperId="mono-peaks" theme="dark" />
      <div className="fixed inset-0 bg-black/45 backdrop-blur-md" />

      <form
        onSubmit={handleSubmit}
        style={{ boxShadow: 'var(--os-shadow)' }}
        className="relative z-10 w-[340px] max-w-[calc(100vw-32px)] rounded-3xl bg-[var(--os-surface-2)] border border-[var(--os-border-strong)] p-6 space-y-5"
      >
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-[var(--os-surface-3)] border border-[var(--os-border)] flex items-center justify-center">
            <Lock className="w-5 h-5 text-[var(--os-text)]" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-[var(--os-text)]">
              {serverName}
            </h1>
            <p className="text-[11px] text-[var(--os-text-muted)] mt-0.5 font-mono">
              {hostname ? `${hostname}` : 'Linux Sanal Masaüstü'}
              {version ? ` · v${version}` : ''}
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          <div>
            <label className="block text-[11px] text-[var(--os-text-muted)] mb-1">
              Kullanıcı Adı
            </label>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              data-testid="login-username"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)] focus:border-[var(--os-border-strong)] focus:outline-none text-xs text-[var(--os-text)]"
            />
          </div>

          <div>
            <label className="block text-[11px] text-[var(--os-text-muted)] mb-1">Parola</label>
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Parolanızı girin"
              data-testid="login-password"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--os-bg)] border border-[var(--os-border)] focus:border-[var(--os-border-strong)] focus:outline-none text-xs text-[var(--os-text)]"
            />
          </div>
        </div>

        {error && (
          <div className="px-3 py-2 rounded-xl bg-red-500/12 border border-red-500/25 text-[11px] text-red-400">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          data-testid="login-submit"
          className="w-full py-2.5 px-4 rounded-xl bg-[var(--os-accent-bg)] text-[var(--os-accent-fg)] hover:opacity-90 disabled:opacity-50 text-xs font-semibold flex items-center justify-center gap-2 transition-opacity"
        >
          <span>{loading ? 'Doğrulanıyor...' : 'Masaüstüne Bağlan'}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
