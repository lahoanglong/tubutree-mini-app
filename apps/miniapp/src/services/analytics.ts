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
  // sendBeacon KHÔNG dùng được ở đây: endpoint /events yêu cầu JWT Bearer token, mà
  // navigator.sendBeacon() không cho gắn header tuỳ ý (không thể gửi Authorization) — mọi lần
  // gọi sendBeacon tới endpoint này sẽ luôn bị BE từ chối 401 (phát hiện ở review cuối). Dùng
  // THẲNG api.post (đã có Authorization qua interceptor), lặp tới khi rỗng để không bỏ sót nếu
  // hàng đợi đang có hơn MAX_BATCH sự kiện lúc trang bị ẩn.
  while (queue.length > 0) {
    void flushEventQueue();
  }
}

export function __resetQueueForTest(): void {
  queue = [];
  if (timer) clearInterval(timer);
  timer = null;
}
