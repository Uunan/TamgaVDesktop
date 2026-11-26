import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export function resolveHelperPath(helperName: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, 'helpers', helperName),
    path.resolve(here, '../server/helpers', helperName),
    path.resolve(here, './server/helpers', helperName),
    path.resolve(process.cwd(), 'server/helpers', helperName),
    path.resolve(process.cwd(), 'dist/helpers', helperName),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

export interface TerminalSession {
  id: string;
  desktopId: string;
  cwd: string;
  proc: ChildProcessWithoutNullStreams;
  listeners: Set<(msg: { type: 'output' | 'exit'; data?: string; code?: number }) => void>;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
}

export class TerminalManager {
  private sessions = new Map<string, TerminalSession>();

  public createSession(
    sessionId: string,
    desktopId: string,
    cwd: string,
    cols = 100,
    rows = 30
  ): TerminalSession {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const scriptPath = resolveHelperPath('pty_bridge.py');
    const safeCwd = fs.existsSync(cwd) ? cwd : process.cwd();
    const proc = spawn('python3', ['-u', scriptPath, safeCwd, String(cols), String(rows)], {
      cwd: safeCwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const listeners = new Set<(msg: { type: 'output' | 'exit'; data?: string; code?: number }) => void>();
    let lineBuf = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      lineBuf += chunk.toString('utf-8');
      let nl = lineBuf.indexOf('\n');
      while (nl !== -1) {
        const line = lineBuf.slice(0, nl).trim();
        lineBuf = lineBuf.slice(nl + 1);
        if (line) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'output' && typeof parsed.data === 'string') {
              const decoded = Buffer.from(parsed.data, 'base64').toString('utf-8');
              for (const fn of listeners) fn({ type: 'output', data: decoded });
            } else if (parsed.type === 'exit') {
              for (const fn of listeners) fn({ type: 'exit', code: Number(parsed.code || 0) });
            }
          } catch {
            // ignore malformed line
          }
        }
        nl = lineBuf.indexOf('\n');
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const txt = chunk.toString('utf-8');
      for (const fn of listeners) fn({ type: 'output', data: txt });
    });

    proc.on('exit', (code) => {
      for (const fn of listeners) fn({ type: 'exit', code: code ?? 0 });
      this.sessions.delete(sessionId);
    });

    const sendCmd = (payload: Record<string, unknown>) => {
      if (proc.stdin.writable) {
        proc.stdin.write(JSON.stringify(payload) + '\n');
      }
    };

    const session: TerminalSession = {
      id: sessionId,
      desktopId,
      cwd: safeCwd,
      proc,
      listeners,
      write: (data: string) => {
        sendCmd({ type: 'input', data: Buffer.from(data, 'utf-8').toString('base64') });
      },
      resize: (c: number, r: number) => {
        sendCmd({ type: 'resize', cols: c, rows: r });
      },
      close: () => {
        this.sessions.delete(sessionId);
        try {
          proc.kill('SIGTERM');
        } catch {}
      },
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  public getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  public destroyDesktopSessions(desktopId: string): void {
    for (const [id, sess] of this.sessions.entries()) {
      if (sess.desktopId === desktopId) {
        sess.close();
        this.sessions.delete(id);
      }
    }
  }

  public destroyAll(): void {
    for (const sess of this.sessions.values()) {
      sess.close();
    }
    this.sessions.clear();
  }
}
