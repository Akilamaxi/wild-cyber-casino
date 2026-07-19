import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    // Bearer-token clients are not vulnerable to ambient-authority CSRF.
    if (request.headers.authorization?.startsWith('Bearer ')) return true;
    if (!request.cookies?.casino_access) return true;
    const cookie = Buffer.from(String(request.cookies.casino_csrf || ''));
    const header = Buffer.from(String(request.headers['x-csrf-token'] || ''));
    if (!cookie.length || cookie.length !== header.length || !crypto.timingSafeEqual(cookie, header)) {
      throw new ForbiddenException('CSRF validation failed.');
    }
    return true;
  }
}
