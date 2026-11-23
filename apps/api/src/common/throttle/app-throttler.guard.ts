import { type ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
  type ThrottlerGenerateKeyFunction,
  type ThrottlerGetTrackerFunction,
} from '@nestjs/throttler';
import { THROTTLER_KEY_GENERATOR, THROTTLER_SKIP, THROTTLER_TRACKER } from '@nestjs/throttler/dist/throttler.constants';
import type { Request } from 'express';
import type { Env } from '../../config/env.validation';
import { PerKeyThrottlerStorage } from './per-key-throttler.storage';
import { throttleIpTracker, throttleRefusalOf } from './throttle.config';

export { THROTTLE_BYPASS_HEADER } from './throttle.config';

/** Trần đếm theo SĐT khách gõ vào: khoá của nó nói về chủ SĐT (có thể là người khác), không chỉ về người đang gọi. */
const PHONE_KEYED_THROTTLERS: ReadonlySet<string> = new Set(['lookupPhone']);

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

  /**
   * Route gắn @ThrottleRefusalMessage trả 429 có `code` và câu tiếng Việt kèm số phút còn bị chặn; route khác giữ câu mặc định.
   * Số phút lấy theo trần đang chặn LÂU NHẤT của route, không theo trần chạm trước (thư viện xét `default` → `authIp` → `lookupPhone` và ném ở
   * trần đầu tiên bị chặn), trừ trần SĐT: xem `longestActiveBlockSeconds`.
   */
  protected override async throwThrottlingException(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    const refusal = throttleRefusalOf(context.getHandler());
    if (!refusal) return super.throwThrottlingException(context, detail);
    const seconds = Math.max(detail.timeToBlockExpire, await this.longestActiveBlockSeconds(context, detail));
    this.getRequestResponse(context).res.header('Retry-After', seconds);
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    throw new HttpException(
      { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'Too Many Requests', code: refusal.code, message: refusal.message(minutes) },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * Số giây còn bị chặn dài nhất trong các trần áp cho request này, đọc thẳng bộ nhớ, không đếm thêm lượt. Khoá và điều kiện bỏ qua
   * dựng giống `ThrottlerGuard.canActivate` của 6.5.0 (decorator route/class trước, rồi cấu hình trần, rồi cấu hình chung).
   *
   * Trần theo SĐT khách gõ chỉ được đọc khi chính nó chặn request (khoá trùng `trigger.key`). Nếu trần mã hay trần IP chặn trước mà vẫn báo
   * thời gian khoá của SĐT, người dò tự làm mình bị chặn rồi gửi kèm SĐT bất kỳ sẽ biết SĐT đó có đang bị khoá 15 phút hay không.
   */
  private async longestActiveBlockSeconds(context: ExecutionContext, trigger: ThrottlerLimitDetail): Promise<number> {
    const storage = this.storageService;
    if (!(storage instanceof PerKeyThrottlerStorage)) return 0;
    const targets = [context.getHandler(), context.getClass()];
    const { req } = this.getRequestResponse(context);
    let longest = 0;
    for (const throttler of this.throttlers) {
      const name = throttler.name ?? 'default';
      if (this.reflector.getAllAndOverride<boolean>(THROTTLER_SKIP + name, targets)) continue;
      if ((throttler.skipIf ?? this.commonOptions.skipIf)?.(context)) continue;
      const getTracker =
        this.reflector.getAllAndOverride<ThrottlerGetTrackerFunction>(THROTTLER_TRACKER + name, targets) ??
        throttler.getTracker ??
        this.commonOptions.getTracker!;
      const generateKey =
        this.reflector.getAllAndOverride<ThrottlerGenerateKeyFunction>(THROTTLER_KEY_GENERATOR + name, targets) ??
        throttler.generateKey ??
        this.commonOptions.generateKey!;
      const key = generateKey(context, await getTracker(req, context), name);
      if (PHONE_KEYED_THROTTLERS.has(name) && key !== trigger.key) continue;
      longest = Math.max(longest, storage.blockedSeconds(key, name));
    }
    return longest;
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
