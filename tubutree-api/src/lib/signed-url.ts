/**
 * Signed URL — Cấp link xem ảnh ngắn hạn không cần JWT.
 *
 * Format: ?exp=<unix_ts>&sig=<hex_hmac>
 *   sig = HMAC_SHA256(secret, "<userId>:<filename>:<exp>:<viewerId>")
 *
 * Khác token-in-query JWT 30 ngày: signed URL có thể chỉ giới hạn 1 file +
 * hết hạn ngắn (mặc định 10 phút).
 */
import { createHmac, timingSafeEqual } from 'crypto';

const SECRET = process.env.JWT_SECRET as string; // share với JWT secret (đã verify > 16 chars khi server start)
const DEFAULT_TTL_SEC = 600; // 10 phút

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('hex');
}

function payloadOf(ownerId: number, filename: string, exp: number, viewerId: number): string {
  return `${ownerId}:${filename}:${exp}:${viewerId}`;
}

export function generateSignedUrl(
  ownerId: number, filename: string, viewerId: number, ttlSec = DEFAULT_TTL_SEC,
): { url: string; exp: number } {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = sign(payloadOf(ownerId, filename, exp, viewerId));
  // viewerId encode để verify đúng người yêu cầu
  return {
    url: `/api/uploads/kyc/${ownerId}/${encodeURIComponent(filename)}?exp=${exp}&v=${viewerId}&sig=${sig}`,
    exp,
  };
}

/** Verify request đến. Trả về true nếu sig hợp lệ + chưa hết hạn. */
export function verifySignedUrl(
  ownerId: number, filename: string, exp: number, viewerId: number, providedSig: string,
): boolean {
  if (Math.floor(Date.now() / 1000) > exp) return false;
  const expected = sign(payloadOf(ownerId, filename, exp, viewerId));
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(providedSig, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
