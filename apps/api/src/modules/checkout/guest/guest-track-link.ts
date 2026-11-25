import { createHmac, timingSafeEqual } from 'node:crypto';
import { GUEST_TRACKING_KEY_RE } from './dto/guest-checkout.dto';

/**
 * Khoá theo dõi tạm cấp khi khách tra đơn bằng mã + SĐT (`POST /checkout/guest/lookup`). Đơn chỉ lưu băm của khoá trình duyệt tạo lúc đặt nên
 * máy chủ không trả lại được khoá gốc, và thay băm thì đường dẫn trên máy đã đặt chết. Khoá tạm là chữ ký HMAC nên không cần cột mới.
 *
 * Khuôn: 32 byte, base64url không đệm (43 ký tự, đúng khuôn `GUEST_TRACKING_KEY_RE`: trang `/don/<mã>#k=` và trang QR nhận như khoá gốc).
 * Byte 0 là phiên bản, byte 1–4 là hạn (giây epoch), 27 byte còn lại là HMAC-SHA256 cắt ngắn của `mã|hạn|băm khoá gốc`. Gắn băm khoá gốc vào
 * chữ ký để khoá tạm chỉ mở đúng đơn ấy và chết theo nếu đơn đổi khoá.
 */

export const GUEST_LOOKUP_LINK_TTL_MS = 24 * 3_600_000;
const VERSION = 0x01;
const MAC_OFFSET = 5;
const MAC_BYTES = 27;
/** Chỉ dùng khi không có bí mật (máy dev, test). Production luôn có JWT_ACCESS_SECRET. */
const DEV_SECRET = 'dev-only-guest-track-link-secret';

function signingKey(secret: string | undefined): Buffer {
  return createHmac('sha256', secret || DEV_SECRET)
    .update('guest-track-link|v1')
    .digest();
}

function macOf(secret: string | undefined, code: string, expSec: number, tokenHash: string): Buffer {
  return createHmac('sha256', signingKey(secret)).update(`${code}|${expSec}|${tokenHash}`).digest().subarray(0, MAC_BYTES);
}

/**
 * `ttlMs` mặc định 24 giờ (tra cứu mã + SĐT). Link trong tin Zalo đặt đơn ký 60 ngày (`mss-order-link.ts`): hạn nằm trong khoá nên hàm kiểm
 * không cần biết khoá được cấp ở đâu.
 */
export function signGuestLookupKey(
  code: string,
  tokenHash: string,
  secret: string | undefined,
  now: number = Date.now(),
  ttlMs: number = GUEST_LOOKUP_LINK_TTL_MS,
): { key: string; expiresAt: Date } {
  const expSec = Math.floor((now + ttlMs) / 1000);
  const buf = Buffer.alloc(MAC_OFFSET + MAC_BYTES);
  buf[0] = VERSION;
  buf.writeUInt32BE(expSec, 1);
  macOf(secret, code, expSec, tokenHash).copy(buf, MAC_OFFSET);
  return { key: buf.toString('base64url'), expiresAt: new Date(expSec * 1000) };
}

/** Khoá tạm còn hạn và ký đúng cho `code` + `tokenHash`. So chữ ký trong thời gian không đổi. */
export function verifyGuestLookupKey(
  key: string,
  code: string,
  tokenHash: string,
  secret: string | undefined,
  now: number = Date.now(),
): boolean {
  if (!GUEST_TRACKING_KEY_RE.test(key)) return false;
  const buf = Buffer.from(key, 'base64url');
  if (buf.length !== MAC_OFFSET + MAC_BYTES || buf[0] !== VERSION) return false;
  const expSec = buf.readUInt32BE(1);
  const signed = timingSafeEqual(buf.subarray(MAC_OFFSET), macOf(secret, code, expSec, tokenHash));
  return signed && expSec * 1000 > now;
}

/**
 * Chủ đơn vẫn là khách vãng lai còn sống: zaloId `guest_`, chưa gộp, chưa có SĐT xác minh. Đơn vãng lai về một tài khoản Zalo (nhận đơn ở `claim`,
 * gộp hay nâng dòng khách khi đăng nhập trên trình duyệt đã đặt) thì không còn, kể cả khi tài khoản đó về sau bị xoá (xoá tài khoản đặt
 * `zaloId`/`phone` về null nhưng không xoá `guestPhone`/`guestTokenHash` của đơn). Chỉ chủ còn sống mới mở đơn bằng khoá tạm đã ký.
 */
export function isLiveGuestOwner(owner: { phone: string | null; zaloId: string | null; mergedIntoId: string | null } | null | undefined): boolean {
  return !!owner?.zaloId && owner.zaloId.startsWith('guest_') && !owner.zaloId.includes('_merged_') && owner.phone === null && owner.mergedIntoId === null;
}
