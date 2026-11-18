import { vitalRating, vitalViewport, type VitalName } from '@tubutree/shared-types';
import { trackEvent } from '../../services/analytics';
import { miniRouteTemplate } from '../../hooks/use-screen-tracker';

/** `PublicConfig.perfRum` (cờ `perf.rum_enabled`, `perf.rum_sample_pct`). */
export interface MiniRum {
  enabled?: boolean;
  samplePct?: number;
}

/** Sau lần rảnh đầu tiên (READY) chờ thêm ngần này để LCP/CLS của màn đầu chốt, rồi gửi. */
const SETTLE_MS = 10_000;

let vals: Partial<Record<VitalName, number>> = {};
let route = '/';
let rum: MiniRum | undefined;
let due = false;
let done = false;

function send(): void {
  if (done || !due || !rum) return;
  done = true;
  if (!rum.enabled || !(Math.random() * 100 < (rum.samplePct ?? 0))) return;
  const et = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType;
  for (const [name, raw] of Object.entries(vals) as [VitalName, number][]) {
    const value = name === 'CLS' ? Math.round(raw * 1e4) / 1e4 : Math.round(raw);
    trackEvent('mini_vital', 'miniapp', {
      name,
      value,
      rating: vitalRating(name, value),
      route,
      vp: vitalViewport(innerWidth),
      ...(et && /^(slow-2g|[234]g)$/.test(et) ? { et } : {}),
    });
  }
}

/** Trang chủ báo cấu hình công khai đã về (không gọi thêm API): cờ tắt thì không gửi gì. */
export function noteMiniRum(cfg: MiniRum | undefined): void {
  if (!cfg || rum) return;
  rum = cfg;
  send();
}

/**
 * Gọi MỘT lần ở điểm vào app. Đo LCP và CLS của màn đầu (PerformanceObserver; WebView không hỗ trợ thì bỏ qua) và READY: mili giây từ lúc mở app
 * tới lần rảnh đầu tiên của luồng chính sau `load`. Gửi một gói `mini_vital` qua hàng đợi sự kiện sẵn có khi trang bị ẩn hoặc 10 giây sau READY,
 * chỉ khi cấu hình đã về và lượt này được chọn mẫu.
 */
export function startMiniVitals(): void {
  try {
    route = miniRouteTemplate(location.pathname.replace(/^\/zapps\/[^/]+/, '') || '/');
    const observe = (type: string, fn: (e: PerformanceEntry & { value?: number; hadRecentInput?: boolean }) => void) => {
      try {
        new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true });
      } catch {
        /* WebView không hỗ trợ loại này */
      }
    };
    observe('largest-contentful-paint', (e) => (vals.LCP = e.startTime));
    observe('layout-shift', (e) => {
      if (!e.hadRecentInput) vals.CLS = (vals.CLS ?? 0) + (e.value ?? 0);
    });
    const idle = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1));
    const ready = () =>
      idle(() => {
        vals.READY = performance.now();
        setTimeout(() => ((due = true), send()), SETTLE_MS);
      });
    if (document.readyState === 'complete') ready();
    else addEventListener('load', ready, { once: true });
    addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && ((due = true), send()));
  } catch {
    /* đo không được làm hỏng app */
  }
}

export function __resetMiniVitalsForTest(): void {
  vals = {};
  route = '/';
  rum = undefined;
  due = false;
  done = false;
}
