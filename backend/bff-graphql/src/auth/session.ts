import { boardMode } from '../board-mode';
import { randomBytes } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';

const SESSION_COOKIE = 'jidis_session';
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_RATE_LIMIT_ATTEMPTS = 5;

interface Session {
  expiresAt: number;
}

interface AttemptWindow {
  count: number;
  resetAt: number;
}

type PinMode = 'auto' | 'always' | 'disabled';

function pinMode(): PinMode {
  // Board mode shows a team's board: no host or address is trusted without the PIN.
  if (boardMode()) return 'always';
  const configured = process.env.DOCK_PIN_MODE?.trim().toLowerCase();
  if (configured === 'always' || configured === 'disabled') return configured;
  return 'auto';
}

function headerValues(request: Request, name: string): string[] {
  const value = request.headers[name];
  if (Array.isArray(value)) return value;
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

function isTailscaleAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase().replace(/^::ffff:/, '');
  if (normalized.startsWith('fd7a:115c:a1e0:')) return true;

  const octets = normalized.split('.').map(Number);
  return octets.length === 4
    && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    && octets[0] === 100
    && octets[1] >= 64
    && octets[1] <= 127;
}

function isTailscaleHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').split(':')[0];
  return normalized.endsWith('.ts.net');
}

/**
 * Tailscale Serve keeps the app bound to loopback and forwards the client
 * request. Trust only the documented tailnet address range or a .ts.net host;
 * local/private HTTP requests still require the configured PIN.
 */
export function isTailscaleRequest(request: Request): boolean {
  if (pinMode() !== 'auto') return false;

  const hosts = [
    ...headerValues(request, 'x-forwarded-host'),
    ...headerValues(request, 'host'),
  ];
  if (hosts.some(isTailscaleHostname)) return true;

  const addresses = [
    request.ip,
    request.socket?.remoteAddress,
    ...headerValues(request, 'x-forwarded-for'),
  ].filter((address): address is string => Boolean(address));
  return addresses.some(isTailscaleAddress);
}

export function shouldRequirePin(request: Request, pinConfigured: boolean): boolean {
  const mode = pinMode();
  if (!pinConfigured || mode === 'disabled') return false;
  return mode === 'always' || !isTailscaleRequest(request);
}

export function missingPinWarning(pinConfigured: boolean): string | null {
  return pinMode() === 'always' && !pinConfigured
    ? '[Auth] DOCK_PIN_MODE is always but no master PIN is stored, so every protected field is open until one is set'
    : null;
}

function defaultSecureCookie(): boolean {
  const configured = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase();
  if (!configured) return process.env.NODE_ENV === 'production';
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  throw new Error('SESSION_COOKIE_SECURE must be true or false');
}

function parseCookies(header?: string): Record<string, string> {
  if (!header) return {};

  return header.split(';').reduce<Record<string, string>>((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator === -1) return cookies;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly ttlMs = DEFAULT_SESSION_TTL_MS,
    private readonly secureCookie = defaultSecureCookie(),
  ) {}

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      maxAge: this.ttlMs,
      path: '/',
      sameSite: 'strict',
      secure: this.secureCookie,
    };
  }

  private clearCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
      secure: this.secureCookie,
    };
  }

  create(response: Response, now = Date.now()): string {
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { expiresAt: now + this.ttlMs });
    response.cookie(SESSION_COOKIE, token, this.cookieOptions());
    return token;
  }

  isAuthenticated(request: Request, now = Date.now()): boolean {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (!token) return false;

    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= now) {
      this.sessions.delete(token);
      return false;
    }

    return true;
  }

  clear(request: Request, response: Response): void {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (token) this.sessions.delete(token);
    response.clearCookie(SESSION_COOKIE, this.clearCookieOptions());
  }

  clearAll(): void {
    this.sessions.clear();
  }
}

export class PinRateLimiter {
  private readonly attempts = new Map<string, AttemptWindow>();

  constructor(
    private readonly maxAttempts = DEFAULT_RATE_LIMIT_ATTEMPTS,
    private readonly windowMs = DEFAULT_RATE_LIMIT_WINDOW_MS,
  ) {}

  retryAfterSeconds(key: string, now = Date.now()): number {
    const attempt = this.attempts.get(key);
    if (!attempt || attempt.resetAt <= now) {
      if (attempt) this.attempts.delete(key);
      return 0;
    }
    return attempt.count >= this.maxAttempts
      ? Math.max(1, Math.ceil((attempt.resetAt - now) / 1000))
      : 0;
  }

  recordFailure(key: string, now = Date.now()): void {
    const attempt = this.attempts.get(key);
    if (!attempt || attempt.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    attempt.count += 1;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}

export interface AuthContext {
  request: Request;
  response: Response;
  authenticated: boolean;
  trustedNetwork: boolean;
  clientKey: string;
  sessions: SessionManager;
  pinRateLimiter: PinRateLimiter;
}

export const sessionManager = new SessionManager();
export const pinRateLimiter = new PinRateLimiter();
