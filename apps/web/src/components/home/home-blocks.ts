import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/client-api';

// Thứ tự khối và loại khách dùng chung với Mini App: xem packages/app-core/src/home-layout.ts.
export { customerKind, homeBlockOrder, resolveHomeKind } from '@tubutree/app-core/home-layout';
export type { HomeBlockId, HomeCustomerKind, HomeKindState } from '@tubutree/app-core/home-layout';

/** Mọi tiền tố query mà Trang chủ hiển thị: kéo để làm mới phải làm mới ĐỦ (A2-33). */
export const HOME_QUERY_PREFIXES = [
  'products', 'for-you', 'flash-sales', 'purchased-items', 'orders', 'subscriptions', 'categories', 'brands', 'cart', 'notifications',
  'new-customer-offer', 'loyalty', 'loyalty-checkin', 'coupons', 'community', 'recycle-open-request-count',
] as const;

export function refreshHomeQueries(qc: QueryClient): Promise<unknown> {
  return Promise.all(HOME_QUERY_PREFIXES.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

/** API cũ chưa có endpoint (404): khối tuỳ chọn ẩn đi thay vì báo lỗi mà bấm "Thử lại" cũng không khỏi. */
export function isEndpointMissing(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function dedupeAgainst<T extends { id: string }>(items: T[], seen: ReadonlySet<string>): T[] {
  return items.filter((p) => !seen.has(p.id));
}
