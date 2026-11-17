import { createHmac } from 'node:crypto';

/**
 * Token xem trước bản nháp (hợp đồng commerce v0.9 mục 1.5): `base64url(payload).chữ ký`, payload `{"pid":"<pancake_product_id>",
 * "ver":<số bản nháp>,"exp":<unix giây>}`.
 *
 * Tubu KHÔNG kiểm chữ ký: khoá ký nằm ở MSS (đề xuất W08: dẫn từ `MSS_ENCRYPTION_KEY`, khoá Tubu không có và không nên có). MSS là nơi
 * kiểm token khi Tubu chuyển nguyên token sang `GET /catalog/preview` bằng lời gọi đã ký; token giả hay hết hạn thì MSS trả 401/404/410 và
 * Tubu báo hết hạn. Ở đây chỉ đọc claims để từ chối sớm token sai dạng/hết hạn (không tốn lời gọi MSS) và để đối chiếu `pid` với tài liệu
 * MSS trả về. Claims chưa kiểm chữ ký nên không được dùng để cấp quyền gì khác.
 */
export const MSS_PREVIEW_TTL_S = 900;
/** Lệch đồng hồ hai máy được chấp nhận. */
const CLOCK_SKEW_S = 60;
/** Phần chữ ký: chỉ kiểm dạng (base64url hay hex) vì cách mã hoá thuộc về MSS. */
const TOKEN_RE = /^([A-Za-z0-9_-]{8,1024})\.([A-Za-z0-9_-]{16,256})$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface MssPreviewClaims {
  pid: string;
  ver: number;
  exp: number;
}

/** Claims khi token đúng dạng và còn hạn (không dài quá 15 phút + lệch giờ); null trong mọi trường hợp khác. Không ném. */
export function readMssPreviewToken(token: unknown, nowMs = Date.now()): MssPreviewClaims | null {
  if (typeof token !== 'string') return null;
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(m[1]!, 'base64url').toString('utf8'));
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

/** Chỉ cho test và công cụ MSS giả: dựng token đúng dạng hợp đồng. */
export function signMssPreviewToken(claims: MssPreviewClaims, secret: string): string {
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
