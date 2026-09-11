import type { Request, Response } from 'express';

/**
 * Refresh token của web shop nằm trong cookie `HttpOnly` do BE set, KHÔNG phải localStorage.
 *
 * Lý do: refresh token sống 30 ngày và đổi được thành access token bất cứ lúc nào, nên một lỗ
 * XSS duy nhất ở web (script quảng cáo, thư viện bị chiếm, `dangerouslySetInnerHTML`) là mất
 * tài khoản vĩnh viễn — nạn nhân đổi mật khẩu cũng không cứu được vì token đã bị copy đi.
 * Cookie `HttpOnly` thì JS không đọc được, kể cả JS của chính mình.
 *
 * Mini App Zalo KHÔNG dùng đường này: webview Zalo là origin khác và không giữ cookie bên thứ
 * ba ổn định, nên Mini App vẫn nhận `refreshToken` trong thân response như cũ. Vì vậy chế độ
 * cookie phải được BẬT CÓ CHỦ ĐÍCH bằng header `x-client: web` (xem `wantsCookieAuth`).
 *
 * Chỉ có ĐÚNG MỘT cookie ở đây. Cờ "có phiên hay không" mà web dùng để quyết định có thử khôi
 * phục phiên nằm ở `localStorage` phía web, KHÔNG phải cookie: cookie do API set thuộc origin
 * của API, nên nếu API ở `api.tubutree.com` còn web ở `tubutree.com` thì web không đọc được nó
 * (trừ khi khai `AUTH_COOKIE_DOMAIN`) — một cái bẫy im lặng khiến web luôn tưởng chưa đăng nhập.
 * Cờ đó không phải bí mật nên để ở localStorage là an toàn.
 */

/** Cookie chứa refresh token thật. HttpOnly ⇒ JS không đọc được. */
export const REFRESH_COOKIE = 'tubu_rt';

/**
 * Chỉ đọc cookie khi client TỰ NHẬN là web bằng header riêng.
 *
 * Đây cũng là lớp chống CSRF: header tuỳ biến không gửi được bằng request "đơn giản" từ trang
 * lạ — trình duyệt bắt buộc preflight, mà preflight sẽ bị CORS allowlist chặn. Không có lớp này
 * thì (với `SameSite=None` khi web và API khác site) một trang bất kỳ có thể ép trình duyệt nạn
 * nhân POST /auth/refresh kèm cookie, làm xoay token và đá nạn nhân ra khỏi phiên.
 */
export function wantsCookieAuth(req: Request): boolean {
  const h = req.headers['x-client'];
  const v = Array.isArray(h) ? h[0] : h;
  return typeof v === 'string' && v.toLowerCase() === 'web';
}

/** Đọc 1 cookie từ header thô — không thêm phụ thuộc `cookie-parser` chỉ để đọc 2 cookie. */
export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

/** Refresh token gửi kèm request web: chỉ tính khi client khai báo `x-client: web`. */
export function readRefreshCookie(req: Request): string | undefined {
  if (!wantsCookieAuth(req)) return undefined;
  const v = readCookie(req, REFRESH_COOKIE);
  return v && v.length > 0 ? v : undefined;
}

type SameSite = 'lax' | 'strict' | 'none';

function sameSite(): SameSite {
  const v = (process.env.AUTH_COOKIE_SAMESITE ?? 'lax').toLowerCase();
  return v === 'none' || v === 'strict' ? v : 'lax';
}

/**
 * `Secure` bắt buộc khi `SameSite=None` (trình duyệt vứt cookie nếu thiếu) và khi chạy prod.
 * Dev http://localhost thì để false, nếu không cookie không bao giờ được lưu.
 */
function cookieBase(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: SameSite;
  path: string;
  domain?: string;
} {
  const ss = sameSite();
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim();
  return {
    httpOnly: true,
    secure: ss === 'none' || process.env.NODE_ENV === 'production',
    sameSite: ss,
    // Giới hạn đường gửi: cookie chỉ đi kèm các route /api/auth/*, không rò sang mọi request API.
    path: '/api/auth',
    ...(domain ? { domain } : {}),
  };
}

export function setRefreshCookies(res: Response, token: string, ttlDays: number): void {
  res.cookie(REFRESH_COOKIE, token, { ...cookieBase(), maxAge: ttlDays * 24 * 60 * 60 * 1000 });
}

export function clearRefreshCookies(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, cookieBase());
}
