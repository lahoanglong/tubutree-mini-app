import type { Page } from '@playwright/test';

/** Mỗi nhãn trong Bento Hub và hàng lối tắt nhanh đọc đủ chữ: không tràn ngang khung chứa, không quá hai dòng. */
export async function shortcutLabelProblems(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="shortcut-grid"] [data-pillar-title], [data-testid="shortcut-grid"] [data-quick-label]',
      ),
    ).flatMap((label) => {
      const range = document.createRange();
      range.selectNodeContents(label);
      const lines = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size;
      const problems: string[] = [];
      if (label.scrollWidth > label.clientWidth + 1) {
        problems.push(`${label.textContent}: tràn ngang ${label.scrollWidth} > ${label.clientWidth}`);
      }
      if (lines > 2) problems.push(`${label.textContent}: ${lines} dòng`);
      return problems;
    }),
  );
}
