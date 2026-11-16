import type { CheckoutEntry, ClientEventName } from '@tubutree/shared-types';
import { api } from './api';
import { getSessionAttribution, sessionEntrySource } from '../utils/entry-source';

interface QueuedEvent {
  eventId: string;
  eventName: ClientEventName;
  occurredAt: string;
  platform: 'miniapp';
  sessionId: string;
  props: Record<string, unknown>;
  entrySource?: string;
  campaign?: string;
  notificationId?: string;
  refCode?: string;
  storefrontSlug?: string;
}

const MAX_BATCH = 50;
const FLUSH_INTERVAL_MS = 10_000;
export const SESSION_IDLE_MS = 30 * 60_000;
let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let sid = '';
let lastAt = 0;
let checkoutEntry: CheckoutEntry = 'unknown';

// Máy chủ chỉ nhận eventId/sessionId dạng UUID: máy cũ không có randomUUID vẫn phải ra chuỗi dạng UUID v4.
function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (+c ^ ((Math.random() * 16) >> (+c / 4))).toString(16));
}

/** Mã phiên chỉ trong bộ nhớ: 30 phút không có sự kiện nào thì sang mã mới. Đọc mã không gia hạn phiên, chỉ `trackEvent` gia hạn. */
export function getSessionId(): string {
  const now = Date.now();
  if (!sid || now - lastAt >= SESSION_IDLE_MS) {
    sid = newId();
    lastAt = now;
  }
  return sid;
}

/** Nơi khách bấm vào thanh toán, ghi ngay trước khi chuyển sang trang thanh toán; `checkout_started` lấy ra đúng một lần. */
export function setCheckoutEntry(entry: CheckoutEntry): void {
  checkoutEntry = entry;
}

export function takeCheckoutEntry(): CheckoutEntry {
  const entry = checkoutEntry;
  checkoutEntry = 'unknown';
  return entry;
}

export function trackEvent(
  eventName: ClientEventName,
  platform: 'miniapp',
  props: Record<string, unknown>,
  extra?: Partial<Pick<QueuedEvent, 'entrySource' | 'notificationId' | 'refCode' | 'storefrontSlug'>>,
): void {
  // Nguồn của phiên (link/QR/thẻ mở app) đi kèm MỌI sự kiện để báo cáo cắt được theo kênh; nơi gọi truyền `extra` thì ưu tiên.
  const campaign = getSessionAttribution()?.campaign;
  const sessionId = getSessionId();
  lastAt = Date.now();
  queue.push({
    eventId: newId(),
    eventName,
    occurredAt: new Date().toISOString(),
    platform,
    sessionId,
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
  sid = '';
  checkoutEntry = 'unknown';
  if (timer) clearInterval(timer);
  timer = null;
}
