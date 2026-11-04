import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request } from 'express';
import type { Env } from '../../config/env.validation';
import { throttleIpTracker } from './throttle.config';

export { THROTTLE_BYPASS_HEADER } from './throttle.config';

/**
 * Throttle toàn cục theo Q-22: khoá đếm là userId khi có JWT hợp lệ, IP khi chưa; request SSR
 * của web mang token nội bộ chỉ chịu trần riêng `ssr` (xem throttle.config.ts).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly jwt = new JwtService();
  private readonly accessSecret: string;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    config: ConfigService<Env, true>,
  ) {
    super(options, storage, reflector);
    this.accessSecret = config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  protected override async getTracker(raw: Record<string, unknown>): Promise<string> {
    const req = raw as unknown as Request & { user?: { sub?: string } };
    // Route cần đăng nhập: JwtAuthGuard (chạy trước guard này) đã gắn req.user.
    // Tiền tố `u:` cũng giữ khoá khác với UserThrottlerGuard của ai-advisor (tracker = sub trần),
    // nếu trùng thì hai guard cùng cộng vào một khoá và route đó chỉ còn nửa giới hạn.
    if (req.user?.sub) return `u:${req.user.sub}`;
    const sub = this.subFromBearer(req);
    return sub ? `u:${sub}` : `ip:${throttleIpTracker(req)}`;
  }

  /** Route @Public không qua JwtAuthGuard, nên tự xác minh Bearer (nếu có) để đếm theo user. */
  private subFromBearer(req: Request): string | undefined {
    const auth = req.headers?.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return undefined;
    try {
      const payload = this.jwt.verify<{ sub?: unknown }>(auth.slice(7).trim(), { secret: this.accessSecret });
      return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : undefined;
    } catch {
      return undefined;
    }
  }
}
