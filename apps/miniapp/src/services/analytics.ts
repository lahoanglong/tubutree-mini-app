import type { ClientEventName } from '@tubutree/shared-types';
import { api } from './api';
import { getSessionAttribution, sessionEntrySource } from '../utils/entry-source';

interface QueuedEvent {
  eventId: string;
  eventName: ClientEventName;
  occurredAt: string;
  platform: 'miniapp';
  props: Record<string, unknown>;
  entrySource?: string;
  campaign?: string;
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
  eventName: ClientEventName,
  platform: 'miniapp',
  props: Record<string, unknown>,
  extra?: Partial<Pick<QueuedEvent, 'entrySource' | 'notificationId' | 'refCode' | 'storefrontSlug'>>,
): void {
  // Nguồn của phiên (link/QR/thẻ mở app) đi kèm MỌI sự kiện để báo cáo cắt được theo kênh; nơi gọi truyền `extra` thì ưu tiên.
  const campaign = getSessionAttribution()?.campaign;
  queue.push({
    eventId: newEventId(),
    eventName,
    occurredAt: new Date().toISOString(),
    platform,
    props,
    entrySource: sessionEntrySource(),
    ...(campaign ? { campaign } : {}),
    ...extra,
  });
  if (queue.length >= MAX_BATCH) void flushEventQueue();
  ensureTimer();
}

/** Phát đúng một lần lúc mở app: kèm mã giới thiệu (`?ref=`) và `utm_medium` của link, để đếm lượt mở theo link. */
export function trackAppOpened(): void {
  const launch = getSessionAttribution();
  trackEvent(
    'app_opened',
    'miniapp',
    launch?.medium ? { medium: launch.medium } : {},
    launch?.refCode ? { refCode: launch.refCode } : undefined,
  );
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
