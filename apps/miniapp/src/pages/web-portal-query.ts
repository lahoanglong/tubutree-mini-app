/**
 * Query của link Mini App cũ (vd `/storefront?khoi=...`) đi theo sang link web, nhưng chỉ những khoá vô hại: link này hiện trên màn,
 * được chép và dán sang trình duyệt ngoài, nên một khoá mang bí mật sẽ rò ra khỏi phiên Zalo.
 */

const MAX_PARAMS = 8;
const MAX_KEY_LENGTH = 32;
const MAX_VALUE_LENGTH = 200;
const KEY_SHAPE = /^[A-Za-z0-9_.-]+$/;

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** So khớp trên khoá đã hạ chữ thường và bỏ `_ - .`, nên `Access_Token`, `x-auth`, `zaloCode` đều bị chặn. */
const SENSITIVE_FRAGMENTS = [
  'token', 'code', 'auth', 'secret', 'jwt', 'session', 'password', 'passwd', 'pwd', 'otp', 'signature', 'apikey', 'accesskey',
  'privatekey', 'credential', 'cookie', 'bearer', 'nonce',
] as const;
const SENSITIVE_EXACT = new Set(['sid', 'ssid', 'sig', 'hmac', 'pin', 'cvv']);
/** Thông tin cá nhân: link này nằm trên thanh địa chỉ và log của web, nên không chuyển số điện thoại, email hay mã người dùng. */
const PERSONAL_FRAGMENTS = ['phone', 'email', 'userid', 'zaloid', 'idbynumber'] as const;
const PERSONAL_EXACT = new Set(['uid', 'tel', 'mobile', 'mail', 'sdt']);
/** Khoá điều hướng: web có thể coi giá trị là đích chuyển trang, nên không chuyển tiếp (chống open redirect). Tiền tố bắt cả `callbackUrl`, `nextPage`, `targetUri`. */
const REDIRECT_PREFIXES = ['redirect', 'return', 'next', 'continue', 'goto', 'callback', 'target', 'dest'] as const;
const REDIRECT_EXACT = new Set(['url', 'uri', 'link', 'back', 'to']);
const REDIRECT_SUFFIXES = ['url', 'uri', 'link'] as const;

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[-_.]/g, '');
  if (SENSITIVE_EXACT.has(k) || PERSONAL_EXACT.has(k) || REDIRECT_EXACT.has(k)) return true;
  if (REDIRECT_PREFIXES.some((p) => k.startsWith(p)) || REDIRECT_SUFFIXES.some((x) => k.endsWith(x))) return true;
  return SENSITIVE_FRAGMENTS.some((fragment) => k.includes(fragment)) || PERSONAL_FRAGMENTS.some((fragment) => k.includes(fragment));
}

/**
 * Giá trị trông như chứng thực: JWT, chuỗi dài lẫn hoa-thường-số, chuỗi hex dài (HMAC, hash) hoặc id ngẫu nhiên dài chỉ gồm chữ thường và số
 * (cuid). Slug chữ thường có gạch ngang như `khoi=ten-san-pham` không dính.
 */
function looksLikeCredential(value: string): boolean {
  if (/^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/.test(value)) return true;
  if (/^[a-f0-9]{32,}$/i.test(value)) return true;
  if (/^[a-z0-9]{24,}$/.test(value) && /[a-z]/.test(value) && /\d/.test(value)) return true;
  return value.length >= 32 && /^[A-Za-z0-9+/=_-]+$/.test(value) && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
}

/**
 * Lọc `location.search` của Mini App thành các cặp an toàn để nối vào link web. Khoá của `fixed` (query cố định của trang đích,
 * vd `tab=community`) luôn thắng khoá cùng tên từ link ngoài. Trả mảng rỗng khi không còn gì hợp lệ.
 */
export function safePortalParams(search: string, fixed: URLSearchParams = new URLSearchParams()): [string, string][] {
  const out: [string, string][] = [];
  const seen = new Set<string>(fixed.keys());
  let incoming: URLSearchParams;
  try {
    incoming = new URLSearchParams(search);
  } catch {
    return out;
  }
  for (const [rawKey, rawValue] of incoming) {
    if (out.length >= MAX_PARAMS) break;
    const key = rawKey.trim();
    if (!key || key.length > MAX_KEY_LENGTH || !KEY_SHAPE.test(key) || seen.has(key)) continue;
    if (isSensitiveKey(key)) continue;
    const value = rawValue.trim();
    if (value.length > MAX_VALUE_LENGTH || hasControlChars(value) || looksLikeCredential(value)) continue;
    seen.add(key);
    out.push([key, value]);
  }
  return out;
}
