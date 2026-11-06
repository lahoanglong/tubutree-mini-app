import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Đo hàng mã giảm giá (testid `coupon-row`) của Mini App và web khổ điện thoại: cao bao nhiêu, chữ nào bị cắt "…", phần tử nào tràn ra ngoài
 * hàng, mỗi phần tử có `data-testid` chiếm mấy dòng. Dùng chung cho coupon-row-320.miniapp.spec.ts và coupon-row-320.web.spec.ts để hai bên
 * so cùng một thước.
 */
export interface RowFacts {
  rowH: number;
  rowW: number;
  pageOverflow: boolean;
  clipped: string[];
  outside: string[];
  lines: Record<string, number>;
  mids: Record<string, number>;
  tops: Record<string, number>;
}

export async function rowFacts(page: Page, rowTestId = 'coupon-row'): Promise<RowFacts> {
  return page.getByTestId(rowTestId).first().evaluate((row) => {
    const rect = row.getBoundingClientRect();
    const clipped: string[] = [];
    const outside: string[] = [];
    const lines: Record<string, number> = {};
    const mids: Record<string, number> = {};
    const tops: Record<string, number> = {};
    for (const el of row.querySelectorAll<HTMLElement>('*')) {
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      if (b.width === 0) continue;
      if ((cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden') && el.scrollWidth > el.clientWidth + 1) clipped.push(el.textContent ?? '');
      if (b.left < rect.left - 0.5 || b.right > rect.right + 0.5) outside.push(el.textContent || el.tagName);
      const id = el.getAttribute('data-testid');
      if (!id) continue;
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
      lines[id] = Math.round(b.height / lh);
      mids[id] = b.top + b.height / 2;
      tops[id] = b.top;
    }
    return {
      rowH: Math.round(rect.height * 10) / 10,
      rowW: Math.round(rect.width),
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      clipped,
      outside,
      lines,
      mids,
      tops,
    };
  });
}

/** Hàng còn nguyên: cao ≤`maxH` (mặc định 44px, hàng ở chân dính giỏ), không chữ nào bị cắt, không phần tử nào tràn, trang không tràn ngang, nút và nhãn một dòng. */
export function expectRowIntact(f: RowFacts, maxH = 44.5): void {
  expect(f.rowH, `hàng mã cao ${f.rowH}px`).toBeLessThanOrEqual(maxH);
  expect(f.clipped, `chữ bị cắt: ${JSON.stringify(f.clipped)}`).toEqual([]);
  expect(f.outside, `phần tử tràn ra ngoài hàng: ${JSON.stringify(f.outside)}`).toEqual([]);
  expect(f.pageOverflow, 'trang tràn ngang').toBe(false);
  expect(f.lines['coupon-cta'], 'nút "Chọn mã" / "Thay đổi" một dòng').toBe(1);
  expect(f.lines['coupon-label'], 'nhãn "Mã giảm giá" một dòng').toBe(1);
}
