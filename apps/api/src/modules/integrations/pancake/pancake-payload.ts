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

/** Chuỗi số theo kiểu máy: chữ số, tối đa hai số lẻ. "12.000" (ba số lẻ, dấu chấm ngăn nghìn kiểu Việt Nam) cố ý KHÔNG khớp. */
const DECIMAL_STRING = /^\d+(?:\.\d{1,2})?$/;
const SIGNED_DECIMAL_STRING = /^-?\d+(?:\.\d{1,2})?$/;

/**
 * Số nguyên không âm cho tiền (VND) và các cột Int: số, hoặc chuỗi số kiểu máy. Số lẻ là null (giá "12000.5" là dữ liệu hỏng,
 * không phải 12001 đồng), trừ khi `round` (nơi chỉ cần so sánh/ghi gần đúng). Âm, quá 2^53, "12.000" → null.
 */
export function payloadNonNegInt(x: unknown, opts: { round?: boolean } = {}): number | null {
  let n: number;
  if (typeof x === 'number') n = x;
  else if (typeof x === 'string' && DECIMAL_STRING.test(x.trim())) n = Number(x.trim());
  else return null;
  if (!Number.isFinite(n) || n < 0) return null;
  if (!Number.isInteger(n)) {
    if (!opts.round) return null;
    n = Math.round(n);
  }
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Số lượng tồn: số nguyên (bỏ phần lẻ), có thể ÂM — POS Pancake cho bán lố kho nên số âm là dữ liệu thật, nơi gọi tự quyết (bán: coi
 * là 0). null khi không đọc được hoặc ngoài cột Int.
 */
export function payloadQuantity(x: unknown): number | null {
  let n: number;
  if (typeof x === 'number') n = x;
  else if (typeof x === 'string' && SIGNED_DECIMAL_STRING.test(x.trim())) n = Number(x.trim());
  else return null;
  if (!Number.isFinite(n)) return null;
  n = Math.trunc(n);
  return Math.abs(n) > INT4_MAX ? null : n;
}

/** Cờ bật/tắt: chỉ `true`, 1, "1", "true" là bật. Chuỗi "false" không được thành bật như `Boolean("false")`. */
export function payloadFlag(x: unknown): boolean {
  return x === true || x === 1 || x === '1' || (typeof x === 'string' && x.trim().toLowerCase() === 'true');
}

/** Mảng các chuỗi khác rỗng: nhận mảng, hoặc một chuỗi đơn lẻ (Pancake trả một ảnh thay vì mảng); còn lại rỗng. */
export function payloadTextList(x: unknown): string[] {
  const items = Array.isArray(x) ? x : typeof x === 'string' ? [x] : [];
  return items.flatMap((i) => (typeof i === 'string' && i.trim() !== '' ? [i.trim()] : []));
}
