import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getRuntimeConfig } from '../utils/runtime-config';

@Injectable()
export class MetricsTokenGuard implements CanActivate {
  private readonly expected = getRuntimeConfig().metricsToken;

  canActivate(context: ExecutionContext): boolean {
    if (!this.expected) {
      throw new UnauthorizedException('Metrics scrape token is not configured');
    }
    const authorization = context.switchToHttp().getRequest().headers.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('Metrics scrape token is required');
    }
    const expectedDigest = createHash('sha256').update(this.expected).digest();
    const suppliedDigest = createHash('sha256').update(authorization.slice(7)).digest();
    if (!timingSafeEqual(expectedDigest, suppliedDigest)) {
      throw new UnauthorizedException('Invalid metrics scrape token');
    }
    return true;
  }
}
