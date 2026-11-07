import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { firstProduct, type PdpProduct } from './support/pdp-product';
import { NARROW_WIDTHS, probeLayout } from './support/layout-probe';
import { expectNoPressMotion, expectPressFeedback, probeTapTargets, waitUntilStill } from './support/touch-probe';
import { mockWebAddressBook, mockWebAffiliate, mockWebLoyalty, mockWebProfile, mockWebVouchers, webSignIn } from './support/touch-p4-web-mocks';

/**
 * W40A: Cá nhân /tai-khoan, Điểm Xanh /tai-khoan/diem-xanh, Mã giảm giá /ma-giam-gia, Sổ địa chỉ /tai-khoan/dia-chi, Đánh giá ở trang sản phẩm và
 * Cộng tác viên /ctv của web ở 320 / 360 / 375px, cùng chuẩn với Mini App (touch-ergonomics-p4.miniapp.spec.ts, touch-press-p4.miniapp.spec.ts):
 * vùng chạm thật ≥ 44 × 44px, không tràn ngang, số tiền/điểm vẽ bằng số đều, nhấn giữ co 0,97..0,99 (giảm chuyển động thì không co).
 * Chỉ dò phần thân trang (`main`): đầu trang và thanh dưới dùng chung của khung web không thuộc các màn này. Mọi lời gọi từ trình duyệt đi qua mock;
 * trang sản phẩm do máy chủ Next dựng từ API thật nên cần một sản phẩm có sẵn trong DB e2e.
 */
async function expectClean(page: Page, screen: string, width: number, scope = 'main'): Promise<void> {
  const taps = await probeTapTargets(page, { scope });
  expect.soft(taps, `${screen} ${width}px: vùng chạm dưới 44px`).toEqual([]);
  const f = await probeLayout(page, { scope });
  expect.soft(f.overflow, `${screen} ${width}px tràn ngang`).toEqual([]);
  expect.soft(f.notTabular, `${screen} ${width}px số không đều`).toEqual([]);
}

async function mockReviewedPdp(api: MockApi, p: PdpProduct): Promise<void> {
  api.get('/flash-sales/active', []);
  api.get('/config/public', { freeshipThreshold: 350_000, subscribeDiscountPct: 0.12 });
  api.get(`/products/${p.slug}`, { variations: p.variations });
  api.get(`/products/${p.slug}/related`, []);
  api.get(`/products/${p.slug}/bought-together`, []);
  api.get('/products/for-you', []);
  api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
  const review = (id: string, rating: number, extra: Record<string, unknown> = {}) => ({
    id, rating, comment: `Nhận xét ${id}`, images: [] as string[], videoUrl: null as string | null,
    createdAt: '2026-09-01T00:00:00.000Z', author: `Khách ${id}`, verifiedPurchase: true, ...extra,
  });
  const img = (n: number) => `https://res.cloudinary.com/tubu/image/upload/v1/r${n}.jpg`;
  api.get(`/products/${p.slug}/reviews`, {
    average: 4.9, count: 1_234, videoCount: 1, distribution: { '5': 1_200, '4': 30, '1': 4 },
    items: [
      review('r1', 5),
      review('r2', 5, { images: [img(1), img(2), img(3)] }),
      review('r3', 4, { videoUrl: 'https://res.cloudinary.com/tubu/video/upload/v1/r3.mp4', images: [img(4)] }),
      review('r4', 1),
    ],
    nextCursor: null,
  });
  api.get(`/products/${p.slug}/reviews/can-review`, {
    canReview: true, reason: null, rewardAvailable: true, purchaseCount: 1,
    reviewableOrders: [{ orderId: 'ord-w40a', code: 'TUBU-W40A-RV', deliveredAt: '2026-10-20T08:00:00.000Z' }],
    myReviews: [],
  });
  api.allowUnmocked('GET /me/coupons', 'GET /affiliate/me', 'GET /cart', 'POST /events', 'POST /affiliate/touch');
}

for (const width of NARROW_WIDTHS) {
  test.describe(`Web ${width}px: vùng chạm, tràn ngang, số đều, nhấn (Cá nhân, Điểm Xanh, Mã, Địa chỉ, Đánh giá, CTV)`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ do spec tự đặt, cần Chromium: một project là đủ');
      await page.setViewportSize({ width, height: 760 });
    });

    test('Cá nhân', async ({ page, api }) => {
      await webSignIn(page, api);
      mockWebProfile(api);
      await page.goto('/tai-khoan');
      await expect(page.getByText('12.450 điểm', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expectClean(page, 'Cá nhân', width);
      await expectPressFeedback(page, page.getByRole('main').getByRole('link', { name: /Nguyễn Văn An/ }).first(), 'hàng hồ sơ (Chỉnh sửa hồ sơ)');
    });

    test('Điểm Xanh và thẻ thành viên số', async ({ page, api }) => {
      await webSignIn(page, api);
      mockWebLoyalty(api);
      await page.goto('/tai-khoan/diem-xanh');
      await expect(page.getByRole('heading', { name: 'Hạng thành viên & Điểm Xanh', level: 1 })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('12.450 Điểm Xanh')).toBeVisible();
      await expectClean(page, 'Điểm Xanh', width);

      await page.getByRole('button', { name: /Thẻ thành viên số/ }).click();
      const copy = page.getByRole('button', { name: /^Chép$/ });
      await expect(copy).toBeVisible();
      await waitUntilStill(copy);
      await expectClean(page, 'Thẻ thành viên số', width, '[role="dialog"]');
      await expectPressFeedback(page, copy, 'nút Chép mã thành viên');
    });

    test('Mã giảm giá: Nhận mã, Mã của tôi, Đã dùng–hết hạn', async ({ page, api }) => {
      await webSignIn(page, api);
      mockWebVouchers(api);
      for (const [tab, name, ready] of [
        ['', 'Nhận mã', 'button:has-text("Lưu mã")'],
        ['?tab=mine', 'Mã của tôi', '[role="group"]'],
        ['?tab=history', 'Đã dùng–hết hạn', '[role="group"]'],
      ] as const) {
        await page.goto(`/ma-giam-gia${tab}`);
        await expect(page.locator(ready).first()).toBeVisible({ timeout: 30_000 });
        await expectClean(page, `Mã giảm giá (${name})`, width);
      }
      await page.goto('/ma-giam-gia');
      await expect(page.getByRole('button', { name: 'Lưu mã' }).first()).toBeVisible({ timeout: 30_000 });
      await expectPressFeedback(page, page.getByRole('button', { name: 'Lưu mã' }).first(), 'nút Lưu mã');
    });

    test('Sổ địa chỉ và form sửa địa chỉ', async ({ page, api }) => {
      await webSignIn(page, api);
      mockWebAddressBook(api);
      await page.goto('/tai-khoan/dia-chi');
      await expect(page.getByText('Mặc định', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expectClean(page, 'Sổ địa chỉ', width);
      await expectPressFeedback(page, page.getByRole('button', { name: 'Đặt mặc định' }).first(), 'nút Đặt mặc định');
      await expectPressFeedback(page, page.getByRole('button', { name: 'Sửa' }).first(), 'nút Sửa');
      await expectPressFeedback(page, page.getByRole('button', { name: 'Xoá' }).first(), 'nút Xoá');

      // Web sửa địa chỉ ngay trong thẻ (không có tấm đáy), Tỉnh/Phường chọn trong sheet tìm không dấu (sheet dò riêng ở address-location-sheet.web.spec.ts): dò cả form.
      await page.getByRole('button', { name: 'Sửa' }).first().click();
      await expect(page.getByRole('heading', { name: 'Sửa địa chỉ' })).toBeVisible();
      await expect(page.getByLabel('Tỉnh/Thành phố')).toBeVisible();
      await expectClean(page, 'Form sửa địa chỉ', width);
    });

    test('Đánh giá có ảnh/video và tấm viết đánh giá', async ({ page, api, request }) => {
      const product = await firstProduct(request);
      test.skip(!product, 'DB e2e chưa có sản phẩm nào');
      await webSignIn(page, api);
      await mockReviewedPdp(api, product!);
      await page.goto(`/san-pham/${product!.slug}`);
      const section = page.locator('[data-section="pdp-reviews"]');
      await section.scrollIntoViewIfNeeded();
      await expect(section.getByText('Nhận xét r1')).toBeVisible({ timeout: 30_000 });
      await expectClean(page, 'Đánh giá', width, '[data-section="pdp-reviews"]');
      await expectPressFeedback(page, section.getByRole('button', { name: /^5 sao/ }), 'chip lọc 5 sao');

      await expect.poll(() => api.callsTo('GET', `/products/${product!.slug}/reviews/can-review`).length, { timeout: 20_000 }).toBeGreaterThan(0);
      await section.getByRole('button', { name: 'Viết đánh giá' }).first().click();
      const form = page.getByRole('form', { name: 'Viết đánh giá' });
      await expect(form).toBeVisible();
      await waitUntilStill(form);
      await expectClean(page, 'Form viết đánh giá', width, 'form[aria-label="Viết đánh giá"]');
      await expectPressFeedback(page, form.getByRole('radio', { name: '3 sao' }), 'nút chọn sao');
      await form.getByRole('radio', { name: '3 sao' }).click();
      await expectPressFeedback(page, form.getByRole('button', { name: 'Gửi đánh giá' }), 'nút Gửi đánh giá');
    });

    test('Cộng tác viên: Tổng quan, Hoa hồng, Chia sẻ', async ({ page, api }) => {
      await webSignIn(page, api);
      mockWebAffiliate(api);
      for (const [tab, name, ready] of [
        ['overview', 'Tổng quan', 'Bậc theo doanh số đã chốt tháng này'],
        ['commission', 'Hoa hồng', 'Hoa hồng'],
        ['share', 'Chia sẻ', 'Mã giới thiệu của bạn'],
      ] as const) {
        await page.goto(`/ctv?tab=${tab}`);
        await expect(page.getByText(ready, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
        await expectClean(page, `Cộng tác viên (${name})`, width);
      }
      await page.goto('/ctv?tab=share');
      const copy = page.getByRole('button', { name: /^Sao chép/ }).first();
      await expect(copy).toBeVisible({ timeout: 30_000 });
      await expectPressFeedback(page, copy, 'nút Sao chép');
    });

    test('giảm chuyển động thì nút không co khi nhấn', async ({ page, api }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await webSignIn(page, api);
      mockWebAddressBook(api);
      await page.goto('/tai-khoan/dia-chi');
      await expect(page.getByText('Mặc định', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expectNoPressMotion(page, page.getByRole('button', { name: 'Sửa' }).first(), 'nút Sửa');
      await expectNoPressMotion(page, page.getByRole('button', { name: 'Đặt mặc định' }).first(), 'nút Đặt mặc định');
    });
  });
}
