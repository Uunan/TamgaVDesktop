import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import type { Request, Response } from 'express';
import type { Duplex } from 'node:stream';
import { applyIpv4PreferenceToEnv } from './linuxDisplayBridge';

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
          env: applyIpv4PreferenceToEnv({
            ...process.env,
            DONT_PROMPT_WSL_INSTALL: '1',
          }),
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

  private getCacheDir(): string {
    const dir = path.join(this.dataDir, 'vscode-asset-cache');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private getAssetCacheKey(reqPath: string, encoding: 'br' | 'gzip'): string {
    const safe = reqPath.replace(/[^a-z0-9._-]/gi, '_').slice(-180);
    return path.join(this.getCacheDir(), `${safe}.${encoding}`);
  }

  private patchWorkbenchHtml(html: string, tamgaTheme: string): string {
    // 1. Remove external vscode-unpkg.net NLS script that stalls on high-latency links
    let out = html.replace(
      /<script[^>]+src=["']https:\/\/www\.vscode-unpkg\.net\/nls\/[^"']+["'][^>]*><\/script>/gi,
      ''
    );

    // 2. Prevent false "The editor failed to load" overlay at 10s while large workbench.js downloads on slower connections
    out = out.replace(
      /animation:\s*vscode-startup-fallback-reveal\s+0s\s+linear\s+10s\s+forwards;/gi,
      'animation: vscode-startup-fallback-reveal 0s linear 120s forwards;'
    );

    // 3. Disable workspace trust banner and match Tamga dark/light theme
    out = out.replace(
      /(<meta\s+id=["']vscode-workbench-web-configuration["']\s+data-settings=["'])([^"']+)(["'])/i,
      (full, prefix: string, encoded: string, suffix: string) => {
        try {
          const decoded = encoded
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          const cfg = JSON.parse(decoded) as Record<string, unknown>;
          cfg.enableWorkspaceTrust = false;
          const prevDefaults =
            typeof cfg.configurationDefaults === 'object' && cfg.configurationDefaults
              ? (cfg.configurationDefaults as Record<string, unknown>)
              : {};
          cfg.configurationDefaults = {
            ...prevDefaults,
            'security.workspace.trust.enabled': false,
            'workbench.startupEditor': 'none',
            'window.confirmBeforeClose': 'never',
            'window.autoDetectColorScheme': false,
            'workbench.colorTheme':
              tamgaTheme === 'light' ? 'Default Light Modern' : 'Default Dark Modern',
          };
          const reEncoded = JSON.stringify(cfg)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          return `${prefix}${reEncoded}${suffix}`;
        } catch {
          return full;
        }
      }
    );

    // 4. Polyfill crypto.subtle.digest (SHA-256) and pass disableServiceWorker=true for Webview iframes
    //    when VS Code Web is accessed over plain HTTP (!window.isSecureContext).
    const nonceMatch = out.match(/<script\s+nonce=["']([^"']+)["']/i);
    if (nonceMatch && out.includes('</head>')) {
      const polyfill = `<script nonce="${nonceMatch[1]}">(function(){try{if(window.isSecureContext)return;if(window.crypto&&!window.crypto.subtle){var K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];function sha256(buf){var b=buf instanceof ArrayBuffer?new Uint8Array(buf):new Uint8Array(buf.buffer||buf,buf.byteOffset||0,buf.byteLength||buf.length);var l=b.length,pw=((l+9+63)>>6)<<4,w=new Uint32Array(pw),dv=new DataView(w.buffer);for(var i=0;i<l;i++)dv.setUint8(i,b[i]);dv.setUint8(l,0x80);dv.setUint32(w.length*4-4,(l*8)>>>0,false);dv.setUint32(w.length*4-8,Math.floor(l/0x20000000)>>>0,false);var h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],W=new Uint32Array(64);for(var o=0;o<pw;o+=16){for(var j=0;j<16;j++)W[j]=dv.getUint32((o+j)*4,false);for(var j=16;j<64;j++){var s0=((W[j-15]>>>7)|(W[j-15]<<25))^((W[j-15]>>>18)|(W[j-15]<<14))^(W[j-15]>>>3);var s1=((W[j-2]>>>17)|(W[j-2]<<15))^((W[j-2]>>>19)|(W[j-2]<<13))^(W[j-2]>>>10);W[j]=(W[j-16]+s0+W[j-7]+s1)>>>0;}var a=h[0],bb=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];for(var j=0;j<64;j++){var S1=((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7));var ch=(e&f)^((~e)&g);var t1=(hh+S1+ch+K[j]+W[j])>>>0;var S0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10));var maj=(a&bb)^(a&c)^(bb&c);var t2=(S0+maj)>>>0;hh=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=bb;bb=a;a=(t1+t2)>>>0;}h[0]=(h[0]+a)>>>0;h[1]=(h[1]+bb)>>>0;h[2]=(h[2]+c)>>>0;h[3]=(h[3]+d)>>>0;h[4]=(h[4]+e)>>>0;h[5]=(h[5]+f)>>>0;h[6]=(h[6]+g)>>>0;h[7]=(h[7]+hh)>>>0;}var out=new Uint8Array(32),odv=new DataView(out.buffer);for(var i=0;i<8;i++)odv.setUint32(i*4,h[i],false);return out.buffer;}Object.defineProperty(window.crypto,'subtle',{configurable:true,value:{digest:function(_a,d){return Promise.resolve(sha256(d));}}});}var orig=Element.prototype.setAttribute;Element.prototype.setAttribute=function(k,v){if(this.tagName==='IFRAME'&&String(k).toLowerCase()==='src'&&String(v).indexOf('/webview/browser/pre/index.html')!==-1&&String(v).indexOf('disableServiceWorker')===-1){v=String(v)+'&disableServiceWorker=true';}return orig.call(this,k,v);};}catch(e){}})();</script>`;
      out = out.replace('</head>', `${polyfill}\n</head>`);
    }
    return out;
  }

  private compressAsync(
    data: Buffer,
    encoding: 'br' | 'gzip',
    cb: (err: Error | null, out?: Buffer) => void
  ): void {
    if (encoding === 'br') {
      zlib.brotliCompress(
        data,
        {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
            [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          },
        },
        cb
      );
    } else {
      zlib.gzip(data, { level: 6 }, cb);
    }
  }

  public proxyHttp = (req: Request, res: Response): void => {
    if (!this.ready) {
      res.status(503).send('VS Code hazırlanıyor...');
      return;
    }

    const acceptEnc = String(req.headers['accept-encoding'] || '');
    const preferredEnc: 'br' | 'gzip' | null = acceptEnc.includes('br')
      ? 'br'
      : acceptEnc.includes('gzip')
      ? 'gzip'
      : null;

    const cleanPath = (req.originalUrl || '').split('?')[0];
    const isImmutableStatic =
      req.method === 'GET' &&
      /^\/vscode-web\/stable-[a-f0-9]+\/static\/.+\.(js|css|svg|json|wasm|map|txt|ttf|woff2?)$/i.test(
        cleanPath
      );

    // Serve pre-compressed immutable VS Code static bundles straight from disk cache (0ms CPU, 3.4MB brotli vs 25MB raw!)
    if (isImmutableStatic && preferredEnc) {
      const cacheFile = this.getAssetCacheKey(cleanPath, preferredEnc);
      if (fs.existsSync(cacheFile)) {
        const ext = path.extname(cleanPath).toLowerCase();
        const mime =
          ext === '.js'
            ? 'text/javascript; charset=utf-8'
            : ext === '.css'
            ? 'text/css; charset=utf-8'
            : ext === '.svg'
            ? 'image/svg+xml'
            : ext === '.json'
            ? 'application/json; charset=utf-8'
            : ext === '.wasm'
            ? 'application/wasm'
            : ext === '.woff2'
            ? 'font/woff2'
            : ext === '.ttf'
            ? 'font/ttf'
            : 'application/octet-stream';
        try {
          const stat = fs.statSync(cacheFile);
          res.writeHead(200, {
            'Content-Type': mime,
            'Content-Encoding': preferredEnc,
            'Content-Length': String(stat.size),
            'Cache-Control': 'public, max-age=31536000, immutable',
            Vary: 'Accept-Encoding',
          });
          fs.createReadStream(cacheFile).pipe(res);
          return;
        } catch {
          // fall through to upstream proxy
        }
      }
    }

    const tamgaTheme = String(req.query?.tamgaTheme || 'dark');
    // Preserve client Host header so code serve-web sets remoteAuthority to the external host:port
    // Remove accept-encoding on localhost so we control clean HTML patching & Brotli/Gzip caching
    const headers: http.OutgoingHttpHeaders = { ...req.headers };
    delete headers['accept-encoding'];

    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: this.port,
        method: req.method,
        path: req.originalUrl,
        headers,
      },
      (upRes) => {
        const outHeaders: http.OutgoingHttpHeaders = { ...upRes.headers };
        // Allow seamless embedding inside TamgaVDesktop WindowFrame
        delete outHeaders['x-frame-options'];
        const csp: unknown = outHeaders['content-security-policy'];
        if (typeof csp === 'string') {
          const cleaned = csp.replace(/frame-ancestors[^;]*;?/gi, '').trim();
          if (cleaned) outHeaders['content-security-policy'] = cleaned;
          else delete outHeaders['content-security-policy'];
        } else if (Array.isArray(csp)) {
          const cleaned = csp
            .map((v) => String(v).replace(/frame-ancestors[^;]*;?/gi, '').trim())
            .filter(Boolean);
          if (cleaned.length > 0) outHeaders['content-security-policy'] = cleaned.join(', ');
          else delete outHeaders['content-security-policy'];
        }

        const ctype = String(outHeaders['content-type'] || '').toLowerCase();

        // Patch VS Code Web bootstrap HTML
        if (req.method !== 'HEAD' && ctype.includes('text/html') && !outHeaders['content-encoding']) {
          const chunks: Buffer[] = [];
          upRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          upRes.on('end', () => {
            const rawHtml = Buffer.concat(chunks).toString('utf-8');
            const patched = Buffer.from(this.patchWorkbenchHtml(rawHtml, tamgaTheme), 'utf-8');
            delete outHeaders['transfer-encoding'];
            if (preferredEnc) {
              delete outHeaders['content-length'];
              outHeaders['content-encoding'] = preferredEnc;
              outHeaders['vary'] = 'Accept-Encoding';
              this.compressAsync(patched, preferredEnc, (err, compBuf) => {
                if (err || !compBuf) {
                  delete outHeaders['content-encoding'];
                  outHeaders['content-length'] = String(patched.length);
                  res.writeHead(upRes.statusCode || 200, outHeaders);
                  res.end(patched);
                } else {
                  outHeaders['content-length'] = String(compBuf.length);
                  res.writeHead(upRes.statusCode || 200, outHeaders);
                  res.end(compBuf);
                }
              });
            } else {
              outHeaders['content-length'] = String(patched.length);
              res.writeHead(upRes.statusCode || 200, outHeaders);
              res.end(patched);
            }
          });
          upRes.on('error', () => {
            if (!res.headersSent) res.status(502).end('VS Code yanıt hatası');
          });
          return;
        }

        // Compress & persist immutable static JS/CSS/WASM/SVG bundles (especially 25MB workbench.js -> 3.4MB br!)
        if (
          isImmutableStatic &&
          (upRes.statusCode || 500) === 200 &&
          preferredEnc &&
          !outHeaders['content-encoding']
        ) {
          const chunks: Buffer[] = [];
          upRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          upRes.on('end', () => {
            const raw = Buffer.concat(chunks);
            delete outHeaders['transfer-encoding'];
            this.compressAsync(raw, preferredEnc, (err, compBuf) => {
              if (err || !compBuf) {
                outHeaders['content-length'] = String(raw.length);
                outHeaders['cache-control'] = 'public, max-age=31536000, immutable';
                res.writeHead(200, outHeaders);
                res.end(raw);
                return;
              }
              // Save asynchronously to disk cache so future requests return in <1ms with zero CPU
              try {
                const cacheFile = this.getAssetCacheKey(cleanPath, preferredEnc);
                fs.writeFile(cacheFile, compBuf, () => {});
              } catch {}
              delete outHeaders['content-length'];
              outHeaders['content-encoding'] = preferredEnc;
              outHeaders['content-length'] = String(compBuf.length);
              outHeaders['cache-control'] = 'public, max-age=31536000, immutable';
              outHeaders['vary'] = 'Accept-Encoding';
              res.writeHead(200, outHeaders);
              res.end(compBuf);
            });
          });
          upRes.on('error', () => {
            if (!res.headersSent) res.status(502).end('VS Code yanıt hatası');
          });
          return;
        }

        const shouldCompress =
          preferredEnc &&
          req.method !== 'HEAD' &&
          !outHeaders['content-encoding'] &&
          /(javascript|css|json|html|svg|wasm|xml|text\/plain)/.test(ctype);

        if (shouldCompress) {
          delete outHeaders['content-length'];
          outHeaders['content-encoding'] = preferredEnc;
          outHeaders['vary'] = 'Accept-Encoding';
          res.writeHead(upRes.statusCode || 200, outHeaders);
          const comp =
            preferredEnc === 'br'
              ? zlib.createBrotliCompress({
                  params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
                })
              : zlib.createGzip({ level: 4 });
          comp.on('error', () => res.destroy());
          upRes.on('error', () => comp.destroy());
          res.on('close', () => comp.destroy());
          upRes.pipe(comp).pipe(res);
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
    if ('setNoDelay' in clientSocket && typeof (clientSocket as net.Socket).setNoDelay === 'function') {
      (clientSocket as net.Socket).setNoDelay(true);
    }
    const upstream = net.connect(this.port, '127.0.0.1', () => {
      upstream.setNoDelay(true);
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
