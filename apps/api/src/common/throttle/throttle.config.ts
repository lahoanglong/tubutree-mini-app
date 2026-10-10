import { applyDecorators, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { Throttle, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { Request } from 'express';

/**
 * Chính sách giới hạn tốc độ (Q-22).
 *
 * - `default`: 300 request/phút cho mỗi route, khoá đếm là userId khi request mang JWT hợp lệ,
 *   IP khi chưa (xem AppThrottlerGuard.getTracker). Khoá vẫn gồm class+handler như mặc định của
 *   @nestjs/throttler: một route nóng không ăn hết suất của các route khác, và khách vô danh
 *   chung IP (CGNAT) không bị cộng dồn mọi màn hình vào một bộ đếm.
 * - `authIp`: chỉ bật trên route gắn @AuthThrottle, là trần theo IP nới rộng cho đăng nhập/refresh,
 *   còn giới hạn chặt nằm ở `default` với khoá theo thiết bị/token.
 */
export const THROTTLE_TTL_MS = 60_000;
export const THROTTLE_DEFAULT_LIMIT = 300;
export const AUTH_IDENTITY_LIMIT = 10;
export const AUTH_IP_LIMIT = 30;

const AUTH_IP_THROTTLE = 'tubu:auth-ip-throttle';

export type AuthIdentity = (req: Request) => string | undefined;

export function clientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

export const throttlerOptions: ThrottlerModuleOptions = {
  throttlers: [
    { name: 'default', ttl: THROTTLE_TTL_MS, limit: THROTTLE_DEFAULT_LIMIT },
    {
      name: 'authIp',
      ttl: THROTTLE_TTL_MS,
      limit: AUTH_IP_LIMIT,
      getTracker: (req) => `ip:${clientIp(req as unknown as Request)}`,
      skipIf: (ctx: ExecutionContext) => Reflect.getMetadata(AUTH_IP_THROTTLE, ctx.getHandler()) !== true,
    },
  ],
};

/**
 * Route đăng nhập/refresh: đếm theo định danh của chính người gọi (deviceId, token) thay vì IP,
 * cộng một trần theo IP rộng hơn. Định danh được băm để bộ nhớ throttler không giữ token thô.
 * Request không có định danh (sai định dạng, sẽ bị ValidationPipe trả 400) rơi về đếm theo IP.
 */
export function AuthThrottle(identify: AuthIdentity) {
  return applyDecorators(
    SetMetadata(AUTH_IP_THROTTLE, true),
    Throttle({
      default: {
        ttl: THROTTLE_TTL_MS,
        limit: AUTH_IDENTITY_LIMIT,
        getTracker: (raw) => {
          const req = raw as unknown as Request;
          const id = identify(req);
          return id ? `auth:${createHash('sha256').update(id).digest('hex')}` : `ip:${clientIp(req)}`;
        },
      },
      authIp: { ttl: THROTTLE_TTL_MS, limit: AUTH_IP_LIMIT },
    }),
  );
}
