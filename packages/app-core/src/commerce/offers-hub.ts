import { fillCopy } from '../shop-copy';

/**
 * Trung tâm Ưu đãi: một trang (`/offers` ở Mini App, `/uu-dai` ở web) chia ba phân mục đổi ngay tại chỗ bằng `?tab=`.
 * Đổi tab dùng replace (không làm dơ lịch sử). Link cũ vẫn mở đúng chỗ: `?section=coupons` (Mã của tôi) → `wallet`.
 */
export type OffersTab = 'deals' | 'wallet' | 'rewards';

export const DEFAULT_OFFERS_TAB: OffersTab = 'deals';

export const OFFERS_TABS: readonly { key: OffersTab; label: string }[] = [
  { key: 'deals', label: fillCopy('offers.tabDeals') },
  { key: 'wallet', label: fillCopy('offers.tabWallet') },
  { key: 'rewards', label: fillCopy('offers.tabRewards') },
];

const KEYS: readonly string[] = OFFERS_TABS.map((t) => t.key);

/** `tab` hợp lệ thắng; không có thì `section=coupons` (link cũ) mở Mã của tôi; còn lại về Săn mã. */
export function parseOffersTab(tab: string | null | undefined, section?: string | null): OffersTab {
  if (tab && KEYS.includes(tab)) return tab as OffersTab;
  if (section === 'coupons') return 'wallet';
  return DEFAULT_OFFERS_TAB;
}

/** Đường dẫn tới một phân mục; tab mặc định không kèm tham số để link chia sẻ gọn. */
export function offersTabHref(basePath: string, tab: OffersTab): string {
  return tab === DEFAULT_OFFERS_TAB ? basePath : `${basePath}?tab=${tab}`;
}
