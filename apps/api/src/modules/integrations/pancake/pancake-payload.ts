/**
 * Đọc phòng thủ các ô của payload Pancake (sản phẩm, biến thể, đơn, webhook). Payload là dữ liệu bên ngoài nên mọi hàm nhận
 * `unknown`, không bao giờ ném lỗi, và ô không đọc được trả `null` để nơi gọi coi như "Pancake không nói gì" thay vì ghi
 * `NaN`, `Infinity`, "undefined" hay "[object Object]" vào DB và vào chữ hiện cho khách.
 */

/** Cột Int của Postgres: số lớn hơn làm câu ghi ném và cả sản phẩm/sự kiện hỏng mãi. */
const INT4_MAX = 2_147_483_647;

/** Những chuỗi mà `String(x)` để lại khi x là undefined/null/NaN/object: dấu hiệu nối nhầm, không phải dữ liệu. */
const POISON = new Set(['undefined', 'null', 'NaN']);
const OBJECT_MARKER = '[object Object]';

/** Chuỗi khác rỗng đã cắt khoảng trắng, hoặc số hữu hạn viết thành chuỗi; mọi kiểu khác (object, mảng, boolean) là null. */
export function payloadText(x: unknown): string | null {
  let s: string;
  if (typeof x === 'string') s = x.trim();
  else if (typeof x === 'number' && Number.isFinite(x)) s = String(x);
  else return null;
  return s === '' || POISON.has(s) || s.includes(OBJECT_MARKER) ? null : s;
}

/** Mã định danh (đơn, biến thể, sản phẩm): chuỗi khác rỗng hoặc số nguyên an toàn. Số lẻ hay quá 2^53 không phải mã. */
export function payloadId(x: unknown): string | null {
  if (typeof x === 'number' && !Number.isSafeInteger(x)) return null;
  return payloadText(x);
}

/** Chuỗi số thập phân (có thể âm), phần lẻ dài tùy ý: "269000.000", "7.00". Không nhận "1e3", "0x10", "1,5". */
const NUMERIC_STRING = /^-?\d+(?:\.\d+)?$/;
/**
 * Mẫu ngăn nghìn kiểu Việt Nam: nhóm đầu 1-3 chữ số, rồi các nhóm đúng ba chữ số sau dấu chấm ("12.000", "269.000", "1.234.567").
 * Không phân biệt được với số thập phân có ba số lẻ ("5.000" là 5 hay 5000?), nên từ chối thay vì đoán: đọc nhầm là sai tiền/tồn.
 * "269000.000" (nhóm đầu 6 chữ số) không khớp mẫu này nên là số thập phân thật.
 */
const THOUSANDS_GROUPED = /^-?\d{1,3}(?:\.\d{3})+$/;

/** Chuỗi số thập phân hợp lệ thành số hữu hạn; chuỗi lạ hoặc khớp mẫu ngăn nghìn là null. */
export function payloadNumericString(x: string): number | null {
  const s = x.trim();
  if (!NUMERIC_STRING.test(s) || THOUSANDS_GROUPED.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Số nguyên không âm cho tiền (VND) và các cột Int: số, hoặc chuỗi số thập phân (xem `payloadNumericString`). Số lẻ là null (giá
 * "12000.5" là dữ liệu hỏng, không phải 12001 đồng), trừ khi `round` (làm tròn) hoặc `trunc` (bỏ phần lẻ): nơi chỉ cần so sánh
 * hoặc ghi gần đúng. Âm, quá 2^53, "12.000" (ngăn nghìn) → null.
 */
export function payloadNonNegInt(x: unknown, opts: { round?: boolean; trunc?: boolean } = {}): number | null {
  let n: number;
  if (typeof x === 'number') n = x;
  else if (typeof x === 'string') {
    const parsed = payloadNumericString(x);
    if (parsed === null) return null;
    n = parsed;
  } else return null;
  if (!Number.isFinite(n) || n < 0) return null;
  if (!Number.isInteger(n)) {
    if (opts.trunc) n = Math.trunc(n);
    else if (opts.round) n = Math.round(n);
    else return null;
  }
  return Number.isSafeInteger(n) ? n || 0 : null;
}

/**
 * Số lượng tồn: số nguyên (bỏ phần lẻ), có thể ÂM — POS Pancake cho bán lố kho nên số âm là dữ liệu thật, nơi gọi tự quyết (bán: coi
 * là 0). null khi không đọc được hoặc ngoài cột Int.
 */
export function payloadQuantity(x: unknown): number | null {
  let n: number;
  if (typeof x === 'number') n = x;
  else if (typeof x === 'string') {
    const parsed = payloadNumericString(x);
    if (parsed === null) return null;
    n = parsed;
  } else return null;
  if (!Number.isFinite(n)) return null;
  n = Math.trunc(n) || 0;
  return Math.abs(n) > INT4_MAX ? null : n;
}

/**
 * Cờ "đã xoá" (`is_removed`): chỉ false, 0, "0", "false", "", null/undefined là CHƯA xoá. Mọi giá trị khác (true, 1, 2, "yes", mốc thời
 * gian xoá, object) là đã xoá, giữ đúng nghĩa của `if (is_removed)` cũ; chuỗi "false" thì không được thành đã xoá như `Boolean("false")`.
 */
export function payloadRemoved(x: unknown): boolean {
  if (typeof x === 'string') {
    const t = x.trim().toLowerCase();
    return !(t === '' || t === '0' || t === 'false');
  }
  return Boolean(x);
}

/** Mảng các chuỗi khác rỗng: nhận mảng, hoặc một chuỗi đơn lẻ (Pancake trả một ảnh thay vì mảng); còn lại rỗng. */
export function payloadTextList(x: unknown): string[] {
  const items = Array.isArray(x) ? x : typeof x === 'string' ? [x] : [];
  return items.flatMap((i) => (typeof i === 'string' && i.trim() !== '' ? [i.trim()] : []));
}
