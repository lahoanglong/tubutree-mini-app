import { applyDecorators, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { Throttle, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { safeEqualStrings } from '../safe-equal';
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
 * - `ssr`: trần riêng 3000/phút cho mỗi handler (khoá của throttler 6.5 gồm class + handler + tên + tracker, nên `ssr:bypass` đếm riêng từng route) cho request web SSR mang `x-throttle-bypass` đúng token. Request đó
 *   bỏ qua `default` và `authIp` (mọi SSR đi ra từ một IP máy chủ web) nhưng không được miễn hoàn toàn: token lộ hay
 *   một trang SSR bị khuếch đại (vd `/san-pham?q=`) vẫn chạm trần này.
 * - blockDuration để mặc định (= ttl, 60s): bộ nhớ của throttler 6.5 đưa bộ đếm về 0 khi hết khoá,
 *   nên khoá ngắn hơn sẽ biến "N request/phút" thành "N request mỗi lần khoá".
 */
export const THROTTLE_TTL_MS = 60_000;
export const THROTTLE_DEFAULT_LIMIT = 300;
export const AUTH_IDENTITY_LIMIT = 10;
export const AUTH_IP_LIMIT = 30;
export const SSR_LIMIT = 3000;

/** Header web SSR gửi kèm (giá trị = THROTTLE_BYPASS_TOKEN). */
export const THROTTLE_BYPASS_HEADER = 'x-throttle-bypass';

const bypassSeen = new WeakMap<Request, boolean>();

/** Token hợp lệ khi header khớp THROTTLE_BYPASS_TOKEN (env, đọc lúc gọi); env rỗng thì tắt hẳn đường này. Tính một lần mỗi request. */
export function hasValidBypass(req: Request): boolean {
  const cached = bypassSeen.get(req);
  if (cached !== undefined) return cached;
  const h = req.headers?.[THROTTLE_BYPASS_HEADER];
  const presented = Array.isArray(h) ? h[0] : h;
  const ok = typeof presented === 'string' && safeEqualStrings(presented, process.env.THROTTLE_BYPASS_TOKEN ?? '');
  bypassSeen.set(req, ok);
  return ok;
}

const isBypass = (ctx: ExecutionContext): boolean => hasValidBypass(ctx.switchToHttp().getRequest<Request>());

const AUTH_IP_THROTTLE = 'tubu:auth-ip-throttle';

export type AuthIdentity = (req: Request) => string | undefined;

export function clientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

/**
 * Khoá đếm theo IP cho throttle. Một thuê bao IPv6 thường có cả /64, nên đếm theo địa chỉ đầy đủ cho phép đổi địa chỉ để
 * né trần: gom theo tiền tố /64. Địa chỉ IPv4 ánh xạ (`::ffff:a.b.c.d`) về `a.b.c.d` để cùng một khoá với IPv4 thuần.
 */
export function throttleIpKey(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(':')) return ip;
  const groups = expandIpv6(ip);
  return groups ? `${groups.slice(0, 4).join(':')}::/64` : ip;
}

function expandIpv6(ip: string): string[] | null {
  const zone = ip.indexOf('%');
  const addr = zone >= 0 ? ip.slice(0, zone) : ip;
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const side = (part: string): string[] => (part === '' ? [] : part.split(':'));
  const head = side(halves[0]!);
  const tail = halves.length === 2 ? side(halves[1]!) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return all.map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''));
}

export function throttleIpTracker(req: Request): string {
  return throttleIpKey(clientIp(req));
}

export const throttlerOptions: ThrottlerModuleOptions = {
  throttlers: [
    { name: 'default', ttl: THROTTLE_TTL_MS, limit: THROTTLE_DEFAULT_LIMIT, skipIf: isBypass },
    {
      name: 'ssr',
      ttl: THROTTLE_TTL_MS,
      limit: SSR_LIMIT,
      getTracker: () => 'ssr:bypass',
      skipIf: (ctx: ExecutionContext) => !isBypass(ctx),
    },
    {
      name: 'authIp',
      ttl: THROTTLE_TTL_MS,
      limit: AUTH_IP_LIMIT,
      getTracker: (req) => `ip:${throttleIpTracker(req as unknown as Request)}`,
      skipIf: (ctx: ExecutionContext) => isBypass(ctx) || Reflect.getMetadata(AUTH_IP_THROTTLE, ctx.getHandler()) !== true,
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
          return id ? `auth:${createHash('sha256').update(id).digest('hex')}` : `ip:${throttleIpTracker(req)}`;
        },
      },
      authIp: { ttl: THROTTLE_TTL_MS, limit: AUTH_IP_LIMIT },
    }),
  );
}
