export const CATALOG_LAUNCH_DATE_KEY = 'catalog.launch_date';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Rỗng (chưa đặt ngày) hoặc ngày YYYY-MM-DD có thật; còn lại trả lý do để từ chối lúc ghi. */
export function catalogLaunchDateProblem(value: unknown): string | null {
  if (value === '') return null;
  const m = typeof value === 'string' ? DATE_RE.exec(value) : null;
  if (!m) return 'phải để trống hoặc là ngày dạng YYYY-MM-DD (giờ Việt Nam), vd "2026-11-01"';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = new Date(Date.UTC(y, mo - 1, d));
  const real = utc.getUTCFullYear() === y && utc.getUTCMonth() === mo - 1 && utc.getUTCDate() === d;
  return real ? null : 'ngày không có thật, kiểm lại ngày và tháng';
}

/** Giá trị công khai cho client: ngày hợp lệ hoặc null (hỏng/rỗng thì coi như chưa đặt, client giữ luật 30 ngày). */
export function publicCatalogLaunchDate(value: unknown): string | null {
  return typeof value === 'string' && value !== '' && catalogLaunchDateProblem(value) === null ? value : null;
}
