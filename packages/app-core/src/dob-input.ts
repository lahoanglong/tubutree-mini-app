/** Ô ngày sinh nhập tay dd/mm/yyyy, dùng chung Mini App và web; giá trị gửi API vẫn là "yyyy-mm-dd". */

export const DOB_PLACEHOLDER = 'dd/mm/yyyy';

export const DOB_ERRORS = {
  incomplete: 'Nhập đủ ngày/tháng/năm, ngày và tháng gõ 2 số, ví dụ 05/03/1990.',
  notReal: 'Ngày này không có thật. Kiểm tra lại ngày và tháng nhé.',
  future: 'Ngày sinh không thể ở tương lai. Kiểm tra lại năm nhé.',
  tooOld: 'Năm sinh chưa hợp lý. Kiểm tra lại năm nhé.',
} as const;

const MIN_YEAR = 1900;

/** Số ký tự khách chèn vào so với `prev` (bỏ phần đầu và đuôi giống nhau). */
function insertedLength(raw: string, prev: string): number {
  let p = 0;
  while (p < raw.length && p < prev.length && raw[p] === prev[p]) p++;
  let q = 0;
  while (q < raw.length - p && q < prev.length - p && raw[raw.length - 1 - q] === prev[prev.length - 1 - q]) q++;
  return raw.length - p - q;
}

/**
 * Gõ số liền nhau ("05031990") thành "05/03/1990"; ".", "-", khoảng trắng như "/"; bỏ ký tự lạ.
 * `prev` là giá trị ô trước khi sửa. Dán cả chuỗi (chèn từ 2 ký tự) và gõ tiến mới tự thêm số 0, chia lại số liền
 * nhau và cắt năm còn 4 số; sửa giữa ô (xoá, chèn, bôi đen thay 1 ký tự) giữ nguyên chữ số như khách gõ.
 */
export function maskDobInput(raw: string, prev?: string): string {
  const s = raw.replace(/[^\d./\-\s]/g, '').replace(/[./\-\s]+/g, '/').replace(/^\//, '');
  const pasted = prev === undefined || insertedLength(raw, prev) > 1;
  if (!s.includes('/')) {
    const d = s.slice(0, 8);
    if (prev !== undefined && !pasted && prev.includes('/')) return d;
    if (d.length <= 2) return d;
    if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
    return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  }
  const iso = pasted ? /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s) : null;
  if (iso) return `${iso[3]!.padStart(2, '0')}/${iso[2]!.padStart(2, '0')}/${iso[1]}`;
  const parts = s.split('/');
  const trailing = parts[parts.length - 1] === '';
  if (trailing) parts.pop();
  if (parts.length > 3) parts.splice(2, parts.length - 2, parts.slice(2).join(''));
  const appended = prev !== undefined && !pasted && raw.length > prev.length && raw.startsWith(prev);
  for (let i = 0; i < Math.min(parts.length, 2); i++) {
    if (parts[i]!.length !== 1) continue;
    const last = i === parts.length - 1;
    if (pasted ? !last || trailing : last && trailing && appended) parts[i] = `0${parts[i]}`;
  }
  if (appended && parts.length === 2 && parts[0]!.length === 2 && parts[1]!.length > 2) {
    parts.push(parts[1]!.slice(2));
    parts[1] = parts[1]!.slice(0, 2);
  }
  if (parts.length === 3 && (pasted || appended)) parts[2] = parts[2]!.slice(0, 4);
  return parts.join('/');
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
