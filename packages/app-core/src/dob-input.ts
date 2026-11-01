/** Ô ngày sinh nhập tay dd/mm/yyyy, dùng chung Mini App và web; giá trị gửi API vẫn là "yyyy-mm-dd". */

export const DOB_PLACEHOLDER = 'dd/mm/yyyy';

export const DOB_ERRORS = {
  incomplete: 'Nhập đủ ngày/tháng/năm, ngày và tháng gõ 2 số, ví dụ 05/03/1990.',
  notReal: 'Ngày này không có thật. Kiểm tra lại ngày và tháng nhé.',
  future: 'Ngày sinh không thể ở tương lai. Kiểm tra lại năm nhé.',
  tooOld: 'Năm sinh chưa hợp lý. Kiểm tra lại năm nhé.',
} as const;

const MIN_YEAR = 1900;

/** Gõ số liền nhau ("05031990") thành "05/03/1990"; "5/" tự thành "05/"; bỏ ký tự lạ, tối đa 8 số. */
export function maskDobInput(raw: string): string {
  const d = raw
    .replace(/(^|\/)(\d)\//g, '$10$2/')
    .replace(/(^|\/)(\d)\//g, '$10$2/')
    .replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
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
