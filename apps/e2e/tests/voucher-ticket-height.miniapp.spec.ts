import type { Locator } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { mockCollectable, mockCouponHistory, mockWallet } from './support/voucher-mocks';

/**
 * Zalo Mini App E2E — chiều cao phiếu mã giảm giá ở 375px (F10d, lỗi P1 #18): thiết kế ~88px, nhãn một dòng, hạn và mã cùng một hàng, tên admin
 * nhắc lại số thì không hiện, một phiếu không trộn "99.000đ" với "99k". Tên mã trong dữ liệu giả cố tình dài, lặp số và có cả tên không lặp. API mock toàn bộ.
 */
test.use({ viewport: { width: 375, height: 812 } });

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

// Phiếu "thường" (mã ngắn, không tên riêng): đúng thiết kế ~88px. Phiếu "biên" (mã dài làm hàng điều kiện gãy dòng, hoặc có thêm hàng tên admin đặt):
// mỗi hàng thêm một dòng caption 20px, không hơn; nhãn vẫn một dòng.
const EDGE_CODES = new Set(['NHANXANH20K', 'QUAKHACHMOI', 'BEPXANH15']);

async function expectCompactTickets(groups: Locator, expected: number) {
  await expect(groups).toHaveCount(expected, { timeout: 15_000 });
  const rows = await groups.evaluateAll((els) =>
    els.map((el) => {
      const title = el.querySelector<HTMLElement>('[data-testid="voucher-body"]')!.firstElementChild as HTMLElement;
      return { code: el.querySelector('[data-testid="voucher-code"]')?.textContent ?? '?', h: Math.round(el.getBoundingClientRect().height), titleH: Math.round(title.getBoundingClientRect().height), text: el.textContent ?? '' };
    }),
  );
  for (const r of rows) {
    const max = EDGE_CODES.has(r.code) ? 124 : 92;
    expect(r.h, `${r.code}: phiếu cao ${r.h}px`).toBeGreaterThanOrEqual(88);
    expect(r.h, `${r.code}: phiếu cao ${r.h}px`).toBeLessThanOrEqual(max);
    expect(r.titleH, `${r.code}: nhãn gãy dòng (${r.titleH}px)`).toBeLessThanOrEqual(24);
    // Một cách ghi số: phiếu rút gọn "99k", không còn "99.000đ" trên cùng phiếu.
    expect(/\d\.\d{3}đ/.test(r.text), `${r.code}: còn số đầy đủ "${r.text}"`).toBe(false);
  }
}

test.describe('Phiếu mã giảm giá ở 375px', () => {
  test.beforeEach(({ api }) => {
    mockDiscovery(api, { returning: true });
    mockHomeEngagement(api);
    mockCollectable(api);
    mockWallet(api, WALLET as never);
    mockCouponHistory(api);
  });

  test('Mã của tôi: phiếu thường cao 88px (biên không quá 124px), nhãn một dòng, không trộn cách ghi số', async ({ page }) => {
    await page.goto('/vouchers?tab=mine');
    await expectCompactTickets(page.getByRole('tabpanel', { name: 'Mã của tôi' }).getByRole('group'), WALLET.length);
  });

  test('Nhận mã: phiếu cao 88px', async ({ page }) => {
    await page.goto('/vouchers');
    await expectCompactTickets(page.getByRole('tabpanel', { name: 'Nhận mã' }).getByRole('group'), 3);
  });
});
