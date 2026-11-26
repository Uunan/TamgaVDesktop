import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { verifyPassword, type TamgaConfig } from './config';

const COOKIE_NAME = 'tamga_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SessionPayload {
  u: string;
  exp: number;
}

export class AuthManager {
  private config: TamgaConfig;
  private attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(config: TamgaConfig) {
    this.config = config;
  }

  public isEnabled(): boolean {
    return Boolean(this.config.auth.enabled);
  }

  public getUsername(): string {
    return this.config.auth.username || 'admin';
  }

  private sign(payloadB64: string): string {
    return crypto
      .createHmac('sha256', this.config.auth.sessionSecret)
      .update(payloadB64)
      .digest('base64url');
  }

  public createToken(username: string): string {
    const payload: SessionPayload = {
      u: username,
      exp: Date.now() + SESSION_TTL_MS,
    };
    const b64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
    const sig = this.sign(b64);
    return `${b64}.${sig}`;
  }

  public verifyToken(token: string | undefined | null): SessionPayload | null {
    if (!token || !token.includes('.')) return null;
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) return null;
    const expected = this.sign(b64);
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    try {
      const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf-8')) as SessionPayload;
      if (!payload.u || typeof payload.exp !== 'number' || payload.exp < Date.now()) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  public extractCookieToken(cookieHeader?: string): string | null {
    if (!cookieHeader) return null;
    const parts = cookieHeader.split(';');
    for (const part of parts) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k === COOKIE_NAME) return decodeURIComponent(v);
    }
    return null;
  }

  public isRequestAuthorized(cookieHeader?: string, authHeader?: string): boolean {
    if (!this.isEnabled()) return true;
    const cookieToken = this.extractCookieToken(cookieHeader);
    if (this.verifyToken(cookieToken)) return true;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const bearer = authHeader.slice(7).trim();
      if (this.verifyToken(bearer)) return true;
    }
    return false;
  }

  public authenticate(username: string, password: string, clientIp: string): { ok: boolean; error?: string; token?: string } {
    const now = Date.now();
    const rec = this.attempts.get(clientIp);
    if (rec && rec.resetAt > now && rec.count >= 15) {
      return { ok: false, error: 'Çok fazla hatalı deneme. Lütfen birkaç dakika sonra tekrar deneyin.' };
    }

    const userMatch = username.trim() === this.getUsername();
    const passMatch = verifyPassword(password, this.config.auth.passwordHash);

    if (!userMatch || !passMatch) {
      const nextCount = rec && rec.resetAt > now ? rec.count + 1 : 1;
      this.attempts.set(clientIp, { count: nextCount, resetAt: now + 5 * 60 * 1000 });
      return { ok: false, error: 'Kullanıcı adı veya parola hatalı.' };
    }

    this.attempts.delete(clientIp);
    return { ok: true, token: this.createToken(username.trim()) };
  }

  public setSessionCookie(res: Response, token: string, isSecure: boolean): void {
    const flags = [
      `${COOKIE_NAME}=${encodeURIComponent(token)}`,
      'HttpOnly',
      'SameSite=Lax',
      'Path=/',
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ];
    if (isSecure) flags.push('Secure');
    res.setHeader('Set-Cookie', flags.join('; '));
  }

  public clearSessionCookie(res: Response): void {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  }

  public requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    if (!this.isEnabled()) {
      next();
      return;
    }
    if (
      req.path === '/api/health' ||
      req.path === '/api/auth/status' ||
      req.path === '/api/auth/login' ||
      req.path === '/api/auth/logout'
    ) {
      next();
      return;
    }
    if (!req.path.startsWith('/api/')) {
      next();
      return;
    }
    if (this.isRequestAuthorized(req.headers.cookie, req.headers.authorization)) {
      next();
      return;
    }
    res.status(401).json({ error: 'Oturum açmanız gerekiyor.', authRequired: true });
  };
}
