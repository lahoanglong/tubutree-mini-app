import type { PurchasedItem } from '@tubutree/app-core/api/orders';

export type ReorderReminderAction = { kind: 'sheet'; item: PurchasedItem } | { kind: 'navigate'; to: string };

/**
 * CTA "Mua lại ngay" của REORDER_REMINDER: mở ReorderSheet đúng variation trong payload khi khách còn mua được nó
 * (có trong purchased-items và còn hàng); còn lại điều hướng tới đích dự phòng (đã đổi sang route web) của thông báo.
 */
export function reorderReminderAction(fallbackTo: string, item: PurchasedItem | null): ReorderReminderAction {
  if (item && item.inStock) return { kind: 'sheet', item };
  return { kind: 'navigate', to: fallbackTo };
}

/** Chọn đúng dòng của variation trong payload từ kết quả purchased-items — KHÔNG lấy phần tử đầu:
 * API cũ/lệch phiên có thể bỏ qua bộ lọc `variationId` và trả SP khác (sheet sẽ hiện nhầm SP). */
export function pickReminderItem(items: PurchasedItem[], variationId: string | undefined): PurchasedItem | null {
  if (!variationId) return null;
  return items.find((i) => i.variationId === variationId) ?? null;
}
