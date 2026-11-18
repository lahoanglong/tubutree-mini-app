'use client';

import {
  toRouteTemplate,
  type CheckoutEntry,
  type ClientEventName,
  type PurchaseEventName,
  type PurchaseEventProps,
} from '@tubutree/shared-types';
import { apiFetch } from './client-api';
import { readFirstTouchCookie } from './entry-source';
import { isPreviewPath } from './preview-frame-ancestors.mjs';

interface QueuedEvent {
  eventId: string;
  eventName: ClientEventName;
  occurredAt: string;
  platform: 'web';
  anonymousId: string;
  sessionId: string;
  props: Record<string, unknown>;
  entrySource?: string;
  campaign?: string;
}

export const MAX_BATCH = 20;
const MAX_QUEUE = 100;
const FLUSH_INTERVAL_MS = 5_000;
export const SESSION_IDLE_MS = 30 * 60_000;

export const ANON_ID_KEY = 'tubu_aid';
export const SESSION_KEY = 'tubu_sid';
const SEEN_KEY = 'tubu_seen';
const CHECKOUT_ENTRY_KEY = 'tubu_ck_entry';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api').replace(/\/+$/, '');
/** Gửi thường (fetch JSON, kèm Bearer nếu đang đăng nhập). */
const INGEST_PATH = '/events/web';
/** Gửi lúc rời trang: thân form `payload=<json>` là request "đơn giản" nên sendBeacon/keepalive đi được mà không cần preflight CORS. */
export const BEACON_URL = `${API_BASE}/events/web/beacon`;

/**
 * Route động của web (thư mục `[param]` trong `src/app`), dạng `/san-pham/:slug`. Sự kiện chỉ mang mẫu route, không mang slug/mã thật.
 * `analytics.spec.ts` quét `src/app` và đỏ khi thiếu một route động.
 */
export const WEB_DYNAMIC_ROUTES = [
  '/brand/:slug',
  '/chien-dich/:slug',
  '/chinh-sach/:loai',
  '/cong-dong/:id',
  '/doi-rac/xong/:id',
  '/doi-rac/yeu-cau/:id',
  '/doi-rac/yeu-cau/:id/sua',
  '/don/:code',
  '/hoc-vien/:courseId',
  '/khoi-phuc/:hint',
  '/moi/:code',
  '/mua-chung/:id',
  '/product/:slug',
  '/s/:slug',
  '/san-pham/:slug',
  '/san-pham/_preview/:slug',
  '/tai-khoan/don-hang/:code',
  '/thanh-toan/chuyen-khoan/:code',
  '/vuon-xanh/choi/:game',
] as const;

export function routeTemplate(pathname: string): string {
  return toRouteTemplate(pathname, WEB_DYNAMIC_ROUTES);
}

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listenersAdded = false;
let memAnonId: string | null = null;
let memSession: { id: string; at: number } | null = null;
const memSeen = new Set<string>();
const unloadHooks = new Set<() => void>();
let lastScreen: string | null = null;

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Máy cũ không có randomUUID: vẫn ra chuỗi dạng UUID v4 để máy chủ nhận.
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}

function local(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function session(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mã ẩn danh của máy, bền qua tải lại. Storage bị chặn thì dùng mã trong bộ nhớ (sống tới khi tải lại trang). */
export function getAnonymousId(): string {
  const ls = local();
  try {
    const v = ls?.getItem(ANON_ID_KEY);
    if (v && UUID_RE.test(v)) return v;
  } catch {
    /* storage bị chặn */
  }
  memAnonId ??= newId();
  try {
    ls?.setItem(ANON_ID_KEY, memAnonId);
  } catch {
    /* storage bị chặn */
  }
  return memAnonId;
}

/** Mã phiên: giữ nguyên khi khách còn thao tác, đổi mã mới sau `SESSION_IDLE_MS` không có sự kiện nào (dùng chung giữa các tab). */
export function getSessionId(now: number = Date.now()): string {
  const ls = local();
  let cur = memSession;
  try {
    const raw = ls?.getItem(SESSION_KEY);
    if (raw) {
      const v = JSON.parse(raw) as { id?: unknown; at?: unknown };
      if (typeof v.id === 'string' && UUID_RE.test(v.id) && typeof v.at === 'number') cur = { id: v.id, at: v.at };
    }
  } catch {
    /* storage bị chặn hoặc giá trị hỏng */
  }
  const next = cur && now - cur.at < SESSION_IDLE_MS && now >= cur.at - 60_000 ? { id: cur.id, at: now } : { id: newId(), at: now };
  memSession = next;
  try {
    ls?.setItem(SESSION_KEY, JSON.stringify(next));
  } catch {
    /* storage bị chặn */
  }
  return next.id;
}

/**
 * Khách bật Do Not Track: web không gửi sự kiện hành vi nào, chỉ còn sự kiện máy chủ (đơn, thanh toán). Trang xem trước MSS cũng không gửi:
 * người xem là người soạn nội dung, không phải khách, và mọi thành phần trên trang (kể cả ScreenTracker ở layout gốc) đi qua hàm này.
 */
export function trackingDisabled(): boolean {
  if (typeof window !== 'undefined' && isPreviewPath(window.location?.pathname)) return true;
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { msDoNotTrack?: string };
  const w = typeof window !== 'undefined' ? (window as Window & { doNotTrack?: string }) : undefined;
  const dnt = nav.doNotTrack ?? w?.doNotTrack ?? nav.msDoNotTrack;
  return dnt === '1' || dnt === 'yes';
}

/** Sự kiện analytics của web (best-effort): khách chưa đăng nhập vẫn gửi được, gắn mã ẩn danh và mã phiên. Không bao giờ ném. */
export function trackWebEvent(eventName: ClientEventName, props: Record<string, unknown>): void {
  try {
    if (typeof window === 'undefined' || trackingDisabled()) return;
    const touch = readFirstTouchCookie();
    queue.push({
      eventId: newId(),
      eventName,
      occurredAt: new Date().toISOString(),
      platform: 'web',
      anonymousId: getAnonymousId(),
      sessionId: getSessionId(),
      props,
      ...(touch?.source ? { entrySource: touch.source } : {}),
      ...(touch?.campaign ? { campaign: touch.campaign } : {}),
    });
    if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE);
    addListeners();
    if (queue.length >= MAX_BATCH) void flushWebEvents();
    else schedule();
  } catch {
    /* đo không được làm hỏng trang */
  }
}

/** Bản có kiểu của `trackWebEvent` cho sự kiện phễu mua: sai khoá props là lỗi biên dịch. */
export function trackPurchase<N extends PurchaseEventName>(eventName: N, props: PurchaseEventProps[N]): void {
  trackWebEvent(eventName, { ...props });
}

/** Phát một lần cho mỗi `key` trong một phiên (vd. mỗi khối Trang chủ). Tải lại trang trong cùng phiên không phát lại. */
export function trackOncePerSession<N extends PurchaseEventName>(key: string, eventName: N, props: PurchaseEventProps[N]): void {
  try {
    if (typeof window === 'undefined' || trackingDisabled()) return;
    const sid = getSessionId();
    const ss = session();
    let seen: { sid: string; keys: string[] } = { sid, keys: [] };
    try {
      const raw = ss?.getItem(SEEN_KEY);
      if (raw) {
        const v = JSON.parse(raw) as { sid?: unknown; keys?: unknown };
        if (v.sid === sid && Array.isArray(v.keys)) seen = { sid, keys: v.keys.filter((k): k is string => typeof k === 'string') };
      }
    } catch {
      /* storage bị chặn hoặc hỏng */
    }
    const memKey = `${sid}|${key}`;
    if (seen.keys.includes(key) || memSeen.has(memKey)) return;
    memSeen.add(memKey);
    seen.keys.push(key);
    try {
      ss?.setItem(SEEN_KEY, JSON.stringify(seen));
    } catch {
      /* storage bị chặn: chỉ còn chống lặp trong bộ nhớ */
    }
    trackPurchase(eventName, props);
  } catch {
    /* đo không được làm hỏng trang */
  }
}

/** `screen_viewed` cho mỗi lần đổi trang; gọi lặp với cùng đường dẫn (React render lại, StrictMode) không phát thêm. */
export function trackScreenView(pathname: string): void {
  if (pathname === lastScreen) return;
  const route = routeTemplate(pathname);
  const referrerRoute = lastScreen === null ? null : routeTemplate(lastScreen);
  lastScreen = pathname;
  trackPurchase('screen_viewed', { route, referrerRoute });
}

/** Nơi bấm vào thanh toán ghi dấu ở đây; trang thanh toán lấy ra (và xoá) khi phát `checkout_started`. */
export function markCheckoutEntry(entry: CheckoutEntry): void {
  try {
    session()?.setItem(CHECKOUT_ENTRY_KEY, entry);
  } catch {
    /* storage bị chặn: trang thanh toán ghi 'unknown' */
  }
}

const ENTRIES: readonly string[] = ['cart', 'cart_subset', 'buy_now', 'flash'];

export function takeCheckoutEntry(): CheckoutEntry {
  try {
    const ss = session();
    const v = ss?.getItem(CHECKOUT_ENTRY_KEY) ?? null;
    ss?.removeItem(CHECKOUT_ENTRY_KEY);
    return v && ENTRIES.includes(v) ? (v as CheckoutEntry) : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Đăng ký việc chạy lúc trang bị đóng (`pagehide`), TRƯỚC khi hàng đợi được gửi bằng beacon: vd. `checkout_abandoned`.
 * Trả hàm huỷ đăng ký.
 */
export function onPageHide(fn: () => void): () => void {
  unloadHooks.add(fn);
  addListeners();
  return () => {
    unloadHooks.delete(fn);
  };
}

function addListeners(): void {
  if (listenersAdded || typeof window === 'undefined') return;
  listenersAdded = true;
  window.addEventListener('pagehide', () => {
    for (const fn of Array.from(unloadHooks)) {
      try {
        fn();
      } catch {
        /* một hook lỗi không chặn hook khác */
      }
    }
    flushWithBeacon();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushWithBeacon();
  });
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushWebEvents();
  }, FLUSH_INTERVAL_MS);
}

/** Gửi một lô (tối đa MAX_BATCH) bằng fetch JSON; API lỗi thì bỏ lô đó (không dồn lại để khỏi rò bộ nhớ khi mất mạng dài). */
export async function flushWebEvents(): Promise<void> {
  try {
    if (queue.length === 0) return;
    const batch = queue.splice(0, MAX_BATCH);
    try {
      await apiFetch(INGEST_PATH, { method: 'POST', body: { events: batch } });
    } catch {
      /* best-effort */
    }
    if (queue.length > 0) schedule();
  } catch {
    /* môi trường lạ: bỏ qua */
  }
}

/** Trang đang ẩn/đóng: gửi hết hàng đợi bằng sendBeacon (lùi về fetch keepalive), từng lô MAX_BATCH. */
export function flushWithBeacon(): void {
  try {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    while (queue.length > 0) {
      const batch = queue.splice(0, MAX_BATCH);
      const body = new URLSearchParams({ payload: JSON.stringify({ events: batch }) });
      let sent = false;
      try {
        sent = typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(BEACON_URL, body);
      } catch {
        sent = false;
      }
      if (!sent && typeof fetch === 'function') {
        void fetch(BEACON_URL, { method: 'POST', body, keepalive: true, credentials: 'omit', mode: 'no-cors' }).catch(() => undefined);
      }
    }
  } catch {
    /* best-effort */
  }
}

export function __resetWebEventsForTest(): void {
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
  memAnonId = null;
  memSession = null;
  memSeen.clear();
  unloadHooks.clear();
  lastScreen = null;
}
