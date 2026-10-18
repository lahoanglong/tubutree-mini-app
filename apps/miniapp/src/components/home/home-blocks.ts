import axios from 'axios';
import type { QueryClient } from '@tanstack/react-query';
import { resetHomeFeed } from '../../services/home-feed';

export type HomeBlockId =
  | 'search' | 'purchased' | 'orderStrip' | 'flash' | 'forYou' | 'bestSellers'
  | 'categories' | 'recentlyViewed' | 'featured' | 'newArrivals' | 'extras' | 'welcome';

export type HomeCustomerKind = 'returning' | 'new';

const RETURNING: readonly HomeBlockId[] = [
  'search', 'purchased', 'orderStrip', 'flash', 'forYou', 'bestSellers', 'categories', 'recentlyViewed', 'featured', 'newArrivals', 'extras',
];
// Ô 'purchased' + 'orderStrip' giữ đúng vị trí 2–3 ở CẢ hai thứ tự: chúng tự rỗng với khách mới, và
// khi purchased-items trả về thì trang không xếp lại phần đầu (guard skeleton kệ Mua lại của 4a).
// "Quà khách mới" ('welcome', chỉ khách mới) đứng sau Danh mục: thứ tự cũ của các khối còn lại giữ nguyên và lưới SP
// đầu tiên (Bán chạy) vẫn là khối thứ 5.
const NEW: readonly HomeBlockId[] = [
  'search', 'purchased', 'orderStrip', 'flash', 'bestSellers', 'categories', 'welcome', 'forYou', 'recentlyViewed', 'featured', 'newArrivals', 'extras',
];
// Bố cục chủ dự án chưa chốt (cờ home.new_customer_layout, D7 việc 1): Quà khách mới + Danh mục lên trước giờ vàng.
// 'purchased'/'orderStrip' tự rỗng với khách mới nên Quà khách mới vẫn là khối đầu tiên người ta thấy sau ô tìm.
const NEW_LAYOUT: readonly HomeBlockId[] = [
  'search', 'purchased', 'orderStrip', 'welcome', 'categories', 'flash', 'bestSellers', 'forYou', 'recentlyViewed', 'featured', 'newArrivals', 'extras',
];

/**
 * Thứ tự khối Trang chủ (spec 5b.1). Đầu trang (logo, chuông, giỏ) là khung trang, không tính.
 * `newCustomerLayout` (cờ cấu hình, mặc định tắt) chỉ đổi thứ tự của khách mới.
 */
export function homeBlockOrder(kind: HomeCustomerKind, newCustomerLayout = false): readonly HomeBlockId[] {
  if (kind === 'returning') return RETURNING;
  return newCustomerLayout ? NEW_LAYOUT : NEW;
}

/** Khách cũ = đã nhận ≥1 SP (kệ Mua lại có hàng). Đang tải / API cũ 404 → coi là khách mới. */
export function customerKind(purchasedCount: number | undefined): HomeCustomerKind {
  return (purchasedCount ?? 0) > 0 ? 'returning' : 'new';
}

export const HOME_GRID_BLOCKS: readonly HomeBlockId[] = ['forYou', 'bestSellers', 'featured', 'newArrivals'];

/** Mọi tiền tố query mà Trang chủ hiển thị — kéo để làm mới phải làm mới ĐỦ (A2-33). */
export const HOME_QUERY_PREFIXES = [
  'products', 'for-you', 'flash-sales', 'purchased-items', 'orders', 'subscriptions', 'categories', 'brands', 'cart', 'notifications',
  'new-customer-offer',
] as const;

export function refreshHomeQueries(qc: QueryClient): Promise<unknown> {
  // Các khối gộp đã dùng ở lần mở đầu; không reset thì làm mới phải bắn ~10 request lẻ.
  resetHomeFeed();
  return Promise.all(HOME_QUERY_PREFIXES.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

/** API cũ chưa có endpoint (404): khối tuỳ chọn như kệ "Mua lại" ẩn đi thay vì báo lỗi mà bấm "Thử lại" cũng không khỏi. */
export function isEndpointMissing(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

export function dedupeAgainst<T extends { id: string }>(items: T[], seen: ReadonlySet<string>): T[] {
  return items.filter((p) => !seen.has(p.id));
}
