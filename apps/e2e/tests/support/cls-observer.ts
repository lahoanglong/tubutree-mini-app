import type { Page } from '@playwright/test';

/** Cài bộ đo CLS (layout-shift) trước khi trang chạy; `readClsTotal` đọc tổng sau hai khung hình. Nguồn dịch ghi ở `__clsSrc` để báo lỗi dễ đọc. */
export async function observeCls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __clsSrc: string[] };
    w.__cls = 0;
    w.__clsSrc = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { hadRecentInput: boolean; value: number; startTime: number; sources?: { node?: Node; previousRect: DOMRect; currentRect: DOMRect }[] }[]) {
        if (e.hadRecentInput) continue;
        w.__cls += e.value;
        const src = (e.sources ?? []).map((x) => {
          const el = x.node instanceof Element ? x.node : x.node?.parentElement;
          return `${el?.tagName}.${String(el?.className ?? '').slice(0, 30)} y${Math.round(x.previousRect.y)}>${Math.round(x.currentRect.y)}`;
        });
        w.__clsSrc.push(`${e.value.toFixed(3)}@${Math.round(e.startTime)} ${src.join(' | ')}`);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

export async function readClsTotal(page: Page): Promise<{ cls: number; sources: string[] }> {
  return page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const w = window as unknown as { __cls: number; __clsSrc: string[] };
            resolve({ cls: w.__cls, sources: w.__clsSrc });
          }),
        ),
      ),
  );
}
