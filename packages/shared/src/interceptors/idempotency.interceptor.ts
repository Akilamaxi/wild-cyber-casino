import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import Redis from 'ioredis';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { lazyConnect: true });

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    
    // Only apply to POST/PUT/PATCH/DELETE
    if (['GET', 'OPTIONS', 'HEAD'].includes(request.method)) {
      return next.handle();
    }

    const idempotencyKey = request.headers['x-idempotency-key'];
    if (!idempotencyKey) {
      return next.handle();
    }

    const cacheKey = `idempotency:${idempotencyKey}`;
    const cachedResponse = await this.redis.get(cacheKey);

    if (cachedResponse) {
      const parsed = JSON.parse(cachedResponse);
      context.switchToHttp().getResponse().status(parsed.status);
      return of(parsed.body);
    }

    return next.handle().pipe(
      tap(async (responseBody) => {
        const httpResponse = context.switchToHttp().getResponse();
        const cacheData = {
          status: httpResponse.statusCode || 200,
          body: responseBody,
        };
        // Cache the response for 24 hours
        await this.redis.set(cacheKey, JSON.stringify(cacheData), 'EX', 60 * 60 * 24);
      }),
    );
  }
}
