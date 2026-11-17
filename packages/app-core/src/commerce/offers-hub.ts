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

/** `?codes=all` ở Săn mã: khối Nhận mã mở sẵn cả kho mã (thay trang Mã giảm giá cũ) và trang cuộn tới khối. */
export const OFFERS_CODES_PARAM = 'codes';
export const OFFERS_CODES_ALL = 'all';
/** `?history=1` ở Mã của tôi: mục "Mã đã dùng, hết hạn" mở sẵn. */
export const OFFERS_HISTORY_PARAM = 'history';
export const OFFERS_HISTORY_OPEN = '1';

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

/** Khối Nhận mã mở sẵn cả kho: chỉ đúng giá trị `all`, giá trị lạ coi như không có. */
export function offersCodesOpen(codes: string | null | undefined): boolean {
  return codes === OFFERS_CODES_ALL;
}

/** Mục lịch sử mã mở sẵn: chỉ đúng giá trị `1`. */
export function offersHistoryOpen(history: string | null | undefined): boolean {
  return history === OFFERS_HISTORY_OPEN;
}

/**
 * Ghép đích chuyển hướng: các tham số `head` đứng đầu theo thứ tự khai, rồi mọi tham số khác của đường cũ (`code=X`, `utm_*`) theo thứ tự gốc.
 * Bỏ `tab` cũ (nghĩa của nó đã đổi sang `head`) và khoá trùng với `head` (đích thắng).
 */
function withLegacyParams(base: string, head: readonly [string, string][], search: string): string {
  const out = new URLSearchParams(head as [string, string][]);
  // Chỉ khoá do đích tự đặt mới thắng tham số cũ; tham số lặp của link cũ (utm_source=a&utm_source=b) giữ đủ.
  const owned = new Set(['tab', ...head.map(([key]) => key)]);
  for (const [key, value] of new URLSearchParams(search)) {
    if (owned.has(key)) continue;
    out.append(key, value);
  }
  return `${base}?${out.toString()}`;
}

/**
 * Đích của trang Mã giảm giá cũ (`/vouchers` ở Mini App, `/ma-giam-gia` ở web): link trong thông báo, ZNS đã gửi, chiến dịch cũ vẫn tới đúng chỗ.
 * Tab Nhận mã (hoặc không có tab, hoặc tab lạ) → Săn mã kèm cả kho mở; Mã của tôi → ví; Đã dùng–hết hạn → ví kèm lịch sử mở.
 * `search` là chuỗi truy vấn có hoặc không có dấu `?` đầu.
 */
export function legacyVouchersTarget(base: string, search: string): string {
  const tab = new URLSearchParams(search).get('tab');
  if (tab === 'mine') return withLegacyParams(base, [['tab', 'wallet']], search);
  if (tab === 'history') return withLegacyParams(base, [['tab', 'wallet'], [OFFERS_HISTORY_PARAM, OFFERS_HISTORY_OPEN]], search);
  return withLegacyParams(base, [['tab', 'deals'], [OFFERS_CODES_PARAM, OFFERS_CODES_ALL]], search);
}

/** Đích của Kho quà cũ của Mini App (`/rewards`): tab Đổi quà của hub, giữ các tham số khác. */
export function legacyRewardsTarget(base: string, search: string): string {
  return withLegacyParams(base, [['tab', 'rewards']], search);
}
