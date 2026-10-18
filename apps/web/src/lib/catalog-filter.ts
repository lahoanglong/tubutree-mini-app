/** Giới hạn của GET /products?q= phía API (SEARCH_Q_MAX_LENGTH): dài hơn bị 400 và trang chủ hiện rỗng. */
export const SEARCH_MAX_LENGTH = 100;

/** Next đưa tham số lặp (?q=a&q=b) vào searchParams dưới dạng mảng dù kiểu khai báo là string. */
export function firstParam(v: string | string[] | null | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : (v ?? undefined);
}

export function normalizeSearchQuery(raw: string | string[] | null | undefined): string {
  return (firstParam(raw) ?? '').replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_LENGTH).trim();
}

/** Số trang tối đa nhận từ URL — chặn ?page=99999999 làm API tính offset khổng lồ. */
const MAX_PAGE = 1000;

/** ?page= về số nguyên ≥ 1; thiếu/hỏng/âm/thập phân → 1. */
export function parsePage(raw: string | string[] | null | undefined): number {
  const v = firstParam(raw);
  if (!v || !/^\d{1,6}$/.test(v)) return 1;
  return Math.min(Math.max(parseInt(v, 10), 1), MAX_PAGE);
}

/** Đường dẫn trang chủ kèm bộ lọc; không có bộ lọc nào thì về `/` (không neo). Trang 1 không ghi ?page=. */
export function homeHref(filter: { brand?: string; category?: string; q?: string; page?: number }): string {
  const params = new URLSearchParams();
  if (filter.brand) params.set('brand', filter.brand);
  if (filter.category) params.set('category', filter.category);
  const q = normalizeSearchQuery(filter.q);
  if (q) params.set('q', q);
  if (filter.page && filter.page > 1) params.set('page', String(Math.floor(filter.page)));
  const qs = params.toString();
  return qs ? `/?${qs}#san-pham` : '/';
}

/** Liên kết phân trang: luôn neo #san-pham để bấm sang trang khác không nhảy về đầu trang chủ. */
export function pageHref(filter: { brand?: string; category?: string; q?: string }, page: number): string {
  const href = homeHref({ ...filter, page });
  return href.includes('#') ? href : `${href}#san-pham`;
}

/** Các mục của thanh phân trang: số trang, hoặc 'gap' cho dấu "…" (luôn có trang đầu, cuối và 1 trang kề hai bên trang hiện tại). */
export function pageItems(current: number, totalPages: number): (number | 'gap')[] {
  const wanted = new Set([1, totalPages, current - 1, current, current + 1]);
  const pages = [...wanted].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const items: (number | 'gap')[] = [];
  pages.forEach((n, i) => {
    if (i > 0 && n - pages[i - 1]! > 1) items.push('gap');
    items.push(n);
  });
  return items;
}
