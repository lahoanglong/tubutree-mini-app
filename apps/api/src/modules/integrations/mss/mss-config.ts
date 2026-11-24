/**
 * Cấu hình kết nối MSS đọc thẳng từ biến môi trường (không qua env.validation): thiếu biến thì mọi cờ MSS coi như tắt và API vẫn
 * khởi động bình thường. Giá trị bí mật không bao giờ rời khỏi file này ngoài lúc ký/kiểm chữ ký; màn Ops chỉ thấy trạng thái.
 *
 * Hợp đồng: /tmp/contracts/mss-tubu-commerce-api.md v0.9 (gốc đường dẫn `{MSS_BASE_URL}/api/ext/tubu/v1`) và
 * /tmp/contracts/tubu-mss-order-events.md mục 3.2 (ký HMAC, xoay khoá theo key id).
 */

/** Đoạn đường dẫn cố định của API MSS dành cho Tubu. */
export const MSS_API_PREFIX = '/api/ext/tubu/v1';

/** Bí mật ngắn hơn chừng này coi như chưa đặt: hợp đồng yêu cầu 32 byte ngẫu nhiên (43 ký tự base64url, 64 ký tự hex). */
export const MSS_SECRET_MIN_LENGTH = 32;

const KEY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type MssEnvVarState = 'ok' | 'missing' | 'invalid';

export interface MssEnvStatus {
  MSS_BASE_URL: MssEnvVarState;
  MSS_KEY_ID: MssEnvVarState;
  MSS_OUTBOUND_SECRET: MssEnvVarState;
  MSS_INBOUND_SECRET: MssEnvVarState;
  /** Khoá trước khi xoay: không bắt buộc, `missing` là trạng thái bình thường. */
  MSS_INBOUND_SECRET_PREV: MssEnvVarState;
}

export interface MssEnv {
  /** Gốc HTTPS của MSS, đã bỏ dấu `/` cuối. null khi thiếu hoặc sai. */
  baseUrl: string | null;
  keyId: string | null;
  outboundSecret: string | null;
  inboundSecret: string | null;
  inboundSecretPrev: string | null;
  status: MssEnvStatus;
}

/**
 * HTTPS bắt buộc ở production. Ngoài production cho phép `http://localhost`/`127.0.0.1` để chạy MSS giả khi phát triển.
 * URL có user:pass, query hoặc fragment bị từ chối: chữ ký chỉ bảo vệ thân và mốc giờ, không bảo vệ chỗ gửi tới.
 */
function parseBaseUrl(raw: string, nodeEnv: string | undefined): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  const localHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !(localHttp && nodeEnv !== 'production')) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

function readSecret(raw: string | undefined): { value: string | null; state: MssEnvVarState } {
  const v = raw?.trim() ?? '';
  if (!v) return { value: null, state: 'missing' };
  if (v.length < MSS_SECRET_MIN_LENGTH) return { value: null, state: 'invalid' };
  return { value: v, state: 'ok' };
}

export function readMssEnv(env: NodeJS.ProcessEnv = process.env): MssEnv {
  const rawBase = env.MSS_BASE_URL?.trim() ?? '';
  const baseUrl = rawBase ? parseBaseUrl(rawBase, env.NODE_ENV) : null;
  const rawKeyId = env.MSS_KEY_ID?.trim() ?? '';
  const keyId = KEY_ID_RE.test(rawKeyId) ? rawKeyId : null;
  const outbound = readSecret(env.MSS_OUTBOUND_SECRET);
  const inbound = readSecret(env.MSS_INBOUND_SECRET);
  const prev = readSecret(env.MSS_INBOUND_SECRET_PREV);
  return {
    baseUrl,
    keyId,
    outboundSecret: outbound.value,
    inboundSecret: inbound.value,
    inboundSecretPrev: prev.value,
    status: {
      MSS_BASE_URL: !rawBase ? 'missing' : baseUrl ? 'ok' : 'invalid',
      MSS_KEY_ID: !rawKeyId ? 'missing' : keyId ? 'ok' : 'invalid',
      MSS_OUTBOUND_SECRET: outbound.state,
      MSS_INBOUND_SECRET: inbound.state,
      MSS_INBOUND_SECRET_PREV: prev.state,
    },
  };
}

/** Biến bắt buộc: thiếu hoặc sai một biến là `isMssConfigured` false. */
export const MSS_REQUIRED_ENV_KEYS = ['MSS_BASE_URL', 'MSS_KEY_ID', 'MSS_OUTBOUND_SECRET', 'MSS_INBOUND_SECRET'] as const;

/** Đủ biến bắt buộc (gốc URL, key id, hai bí mật). Thiếu một biến là mọi cờ MSS coi như tắt. */
export function isMssConfigured(env: MssEnv): boolean {
  return Boolean(env.baseUrl && env.keyId && env.outboundSecret && env.inboundSecret);
}
