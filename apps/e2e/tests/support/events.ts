import type { Page } from '@playwright/test';
import type { MockApi } from './mock-api';

/**
 * Giúp các spec kiểm tra sự kiện analytics (POST /events) — dùng chung cho buy-flow-4a và buy-flow-4b.
 * Cần `api.post('/events', ...)` đã đăng ký thì các lô mới được ghi lại trong `api.callsTo`.
 */

/** Hàng đợi sự kiện chỉ xả khi app bị ẩn (hoặc mỗi 10s) — ép xả để các lô /events tới mock ngay. */
export async function flushEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

export interface RecordedEvent {
  eventName: string;
  props: Record<string, unknown>;
  notificationId?: string;
}

/** Mọi sự kiện analytics đã tới mock (cần `api.post('/events', ...)`) có tên `eventName`. */
export function eventsNamed(api: MockApi, eventName: string): RecordedEvent[] {
  return api
    .callsTo('POST', '/events')
    .flatMap((c) => (c.body as { events: RecordedEvent[] }).events)
    .filter((e) => e.eventName === eventName);
}
