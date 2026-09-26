import { BadRequestException } from '@nestjs/common';

/**
 * Che bí mật khi admin ĐỌC SystemConfig (GET /admin/config, phản hồi PUT /admin/config).
 *
 * SystemConfig là JSON tự do do admin sửa tay; bản WIP Gomdon từng lưu mật khẩu tài khoản Gomdon trong
 * `shipping.gomdon.config.password` (loadGomdonConfig vẫn đọc fallback đó). Trước đây GET trả nguyên
 * văn — ai có token admin (hoặc chỉ cần đứng sau lưng admin đang mở tab Cấu hình) là đọc được mật khẩu.
 * Tài khoản Gomdon nay nằm ở env; lớp che này là lưới an toàn cho MỌI khoá kiểu bí mật.
 */
export const SECRET_KEY_RE = /password|secret|token/i;

/** Chuỗi thay thế. Form lưu lại gửi đúng chuỗi này → restoreRedactedSecrets() trả giá trị thật. */
export const REDACTED = '••••••••';

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

/** Rỗng/null = "chưa đặt" — hiển thị nguyên để admin biết thiếu, không lộ gì. */
function isEmptySecret(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

/** Bản sao đã che (KHÔNG sửa object gốc — cache của SystemConfigService dùng chung tham chiếu). */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) && !isEmptySecret(v) ? REDACTED : redactSecrets(v);
    }
    return out;
  }
  return value;
}

interface ConfigRowLike {
  key: string;
  value: unknown;
}

/**
 * Che cho cả 2 dạng đọc của admin: mảng dòng SystemConfig (findMany) và Record<key, value>
 * (getByCategory). Khoá config tự nó là bí mật (vd `zalo.oa_access_token`) → che cả value.
 */
export function redactConfigRows<T extends ConfigRowLike>(rows: T[]): T[];
export function redactConfigRows(rows: Record<string, unknown>): Record<string, unknown>;
export function redactConfigRows(rows: ConfigRowLike[] | Record<string, unknown>): unknown {
  if (Array.isArray(rows)) {
    return rows.map((r) => ({ ...r, value: redactValueForKey(r.key, r.value) }));
  }
  return Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, redactValueForKey(k, v)]));
}

export function redactValueForKey(key: string, value: unknown): unknown {
  if (isSecretKey(key)) return isEmptySecret(value) ? value : REDACTED;
  return redactSecrets(value);
}

function redactedMarkerError(path: string): BadRequestException {
  return new BadRequestException(
    `"${path}" đang là giá trị che (${REDACTED}) nhưng chưa có giá trị thật để giữ lại — nhập giá trị thật hoặc xoá trường này.`,
  );
}

/**
 * Admin lưu lại một config đã bị che → ở chỗ nào client gửi lại đúng REDACTED thì lấy giá trị hiện
 * có trong DB, không ghi đè bí mật thật bằng chuỗi "••••". Không có giá trị cũ để giữ → 400.
 */
export function restoreRedactedSecrets(key: string, incoming: unknown, existing: unknown): unknown {
  return restoreAt(key, incoming, existing);
}

function restoreAt(path: string, incoming: unknown, existing: unknown): unknown {
  if (incoming === REDACTED) {
    if (isEmptySecret(existing) || existing === REDACTED) throw redactedMarkerError(path);
    return existing;
  }
  if (Array.isArray(incoming)) {
    const prev = Array.isArray(existing) ? existing : [];
    return incoming.map((v, i) => restoreAt(`${path}[${i}]`, v, prev[i]));
  }
  if (incoming && typeof incoming === 'object') {
    const prev =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? (existing as Record<string, unknown>)
        : {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
      out[k] = restoreAt(`${path}.${k}`, v, prev[k]);
    }
    return out;
  }
  return incoming;
}
