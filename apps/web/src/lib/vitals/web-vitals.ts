'use client';

import { vitalRating, vitalViewport, VITAL_NAV_TYPES, VITAL_NET_TYPES, type VitalName } from '@tubutree/shared-types';
import { BEACON_URL, routeTemplate, trackingDisabled } from '@/lib/analytics';

/** Phần `web-vitals` (bản Next gói sẵn ở `next/dist/compiled/web-vitals`) mà bộ thu dùng. */
export interface VitalMetric {
  name: string;
  value: number;
  navigationType?: string;
}
type OnMetric = (cb: (m: VitalMetric) => void, opts?: { reportAllChanges?: boolean }) => void;
export interface WebVitalsLib {
  onLCP: OnMetric;
  onCLS: OnMetric;
  onINP: OnMetric;
  onFCP: OnMetric;
  onTTFB: OnMetric;
}

const NAMES: readonly string[] = ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'];

export function netType(nav: Navigator | undefined): string {
  const t = (nav as Navigator & { connection?: { effectiveType?: string } } | undefined)?.connection?.effectiveType;
  return t && (VITAL_NET_TYPES as readonly string[]).includes(t) ? t : 'unknown';
}

/** Một sự kiện `web_vital`: không mã ẩn danh, không mã phiên, không nguồn vào; chỉ số đo, mẫu route của trang mở đầu và nhóm khung nhìn. */
export function vitalEvent(m: VitalMetric, ctx: { route: string; vp: string; et: string }, id: string, at: string) {
  const name = m.name as VitalName;
  const value = name === 'CLS' ? Math.round(m.value * 10_000) / 10_000 : Math.round(m.value);
  const nav = m.navigationType && (VITAL_NAV_TYPES as readonly string[]).includes(m.navigationType) ? { nav: m.navigationType } : {};
  return {
    eventId: id,
    eventName: 'web_vital' as const,
    occurredAt: at,
    platform: 'web' as const,
    props: { name, value, rating: vitalRating(name, value), route: ctx.route, vp: ctx.vp, et: ctx.et, ...nav },
  };
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (+c ^ ((Math.random() * 16) >> (+c / 4))).toString(16));

let started = false;

/**
 * Đo LCP, CLS, INP, FCP, TTFB của lượt xem trang này và gửi MỘT gói (sendBeacon, lùi về fetch keepalive) lần đầu trang bị ẩn hay đóng. Số đo
 * thuộc trang mở đầu (chuyển trang trong app không phải lượt xem mới với trình duyệt). Lấy mẫu một lần mỗi lượt tải; DNT và trang xem trước
 * không đo. Thư viện đo chỉ được tải khi lượt này được chọn.
 */
export function startWebVitals(
  samplePct: number,
  opts: { rand?: () => number; load?: () => Promise<WebVitalsLib> } = {},
): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (trackingDisabled() || !((opts.rand ?? Math.random)() * 100 < samplePct)) return;
  const ctx = { route: routeTemplate(window.location.pathname), vp: vitalViewport(window.innerWidth), et: netType(navigator) };
  const latest = new Map<string, VitalMetric>();
  let sent = false;
  const send = () => {
    if (sent || latest.size === 0) return;
    sent = true;
    const at = new Date().toISOString();
    const events = Array.from(latest.values(), (m) => vitalEvent(m, ctx, newId(), at));
    const body = new URLSearchParams({ payload: JSON.stringify({ events }) });
    try {
      if (navigator.sendBeacon?.(BEACON_URL, body)) return;
    } catch {
      /* lùi về fetch */
    }
    void fetch(BEACON_URL, { method: 'POST', body, keepalive: true, credentials: 'omit', mode: 'no-cors' }).catch(() => undefined);
  };
  const add = (m: VitalMetric) => {
    if (!sent && NAMES.includes(m.name) && Number.isFinite(m.value)) latest.set(m.name, m);
  };
  const load =
    opts.load ??
    (() => import('next/dist/compiled/web-vitals').then((m) => ((m as Partial<WebVitalsLib>).onLCP ? m : (m as unknown as { default: WebVitalsLib }).default) as WebVitalsLib));
  load()
    .then((lib) => {
      // LCP, CLS, INP: báo MỌI lần đổi giá trị. Không có cờ này thư viện chỉ báo chúng trong trình nghe ẩn trang của chính nó, mà trình nghe CLS
      // chỉ được gắn sau FCP (sau trình nghe dưới đây) nên gói gửi lúc ẩn trang sẽ thiếu CLS/INP, và LCP chỉ có khi khách đã bấm hay gõ.
      for (const on of [lib.onLCP, lib.onCLS, lib.onINP]) on(add, { reportAllChanges: true });
      lib.onFCP(add);
      lib.onTTFB(add);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && send(), true);
      window.addEventListener('pagehide', send, true);
    })
    .catch(() => undefined);
}

export function __resetWebVitalsForTest(): void {
  started = false;
}
