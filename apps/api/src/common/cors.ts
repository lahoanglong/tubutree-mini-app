import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { wantsCookieAuth } from '../modules/auth/refresh-cookie';
import { RESERVED_STOREFRONT_IDENTIFIERS, SUBDOMAIN_RE } from '../modules/storefront/identifier-validation';

// Origin webview Zalo Mini App: LUÔN cho phép (backend phục vụ Mini App, không phụ thuộc env). Thiếu thì webview Zalo chặn
// mọi response API. Gồm h5.zdn.vn, *.zadn.vn, zalo.me.
const ZALO_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)*(zdn\.vn|zadn\.vn|zalo\.me)$/i;
// Domain chính và mọi subdomain đối tác (*.tubutree.com, Multi-tenancy Storefront). Production chỉ https và không cổng.
const TUBU_ORIGIN_RE_PROD = /^https:\/\/([a-z0-9-]+\.)*tubutree\.com$/i;
const TUBU_ORIGIN_RE_DEV = /^https?:\/\/([a-z0-9-]+\.)*tubutree\.com(:[0-9]+)?$/i;
const LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1|([a-z0-9-]+)\.localhost)(:[0-9]+)?$/i;
/** Tên miền gốc của gian hàng CTV `<nhãn>.tubutree.com` (web middleware dùng cùng giá trị qua NEXT_PUBLIC_TENANT_ROOT_DOMAIN). */
export const TENANT_ROOT_DOMAIN = 'tubutree.com';
const TENANT_ORIGIN_RE = new RegExp(`^https://([^./:]+)\\.${TENANT_ROOT_DOMAIN.replace(/\./g, '\\.')}$`, 'i');

/** `https://<một nhãn>.tubutree.com` không cổng, nhãn theo luật slug gian hàng và không thuộc danh sách dành riêng (api, www, hello...). */
function isTenantOrigin(origin: string): boolean {
  const label = TENANT_ORIGIN_RE.exec(origin)?.[1]?.toLowerCase();
  return !!label && SUBDOMAIN_RE.test(label) && !RESERVED_STOREFRONT_IDENTIFIERS.has(label);
}

export const FALLBACK_WEB_ORIGINS = ['https://tubutree.com', 'https://app.tubutree.com'];
export const COOKIE_AUTH_ORIGIN_MESSAGE = 'Yêu cầu không đến từ trang web Tubu Tree.';

export interface CorsPolicy {
  /** Dùng cho `enableCors({ origin })`. */
  corsOrigin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void;
  /** Origin của trang web shop (CORS_ORIGINS), không gồm origin Zalo hay subdomain đối tác. */
  isWebOrigin: (origin: string | undefined) => boolean;
}

export function buildCorsPolicy(isProd: boolean, staticAllow: readonly string[]): CorsPolicy {
  const tubuRe = isProd ? TUBU_ORIGIN_RE_PROD : TUBU_ORIGIN_RE_DEV;
  return {
    corsOrigin: (origin, cb) => {
      // Không có Origin (app native/WebView không gửi, health check, server-to-server, curl) → cho qua.
      if (!origin) return cb(null, true);
      if (ZALO_ORIGIN_RE.test(origin)) return cb(null, true);
      if (tubuRe.test(origin)) return cb(null, true);
      if (staticAllow.includes(origin)) return cb(null, true);
      if (!isProd) return cb(null, true); // dev: mở hết cho tiện test local
      return cb(null, false); // prod + origin lạ → chặn (không set Allow-Origin)
    },
    isWebOrigin: (origin) => !!origin && (staticAllow.includes(origin) || isTenantOrigin(origin) || (!isProd && LOCALHOST_RE.test(origin))),
  };
}

// Mọi endpoint đặt hoặc dùng cookie phiên ở chế độ web. Tất cả là fetch POST từ trang web (luôn có Origin): zalo-oauth nhận `code`
// ở trang callback của web rồi mới POST, không phải redirect GET từ Zalo tới API.
const COOKIE_AUTH_ROUTE = /^\/api\/auth\/(refresh|logout|guest|zalo-oauth|zalo-mini-app|ensure-phone)\/?$/i;

/**
 * Endpoint auth ở chế độ cookie `HttpOnly` (`x-client: web`) chỉ nhận khi Origin là trang web shop (CORS_ORIGINS hoặc gian hàng
 * `<slug>.tubutree.com`). Origin Zalo (*.zdn.vn) hợp lệ cho CORS nhưng không bao giờ dùng cookie, nên một trang trên đó không đổi được
 * cookie của khách thành access token; đăng nhập cũng bị chặn để một subdomain lạ không gắn phiên của kẻ tấn công vào trình duyệt nạn nhân. Mini App gửi refresh token
 * trong thân (không `x-client: web`) nên không đi qua kiểm này.
 */
export function cookieAuthOriginGuard(isWebOrigin: CorsPolicy['isWebOrigin']): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'OPTIONS' && COOKIE_AUTH_ROUTE.test(req.path) && wantsCookieAuth(req) && !isWebOrigin(req.headers.origin)) {
      res.status(403).json({ statusCode: 403, message: COOKIE_AUTH_ORIGIN_MESSAGE, error: 'Forbidden' });
      return;
    }
    next();
  };
}
