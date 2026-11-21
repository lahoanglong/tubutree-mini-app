import type { Env } from '../../../config/go-live/types';
import { isSecretKey } from '../config-redaction';

/**
 * Tên biến env chứa bí mật mà luật tên khoá SystemConfig (`isSecretKey`) không bắt: khoá đánh số (`ZALOPAY_KEY1`), khoá cổng (`*_GATEWAY_KEY`),
 * chuỗi kết nối có mật khẩu, URL webhook mang token, tài khoản đăng nhập Gomdon và SMTP.
 */
const EXTRA_ENV_SECRET = /_KEY\d*$|DATABASE_URL|REDIS_URL|WEBHOOK_URL|_DSN$|GOMDON_PHONE|SMTP_USER/i;
/** Giá trị ngắn hơn mức này không được coi là bí mật để thay (tránh thay nhầm chữ thường như "true"). */
const MIN_SECRET_LEN = 6;
export const SECRET_MASK = '***';

export function isSecretEnvName(name: string): boolean {
  return isSecretKey(name) || EXTRA_ENV_SECRET.test(name);
}

function urlPassword(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.password ? decodeURIComponent(u.password) : null;
  } catch {
    return null;
  }
}

/** Mọi giá trị bí mật đang có trong env (kể cả mật khẩu nằm trong chuỗi kết nối), dài trước ngắn sau để thay chuỗi dài trước. */
export function secretValues(env: Env): string[] {
  const out = new Set<string>();
  for (const [name, raw] of Object.entries(env)) {
    if (!raw || !isSecretEnvName(name)) continue;
    const v = raw.trim();
    if (v.length >= MIN_SECRET_LEN) out.add(v);
    const pw = urlPassword(v);
    if (pw && pw.length >= MIN_SECRET_LEN) out.add(pw);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

function scrubString(s: string, secrets: readonly string[]): string {
  let out = s;
  for (const secret of secrets) if (out.includes(secret)) out = out.split(secret).join(SECRET_MASK);
  return out;
}

/**
 * Lưới chặn cuối trước khi trả bảng kiểm ra trình duyệt: các dòng `go-live:check` vốn chỉ nói "đã đặt / chưa đặt", nhưng một dòng mới viết
 * sơ ý (in nguyên giá trị) cũng không được lọt bí mật. Đi sâu mọi chuỗi trong kết quả và thay giá trị bí mật bằng `***`.
 */
export function scrubSecrets<T>(value: T, secrets: readonly string[]): T {
  if (secrets.length === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return scrubString(v, secrets);
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Date) return v;
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
