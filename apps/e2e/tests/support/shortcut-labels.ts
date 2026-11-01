import type { Page } from '@playwright/test';

/** Mỗi nhãn lối tắt đọc đủ chữ: không tràn ngang, không quá hai dòng (nhãn bị cắt "…" làm khách không biết ô nào là Mã giảm giá). */
export async function shortcutLabelProblems(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="shortcut-grid"] button')).flatMap((btn) => {
      const label = btn.lastElementChild as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(label);
      const lines = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size;
      const problems: string[] = [];
      if (label.scrollWidth > label.clientWidth) problems.push(`${label.textContent}: tràn ngang ${label.scrollWidth} > ${label.clientWidth}`);
      if (lines > 2) problems.push(`${label.textContent}: ${lines} dòng`);
      return problems;
    }),
  );
}
