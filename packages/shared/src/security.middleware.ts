import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import * as crypto from 'crypto';

declare module 'express-serve-static-core' {
  interface Request { requestId?: string; }
}

function parseCookies(value?: string): Record<string, string> {
  if (!value) return {};
  return value.split(';').reduce<Record<string, string>>((result, part) => {
    const separator = part.indexOf('=');
    if (separator < 1) return result;
    const key = part.slice(0, separator).trim();
    try { result[key] = decodeURIComponent(part.slice(separator + 1).trim()); } catch { /* ignore malformed cookies */ }
    return result;
  }, {});
}

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incomingId = req.header('x-request-id');
    const requestId = incomingId && /^[a-zA-Z0-9._-]{8,128}$/.test(incomingId)
      ? incomingId : crypto.randomUUID();
    req.requestId = requestId;
    req.cookies = parseCookies(req.headers.cookie);
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'", "base-uri 'self'", "frame-ancestors 'none'", "object-src 'none'",
      "form-action 'self'", "img-src 'self' data: blob:", "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'", "script-src 'self'", "connect-src 'self' ws: wss:",
      ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
    ].join('; '));
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    res.removeHeader('X-Powered-By');
    next();
  }
}
