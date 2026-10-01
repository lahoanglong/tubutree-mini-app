import type { QueryClient } from '@tanstack/react-query';

export type HomeBlockId =
  | 'search' | 'purchased' | 'orderStrip' | 'flash' | 'forYou' | 'bestSellers'
  | 'categories' | 'recentlyViewed' | 'featured' | 'newArrivals' | 'extras';

export type HomeCustomerKind = 'returning' | 'new';

const RETURNING: readonly HomeBlockId[] = [
  'search', 'purchased', 'orderStrip', 'flash', 'forYou', 'bestSellers', 'categories', 'recentlyViewed', 'featured', 'newArrivals', 'extras',
];
// Ô 'purchased' + 'orderStrip' giữ đúng vị trí 2–3 ở CẢ hai thứ tự: chúng tự rỗng với khách mới, và
// khi purchased-items trả về thì trang không xếp lại phần đầu (guard skeleton kệ Mua lại của 4a).
const NEW: readonly HomeBlockId[] = [
  'search', 'purchased', 'orderStrip', 'flash', 'bestSellers', 'categories', 'forYou', 'recentlyViewed', 'featured', 'newArrivals', 'extras',
];

/** Thứ tự khối Trang chủ (spec 5b.1). Đầu trang (logo, chuông, giỏ) là khung trang, không tính. */
export function homeBlockOrder(kind: HomeCustomerKind): readonly HomeBlockId[] {
  return kind === 'returning' ? RETURNING : NEW;
}

/** Khách cũ = đã nhận ≥1 SP (kệ Mua lại có hàng). Đang tải / API cũ 404 → coi là khách mới. */
export function customerKind(purchasedCount: number | undefined): HomeCustomerKind {
  return (purchasedCount ?? 0) > 0 ? 'returning' : 'new';
}

export const HOME_GRID_BLOCKS: readonly HomeBlockId[] = ['forYou', 'bestSellers', 'featured', 'newArrivals'];

/** Mọi tiền tố query mà Trang chủ hiển thị — kéo để làm mới phải làm mới ĐỦ (A2-33). */
export const HOME_QUERY_PREFIXES = [
  'products', 'for-you', 'flash-sales', 'purchased-items', 'orders', 'subscriptions', 'categories', 'brands', 'cart', 'notifications',
] as const;

export function refreshHomeQueries(qc: QueryClient): Promise<unknown> {
  return Promise.all(HOME_QUERY_PREFIXES.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function dedupeAgainst<T extends { id: string }>(items: T[], seen: ReadonlySet<string>): T[] {
  return items.filter((p) => !seen.has(p.id));
}
