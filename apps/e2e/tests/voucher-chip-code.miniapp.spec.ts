import { test, expect } from './support/mock-api';
import { BRAND_SLUG, FUWA, mockBrandPage } from './support/shop-page-mocks';

/**
 * Chip mã giảm giá ở trang thương hiệu (Mini App), 375px: chữ phụ của khuyến mãi dài hơn 2 dòng bị cắt ở dòng thứ hai, nhưng mã (15 ký tự) ở hàng riêng
 * phải thấy nguyên vẹn, nằm trong khung chip và trong màn hình, không đè lên phụ đề. Khuyến mãi không gắn mã không có hàng mã. API mock toàn bộ.
 */
test.use({ viewport: { width: 375, height: 812 } });

const LONG_SUBTITLE =
  'Tri ân khách hàng thân thiết của thương hiệu nhân dịp khai trương gian hàng mới, áp dụng cho mọi sản phẩm trong kho và mọi đơn từ 250.000đ trở lên với mã NHANLOCXANH2026';
const END = new Date(Date.now() + 30 * 86_400_000).toISOString();
const START = new Date(Date.now() - 86_400_000).toISOString();
const promo = (id: string, title: string, couponCode: string | null) => ({ id, title, subtitle: LONG_SUBTITLE, themeColor: null, couponCode, startAt: START, endAt: END });

test('phụ đề dài bị cắt 2 dòng, mã ở hàng riêng vẫn thấy nguyên trong khung chip', async ({ page, api }, testInfo) => {
  mockBrandPage(api);
  api.get('/brand/public/:slug', { ...FUWA, promotions: [promo('p-long', 'Khai trương', 'NHANLOCXANH2026'), promo('p-plain', 'Quà tặng', null)] });
  await page.goto(`/brand/${BRAND_SLUG}`);
  const chip = page.getByRole('group', { name: 'Khai trương' });
  await expect(chip).toBeVisible({ timeout: 15_000 });
  const meta = chip.getByTestId('voucher-meta');
  const code = chip.getByTestId('voucher-code');
  await expect(code).toHaveText('NHANLOCXANH2026');

  const m = await page.evaluate(() => {
    const group = Array.from(document.querySelectorAll<HTMLElement>('[role="group"]')).find((g) => g.getAttribute('aria-label') === 'Khai trương')!;
    const metaEl = group.querySelector<HTMLElement>('[data-testid="voucher-meta"]')!;
    const codeEl = group.querySelector<HTMLElement>('[data-testid="voucher-code"]')!;
    const lineHeight = parseFloat(getComputedStyle(metaEl).lineHeight);
    const box = (el: HTMLElement) => el.getBoundingClientRect().toJSON() as { top: number; bottom: number; left: number; right: number; width: number; height: number };
    return { chip: box(group), meta: box(metaEl), code: box(codeEl), lineHeight, metaScrollH: metaEl.scrollHeight, vw: window.innerWidth };
  });
  // Phụ đề chỉ hiện 2 dòng (còn nhiều dòng hơn thì bị cắt), và đúng là dài hơn 2 dòng.
  expect(m.meta.height, 'phụ đề cắt ở hai dòng').toBeLessThanOrEqual(m.lineHeight * 2 + 1);
  expect(m.metaScrollH, 'phụ đề thật dài hơn hai dòng (ca này phải đo đúng tình huống)').toBeGreaterThan(m.lineHeight * 2 + 1);
  // Mã ở hàng riêng dưới phụ đề, không đè lên.
  expect(m.code.top, 'mã nằm dưới phụ đề').toBeGreaterThanOrEqual(m.meta.bottom - 1);
  // Mã nguyên vẹn: không bị cắt ngang chữ, nằm trọn trong khung chip và trong màn hình.
  expect(m.code.right, 'mã trong khung chip').toBeLessThanOrEqual(m.chip.right + 0.5);
  expect(m.code.bottom, 'mã trong khung chip').toBeLessThanOrEqual(m.chip.bottom + 0.5);
  expect(m.code.left).toBeGreaterThanOrEqual(0);
  expect(m.code.right, 'mã trong màn hình 375px').toBeLessThanOrEqual(m.vw);
  await expect(meta).toBeVisible();

  await expect(page.getByRole('group', { name: 'Quà tặng' }).getByTestId('voucher-code')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByTestId('brand-vouchers').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('brand-chip-code375.png') });
});

const LONG_CODE = 'KHAITRUONGTRIANKHACHHANG2026-FUWA-VIP'.padEnd(39, 'X');

test('mã dài 39 ký tự xuống dòng trong thân chip: đủ chữ, không nằm dưới nút Sao chép, không tràn trang', async ({ page, api }, testInfo) => {
  mockBrandPage(api);
  api.get('/brand/public/:slug', { ...FUWA, promotions: [promo('p-longcode', 'Mã dài', LONG_CODE)] });
  await page.goto(`/brand/${BRAND_SLUG}`);
  const chip = page.getByRole('group', { name: 'Mã dài' });
  await expect(chip).toBeVisible({ timeout: 15_000 });
  const code = chip.getByTestId('voucher-code');
  await expect(code).toHaveText(LONG_CODE);
  const button = chip.getByRole('button', { name: /Sao chép/ });
  await expect(button).toBeVisible();

  const btn = (await button.boundingBox())!;
  const body = (await chip.getByTestId('voucher-body').boundingBox())!;
  const rects = await code.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return Array.from(range.getClientRects()).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
  });
  expect(rects.length, 'mã dài xuống ít nhất hai dòng trong thân chip').toBeGreaterThan(1);
  const right = Math.max(...rects.map((r) => r.right));
  const left = Math.min(...rects.map((r) => r.left));
  expect(right, 'mép phải mã không chạm nút Sao chép').toBeLessThanOrEqual(btn.x + 0.5);
  expect(right, 'mã trong thân chip').toBeLessThanOrEqual(body.x + body.width + 0.5);
  expect(left, 'mã trong thân chip').toBeGreaterThanOrEqual(body.x - 0.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByTestId('brand-vouchers').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('brand-chip-longcode375.png') });
});
