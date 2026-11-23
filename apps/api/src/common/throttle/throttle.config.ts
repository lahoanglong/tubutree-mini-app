import { applyDecorators, type DynamicModule, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { Throttle, ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { safeEqualStrings } from '../safe-equal';
import { PerKeyThrottlerStorage } from './per-key-throttler.storage';
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
 * - `lookupPhone`: chỉ bật trên route gắn @LookupThrottle, trần theo định danh thứ hai khách gõ (SĐT), đếm chung mọi mã và mọi IP.
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
export const STAFF_LOOKUP_LIMIT = 30;

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
const LOOKUP_PHONE_THROTTLE = 'tubu:lookup-phone-throttle';
const STAFF_LOOKUP_THROTTLE = 'tubu:staff-lookup-throttle';
const THROTTLE_REFUSAL = 'tubu:throttle-refusal';

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
      // Chỉ route gắn @StaffLookupThrottle và chỉ khi người gọi là nhân viên (STAFF): ADMIN và các vai trò khác không bị trần này.
      name: 'staffLookup',
      ttl: THROTTLE_TTL_MS,
      limit: STAFF_LOOKUP_LIMIT,
      skipIf: (ctx: ExecutionContext) =>
        Reflect.getMetadata(STAFF_LOOKUP_THROTTLE, ctx.getHandler()) !== true ||
        ctx.switchToHttp().getRequest<{ user?: { role?: string } }>().user?.role !== 'STAFF',
    },
    {
      name: 'authIp',
      ttl: THROTTLE_TTL_MS,
      limit: AUTH_IP_LIMIT,
      getTracker: (req) => `ip:${throttleIpTracker(req as unknown as Request)}`,
      skipIf: (ctx: ExecutionContext) => isBypass(ctx) || Reflect.getMetadata(AUTH_IP_THROTTLE, ctx.getHandler()) !== true,
    },
    {
      // ttl/limit thật nằm ở decorator LookupThrottle của từng route. Không gửi header `X-RateLimit-*-lookupPhone`: số lượt còn lại đếm theo SĐT khách gõ,
      // nên mã mới + IP mới vẫn đọc được một SĐT bất kỳ đã bị tra bao nhiêu lần. Số phút chặn đi qua `Retry-After` của AppThrottlerGuard.
      name: 'lookupPhone',
      ttl: THROTTLE_TTL_MS,
      limit: AUTH_IDENTITY_LIMIT,
      setHeaders: false,
      skipIf: (ctx: ExecutionContext) => isBypass(ctx) || Reflect.getMetadata(LOOKUP_PHONE_THROTTLE, ctx.getHandler()) !== true,
    },
  ],
};

/** Cấu hình throttle kèm bộ nhớ đếm riêng theo từng khoá (xem PerKeyThrottlerStorage), tạo mới cho mỗi app Nest. */
export function createThrottlerOptions(): ThrottlerModuleOptions {
  return { ...throttlerOptions, storage: new PerKeyThrottlerStorage() };
}

/** ThrottlerModule của app: factory nên mỗi app (kể cả app dựng trong test) có bộ nhớ riêng, đóng app thì huỷ hẹn giờ. */
export function throttlerRootModule(): DynamicModule {
  return ThrottlerModule.forRootAsync({ useFactory: createThrottlerOptions });
}

/**
 * Route tra cứu khách mà nhân viên CSKH không được quét hàng loạt: trần `limit` lượt mỗi phút cho mỗi tài khoản nhân viên (STAFF),
 * ADMIN không đổi. Trần riêng cho từng route, đếm theo userId như `default`.
 */
export function StaffLookupThrottle(limit: number = STAFF_LOOKUP_LIMIT) {
  return applyDecorators(SetMetadata(STAFF_LOOKUP_THROTTLE, true), Throttle({ staffLookup: { ttl: THROTTLE_TTL_MS, limit } }));
}

/**
 * Route đăng nhập/refresh: đếm theo định danh của chính người gọi (deviceId, token) thay vì IP,
 * cộng một trần theo IP rộng hơn. Định danh được băm để bộ nhớ throttler không giữ token thô.
 * Request không có định danh (sai định dạng, sẽ bị ValidationPipe trả 400) rơi về đếm theo IP.
 */
export function AuthThrottle(identify: AuthIdentity) {
  return identityThrottle('auth', identify, AUTH_IDENTITY_LIMIT, AUTH_IP_LIMIT);
}

/** Trần thứ hai của route tra cứu: định danh khác (SĐT) đếm riêng, chung mọi giá trị của định danh chính và mọi IP. */
export interface LookupSecondaryThrottle {
  identify: AuthIdentity;
  limit: number;
  ttlMs: number;
}

/**
 * Route công khai tra theo hai thứ khách gõ (mã đơn + SĐT): trần theo mã để nhiều IP không chia nhau dò một mã, trần theo SĐT để người biết SĐT
 * không dò cạn mã (mã đơn chỉ có 10^5 giá trị mỗi ngày) dù đổi IP, cộng trần theo IP để một máy không quét nhiều mã.
 */
export function LookupThrottle(identify: AuthIdentity, identityLimit: number, ipLimit: number, secondary: LookupSecondaryThrottle) {
  return applyDecorators(
    identityThrottle('lookup', identify, identityLimit, ipLimit),
    SetMetadata(LOOKUP_PHONE_THROTTLE, true),
    Throttle({ lookupPhone: { ttl: secondary.ttlMs, limit: secondary.limit, getTracker: hashedTracker('lookup-phone', secondary.identify) } }),
  );
}

/** Băm định danh để bộ nhớ throttler không giữ giá trị thô; không có định danh (sẽ bị ValidationPipe trả 400) thì đếm theo IP. */
function hashedTracker(prefix: string, identify: AuthIdentity) {
  return (raw: Record<string, unknown>): string => {
    const req = raw as unknown as Request;
    const id = identify(req);
    return id ? `${prefix}:${createHash('sha256').update(id).digest('hex')}` : `ip:${throttleIpTracker(req)}`;
  };
}

/**
 * Câu 429 riêng của một route công khai thay cho câu tiếng Anh mặc định của throttler ("ThrottlerException: Too Many Requests"): `code` ổn định
 * cho máy khách, `message` nhận số phút còn bị chặn (làm tròn lên, tối thiểu 1) của trần vừa chạm. Route không gắn giữ câu mặc định vì app khách
 * nhận 429 chung qua chuỗi đó.
 */
export interface ThrottleRefusal {
  code: string;
  message: (retryMinutes: number) => string;
}

export function ThrottleRefusalMessage(refusal: ThrottleRefusal) {
  return SetMetadata(THROTTLE_REFUSAL, refusal);
}

export function throttleRefusalOf(handler: object): ThrottleRefusal | undefined {
  return Reflect.getMetadata(THROTTLE_REFUSAL, handler) as ThrottleRefusal | undefined;
}

function identityThrottle(prefix: string, identify: AuthIdentity, identityLimit: number, ipLimit: number) {
  return applyDecorators(
    SetMetadata(AUTH_IP_THROTTLE, true),
    Throttle({
      default: { ttl: THROTTLE_TTL_MS, limit: identityLimit, getTracker: hashedTracker(prefix, identify) },
      authIp: { ttl: THROTTLE_TTL_MS, limit: ipLimit },
    }),
  );
}
