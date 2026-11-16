'use client';

import { useEffect } from 'react';
import { trackOncePerSession } from '@/lib/analytics';

/** Khối giữ chỗ hay dải lỗi cấp trang không phải nội dung khách xem. */
const IGNORED = new Set(['settling', 'pageError']);
export const HOME_BLOCK_DWELL_MS = 1000;
/**
 * Mốc dày ở gần 0: khối cao (lưới gợi ý cuộn vô tận) chỉ lộ một phần nhỏ của nó dù đã phủ cả màn hình, nên phải có một mốc rơi vào
 * khoảng [nửa màn / chiều cao khối, cả màn / chiều cao khối]; hai mốc liền nhau cách nhau không quá 2 lần thì khối cao tới ~400 màn vẫn bắt được.
 */
const THRESHOLDS = [0, 0.0025, 0.005, 0.01, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.75, 1];

function counts(e: IntersectionObserverEntry): boolean {
  // Khối rỗng cao 0 được trình duyệt báo tỉ lệ 1 khi nằm trong khung: không có gì để xem.
  if (!e.isIntersecting || e.boundingClientRect.height <= 0) return false;
  if (e.intersectionRatio >= 0.5) return true;
  const viewport = e.rootBounds?.height || window.innerHeight;
  return viewport > 0 && e.intersectionRect.height >= viewport / 2;
}

/**
 * `home_block_viewed` cho các khối `[data-home-block]` của Trang chủ: khối được tính là đã xem khi lộ ≥ 50% của nó, hoặc phủ ≥ 50% chiều cao
 * màn hình (khối cao), liên tục 1 giây; mỗi khối một lần trong phiên. Khối chen vào sau (đổi loại khách, tải xong) được bắt bằng MutationObserver.
 * Không vẽ gì.
 */
export function HomeBlockTracker() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') return;
    const timers = new Map<Element, ReturnType<typeof setTimeout>>();
    const observed = new Set<Element>();
    const done = new Set<string>();
    const blockOf = (el: Element) => (el as HTMLElement).dataset.homeBlock ?? '';
    const cancel = (el: Element) => {
      const t = timers.get(el);
      if (t !== undefined) clearTimeout(t);
      timers.delete(el);
    };
    const forget = (el: Element) => {
      cancel(el);
      io.unobserve(el);
      observed.delete(el);
    };
    const fire = (el: Element) => {
      timers.delete(el);
      const id = blockOf(el);
      if (!el.isConnected || done.has(id)) return;
      done.add(id);
      forget(el);
      trackOncePerSession(`home:${id}`, 'home_block_viewed', { block: id });
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (done.has(blockOf(e.target))) forget(e.target);
          else if (!counts(e)) cancel(e.target);
          else if (!timers.has(e.target)) timers.set(e.target, setTimeout(() => fire(e.target), HOME_BLOCK_DWELL_MS));
        }
      },
      { threshold: THRESHOLDS },
    );
    const scan = () => {
      for (const el of Array.from(observed)) if (!el.isConnected) forget(el);
      document.querySelectorAll<HTMLElement>('[data-home-block]').forEach((el) => {
        const id = blockOf(el);
        if (observed.has(el) || !id || IGNORED.has(id) || done.has(id)) return;
        observed.add(el);
        io.observe(el);
      });
    };
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });
    scan();
    return () => {
      mo.disconnect();
      io.disconnect();
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      observed.clear();
    };
  }, []);
  return null;
}
