import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DbService } from '@cyber-casino/shared';
import * as jwt from 'jsonwebtoken';
import { IS_PUBLIC_KEY, ROLES_KEY } from './security.decorators';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly db: DbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Authentication required.');

    const secret = process.env.JWT_SECRET;
    if (!secret) throw new UnauthorizedException('Authentication is unavailable.');

    let decoded: any;
    try {
      decoded = jwt.verify(header.slice(7), secret, {
        algorithms: ['HS256'],
        issuer: process.env.JWT_ISSUER || 'cyber-casino',
        audience: process.env.JWT_AUDIENCE || 'cyber-casino-api',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }

    const user = await this.db.get(
      'SELECT email, role, status FROM users WHERE LOWER(email) = ?',
      [String(decoded.email || '').toLowerCase()],
    );
    if (!user || ['FROZEN', 'BANNED'].includes(user.status)) {
      throw new UnauthorizedException('Account is unavailable.');
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) || [];
    if (requiredRoles.length && !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions.');
    }

    const tokenEmail = String(user.email).toLowerCase();
    for (const suppliedEmail of [request.body?.email, request.query?.email]) {
      if (suppliedEmail && String(suppliedEmail).toLowerCase() !== tokenEmail) {
        throw new ForbiddenException('Account identity does not match the authenticated user.');
      }
    }

    request.user = { ...decoded, email: user.email, role: user.role };
    return true;
  }
}
