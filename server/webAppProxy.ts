import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import type express from 'express';
import { ensureGoogleApiIpv4Preference } from './linuxDisplayBridge';

interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  sameSite?: string;
}

const ipv4HttpAgent = new http.Agent({ keepAlive: true, family: 4 });
const ipv4HttpsAgent = new https.Agent({ keepAlive: true, family: 4 });

function encodeOrigin(origin: string): string {
  return Buffer.from(origin, 'utf8').toString('base64url');
}

function decodeOrigin(b64: string): string | null {
  try {
    const raw = Buffer.from(b64, 'base64url').toString('utf8');
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === '169.254.169.254' || h === 'metadata.google.internal' || h.endsWith('.internal')) {
    return true;
  }
  return false;
}

function normalizeProxyTarget(raw: string): URL | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (isBlockedHost(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

function decodeChromeCookieValue(hostKey: string, encHex: string, plainVal: string): string {
  if (plainVal) return plainVal;
  if (!encHex) return '';
  try {
    const buf = Buffer.from(encHex, 'hex');
    if (buf.length < 4) return '';
    const prefix = buf.subarray(0, 3).toString('ascii');
    if (prefix !== 'v10') {
      return '';
    }
    const key = crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1');
    const iv = Buffer.alloc(16, 0x20); // 16 spaces
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    const decrypted = Buffer.concat([decipher.update(buf.subarray(3)), decipher.final()]);
    // Chromium >= 130 prepends SHA256(host_key) (32 bytes) when length >= 32 and match
    if (decrypted.length > 32) {
      const domainDigest = crypto.createHash('sha256').update(hostKey).digest();
      if (decrypted.subarray(0, 32).equals(domainDigest)) {
        return decrypted.subarray(32).toString('utf8');
      }
    }
    // Heuristic fallback: if first 32 bytes contain control/non-UTF8 bytes while tail is clean ASCII
    const headNonPrint = decrypted.subarray(0, 32).some((b) => b < 0x20 || b > 0x7e);
    if (decrypted.length > 32 && headNonPrint) {
      const tail = decrypted.subarray(32).toString('utf8');
      if (!/[\u0000-\u001f\ufffd]/.test(tail)) return tail;
    }
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

function buildClientRuntimeShim(origin: string, originB64: string): string {
  const safeOrigin = JSON.stringify(origin);
  const safeB64 = JSON.stringify(originB64);
  return `<script data-tamga-proxy="1">
(function(){
  if (window.__tamgaWebProxyInit) return;
  window.__tamgaWebProxyInit = true;
  try {
    if (!window.isSecureContext && window.crypto) {
      if (typeof window.crypto.randomUUID !== 'function' && window.crypto.getRandomValues) {
        Object.defineProperty(window.crypto, 'randomUUID', {
          configurable: true,
          value: function() {
            var b = new Uint8Array(16);
            window.crypto.getRandomValues(b);
            b[6] = (b[6] & 0x0f) | 0x40;
            b[8] = (b[8] & 0x3f) | 0x80;
            var h = [];
            for (var i = 0; i < 16; i++) h.push((b[i] < 16 ? '0' : '') + b[i].toString(16));
            return h.slice(0,4).join('') + '-' + h.slice(4,6).join('') + '-' + h.slice(6,8).join('') + '-' + h.slice(8,10).join('') + '-' + h.slice(10,16).join('');
          }
        });
      }
      if (!window.crypto.subtle) {
        var K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
        var sha256=function(buf){var b=buf instanceof ArrayBuffer?new Uint8Array(buf):new Uint8Array(buf.buffer||buf,buf.byteOffset||0,buf.byteLength||buf.length);var l=b.length,pw=((l+9+63)>>6)<<4,w=new Uint32Array(pw),dv=new DataView(w.buffer);for(var i=0;i<l;i++)dv.setUint8(i,b[i]);dv.setUint8(l,0x80);dv.setUint32(w.length*4-4,(l*8)>>>0,false);dv.setUint32(w.length*4-8,Math.floor(l/0x20000000)>>>0,false);var h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],W=new Uint32Array(64);for(var o=0;o<pw;o+=16){for(var j=0;j<16;j++)W[j]=dv.getUint32((o+j)*4,false);for(var j=16;j<64;j++){var s0=((W[j-15]>>>7)|(W[j-15]<<25))^((W[j-15]>>>18)|(W[j-15]<<14))^(W[j-15]>>>3);var s1=((W[j-2]>>>17)|(W[j-2]<<15))^((W[j-2]>>>19)|(W[j-2]<<13))^(W[j-2]>>>10);W[j]=(W[j-16]+s0+W[j-7]+s1)>>>0;}var a=h[0],bb=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];for(var j=0;j<64;j++){var S1=((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7));var ch=(e&f)^((~e)&g);var t1=(hh+S1+ch+K[j]+W[j])>>>0;var S0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10));var maj=(a&bb)^(a&c)^(bb&c);var t2=(S0+maj)>>>0;hh=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=bb;bb=a;a=(t1+t2)>>>0;}h[0]=(h[0]+a)>>>0;h[1]=(h[1]+bb)>>>0;h[2]=(h[2]+c)>>>0;h[3]=(h[3]+d)>>>0;h[4]=(h[4]+e)>>>0;h[5]=(h[5]+f)>>>0;h[6]=(h[6]+g)>>>0;h[7]=(h[7]+hh)>>>0;}var out=new Uint8Array(32),odv=new DataView(out.buffer);for(var i=0;i<8;i++)odv.setUint32(i*4,h[i],false);return out.buffer;};
        Object.defineProperty(window.crypto, 'subtle', {
          configurable: true,
          value: { digest: function(_alg, data) { return Promise.resolve(sha256(data)); } }
        });
      }
    }
  } catch (e) {}
  var UPSTREAM_ORIGIN = ${safeOrigin};
  var ORIGIN_B64 = ${safeB64};
  var PROXY_PREFIX = '/web-app-proxy/p/';

  function b64url(str) {
    try {
      var bytes = new TextEncoder().encode(str);
      var bin = '';
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    } catch (e) { return ''; }
  }

  function toProxyUrl(input, forWs) {
    if (!input || typeof input !== 'string') return input;
    var s = input.trim();
    if (!s || s.startsWith('data:') || s.startsWith('blob:') || s.startsWith('javascript:') || s.startsWith('mailto:') || s.startsWith('#')) {
      return input;
    }
    if (s.startsWith('/web-app-proxy/')) return s;
    try {
      var upBase = new URL(UPSTREAM_ORIGIN + '/');
      if (forWs) {
        var wsUrl = new URL(s, upBase.href);
        var proto = wsUrl.protocol === 'wss:' || wsUrl.protocol === 'https:' ? 'https:' : 'http:';
        var hostOrigin = proto + '//' + wsUrl.host;
        var wsScheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return wsScheme + '//' + location.host + '/web-app-proxy/ws/' + b64url(hostOrigin) + wsUrl.pathname + wsUrl.search;
      }
      if (s.startsWith('//')) {
        s = upBase.protocol + s;
      }
      var resolved = new URL(s, upBase.href);
      if (resolved.origin === location.origin) {
        if (resolved.pathname.startsWith('/web-app-proxy/')) return resolved.pathname + resolved.search + resolved.hash;
        return PROXY_PREFIX + ORIGIN_B64 + resolved.pathname + resolved.search + resolved.hash;
      }
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return input;
      return PROXY_PREFIX + b64url(resolved.origin) + resolved.pathname + resolved.search + resolved.hash;
    } catch (e) {
      return input;
    }
  }

  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function(resource, init) {
      try {
        if (typeof resource === 'string') {
          resource = toProxyUrl(resource, false);
        } else if (resource && typeof Request !== 'undefined' && resource instanceof Request) {
          var rewritten = toProxyUrl(resource.url, false);
          if (rewritten !== resource.url) {
            resource = new Request(rewritten, resource);
          }
        }
      } catch (e) {}
      return origFetch.call(this, resource, init);
    };
  }

  if (window.XMLHttpRequest && XMLHttpRequest.prototype.open) {
    var origXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      try {
        if (typeof url === 'string') {
          arguments[1] = toProxyUrl(url, false);
        }
      } catch (e) {}
      return origXhrOpen.apply(this, arguments);
    };
  }

  if (navigator.sendBeacon) {
    var origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      try {
        if (typeof url === 'string') url = toProxyUrl(url, false);
      } catch (e) {}
      return origBeacon(url, data);
    };
  }

  if (window.WebSocket) {
    var OrigWS = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      var proxied = typeof url === 'string' ? toProxyUrl(url, true) : url;
      return protocols !== undefined ? new OrigWS(proxied, protocols) : new OrigWS(proxied);
    };
    window.WebSocket.prototype = OrigWS.prototype;
    window.WebSocket.CONNECTING = OrigWS.CONNECTING;
    window.WebSocket.OPEN = OrigWS.OPEN;
    window.WebSocket.CLOSING = OrigWS.CLOSING;
    window.WebSocket.CLOSED = OrigWS.CLOSED;
  }

  var origOpen = window.open;
  window.open = function(url, target, features) {
    if (typeof url === 'string' && url) {
      return origOpen.call(window, toProxyUrl(url, false), target || '_self', features);
    }
    return origOpen.apply(window, arguments);
  };

  if (window.history) {
    var wrapHistory = function(fn) {
      return function(state, title, url) {
        try {
          if (typeof url === 'string' && url) {
            url = toProxyUrl(url, false);
          }
        } catch (e) {}
        return fn.call(history, state, title, url);
      };
    };
    history.pushState = wrapHistory(history.pushState);
    history.replaceState = wrapHistory(history.replaceState);
  }

  try {
    var origSetAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
      var low = String(name || '').toLowerCase();
      if ((low === 'src' || low === 'href' || low === 'action') && typeof value === 'string') {
        value = toProxyUrl(value, false);
      }
      return origSetAttr.call(this, name, value);
    };
  } catch (e) {}

  function notifyTitle() {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'tamga_webapp_title', title: document.title || '', url: UPSTREAM_ORIGIN }, '*');
      }
    } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', function() {
    notifyTitle();
    var titleEl = document.querySelector('title');
    if (titleEl && typeof MutationObserver !== 'undefined') {
      new MutationObserver(notifyTitle).observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  });
  window.addEventListener('load', notifyTitle);

  window.addEventListener('keydown', function(e) {
    var k = String(e.key || '').toLowerCase();
    var isMac = /mac/i.test(navigator.platform || '');
    if ((isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.altKey) && !e.shiftKey && k === 'l') {
      e.preventDefault();
      e.stopPropagation();
      try { window.parent.postMessage({ type: 'tamga_shortcut', action: 'lock' }, '*'); } catch (err) {}
    } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && k === 'w') {
      e.preventDefault();
      e.stopPropagation();
      try { window.parent.postMessage({ type: 'tamga_shortcut', action: 'close-window' }, '*'); } catch (err) {}
    }
  }, true);
})();
</script>`;
}

export class WebAppProxyManager {
  private jars = new Map<string, Map<string, StoredCookie>>();
  private desktopRoots = new Map<string, string>();
  private lastChromeSync = new Map<string, number>();

  public registerDesktopRoot(desktopId: string, instanceRoot: string): void {
    if (!this.desktopRoots.has(desktopId)) {
      this.desktopRoots.set(desktopId, instanceRoot);
      this.loadJarFromDisk(desktopId, instanceRoot);
    }
  }

  private getJarPath(desktopId: string): string | null {
    const root = this.desktopRoots.get(desktopId);
    return root ? path.join(root, 'web-proxy-cookies.json') : null;
  }

  private loadJarFromDisk(desktopId: string, instanceRoot: string): void {
    const jar = new Map<string, StoredCookie>();
    this.jars.set(desktopId, jar);
    const fp = path.join(instanceRoot, 'web-proxy-cookies.json');
    try {
      if (fs.existsSync(fp)) {
        const list = JSON.parse(fs.readFileSync(fp, 'utf8')) as StoredCookie[];
        if (Array.isArray(list)) {
          for (const c of list) {
            if (c?.name && c?.domain) {
              jar.set(`${c.domain}|${c.path || '/'}|${c.name}`, c);
            }
          }
        }
      }
    } catch {}
  }

  private saveJarToDisk(desktopId: string): void {
    const fp = this.getJarPath(desktopId);
    const jar = this.jars.get(desktopId);
    if (!fp || !jar) return;
    try {
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, JSON.stringify(Array.from(jar.values()), null, 2), 'utf8');
    } catch {}
  }

  private getJar(desktopId: string): Map<string, StoredCookie> {
    let jar = this.jars.get(desktopId);
    if (!jar) {
      jar = new Map();
      this.jars.set(desktopId, jar);
    }
    return jar;
  }

  public syncFromChromeProfile(desktopId: string): number {
    const root = this.desktopRoots.get(desktopId);
    if (!root) return 0;
    const candidates = [
      path.join(root, 'app-profiles', 'chrome', 'Default', 'Cookies'),
      path.join(root, 'app-profiles', 'chromium', 'Default', 'Cookies'),
      path.join(root, '.config', 'google-chrome', 'Default', 'Cookies'),
    ];
    const dbPath = candidates.find((p) => fs.existsSync(p));
    if (!dbPath) return 0;

    const jar = this.getJar(desktopId);
    let imported = 0;
    const tmpCopy = `/tmp/tamga-ck-${desktopId}-${Date.now()}.db`;
    try {
      fs.copyFileSync(dbPath, tmpCopy);
      const py = [
        'import sqlite3, json, sys',
        'conn = sqlite3.connect(sys.argv[1])',
        'rows = conn.execute("SELECT host_key, name, path, value, hex(encrypted_value), expires_utc FROM cookies").fetchall()',
        'print(json.dumps(rows))',
      ].join('\n');
      const raw = execFileSync('python3', ['-c', py, tmpCopy], {
        timeout: 4000,
        maxBuffer: 8 * 1024 * 1024,
      }).toString('utf8');
      const rows = JSON.parse(raw) as Array<[string, string, string, string, string, number]>;
      for (const [hostKey, name, cPath, plainVal, encHex] of rows) {
        const val = decodeChromeCookieValue(hostKey, encHex || '', plainVal || '');
        if (!name || !val) continue;
        jar.set(`${hostKey}|${cPath || '/'}|${name}`, {
          name,
          value: val,
          domain: hostKey,
          path: cPath || '/',
        });
        imported++;
      }
      this.lastChromeSync.set(desktopId, Date.now());
      this.saveJarToDisk(desktopId);
    } catch {
      // Ignore read errors when DB unavailable
    } finally {
      try {
        fs.unlinkSync(tmpCopy);
      } catch {}
    }
    return imported;
  }

  private matchCookiesHeader(desktopId: string, url: URL): string {
    const jar = this.getJar(desktopId);
    const host = url.hostname.toLowerCase();
    const reqPath = url.pathname || '/';
    const matched: string[] = [];
    for (const c of jar.values()) {
      const dom = c.domain.toLowerCase();
      const domainMatch = dom.startsWith('.')
        ? host === dom.slice(1) || host.endsWith(dom)
        : host === dom || host.endsWith(`.${dom}`);
      if (!domainMatch) continue;
      if (!reqPath.startsWith(c.path || '/')) continue;
      matched.push(`${c.name}=${c.value}`);
    }
    return matched.join('; ');
  }

  private storeResponseCookies(desktopId: string, targetUrl: URL, setCookies: string[] | string | undefined): void {
    if (!setCookies) return;
    const list = Array.isArray(setCookies) ? setCookies : [setCookies];
    const jar = this.getJar(desktopId);
    let dirty = false;
    for (const raw of list) {
      const parts = raw.split(';').map((p) => p.trim());
      if (parts.length === 0) continue;
      const eq = parts[0].indexOf('=');
      if (eq <= 0) continue;
      const name = parts[0].slice(0, eq).trim();
      const value = parts[0].slice(eq + 1);
      let domain = targetUrl.hostname.toLowerCase();
      let cPath = '/';
      for (const attr of parts.slice(1)) {
        const [ak, ...av] = attr.split('=');
        const low = ak.trim().toLowerCase();
        const aval = av.join('=').trim();
        if (low === 'domain' && aval) {
          domain = aval.toLowerCase();
        } else if (low === 'path' && aval) {
          cPath = aval;
        }
      }
      jar.set(`${domain}|${cPath}|${name}`, { name, value, domain, path: cPath });
      dirty = true;
    }
    if (dirty) this.saveJarToDisk(desktopId);
  }

  private rewriteUrlToProxy(rawUrl: string, currentOrigin: string): string {
    const trimmed = (rawUrl || '').trim();
    if (
      !trimmed ||
      trimmed.startsWith('data:') ||
      trimmed.startsWith('blob:') ||
      trimmed.startsWith('javascript:') ||
      trimmed.startsWith('mailto:') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('/web-app-proxy/')
    ) {
      return rawUrl;
    }
    try {
      const base = new URL(`${currentOrigin}/`);
      const resolved = new URL(trimmed.startsWith('//') ? `${base.protocol}${trimmed}` : trimmed, base);
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return rawUrl;
      return `/web-app-proxy/p/${encodeOrigin(resolved.origin)}${resolved.pathname}${resolved.search}${resolved.hash}`;
    } catch {
      return rawUrl;
    }
  }

  private rewriteHtml(html: string, origin: string, originB64: string): string {
    let out = html
      .replace(/<meta[^>]+http-equiv=["']?content-security-policy[^"']*["']?[^>]*>/gi, '')
      .replace(/<meta[^>]+http-equiv=["']?x-frame-options[^"']*["']?[^>]*>/gi, '')
      .replace(/<base\b[^>]*>/gi, '')
      .replace(/\s+integrity=(["'])[^"']*\1/gi, '');

    // Rewrite absolute, protocol-relative, and root-relative (/...) URLs across quoted attributes
    out = out.replace(
      /\b(src|href|action|poster|data-src)=(["'])((?:https?:|\/\/|\/(?!web-app-proxy\/))[^"']*)\2/gi,
      (_m, attr, q, url) => `${attr}=${q}${this.rewriteUrlToProxy(url, origin)}${q}`
    );

    // Rewrite unquoted src/href/action/poster attributes when upstream HTML omits quotes
    out = out.replace(
      /\b(src|href|action|poster)=((?:https?:|\/\/|\/(?!web-app-proxy\/))[^\s"'=<>`]+)/gi,
      (_m, attr, url) => `${attr}="${this.rewriteUrlToProxy(url, origin)}"`
    );

    // Rewrite srcset entries
    out = out.replace(/\bsrcset=(["'])([^"']+)\1/gi, (_m, q, val) => {
      const rewritten = String(val)
        .split(',')
        .map((part) => {
          const trimmed = part.trim();
          if (!trimmed) return part;
          const sp = trimmed.split(/\s+/);
          if (/^(https?:|\/\/|\/(?!web-app-proxy\/))/i.test(sp[0])) {
            sp[0] = this.rewriteUrlToProxy(sp[0], origin);
          }
          return sp.join(' ');
        })
        .join(', ');
      return `srcset=${q}${rewritten}${q}`;
    });

    const headAddon = `<base href="/web-app-proxy/p/${originB64}/">\n${buildClientRuntimeShim(origin, originB64)}`;
    if (/<head(\s[^>]*)?>/i.test(out)) {
      out = out.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n${headAddon}`);
    } else {
      out = `${headAddon}\n${out}`;
    }
    return out;
  }

  private rewriteCss(css: string, origin: string): string {
    let out = css.replace(
      /url\(\s*(['"]?)((?:https?:|\/\/|\/(?!web-app-proxy\/))[^)'"]+)\1\s*\)/gi,
      (_m, q, url) => `url(${q}${this.rewriteUrlToProxy(url, origin)}${q})`
    );
    out = out.replace(
      /@import\s+(["'])((?:https?:|\/\/|\/(?!web-app-proxy\/))[^"']+)\1/gi,
      (_m, q, url) => `@import ${q}${this.rewriteUrlToProxy(url, origin)}${q}`
    );
    return out;
  }

  public handleOpen(req: express.Request, res: express.Response, desktopId: string, instanceRoot: string): void {
    this.registerDesktopRoot(desktopId, instanceRoot);
    const target = normalizeProxyTarget(String(req.query.url || ''));
    if (!target) {
      res.status(400).send('Geçersiz Web Uygulama URL adresi.');
      return;
    }
    const lastSync = this.lastChromeSync.get(desktopId) || 0;
    if (Date.now() - lastSync > 15_000) {
      this.syncFromChromeProfile(desktopId);
    }
    const b64 = encodeOrigin(target.origin);
    res.redirect(302, `/web-app-proxy/p/${b64}${target.pathname}${target.search}${target.hash}`);
  }

  public async handleProxyRequest(
    req: express.Request,
    res: express.Response,
    desktopId: string,
    instanceRoot: string,
    overrideOriginB64?: string
  ): Promise<void> {
    this.registerDesktopRoot(desktopId, instanceRoot);
    await ensureGoogleApiIpv4Preference().catch(() => {});

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD');
      res.setHeader(
        'Access-Control-Allow-Headers',
        String(req.headers['access-control-request-headers'] || '*')
      );
      res.status(204).end();
      return;
    }

    const pathMatch = req.originalUrl.match(/^\/web-app-proxy\/p\/([^/?#]+)(.*)$/);
    const originB64 = overrideOriginB64 || pathMatch?.[1] || String(req.params.originB64 || '');
    const upstreamOrigin = decodeOrigin(originB64);
    if (!upstreamOrigin) {
      res.status(400).send('Geçersiz hedef origin.');
      return;
    }

    const restUrl = overrideOriginB64 ? req.originalUrl || '/' : pathMatch?.[2] || '/';
    const normalizedRest = restUrl.startsWith('/') || restUrl.startsWith('?') ? restUrl : `/${restUrl}`;
    const targetUrl = new URL(normalizedRest, `${upstreamOrigin}/`);
    if (isBlockedHost(targetUrl.hostname)) {
      res.status(403).send('Engellenen hedef adres.');
      return;
    }

    const upstreamHeaders: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const low = k.toLowerCase();
      if (
        [
          'host',
          'connection',
          'accept-encoding',
          'content-length',
          'x-desktop-id',
          'x-forwarded-for',
          'x-forwarded-host',
          'x-forwarded-proto',
        ].includes(low)
      ) {
        continue;
      }
      if (low === 'origin') {
        upstreamHeaders['origin'] = upstreamOrigin;
        continue;
      }
      if (low === 'referer' && typeof v === 'string') {
        upstreamHeaders['referer'] = `${upstreamOrigin}/`;
        continue;
      }
      upstreamHeaders[low] = v;
    }
    upstreamHeaders['host'] = targetUrl.host;
    upstreamHeaders['accept-encoding'] = 'gzip, deflate, br';
    if (!upstreamHeaders['origin'] && req.method !== 'GET' && req.method !== 'HEAD') {
      upstreamHeaders['origin'] = upstreamOrigin;
    }

    const jarCookies = this.matchCookiesHeader(desktopId, targetUrl);
    const clientCookies = typeof req.headers.cookie === 'string'
      ? req.headers.cookie
          .split(';')
          .map((c) => c.trim())
          .filter((c) => c && !c.startsWith('tamga_session='))
          .join('; ')
      : '';
    const combinedCookie = [jarCookies, clientCookies].filter(Boolean).join('; ');
    if (combinedCookie) {
      upstreamHeaders['cookie'] = combinedCookie;
    }

    const sendWithBody = (bodyBuf: Buffer | null) => {
      if (bodyBuf && bodyBuf.length > 0) {
        upstreamHeaders['content-length'] = String(bodyBuf.length);
      }

      const client = targetUrl.protocol === 'https:' ? https : http;
      const agent = targetUrl.protocol === 'https:' ? ipv4HttpsAgent : ipv4HttpAgent;
      const upReq = client.request(
        {
          protocol: targetUrl.protocol,
          hostname: targetUrl.hostname,
          port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
          path: `${targetUrl.pathname}${targetUrl.search}`,
          method: req.method,
          headers: upstreamHeaders,
          agent,
          timeout: 30000,
        },
        (upRes) => {
          this.storeResponseCookies(desktopId, targetUrl, upRes.headers['set-cookie']);

          const outHeaders: http.OutgoingHttpHeaders = {};
          for (const [hk, hv] of Object.entries(upRes.headers)) {
            const low = hk.toLowerCase();
            if (
              [
                'x-frame-options',
                'content-security-policy',
                'content-security-policy-report-only',
                'cross-origin-opener-policy',
                'cross-origin-embedder-policy',
                'cross-origin-resource-policy',
                'strict-transport-security',
                'set-cookie',
                'transfer-encoding',
                'content-length',
              ].includes(low)
            ) {
              continue;
            }
            if (low === 'location' && typeof hv === 'string') {
              outHeaders['location'] = this.rewriteUrlToProxy(hv, upstreamOrigin);
              continue;
            }
            outHeaders[low] = hv;
          }

          outHeaders['access-control-allow-origin'] = req.headers.origin || '*';
          outHeaders['access-control-allow-credentials'] = 'true';

          const statusCode = upRes.statusCode || 200;
          const ctype = String(upRes.headers['content-type'] || '').toLowerCase();
          const cenc = String(upRes.headers['content-encoding'] || '').toLowerCase();
          const isRewriteTarget =
            req.method !== 'HEAD' &&
            (ctype.includes('text/html') || ctype.includes('text/css'));

          if (!isRewriteTarget) {
            res.writeHead(statusCode, outHeaders);
            upRes.pipe(res);
            return;
          }

          const resChunks: Buffer[] = [];
          upRes.on('data', (d: Buffer) => resChunks.push(d));
          upRes.on('end', () => {
            const rawBuf = Buffer.concat(resChunks);
            const finalize = (plainBuf: Buffer) => {
              delete outHeaders['content-encoding'];
              let outBuf = plainBuf;
              if (ctype.includes('text/html')) {
                outBuf = Buffer.from(
                  this.rewriteHtml(plainBuf.toString('utf8'), upstreamOrigin, originB64),
                  'utf8'
                );
              } else if (ctype.includes('text/css')) {
                outBuf = Buffer.from(
                  this.rewriteCss(plainBuf.toString('utf8'), upstreamOrigin),
                  'utf8'
                );
              }
              outHeaders['content-length'] = String(outBuf.length);
              res.writeHead(statusCode, outHeaders);
              res.end(outBuf);
            };

            if (cenc.includes('br')) {
              zlib.brotliDecompress(rawBuf, (err, d) => finalize(err ? rawBuf : d));
            } else if (cenc.includes('gzip')) {
              zlib.gunzip(rawBuf, (err, d) => finalize(err ? rawBuf : d));
            } else if (cenc.includes('deflate')) {
              zlib.inflate(rawBuf, (err, d) => finalize(err ? rawBuf : d));
            } else {
              finalize(rawBuf);
            }
          });
          upRes.on('error', () => {
            if (!res.headersSent) res.status(502).end('Web uygulaması yanıt hatası.');
          });
        }
      );

      upReq.on('error', (err) => {
        if (!res.headersSent) res.status(502).end(`Bağlantı hatası: ${err.message}`);
      });
      upReq.on('timeout', () => {
        upReq.destroy();
      });
      if (bodyBuf && bodyBuf.length > 0) upReq.write(bodyBuf);
      upReq.end();
    };

    if (req.readableEnded) {
      let fallbackBody: Buffer | null = null;
      if (Buffer.isBuffer(req.body)) {
        fallbackBody = req.body;
      } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        fallbackBody = Buffer.from(JSON.stringify(req.body), 'utf8');
      } else if (typeof req.body === 'string' && req.body.length > 0) {
        fallbackBody = Buffer.from(req.body, 'utf8');
      }
      sendWithBody(fallbackBody);
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      sendWithBody(chunks.length > 0 ? Buffer.concat(chunks) : null);
    });
  }

  public proxyUpgrade(req: http.IncomingMessage, clientSocket: net.Socket | any, head: Buffer): void {
    try {
      const m = (req.url || '').match(/^\/web-app-proxy\/ws\/([^/]+)(\/.*)?$/);
      if (!m) {
        clientSocket.destroy();
        return;
      }
      const upstreamOrigin = decodeOrigin(m[1]);
      if (!upstreamOrigin) {
        clientSocket.destroy();
        return;
      }
      const target = new URL(m[2] || '/', `${upstreamOrigin}/`);
      const port = Number(target.port) || (target.protocol === 'https:' ? 443 : 80);

      const onUpstreamReady = (upSock: net.Socket) => {
        const hdrLines = [`GET ${target.pathname}${target.search} HTTP/1.1`, `Host: ${target.host}`];
        for (const [k, v] of Object.entries(req.headers)) {
          const low = k.toLowerCase();
          if (low === 'host' || low === 'origin' || !v) continue;
          hdrLines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
        }
        hdrLines.push(`Origin: ${upstreamOrigin}`, '', '');
        upSock.write(hdrLines.join('\r\n'));
        if (head.length > 0) upSock.write(head);
        clientSocket.pipe(upSock);
        upSock.pipe(clientSocket);
      };

      const tcpSock = net.connect({ host: target.hostname, port, family: 4 });
      const upSock =
        target.protocol === 'https:'
          ? tls.connect({ socket: tcpSock, servername: target.hostname }, () => onUpstreamReady(upSock))
          : tcpSock;
      if (target.protocol !== 'https:') {
        tcpSock.on('connect', () => onUpstreamReady(tcpSock));
      } else {
        tcpSock.on('error', () => clientSocket.destroy());
      }

      upSock.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => upSock.destroy());
    } catch {
      try {
        clientSocket.destroy();
      } catch {}
    }
  }
}
