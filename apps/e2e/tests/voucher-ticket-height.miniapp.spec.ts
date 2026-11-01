import type { Locator } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { mockCollectable, mockCouponHistory, mockWallet } from './support/voucher-mocks';

/**
 * Zalo Mini App E2E — chiều cao phiếu mã giảm giá ở 375px (F10d, lỗi P1 #18; G1): thiết kế ~88px, nhãn một dòng, điều kiện và tên admin một hàng,
 * hạn · số lượt · mã một hàng đáy, một phiếu không trộn "99.000đ" với "99k". Dữ liệu giả cố tình có tên dài, tên lặp số và mã dài 15 ký tự cùng "Còn 3 lượt".
 * Ở 320px (máy nhỏ nhất của Zalo) chỉ giữ một điều: mã không bị cắt. API mock toàn bộ.
 */
const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

const WALLET = [
  { code: 'NHANSHIP', title: 'Miễn phí giao hàng đơn từ 99.000đ', type: 'FREESHIP', value: 0, minOrder: 99_000, maxDiscount: null, endAt: inDays(2) },
  { code: 'NHAN10', title: 'Giảm 10% tối đa 50.000đ', type: 'PERCENT', value: 10, minOrder: 300_000, maxDiscount: 50_000, endAt: inDays(12) },
  { code: 'NHANXANH20K', title: 'Giảm 20.000đ đơn từ 150.000đ', type: 'AMOUNT', value: 20_000, minOrder: 150_000, maxDiscount: null, endAt: inDays(6) },
  { code: 'BEPXANH15', title: 'Chương trình tri ân khách hàng thân thiết mùa thu', type: 'PERCENT', value: 15, minOrder: 250_000, maxDiscount: 45_000, endAt: inDays(30) },
  { code: 'QUAKHACHMOI', title: 'Quà khách mới', type: 'AMOUNT', value: 30_000, minOrder: 0, maxDiscount: null, endAt: inDays(20) },
  { code: 'TUBU99', title: null, type: 'PERCENT', value: 99, minOrder: 999_000, maxDiscount: 999_000, endAt: inDays(40) },
];

// Hàng đáy (hạn dùng · số lượt · mã) là một hàng `flex-wrap`: mã dài thì gãy xuống dòng riêng và phiếu cao thêm đúng một dòng caption (20px).
// Phiếu thường tối đa 96px; phiếu có hàng đáy gãy tối đa 104px (dòng caption 20px, đệm 8px); trong một danh sách chênh nhau không quá 16px.
const NORMAL_MAX = 96;
const FOOT_WRAP_MAX = 104;
const FOOT_LINE = 24; // hàng đáy một dòng cao 20px, hai dòng 40px

async function expectCompactTickets(groups: Locator, expected: number) {
  await expect(groups).toHaveCount(expected, { timeout: 15_000 });
  const rows = await groups.evaluateAll((els) =>
    els.map((el) => {
      const title = el.querySelector<HTMLElement>('[data-testid="voucher-body"]')!.firstElementChild as HTMLElement;
      const foot = el.querySelector<HTMLElement>('[data-testid="voucher-foot"]');
      return {
        code: el.querySelector('[data-testid="voucher-code"]')?.textContent ?? '?',
        h: Math.round(el.getBoundingClientRect().height),
        titleH: Math.round(title.getBoundingClientRect().height),
        footH: foot ? Math.round(foot.getBoundingClientRect().height) : 0,
        text: el.textContent ?? '',
      };
    }),
  );
  for (const r of rows) {
    const max = r.footH > FOOT_LINE ? FOOT_WRAP_MAX : NORMAL_MAX;
    expect(r.h, `${r.code}: phiếu cao ${r.h}px`).toBeGreaterThanOrEqual(88);
    expect(r.h, `${r.code}: phiếu cao ${r.h}px (hàng đáy ${r.footH}px)`).toBeLessThanOrEqual(max);
    expect(r.titleH, `${r.code}: nhãn gãy dòng (${r.titleH}px)`).toBeLessThanOrEqual(24);
    // Một cách ghi số: phiếu rút gọn "99k", không còn "99.000đ" trên cùng phiếu.
    expect(/\d\.\d{3}đ/.test(r.text), `${r.code}: còn số đầy đủ "${r.text}"`).toBe(false);
  }
  const heights = rows.map((r) => r.h);
  expect(Math.max(...heights) - Math.min(...heights), `chênh cao trong một danh sách: ${heights.join(', ')}`).toBeLessThanOrEqual(16);
}

// Kho "Nhận mã": một phiếu có tên admin, mã dài và "Còn 3 lượt" (mọi thứ cùng lúc), một phiếu trơn, một Miễn phí giao hàng có tên lặp số.
const COLLECT = [
  { code: 'NHANLOCXANH2026', title: 'Quà tri ân khách hàng thân thiết', type: 'AMOUNT', value: 50_000, minOrder: 300_000, maxDiscount: null, startAt: inDays(-1), endAt: inDays(5), newCustomerOnly: false, claimedCount: 7, usageLimit: 10 },
  { code: 'NHAN10', title: null, type: 'PERCENT', value: 10, minOrder: 200_000, maxDiscount: 40_000, startAt: inDays(-1), endAt: inDays(20), newCustomerOnly: false, claimedCount: 0, usageLimit: null },
  { code: 'FS99', title: 'Miễn phí giao hàng đơn từ 99.000đ', type: 'FREESHIP', value: 0, minOrder: 99_000, maxDiscount: null, startAt: inDays(-1), endAt: inDays(2), newCustomerOnly: false, claimedCount: 0, usageLimit: null },
];

test.describe('Phiếu mã giảm giá ở 375px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(({ api }) => {
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api);
    mockCollectable(api, COLLECT as never);
    mockWallet(api, WALLET as never);
    mockCouponHistory(api);
  });

  test('Mã của tôi: phiếu 88 đến 96px (hàng đáy gãy thì 104px), nhãn một dòng, không trộn cách ghi số', async ({ page }) => {
    await page.goto('/vouchers?tab=mine');
    await expectCompactTickets(page.getByRole('tabpanel', { name: 'Mã của tôi' }).getByRole('group'), WALLET.length);
  });

  test('Nhận mã: phiếu có tên, mã dài và "Còn 3 lượt" vẫn trong khung 104px, cạnh phiếu trơn chênh không quá 16px', async ({ page }) => {
    await page.goto('/vouchers');
    await expectCompactTickets(page.getByRole('tabpanel', { name: 'Nhận mã' }).getByRole('group'), COLLECT.length);
  });
});

test.describe('Phiếu mã giảm giá ở 320px', () => {
  test.use({ viewport: { width: 320, height: 812 } });

  test.beforeEach(({ api }) => {
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api);
    mockCollectable(api, COLLECT as never);
    mockWallet(api, WALLET as never);
    mockCouponHistory(api);
  });

  test('Nhận mã: mã dài 15 ký tự nằm trọn trong phiếu, không bị cắt', async ({ page }) => {
    await page.goto('/vouchers');
    const code = page.getByTestId('voucher-code').filter({ hasText: 'NHANLOCXANH2026' });
    await expect(code).toBeVisible({ timeout: 15_000 });
    const fits = await code.evaluate((el) => {
      const c = el.getBoundingClientRect();
      const t = el.closest('[role="group"]')!.getBoundingClientRect();
      return c.left >= t.left && c.right <= t.right && el.scrollWidth <= el.clientWidth + 1;
    });
    expect(fits, 'mã tràn ra ngoài phiếu').toBe(true);
  });
});
