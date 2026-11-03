import type { Locator, Page } from '@playwright/test';

/** Đo CLS và vị trí khối bên dưới vùng ghi chú Giờ vàng của PDP (Mini + web); dùng chung để hai bên đo cùng một cách. */
export async function trackLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Rect = { y: number };
    type Entry = { hadRecentInput: boolean; value: number; startTime: number; sources?: { previousRect: Rect; currentRect: Rect; node?: Element | null }[] };
    const w = window as unknown as {
      __cls: number;
      __shifts: { value: number; slotDy: number; srcs: { y0: number; y1: number; n: string }[] }[];
    };
    w.__cls = 0;
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as Entry[]) {
        if (e.hadRecentInput) continue;
        w.__cls += e.value;
        const srcs = (e.sources ?? []).map((src) => ({
          y0: src.previousRect.y,
          y1: src.currentRect.y,
          n: src.node ? `${src.node.tagName.toLowerCase()}${src.node.closest('[data-section]') ? `[${src.node.closest('[data-section]')!.getAttribute('data-section')}]` : ''}` : '?',
        }));
        // Vùng ghi chú tự dịch (khối phía trên đổi chiều cao) thì nó là một nguồn của lần dịch: lấy độ dịch đó làm mốc.
        const own = srcs.find((x) => x.n === 'div[pdp-flash-limit]');
        w.__shifts.push({
          value: e.value,
          slotDy: own ? own.y1 - own.y0 : 0,
          srcs,
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

export const readCls = (page: Page) =>
  page.evaluate(() => new Promise<number>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r((window as unknown as { __cls: number }).__cls)))));

/**
 * Tổng giá trị layout-shift do phần bên dưới vùng ghi chú (nguồn có y trước đó >= đỉnh vùng ghi chú, toạ độ khung nhìn) dịch so với chính vùng ghi chú.
 * Khối phía trên đổi theo pha đăng nhập (dòng Điểm Xanh, giá) đẩy cả vùng lẫn phần dưới đi cùng nhau thì không tính: đó không phải do ghi chú.
 */
export const readShiftBelow = (page: Page, slot: Locator) =>
  slot.evaluate(
    (el) =>
      new Promise<number>((r) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const top = el.getBoundingClientRect().top - 1;
            const shifts = (window as unknown as { __shifts: { value: number; slotDy: number; srcs: { y0: number; y1: number; n: string }[] }[] }).__shifts;
            const moved = (e: (typeof shifts)[number]) => e.srcs.some((s) => s.y0 >= top && Math.abs(s.y1 - s.y0 - e.slotDy) > 0.5);
            r(shifts.reduce((sum, e) => (moved(e) ? sum + e.value : sum), 0));
          }),
        ),
      ),
  );

/** Treo một request mock cho tới khi test gọi `release()`: không phụ thuộc đồng hồ, nên "trước" luôn đo lúc ghi chú chưa về. */
export function gate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  return { wait, release };
}

/**
 * Cuộn vùng ghi chú vào giữa màn hình rồi đánh dấu khối nằm ngay bên dưới nó trên màn hình (bỏ qua khối cao 0, khối ẩn và khối cố định như thanh dính).
 * Trả locator của khối đó: chiều cao vùng ghi chú đổi thì y của khối này đổi, và nó nằm trong màn hình nên CLS tính được.
 */
export async function anchorBelow(slot: Locator): Promise<Locator> {
  await slot.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    const bottom = el.getBoundingClientRect().bottom - 1;
    // Theo vị trí thật trên màn hình, không theo thứ tự DOM: cột PDP xếp lại bằng `order`, nên khối đứng sau trong DOM có thể nằm phía trên.
    let node: Element | null = el;
    while (node) {
      let best: Element | null = null;
      let bestTop = Infinity;
      for (const n of Array.from(node.parentElement?.children ?? [])) {
        if (n === node) continue;
        const r = n.getBoundingClientRect();
        if (r.height > 0 && r.top >= bottom && r.top < bestTop && getComputedStyle(n).position !== 'fixed') {
          best = n;
          bestTop = r.top;
        }
      }
      if (best) {
        best.setAttribute('data-cls-anchor', '1');
        return;
      }
      node = node.parentElement;
    }
    throw new Error('không có khối nào bên dưới vùng ghi chú');
  });
  return slot.page().locator('[data-cls-anchor="1"]');
}
