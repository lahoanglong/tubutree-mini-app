import { trackEvent } from './analytics';

/** Sự kiện khám phá & tìm kiếm (spec §3.4). Tên event tự do ở server (@IsString) — không cần đổi DTO. */
export type FilterType = 'price' | 'in_stock' | 'brand' | 'rating';
export type SearchClickSource = 'results' | 'suggest';

export function trackSearchPerformed(p: { q: string; resultsCount: number }): void {
  trackEvent('search_performed', 'miniapp', { ...p });
}

export function trackSearchResultClicked(p: { q: string; position: number; source: SearchClickSource; slug: string }): void {
  trackEvent('search_result_clicked', 'miniapp', { ...p });
}

export function trackFilterApplied(type: FilterType): void {
  trackEvent('filter_applied', 'miniapp', { type });
}
