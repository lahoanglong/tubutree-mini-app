import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Ký và kiểm chữ ký HMAC giữa Tubu và MSS (hợp đồng tubu-mss-order-events mục 3.2 và 4.2, dùng chung cho hợp đồng commerce v0.9):
 * `v1=<hex chữ thường của HMAC-SHA256(secret, "<timestamp>.<rawBody>")>`, timestamp là giây unix, thân rỗng ký `"<timestamp>."`.
 * Chữ ký tính trên đúng các byte gửi đi/nhận về: không parse rồi stringify lại (mất `\/`, `\uXXXX`, thứ tự khoá).
 *
 * Chiều Tubu → MSS mang header `X-Tubu-*`; chiều MSS → Tubu mang `X-Mss-*` và ký bằng bí mật riêng của chiều ngược.
 */

export const MSS_SIGNATURE_VERSION = 'v1';
/** Cửa sổ chống phát lại theo hợp đồng: lệch quá chừng này giây so với giờ máy chủ thì từ chối. */
export const MSS_TIMESTAMP_TOLERANCE_SEC = 300;

export const TUBU_KEY_ID_HEADER = 'X-Tubu-Key-Id';
export const TUBU_TIMESTAMP_HEADER = 'X-Tubu-Timestamp';
export const TUBU_SIGNATURE_HEADER = 'X-Tubu-Signature';

/** Tên header chữ thường như Node đưa vào `req.headers`. */
export const MSS_KEY_ID_HEADER = 'x-mss-key-id';
export const MSS_TIMESTAMP_HEADER = 'x-mss-timestamp';
export const MSS_SIGNATURE_HEADER = 'x-mss-signature';

const TIMESTAMP_RE = /^\d{1,12}$/;
const SIGNATURE_RE = /^(?:v1=)?([0-9a-fA-F]{64})$/;

export type RawBody = Buffer | string | undefined | null;

function bodyBytes(rawBody: RawBody): Buffer {
  if (rawBody == null) return Buffer.alloc(0);
  return Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
}

function hmac(secret: string, timestamp: string, rawBody: RawBody): Buffer {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(bodyBytes(rawBody)).digest();
}

/** Giá trị header chữ ký: `v1=<64 hex chữ thường>`. */
export function computeMssSignature(secret: string, timestamp: number | string, rawBody: RawBody): string {
  return `${MSS_SIGNATURE_VERSION}=${hmac(secret, String(timestamp), rawBody).toString('hex')}`;
}

export interface MssSignInput {
  keyId: string;
  secret: string;
  rawBody: RawBody;
  /** Giây unix; mặc định giờ hiện tại. Mỗi lần thử lại phải ký lại với giờ mới (hợp đồng mục 5.2). */
  timestamp?: number;
}

/** Ba header Tubu gắn vào mỗi yêu cầu gửi MSS. */
export function signMssRequest({ keyId, secret, rawBody, timestamp = Math.floor(Date.now() / 1000) }: MssSignInput): Record<string, string> {
  return {
    [TUBU_KEY_ID_HEADER]: keyId,
    [TUBU_TIMESTAMP_HEADER]: String(timestamp),
    [TUBU_SIGNATURE_HEADER]: computeMssSignature(secret, timestamp, rawBody),
  };
}

export type MssVerifyFailure = 'missing_header' | 'malformed' | 'bad_signature' | 'stale_timestamp' | 'not_configured';
export type MssVerifyResult = { ok: true; usedPreviousSecret: boolean } | { ok: false; reason: MssVerifyFailure };

export interface MssVerifyInput {
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: RawBody;
  /** Bí mật hiện tại và (khi đang xoay khoá) bí mật trước; phần tử null bị bỏ qua. */
  secrets: ReadonlyArray<string | null | undefined>;
  nowSec?: number;
  toleranceSec?: number;
}

/**
 * Kiểm chữ ký với từng bí mật bằng so sánh hằng thời gian, rồi mới kiểm cửa sổ giờ (chỉ người giữ khoá mới phân biệt được
 * "sai giờ" với "sai chữ ký"; người gọi trả 401 chung cho mọi nhánh). Lý do chi tiết chỉ để ghi log nội bộ.
 */
export function verifyMssSignature({ timestamp, signature, rawBody, secrets, nowSec = Math.floor(Date.now() / 1000), toleranceSec = MSS_TIMESTAMP_TOLERANCE_SEC }: MssVerifyInput): MssVerifyResult {
  const usable = secrets.filter((s): s is string => typeof s === 'string' && s.length > 0);
  if (usable.length === 0) return { ok: false, reason: 'not_configured' };
  if (!timestamp || !signature) return { ok: false, reason: 'missing_header' };
  const sig = SIGNATURE_RE.exec(signature.trim());
  if (!TIMESTAMP_RE.test(timestamp) || !sig) return { ok: false, reason: 'malformed' };
  const given = Buffer.from(sig[1]!.toLowerCase(), 'hex');
  let matched = -1;
  usable.forEach((secret, i) => {
    // Tính đủ mọi bí mật (không dừng sớm) để thời gian trả lời không lộ khoá nào khớp.
    if (timingSafeEqual(hmac(secret, timestamp, rawBody), given) && matched < 0) matched = i;
  });
  if (matched < 0) return { ok: false, reason: 'bad_signature' };
  if (Math.abs(nowSec - Number(timestamp)) > toleranceSec) return { ok: false, reason: 'stale_timestamp' };
  return { ok: true, usedPreviousSecret: matched > 0 };
}
