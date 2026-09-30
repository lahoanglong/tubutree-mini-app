import { trackEvent } from './analytics';

/** Điểm vào luồng mua lại (spec §3.4). Tên event tự do ở server (@IsString) — không cần đổi DTO. */
export type ReorderSource = 'home_rail' | 'order_card' | 'order_detail' | 'notification' | 'orders_tab';

export function trackReorderClicked(p: { source: ReorderSource; orderCode?: string; variationId?: string }): void {
  trackEvent('reorder_clicked', 'miniapp', { ...p });
}

export function trackReorderCompleted(p: { source: ReorderSource; added: number; skipped: number }): void {
  trackEvent('reorder_completed', 'miniapp', { ...p });
}

export function trackReorderReminderCta(notificationId: string): void {
  trackEvent('reorder_reminder_cta', 'miniapp', { notificationId }, { notificationId });
}
