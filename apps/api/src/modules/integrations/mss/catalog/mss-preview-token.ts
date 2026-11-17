import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Token xem trước bản nháp (hợp đồng commerce v0.9 mục 1.5): `base64url(payload).chữ ký`, payload `{"pid":"<pancake_product_id>",
 * "ver":<số bản nháp>,"exp":<unix giây>}`, chữ ký HMAC-SHA256 trên đúng chuỗi base64url của payload bằng bí mật chiều MSS → Tubu
 * (`MSS_INBOUND_SECRET`, nhận cả khoá trước khi xoay). Hợp đồng chưa ghi cách mã hoá chữ ký: nhận base64url (43 ký tự) và hex (64 ký tự).
 *
 * Token chỉ là vé vào: Tubu kiểm ở đây để token sai/hết hạn không chạm tới MSS, rồi chuyển nguyên token cho MSS kiểm lần nữa khi lấy
 * bản nháp.
 */
export const MSS_PREVIEW_TTL_S = 900;
/** Lệch đồng hồ hai máy được chấp nhận. */
const CLOCK_SKEW_S = 60;
const TOKEN_RE = /^([A-Za-z0-9_-]{8,1024})\.([A-Za-z0-9_-]{43}|[0-9a-f]{64})$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface MssPreviewClaims {
  pid: string;
  ver: number;
  exp: number;
}

function sigMatches(body: string, sig: string, secret: string): boolean {
  const mac = createHmac('sha256', secret).update(body).digest();
  const given = sig.length === 64 ? Buffer.from(sig, 'hex') : Buffer.from(sig, 'base64url');
  return given.length === mac.length && timingSafeEqual(given, mac);
}

/** Claims khi token đúng chữ ký và còn hạn (không dài quá 15 phút + lệch giờ); null trong mọi trường hợp khác. Không ném. */
export function verifyMssPreviewToken(token: unknown, secrets: readonly (string | null)[], nowMs = Date.now()): MssPreviewClaims | null {
  if (typeof token !== 'string') return null;
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  const body = m[1]!;
  const sig = m[2]!;
  if (!secrets.some((s) => !!s && sigMatches(body, sig, s))) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
  const { pid, ver, exp } = claims as Record<string, unknown>;
  if (typeof pid !== 'string' || !ID_RE.test(pid)) return null;
  if (typeof ver !== 'number' || !Number.isInteger(ver) || ver < 0) return null;
  if (typeof exp !== 'number' || !Number.isInteger(exp)) return null;
  const now = Math.floor(nowMs / 1000);
  if (exp <= now - CLOCK_SKEW_S || exp > now + MSS_PREVIEW_TTL_S + CLOCK_SKEW_S) return null;
  return { pid, ver, exp };
}

/** Chỉ cho test và công cụ MSS giả: ký token đúng như MSS. */
export function signMssPreviewToken(claims: MssPreviewClaims, secret: string): string {
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
