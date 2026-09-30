import type { PurchasedItem } from '../../services/shop-api';

export type ReorderReminderAction = { kind: 'sheet'; item: PurchasedItem } | { kind: 'navigate'; to: string };

/** Đích khi không mở được sheet: trang sản phẩm nếu payload có slug, không thì tab Đơn hàng. */
export function reminderFallbackPath(data?: Record<string, string>): string {
  const slug = data?.product_slug ?? data?.productSlug;
  return slug ? `/product/${encodeURIComponent(String(slug))}` : '/orders';
}

/**
 * CTA "Mua lại ngay" của REORDER_REMINDER (spec 4a.4): mở ReorderSheet đúng variation trong payload
 * khi khách còn mua được nó (có trong purchased-items và còn hàng); còn lại điều hướng dự phòng.
 */
export function reorderReminderAction(data: Record<string, string> | undefined, item: PurchasedItem | null): ReorderReminderAction {
  if (item && item.inStock) return { kind: 'sheet', item };
  return { kind: 'navigate', to: reminderFallbackPath(data) };
}

/** Chọn đúng dòng của variation trong payload từ kết quả purchased-items — KHÔNG lấy phần tử đầu:
 * API cũ/lệch phiên có thể bỏ qua bộ lọc `variationId` và trả SP khác (sheet sẽ hiện nhầm SP). */
export function pickReminderItem(items: PurchasedItem[], variationId: string | undefined): PurchasedItem | null {
  if (!variationId) return null;
  return items.find((i) => i.variationId === variationId) ?? null;
}
