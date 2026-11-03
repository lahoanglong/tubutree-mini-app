import type { Locator, Page } from '@playwright/test';

/** Đo CLS và vị trí khối bên dưới vùng ghi chú Giờ vàng của PDP (Mini + web); dùng chung để hai bên đo cùng một cách. */
export async function trackLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { hadRecentInput: boolean; value: number }[]) if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

export const readCls = (page: Page) =>
  page.evaluate(() => new Promise<number>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r((window as unknown as { __cls: number }).__cls)))));

/** Treo một request mock cho tới khi test gọi `release()`: không phụ thuộc đồng hồ, nên "trước" luôn đo lúc ghi chú chưa về. */
export function gate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  return { wait, release };
}

/**
 * Cuộn vùng ghi chú vào giữa màn hình rồi đánh dấu khối đầu tiên bên dưới nó có chiều cao (bỏ qua khối cao 0, khối ẩn và khối cố định như thanh dính).
 * Trả locator của khối đó: chiều cao vùng ghi chú đổi thì y của khối này đổi, và nó nằm trong màn hình nên CLS tính được.
 */
export async function anchorBelow(slot: Locator): Promise<Locator> {
  await slot.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    let node: Element | null = el;
    while (node) {
      let n = node.nextElementSibling;
      while (n) {
        const r = n.getBoundingClientRect();
        if (r.height > 0 && getComputedStyle(n).position !== 'fixed') {
          n.setAttribute('data-cls-anchor', '1');
          return;
        }
        n = n.nextElementSibling;
      }
      node = node.parentElement;
    }
    throw new Error('không có khối nào bên dưới vùng ghi chú');
  });
  return slot.page().locator('[data-cls-anchor="1"]');
}
