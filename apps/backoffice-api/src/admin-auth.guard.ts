import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { DbService } from '@cyber-casino/shared';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly db: DbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization;
    const secret = process.env.JWT_SECRET;
    if (!header?.startsWith('Bearer ') || !secret) throw new UnauthorizedException('Authentication required.');

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

    const user = await this.db.get('SELECT email, role, status FROM users WHERE LOWER(email) = ?', [
      String(decoded.email || '').toLowerCase(),
    ]);
    if (!user || user.role !== 'ADMIN' || ['FROZEN', 'BANNED'].includes(user.status)) {
      throw new ForbiddenException('Administrator access required.');
    }
    request.user = { ...decoded, email: user.email, role: user.role };
    return true;
  }
}
