import { BadRequestException } from '@nestjs/common';

/**
 * Che bí mật khi admin ĐỌC SystemConfig (GET /admin/config, phản hồi PUT /admin/config).
 *
 * SystemConfig là JSON tự do do admin sửa tay; bản WIP Gomdon từng lưu mật khẩu tài khoản Gomdon trong
 * `shipping.gomdon.config.password` (loadGomdonConfig vẫn đọc fallback đó). Trước đây GET trả nguyên
 * văn — ai có token admin (hoặc chỉ cần đứng sau lưng admin đang mở tab Cấu hình) là đọc được mật khẩu.
 * Tài khoản Gomdon nay nằm ở env; lớp che này là lưới an toàn cho MỌI khoá kiểu bí mật.
 *
 * Khớp (không phân biệt hoa thường): password/passwd/passphrase ở bất kỳ đâu; `pass` chỉ khi đứng thành
 * một đoạn riêng (`pass`, `db_pass`, `smtp.pass`) — KHÔNG khớp `pass` làm chuỗi con vì `seasonpass.tiers`
 * / `seasonpass.checkin_xp` là key đang seed (che nhầm thì admin mất quyền xem/sửa bậc Season Pass), và
 * passport/bypass/compass không phải bí mật; pwd, secret, token, api key, private key, credential, hmac,
 * signature ở bất kỳ đâu; `key`/`key2` chỉ khi là NGUYÊN tên field (không che keyword/monkey/key_id).
 * Hạn chế đã biết: camelCase `smtpPass` (Pass dính liền, không dấu phân cách) không bị bắt — phân biệt với
 * `seasonPass` bằng regex là không thể; dùng `smtpPassword`/`smtp_pass`.
 * config-redaction.spec.ts đọc mảng SYSTEM_CONFIGS trong prisma/seed.ts và fail nếu regex che nhầm key đang seed.
 */
export const SECRET_KEY_RE =
  /passw(?:or)?d|passphrase|(?:^|[^a-z0-9])pass(?:$|[^a-z0-9])|pwd|secret|token|api[_-]?key|private[_-]?key|credential|^key\d*$|hmac|signature/i;

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

function reorderedListError(path: string): BadRequestException {
  return new BadRequestException(
    `Nhập lại giá trị thật cho trường bí mật trong danh sách đã đổi thứ tự/độ dài ("${path}").`,
  );
}

/** Có chuỗi che ở đâu đó bên trong (đệ quy) không. */
function containsRedacted(v: unknown): boolean {
  if (v === REDACTED) return true;
  if (Array.isArray(v)) return v.some(containsRedacted);
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).some(containsRedacted);
  return false;
}

/** Bản sao BỎ mọi field bí mật (đệ quy) — phần còn lại là "danh tính" của phần tử để so khớp. */
function withoutSecrets(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutSecrets);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (!isSecretKey(k)) out[k] = withoutSecrets(x);
    }
    return out;
  }
  return v;
}

/**
 * So sánh sâu KHÔNG phụ thuộc thứ tự khoá — giá trị cũ đọc từ cột Json (Postgres jsonb tự sắp lại khoá),
 * JSON.stringify thô sẽ luôn lệch dù nội dung giống hệt.
 */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const ka = Object.keys(ra);
    const kb = Object.keys(rb);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(rb, k) && sameJson(ra[k], rb[k]));
  }
  return false;
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
    // Khôi phục theo CHỈ SỐ chỉ đúng khi phần tử i gửi lên là CÙNG phần tử i đã lưu. Admin xoá/thêm/đổi
    // thứ tự phần tử mà bí mật vẫn đang che → phần tử nhận nhầm bí mật của phần tử khác, âm thầm. Chỉ
    // chặn khi có chuỗi che bên trong (mảng không có bí mật che thì sửa tự do như trước).
    if (Array.isArray(existing)) {
      const masked = incoming.map(containsRedacted);
      if (masked.some(Boolean)) {
        if (incoming.length !== prev.length) throw reorderedListError(path);
        masked.forEach((m, i) => {
          if (m && !sameJson(withoutSecrets(incoming[i]), withoutSecrets(prev[i]))) {
            throw reorderedListError(`${path}[${i}]`);
          }
        });
      }
    }
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
