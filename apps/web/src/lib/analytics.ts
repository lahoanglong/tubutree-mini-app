'use client';

import type { ClientEventName } from '@tubutree/shared-types';
import { apiFetch, hasSessionMarker } from './client-api';
import { readFirstTouchCookie } from './entry-source';

interface QueuedEvent {
  eventId: string;
  eventName: ClientEventName;
  occurredAt: string;
  platform: 'web';
  props: Record<string, unknown>;
  entrySource?: string;
  campaign?: string;
}

const MAX_BATCH = 50;
const MAX_QUEUE = 100;
const FLUSH_INTERVAL_MS = 5_000;
let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let hideListenerAdded = false;

function newEventId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Sự kiện analytics của web (best-effort, chỉ tên trong CLIENT_EVENT_NAMES). `/events` đòi JWT, nên khách chưa có phiên thì sự kiện
 * nằm chờ trong hàng đợi (tối đa MAX_QUEUE, bỏ cái cũ nhất) và chỉ gửi khi đã có phiên; tải lại trang mất hàng đợi, chấp nhận.
 */
export function trackWebEvent(eventName: ClientEventName, props: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const touch = readFirstTouchCookie();
  queue.push({
    eventId: newEventId(),
    eventName,
    occurredAt: new Date().toISOString(),
    platform: 'web',
    props,
    ...(touch?.source ? { entrySource: touch.source } : {}),
    ...(touch?.campaign ? { campaign: touch.campaign } : {}),
  });
  if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE);
  if (queue.length >= MAX_BATCH) void flushWebEvents();
  schedule();
}

function schedule(): void {
  if (!hideListenerAdded && typeof document !== 'undefined') {
    hideListenerAdded = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flushWebEvents();
    });
  }
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushWebEvents();
  }, FLUSH_INTERVAL_MS);
}

export async function flushWebEvents(): Promise<void> {
  // Mọi thứ nằm trong try: analytics không bao giờ được làm hỏng màn hình hay tạo promise bị từ chối không ai bắt.
  try {
    if (queue.length === 0 || !hasSessionMarker()) return;
    const batch = queue.splice(0, MAX_BATCH);
    try {
      await apiFetch('/events', { method: 'POST', body: { events: batch } });
    } catch {
      // Best-effort như Mini App: mất lô này, không dồn lại để khỏi rò bộ nhớ khi mất mạng dài.
    }
    if (queue.length > 0) schedule();
  } catch {
    // hasSessionMarker/apiFetch không dùng được (môi trường lạ): bỏ qua.
  }
}

export function __resetWebEventsForTest(): void {
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
}
