/** Ô ngày sinh nhập tay dd/mm/yyyy, dùng chung Mini App và web; giá trị gửi API vẫn là "yyyy-mm-dd". */

export const DOB_PLACEHOLDER = 'dd/mm/yyyy';

export const DOB_ERRORS = {
  incomplete: 'Nhập đủ ngày/tháng/năm, ngày và tháng gõ 2 số, ví dụ 05/03/1990.',
  notReal: 'Ngày này không có thật. Kiểm tra lại ngày và tháng nhé.',
  future: 'Ngày sinh không thể ở tương lai. Kiểm tra lại năm nhé.',
  tooOld: 'Năm sinh chưa hợp lý. Kiểm tra lại năm nhé.',
} as const;

const MIN_YEAR = 1900;

/** Vị trí khác đầu tiên và số ký tự khách chèn vào so với `prev` (bỏ phần đầu và đuôi giống nhau). */
function diffFrom(raw: string, prev: string): { start: number; inserted: number } {
  let p = 0;
  while (p < raw.length && p < prev.length && raw[p] === prev[p]) p++;
  let q = 0;
  while (q < raw.length - p && q < prev.length - p && raw[raw.length - 1 - q] === prev[prev.length - 1 - q]) q++;
  return { start: p, inserted: raw.length - p - q };
}

const pad2 = (x: string) => (x.length === 1 ? `0${x}` : x);

/** Tách phần chữ số liền nhau cuối cùng thành ngày/tháng 2 số, phần dư sang ô sau. */
function splitOverflow(parts: string[]): string[] {
  const out = [...parts];
  while (out.length < 3 && out[out.length - 1]!.length > 2) {
    const last = out.pop()!;
    out.push(last.slice(0, 2), last.slice(2));
  }
  return out;
}

/** Thay cả ô (ô đang trống, dán, trình duyệt tự điền): chuẩn hoá toàn bộ về dd/mm/yyyy, tối đa 8 số. */
function normalizeAll(t: string): string {
  const s = t.replace(/\/+/g, '/').replace(/^\//, '');
  if (!s.includes('/')) return splitOverflow([s.slice(0, 8)]).join('/');
  const iso = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\/?$/.exec(s);
  if (iso) return `${pad2(iso[3]!)}/${pad2(iso[2]!)}/${iso[1]}`;
  const parts = s.split('/');
  const trailing = parts[parts.length - 1] === '';
  if (trailing) parts.pop();
  if (parts.length > 3) return parts.join('/');
  return parts.map((x, i) => (i === 2 ? x.slice(0, 4) : i < parts.length - 1 || trailing ? pad2(x) : x)).join('/');
}

/** Gõ thêm đúng một ký tự ở cuối ô. Dấu ngăn vừa gõ không hiện, chỉ đệm số 0 cho ngày/tháng 1 số; "/" hiện khi gõ số kế tiếp. */
function appendOne(t: string, prev: string): string {
  if (t.length === prev.length) return prev;
  if (t.endsWith('/')) {
    if (prev.endsWith('/')) return prev;
    const parts = t.slice(0, -1).split('/');
    const i = parts.length - 1;
    if (i >= 2) return prev;
    parts[i] = pad2(parts[i]!);
    return parts.join('/');
  }
  const parts = t.split('/');
  if (parts.length > 3) return t;
  const out = splitOverflow(parts);
  if (out.length === 3 && out[2]!.length > 4) return prev;
  return out.join('/');
}

/**
 * Ô ngày sinh gõ tay. ".", "-", khoảng trắng như "/"; bỏ ký tự lạ. `prev` là giá trị ô trước khi sửa.
 * - Ô đang trống, dán hoặc tự điền (chèn từ 2 ký tự ở đầu ô, hoặc từ 6 ký tự): chuẩn hoá cả ô, "5.3.1990" thành "05/03/1990".
 * - Gõ thêm một ký tự ở cuối: tự thêm "/" và số 0.
 * - Mọi kiểu sửa khác (xoá, chèn hay bôi đen thay giữa ô): giữ nguyên như khách gõ, không dồn hay cắt chữ số;
 *   ô sai dạng thì lời lỗi `incomplete` chỉ cách sửa.
 */
export function maskDobInput(raw: string, prev?: string): string {
  const t = raw.replace(/[^\d./\-\s]/g, '').replace(/[.\-\s]/g, '/');
  if (prev === undefined || prev === '') return normalizeAll(t);
  const { start, inserted } = diffFrom(raw, prev);
  if (inserted >= 2 && (start === 0 || inserted >= 6)) return normalizeAll(t);
  if (raw.length === prev.length + 1 && raw.startsWith(prev)) return appendOne(t, prev);
  return t;
}

/** Trả `iso` khi ô có ngày hợp lệ; `error` nói rõ cần nhập lại gì. Ô trống không phải lỗi. `now` theo giờ máy khách. */
export function validateDobVn(text: string, now: Date = new Date()): { iso: string | null; error: string | null } {
  if (text === '') return { iso: null, error: null };
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!m) return { iso: null, error: DOB_ERRORS.incomplete };
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return { iso: null, error: DOB_ERRORS.notReal };
  }
  if (y < MIN_YEAR) return { iso: null, error: DOB_ERRORS.tooOld };
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (iso > today) return { iso: null, error: DOB_ERRORS.future };
  return { iso, error: null };
}
