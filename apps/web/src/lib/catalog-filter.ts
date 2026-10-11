/** Giới hạn của GET /products?q= phía API (SEARCH_Q_MAX_LENGTH): dài hơn bị 400 và trang chủ hiện rỗng. */
export const SEARCH_MAX_LENGTH = 100;

/** Next đưa tham số lặp (?q=a&q=b) vào searchParams dưới dạng mảng dù kiểu khai báo là string. */
export function firstParam(v: string | string[] | null | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : (v ?? undefined);
}

export function normalizeSearchQuery(raw: string | string[] | null | undefined): string {
  return (firstParam(raw) ?? '').replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_LENGTH).trim();
}

/** Đường dẫn trang chủ kèm bộ lọc; không có bộ lọc nào thì về `/` (không neo). */
export function homeHref(filter: { brand?: string; q?: string }): string {
  const params = new URLSearchParams();
  if (filter.brand) params.set('brand', filter.brand);
  const q = normalizeSearchQuery(filter.q);
  if (q) params.set('q', q);
  const qs = params.toString();
  return qs ? `/?${qs}#san-pham` : '/';
}
