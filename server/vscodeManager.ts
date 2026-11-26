import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import type { Request, Response } from 'express';
import type { Duplex } from 'node:stream';

function resolveCodeServeBinary(): string | null {
  // Prefer direct Rust tunnel binary to avoid keeping an extra Electron Node wrapper alive
  if (fs.existsSync('/usr/share/code/bin/code-tunnel')) {
    return '/usr/share/code/bin/code-tunnel';
  }
  try {
    const out = execSync('command -v code-tunnel || command -v code', {
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: '/bin/sh',
    })
      .toString('utf-8')
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

export class VSCodeServerManager {
  private proc: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private ready = false;
  private port = 4899;
  private dataDir: string;
  private statusMessage = 'VS Code Web sunucusu hazırlanıyor...';

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  public isInstalled(): boolean {
    return Boolean(resolveCodeServeBinary());
  }

  public getStatus() {
    return {
      installed: this.isInstalled(),
      ready: this.ready,
      statusMessage: this.statusMessage,
    };
  }

  public async ensureStarted(): Promise<void> {
    if (this.ready && this.proc && this.proc.exitCode === null) {
      return;
    }
    if (this.starting) {
      return this.starting;
    }
    const bin = resolveCodeServeBinary();
    if (!bin) {
      throw new Error('VS Code sunucuda kurulu değil. Uygulamalar penceresinden kurabilirsiniz.');
    }

    this.starting = (async () => {
      const cliDir = path.join(this.dataDir, 'vscode-cli');
      const srvDir = path.join(this.dataDir, 'vscode-server');
      const machineSettingsDir = path.join(srvDir, 'data', 'Machine');
      fs.mkdirSync(cliDir, { recursive: true });
      fs.mkdirSync(machineSettingsDir, { recursive: true });

      const machineSettingsPath = path.join(machineSettingsDir, 'settings.json');
      if (!fs.existsSync(machineSettingsPath)) {
        fs.writeFileSync(
          machineSettingsPath,
          JSON.stringify(
            {
              'security.workspace.trust.enabled': false,
              'workbench.startupEditor': 'none',
              'workbench.colorTheme': 'Default Dark Modern',
            },
            null,
            2
          ),
          'utf-8'
        );
      }

      this.ready = false;
      this.statusMessage = 'VS Code Web motoru başlatılıyor (ilk açılışta bileşenler indirilebilir)...';

      const proc = spawn(
        bin,
        [
          'serve-web',
          '--host',
          '127.0.0.1',
          '--port',
          String(this.port),
          '--without-connection-token',
          '--accept-server-license-terms',
          '--server-base-path',
          '/vscode-web',
          '--cli-data-dir',
          cliDir,
          '--server-data-dir',
          srvDir,
          '--disable-telemetry',
        ],
        {
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            DONT_PROMPT_WSL_INSTALL: '1',
          },
        }
      );
      this.proc = proc;

      proc.stdout?.on('data', (chunk: Buffer) => {
        const line = chunk.toString('utf-8').trim();
        if (line.toLowerCase().includes('downloading')) {
          this.statusMessage = 'VS Code Web sunucu paketi indiriliyor...';
        }
      });

      proc.on('exit', () => {
        this.ready = false;
        this.proc = null;
      });

      // Poll until local HTTP server responds (up to 90s on first-time server component download)
      for (let i = 0; i < 180; i++) {
        if (proc.exitCode !== null) {
          throw new Error('VS Code Web sunucusu beklenmedik şekilde kapandı.');
        }
        const alive = await this.probeHttp();
        if (alive) {
          this.ready = true;
          this.statusMessage = 'Hazır';
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error('VS Code Web sunucusu zaman aşımına uğradı.');
    })();

    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private probeHttp(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port: this.port,
          path: '/vscode-web/',
          timeout: 800,
        },
        (res) => {
          res.resume();
          resolve((res.statusCode || 500) < 500);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  public proxyHttp = (req: Request, res: Response): void => {
    if (!this.ready) {
      res.status(503).send('VS Code hazırlanıyor...');
      return;
    }
    const acceptGzip = String(req.headers['accept-encoding'] || '').includes('gzip');
    // Preserve client Host header so code serve-web sets remoteAuthority to the external host:port
    const headers = { ...req.headers };
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: this.port,
        method: req.method,
        path: req.originalUrl,
        headers,
      },
      (upRes) => {
        const outHeaders = { ...upRes.headers };
        // Allow seamless embedding inside TamgaVDesktop WindowFrame
        delete outHeaders['x-frame-options'];
        if (typeof outHeaders['content-security-policy'] === 'string') {
          outHeaders['content-security-policy'] = outHeaders['content-security-policy'].replace(
            /frame-ancestors[^;]*;?/gi,
            ''
          );
        } else if (Array.isArray(outHeaders['content-security-policy'])) {
          outHeaders['content-security-policy'] = outHeaders['content-security-policy'].map((v) =>
            v.replace(/frame-ancestors[^;]*;?/gi, '')
          );
        }

        const ctype = String(outHeaders['content-type'] || '').toLowerCase();
        const shouldGzip =
          acceptGzip &&
          req.method !== 'HEAD' &&
          !outHeaders['content-encoding'] &&
          /(javascript|css|json|html|svg|wasm|xml|text\/plain)/.test(ctype);

        if (shouldGzip) {
          delete outHeaders['content-length'];
          outHeaders['content-encoding'] = 'gzip';
          res.writeHead(upRes.statusCode || 200, outHeaders);
          const gz = zlib.createGzip({ level: 1 });
          gz.on('error', () => res.destroy());
          upRes.on('error', () => gz.destroy());
          res.on('close', () => gz.destroy());
          upRes.pipe(gz).pipe(res);
          return;
        }

        res.writeHead(upRes.statusCode || 200, outHeaders);
        upRes.pipe(res);
      }
    );

    upstream.on('error', () => {
      if (!res.headersSent) res.status(502).end('VS Code bağlantı hatası');
    });

    req.pipe(upstream);
  };

  public proxyUpgrade(req: http.IncomingMessage, clientSocket: Duplex, head: Buffer): void {
    const upstream = net.connect(this.port, '127.0.0.1', () => {
      // Preserve incoming Host header so Origin validation in code serve-web succeeds
      const lines = [`${req.method || 'GET'} ${req.url || '/vscode-web/'} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i];
        const v = req.rawHeaders[i + 1];
        lines.push(`${k}: ${v}`);
      }
      lines.push('', '');
      upstream.write(lines.join('\r\n'));
      if (head && head.length > 0) upstream.write(head);

      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });

    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  }

  public stop(): void {
    if (this.proc) {
      try {
        if (this.proc.pid) {
          process.kill(-this.proc.pid, 'SIGTERM');
        } else {
          this.proc.kill('SIGTERM');
        }
      } catch {}
      this.proc = null;
    }
    this.ready = false;
  }
}
