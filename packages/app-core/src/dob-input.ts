/** Ô ngày sinh nhập tay dd/mm/yyyy, dùng chung Mini App và web; giá trị gửi API vẫn là "yyyy-mm-dd". */

export const DOB_PLACEHOLDER = 'dd/mm/yyyy';

export const DOB_ERRORS = {
  incomplete: 'Nhập đủ ngày/tháng/năm, ngày và tháng gõ 2 số, ví dụ 05/03/1990.',
  notReal: 'Ngày này không có thật. Kiểm tra lại ngày và tháng nhé.',
  future: 'Ngày sinh không thể ở tương lai. Kiểm tra lại năm nhé.',
  tooOld: 'Năm sinh chưa hợp lý. Kiểm tra lại năm nhé.',
} as const;

const MIN_YEAR = 1900;

/**
 * Gõ số liền nhau ("05031990") thành "05/03/1990"; ".", "-", khoảng trắng như "/"; bỏ ký tự lạ.
 * `prev` là giá trị ô trước khi sửa: chỉ gõ tiến (dấu ngăn vừa gõ ở cuối ô) hoặc dán cả chuỗi mới tự thêm số 0,
 * sửa giữa ô (xoá, chèn, bôi đen thay) giữ nguyên chữ số của phần khác.
 */
export function maskDobInput(raw: string, prev?: string): string {
  const s = raw.replace(/[^\d./\-\s]/g, '').replace(/[./\-\s]+/g, '/').replace(/^\//, '');
  if (!s.includes('/')) {
    const d = s.slice(0, 8);
    if (d.length <= 2) return d;
    if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
    return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  }
  const parts = s.split('/');
  const trailing = parts[parts.length - 1] === '';
  if (trailing) parts.pop();
  if (parts.length > 3) parts.splice(2, parts.length - 2, parts.slice(2).join(''));
  const pasted = prev === undefined || raw.length - prev.length > 1;
  const typedForward = trailing && raw.length > (prev?.length ?? 0);
  for (let i = 0; i < Math.min(parts.length, 2); i++) {
    if (parts[i]!.length !== 1) continue;
    const last = i === parts.length - 1;
    if (pasted ? !last || trailing : last && typedForward) parts[i] = `0${parts[i]}`;
  }
  const appended = prev !== undefined && !pasted && raw.length > prev.length && raw.startsWith(prev);
  if (appended && parts.length === 2 && parts[0]!.length === 2 && parts[1]!.length > 2) {
    parts.push(parts[1]!.slice(2));
    parts[1] = parts[1]!.slice(0, 2);
  }
  if (parts.length === 3) parts[2] = parts[2]!.slice(0, 4);
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
