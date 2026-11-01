import { test, expect } from './support/mock-api';
import { mockBuilder } from './support/builder-mocks';
import type { Locator, Page } from '@playwright/test';

/**
 * G6 (P2 #25..#30): số đo 375px của nút Mini và màn dựng gian hàng. Toàn bộ API được mock.
 */
test.use({ viewport: { width: 375, height: 812 } });

const luminance = ([r, g, b]: number[]) => {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
};
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const rgbOf = (css: string) => (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);

const openBuilder = async (page: Page) => {
  await page.goto('/storefront');
  await expect(page.getByTestId('section-card')).toHaveCount(3, { timeout: 15_000 });
};

/** Icon (svg) trong nút và nhãn chữ của nút: tâm dọc và khoảng cách ngang. */
const iconVsLabel = async (btn: Locator) =>
  btn.evaluate((el) => {
    const svg = el.querySelector('svg')!.getBoundingClientRect();
    const range = document.createRange();
    const labelNode = Array.from(el.querySelectorAll('span')).find((s) => s.children.length === 0 && (s.textContent ?? '').trim() !== '' && !s.closest('.zaui-btn-icon'))!;
    range.selectNodeContents(labelNode);
    const text = range.getBoundingClientRect();
    return { dy: Math.abs(svg.top + svg.height / 2 - (text.top + text.height / 2)), gap: text.left - svg.right };
  });

test.describe('Nút Mini (G6 #25 #26 #27)', () => {
  test.beforeEach(({ api }) => mockBuilder(api));

  test('"Sắp xếp" là nút chữ: không rộng tối thiểu 120px, mép phải cách mép màn 16 + 8px (đệm của nút chữ web)', async ({ page }) => {
    await openBuilder(page);
    const box = (await page.getByRole('button', { name: 'Sắp xếp', exact: true }).boundingBox())!;
    expect(box.width, `nút rộng ${box.width}px`).toBeLessThan(110);
    expect(375 - (box.x + box.width)).toBeLessThanOrEqual(16 + 1);
  });

  for (const name of ['Sửa hồ sơ', 'Cài đặt']) {
    test(`nút "${name}": icon căn giữa dọc với chữ, cách chữ khoảng 8px`, async ({ page }) => {
      await openBuilder(page);
      const m = await iconVsLabel(page.getByRole('button', { name, exact: true }));
      expect(m.dy, `lệch dọc ${m.dy}px`).toBeLessThanOrEqual(1);
      expect(m.gap, `khoảng cách ${m.gap}px`).toBeGreaterThanOrEqual(6);
      expect(m.gap).toBeLessThanOrEqual(10);
    });
  }

  test('"Lưu mức giảm" đang tắt: chữ đọc được (>= 4,5:1 trên nền nút)', async ({ page }) => {
    await openBuilder(page);
    await page.locator('[data-testid="section-card"] button').filter({ hasText: 'Combo giặt sạch' }).first().click();
    const save = page.getByRole('button', { name: 'Lưu mức giảm' });
    await expect(save).toBeDisabled();
    const { fg, bg } = await save.evaluate((el) => {
      const cs = getComputedStyle(el);
      const label = Array.from(el.querySelectorAll('span')).find((s) => s.children.length === 0) ?? el;
      return { fg: getComputedStyle(label).color, bg: cs.backgroundColor };
    });
    expect(contrast(rgbOf(fg), rgbOf(bg)), `chữ ${fg} trên ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});
