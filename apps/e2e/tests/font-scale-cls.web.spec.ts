import { test, expect } from './support/mock-api';
import { observeCls, readClsTotal } from './support/cls-observer';
import { mockMergedHome } from './support/home-merged';

/**
 * Web, Trang chủ: khách đã chọn cỡ chữ "lớn"/"nhỏ" ở Cài đặt thì script ở <head> đặt font-size gốc trước khi vẽ,
 * nên trang không dựng lại một lần sau hydrate.
 */
const CLS_MAX = 0.01;
const SCALES = [
  { scale: 'large', size: '112.5%' },
  { scale: 'small', size: '93.75%' },
] as const;

for (const { scale, size } of SCALES) {
  test(`CLS Trang chủ với cỡ chữ ${scale}: font-size gốc đặt từ khung hình đầu`, async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.addInitScript((s) => {
      try {
        localStorage.setItem('tubu_prefs', JSON.stringify({ fontScale: s }));
      } catch {
        /* không có localStorage */
      }
    }, scale);
    await observeCls(page);
    api.get('/flash-sales/upcoming', []);
    api.get('/me/wishlist/ids', []);
    api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: 0 });
    mockMergedHome(api);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Gợi ý hôm nay' })).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(800);
    const { cls, sources } = await readClsTotal(page);
    expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe(size);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-font-scale'))).toBe(scale);
    test.info().annotations.push({ type: 'CLS', description: cls.toFixed(4) });
    console.log(`CLS font-scale ${scale} = ${cls.toFixed(4)}\n${sources.map((s) => `  shift ${s}`).join('\n')}`);
    expect(cls).toBeLessThan(CLS_MAX);
  });
}
