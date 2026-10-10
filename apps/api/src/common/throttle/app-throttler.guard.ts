import { type ExecutionContext, Injectable } from '@nestjs/common';
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
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { Env } from '../../config/env.validation';
import { clientIp } from './throttle.config';

/** Header web SSR gửi kèm để được miễn throttle (giá trị = THROTTLE_BYPASS_TOKEN). */
export const THROTTLE_BYPASS_HEADER = 'x-throttle-bypass';

function sha256(v: string): Buffer {
  return createHash('sha256').update(v).digest();
}

/**
 * Throttle toàn cục theo Q-22: khoá đếm là userId khi có JWT hợp lệ, IP khi chưa; request SSR
 * của web mang token nội bộ được miễn (mọi SSR đi ra từ một IP máy chủ web).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly jwt = new JwtService();
  private readonly bypassDigest: Buffer | null;
  private readonly accessSecret: string;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    config: ConfigService<Env, true>,
  ) {
    super(options, storage, reflector);
    const bypass = config.get('THROTTLE_BYPASS_TOKEN', { infer: true }) ?? '';
    this.bypassDigest = bypass.length > 0 ? sha256(bypass) : null;
    this.accessSecret = config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (!this.bypassDigest) return false;
    const req = context.switchToHttp().getRequest<Request>();
    const h = req.headers?.[THROTTLE_BYPASS_HEADER];
    const presented = Array.isArray(h) ? h[0] : h;
    if (typeof presented !== 'string' || presented.length === 0) return false;
    // So sánh digest cố định 32 byte: timingSafeEqual cần cùng độ dài, và không lộ độ dài token.
    return timingSafeEqual(sha256(presented), this.bypassDigest);
  }

  protected override async getTracker(raw: Record<string, unknown>): Promise<string> {
    const req = raw as unknown as Request & { user?: { sub?: string } };
    // Route cần đăng nhập: JwtAuthGuard (chạy trước guard này) đã gắn req.user.
    // Tiền tố `u:` cũng giữ khoá khác với UserThrottlerGuard của ai-advisor (tracker = sub trần),
    // nếu trùng thì hai guard cùng cộng vào một khoá và route đó chỉ còn nửa giới hạn.
    if (req.user?.sub) return `u:${req.user.sub}`;
    const sub = this.subFromBearer(req);
    return sub ? `u:${sub}` : `ip:${clientIp(req)}`;
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
