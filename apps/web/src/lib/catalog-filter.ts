/** Giới hạn của GET /products?q= phía API (SEARCH_Q_MAX_LENGTH): dài hơn bị 400 và trang chủ hiện rỗng. */
export const SEARCH_MAX_LENGTH = 100;

export function normalizeSearchQuery(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_LENGTH).trim();
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
