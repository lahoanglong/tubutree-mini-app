import { api } from './api';

interface QueuedEvent {
  eventId: string;
  eventName: string;
  occurredAt: string;
  platform: 'miniapp';
  props: Record<string, unknown>;
  entrySource?: string;
  notificationId?: string;
  refCode?: string;
  storefrontSlug?: string;
}

const MAX_BATCH = 50;
const FLUSH_INTERVAL_MS = 10_000;
let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

function newEventId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function trackEvent(
  eventName: string,
  platform: 'miniapp',
  props: Record<string, unknown>,
  extra?: Partial<Pick<QueuedEvent, 'entrySource' | 'notificationId' | 'refCode' | 'storefrontSlug'>>,
): void {
  queue.push({
    eventId: newEventId(),
    eventName,
    occurredAt: new Date().toISOString(),
    platform,
    props,
    ...extra,
  });
  if (queue.length >= MAX_BATCH) void flushEventQueue();
  ensureTimer();
}

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(() => void flushEventQueue(), FLUSH_INTERVAL_MS);
}

export async function flushEventQueue(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    await api.post('/events', { events: batch });
  } catch {
    // best-effort — không throw, không dồn lại vô hạn (tránh rò rỉ bộ nhớ nếu mất mạng dài hạn);
    // chấp nhận mất lô này, đúng bản chất "best-effort" của sự kiện không phải tiền.
  }
}

export function flushEventQueueOnHide(): void {
  if (queue.length === 0) return;
  // Lấy batch ra khỏi queue MỘT LẦN rồi giữ biến cục bộ — KHÔNG được gọi flushEventQueue() ở
  // nhánh dự phòng bên dưới vì queue module-level đã rỗng ngay sau splice() này (phát hiện ở
  // review Task 17: gọi lại flushEventQueue() sau khi đã splice queue rỗng khiến nhánh dự
  // phòng — chính xác lúc sendBeacon thất bại/không có — là no-op câm lặng, mất trắng dữ liệu).
  const batch = queue.splice(0, MAX_BATCH);
  const body = JSON.stringify({ events: batch });
  if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
    const ok = navigator.sendBeacon('/api/events', body);
    if (ok) return;
  }
  // sendBeacon không khả dụng hoặc thất bại — gửi lại bằng chính `batch` đã lấy ra ở trên qua
  // fetch thường (best-effort, không throw).
  void api.post('/events', { events: batch }).catch(() => {});
}

export function __resetQueueForTest(): void {
  queue = [];
  if (timer) clearInterval(timer);
  timer = null;
}
