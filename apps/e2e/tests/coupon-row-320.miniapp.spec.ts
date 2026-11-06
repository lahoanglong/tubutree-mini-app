import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession } from './support/mock-api';
import { mockFooterCart, type FooterCartOptions } from './support/cart-footer-mocks';
import { expectRowIntact, rowFacts } from './support/coupon-row-facts';

/**
 * Hàng mã giảm giá ở chân dính giỏ Mini App (CouponRow) trên máy hẹp 320px: chữ không bị cắt "…" và lời mời không rớt xuống 3 dòng chật chội.
 * Nhãn "Mã giảm giá" nằm trên, nội dung (mã đã áp + số giảm, gợi ý, hoặc lời mời) xuống dòng dưới khi dòng đầu không đủ chỗ, và cả hàng
 * vẫn cao đúng 44px (vùng chạm), nên chân dính không cao thêm. Ở 375px lời mời vẫn cùng dòng với nhãn; mã đã áp xuống dòng dưới vì cả dòng
 * cần 349px trên hàng rộng 343px. API mock toàn bộ.
 */
test.use({ viewport: { width: 320, height: 568 } });

const HINT = { usable: 3, maxSaving: 50_000 };

async function openCart(page: Page, api: Parameters<typeof mockFooterCart>[0], o: FooterCartOptions & { hint?: typeof HINT } = {}): Promise<void> {
  mockSession(api, makeUser({ id: 'user-coupon-row', fullName: 'Khách Mã' }));
  mockFooterCart(api, { lines: 2, reached: false, ...o });
  await page.goto('/cart');
  await expect(page.getByTestId('coupon-row')).toBeVisible({ timeout: 15_000 });
  if (o.hint) await expect(page.getByTestId('coupon-hint')).toBeVisible();
}

test.describe('Giỏ Mini App: hàng mã giảm giá ở 320px', () => {
  test('chưa có mã: lời mời một dòng dưới nhãn, không "…", hàng vẫn 44px', async ({ page, api }) => {
    await openCart(page, api);
    const f = await rowFacts(page);
    expectRowIntact(f);
    expect(f.lines['coupon-placeholder'], `lời mời ${f.lines['coupon-placeholder']} dòng`).toBe(1);
    expect(f.mids['coupon-placeholder']! - f.mids['coupon-label']!, 'lời mời nằm dưới nhãn (xuống dòng)').toBeGreaterThan(8);
  });

  test('có gợi ý mã: gợi ý một dòng, không "…", hàng vẫn 44px', async ({ page, api }) => {
    await openCart(page, api, { hint: HINT });
    const f = await rowFacts(page);
    expectRowIntact(f);
    expect(f.lines['coupon-hint'], `gợi ý ${f.lines['coupon-hint']} dòng`).toBe(1);
  });

  test('đã áp mã: mã và số giảm hiện đủ, không "…", hàng vẫn 44px', async ({ page, api }) => {
    await openCart(page, api, { coupon: { code: 'WELCOME30', discount: 30_000 } });
    const f = await rowFacts(page);
    expectRowIntact(f);
    await expect(page.getByTestId('coupon-code')).toHaveText('WELCOME30');
    await expect(page.getByTestId('coupon-discount')).toHaveText('-30.000đ');
    expect(f.lines['coupon-code'], 'mã một dòng').toBe(1);
    expect(f.lines['coupon-discount'], 'số giảm một dòng').toBe(1);
  });

  test('mã 11 ký tự và số giảm 50.000đ: vẫn đủ chữ, không "…"', async ({ page, api }) => {
    await openCart(page, api, { coupon: { code: 'XANHTHANG11', discount: 50_000 } });
    const f = await rowFacts(page);
    expectRowIntact(f);
    await expect(page.getByTestId('coupon-code')).toHaveText('XANHTHANG11');
    await expect(page.getByTestId('coupon-discount')).toHaveText('-50.000đ');
  });

  test('mã dài bất thường: không tràn hàng, hàng vẫn 44px (cắt có kiểm soát là chốt cuối)', async ({ page, api }) => {
    await openCart(page, api, { coupon: { code: 'KHUYENMAI-THANG-MUOI-MOT-VIP-2026', discount: 1_250_000 } });
    const f = await rowFacts(page);
    expect(f.rowH, `hàng mã cao ${f.rowH}px`).toBeLessThanOrEqual(44.5);
    expect(f.outside, `phần tử tràn ra ngoài hàng: ${JSON.stringify(f.outside)}`).toEqual([]);
    expect(f.pageOverflow, 'trang tràn ngang').toBe(false);
    await expect(page.getByTestId('coupon-discount')).toHaveText('-1.250.000đ');
  });

  test('chạm vào hàng vẫn mở bảng chọn mã', async ({ page, api }) => {
    await openCart(page, api);
    await page.getByTestId('coupon-row').click();
    await expect(page.getByRole('textbox', { name: /nhập mã/i })).toBeVisible();
  });
});

test.describe('Giỏ Mini App: hàng mã giảm giá ở 375px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('chưa có mã: nhãn và lời mời cùng một dòng (đủ chỗ), hàng 44px', async ({ page, api }) => {
    await openCart(page, api);
    const f = await rowFacts(page);
    expectRowIntact(f);
    expect(Math.abs(f.mids['coupon-placeholder']! - f.mids['coupon-label']!), 'lời mời lệch dòng so với nhãn').toBeLessThanOrEqual(3);
  });

  test('đã áp mã: mã và số giảm hiện đủ, không "…"', async ({ page, api }) => {
    await openCart(page, api, { coupon: { code: 'WELCOME30', discount: 30_000 } });
    const f = await rowFacts(page);
    expectRowIntact(f);
    await expect(page.getByTestId('coupon-code')).toHaveText('WELCOME30');
    await expect(page.getByTestId('coupon-discount')).toHaveText('-30.000đ');
  });
});
