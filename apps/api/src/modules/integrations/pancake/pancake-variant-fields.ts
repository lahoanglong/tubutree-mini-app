/**
 * Phân loại của một biến thể trong payload sản phẩm Pancake (`variations[].fields`). Pancake trả MẢNG object
 * `[{ id, name: 'PHÂN LOẠI', value: '1 chai', keyValue: '1 CHAI' }]`; tài liệu cũ và dữ liệu seed dùng object `{ size: '100ml' }`.
 * Payload là dữ liệu bên ngoài nên mọi hàm ở đây nhận `unknown` và không bao giờ ném lỗi.
 */
export interface PancakeVariantFieldObject {
  id?: string;
  name?: string;
  value?: string | number | PancakeVariantFieldObject | null;
  keyValue?: string;
  k?: string;
  v?: string | number | PancakeVariantFieldObject | null;
  key?: string;
}

export type PancakeVariantField = string | number | PancakeVariantFieldObject;

export type PancakeVariantFields = PancakeVariantField[] | Record<string, string | number | PancakeVariantFieldObject | null | undefined>;

/** Chuỗi mà `String({})` / `Object.values(...).join()` để lại khi nối nhầm object: dấu hiệu tên biến thể ghi hỏng. */
export const BROKEN_VARIANT_NAME_MARKER = '[object Object]';

export function isBrokenVariantName(name: unknown): boolean {
  return typeof name === 'string' && name.includes(BROKEN_VARIANT_NAME_MARKER);
}

interface VariantEntry {
  name: string | null;
  value: string;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function cleanText(x: unknown): string | null {
  let s: string;
  if (typeof x === 'string') s = x.trim();
  else if (typeof x === 'number' && Number.isFinite(x)) s = String(x);
  else return null;
  // Giá trị đã mang sẵn chuỗi hỏng (Pancake hay dữ liệu cũ) không được lọt vào nhãn.
  return s === '' || s.includes(BROKEN_VARIANT_NAME_MARKER) ? null : s;
}

/** Giá trị đơn lẻ: chuỗi, số, hoặc một object `{ value | name }` (chỉ xuống một tầng). */
function scalarValue(x: unknown): string | null {
  const direct = cleanText(x);
  if (direct !== null) return direct;
  if (!isRecord(x)) return null;
  return cleanText(x.value) ?? cleanText(x.name);
}

function entryOf(item: unknown): VariantEntry | null {
  if (isRecord(item)) {
    const value = scalarValue(item.value ?? item.v);
    if (value === null) return null;
    return { name: cleanText(item.name ?? item.key ?? item.k), value };
  }
  const value = cleanText(item);
  return value === null ? null : { name: null, value };
}

/** Các phân loại đọc được, theo đúng thứ tự trong payload. Phần tử rác bị bỏ. */
function entriesOf(raw: unknown): VariantEntry[] {
  if (Array.isArray(raw)) return raw.flatMap((item) => entryOf(item) ?? []);
  if (!isRecord(raw)) return [];
  return Object.entries(raw).flatMap(([name, val]) => {
    const value = scalarValue(val);
    return value === null ? [] : [{ name: cleanText(name), value }];
  });
}

/** Nhãn phân loại = các `value` nối " - " theo thứ tự Pancake; null khi không đọc được gì để nơi gọi dùng tên sản phẩm. */
export function variantLabel(raw: unknown): string | null {
  const values = entriesOf(raw).map((e) => e.value);
  return values.length > 0 ? values.join(' - ') : null;
}

/**
 * `{tên: giá trị}` để cột `variations.attributes` luôn đúng kiểu `Record<string, string>` mà API và client khai báo. Khoá trùng
 * thêm " (n)" thay vì đè nhau; phần tử không có tên lấy `option_<n>` (n đếm trong các phân loại đọc được, phần tử rác không tính). Thứ tự khoá của jsonb không được giữ, nên nhãn
 * không dựng lại từ cột này mà dựng từ payload (`variantLabel`).
 */
export function variantAttributes(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  entriesOf(raw).forEach((e, i) => {
    const base = e.name ?? `option_${i + 1}`;
    let key = base;
    for (let n = 2; Object.prototype.hasOwnProperty.call(out, key); n++) key = `${base} (${n})`;
    Object.defineProperty(out, key, { value: e.value, enumerable: true, writable: true, configurable: true });
  });
  return out;
}
