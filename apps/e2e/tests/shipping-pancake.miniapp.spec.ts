import { test, expect, makeOrder, makeUser, mockSession, reply } from './support/mock-api';

/**
 * E2E Test — Luồng Vận chuyển Pancake POS & Hiển thị trên Zalo Mini App
 * (apps/miniapp/src/pages/order-detail.tsx — khối "Vận chuyển" §6.4; GET /orders/:code).
 *
 * Kiểm tra:
 * 1. Đơn có thông tin vận chuyển đồng bộ từ Pancake: hãng VC, mã vận đơn, trạng thái VC,
 *    nút "Sao chép", nút "Tra cứu hành trình", các chặng hành trình (shippingHistory).
 * 2. Bấm "Sao chép" → mã vận đơn THẬT vào clipboard + snackbar thành công.
 * 3. Đơn chưa gán vận chuyển → không hiện khối vận chuyển rỗng.
 */
test.describe('Zalo Mini App E2E - Luồng Đối tác Vận chuyển (Pancake POS Sync)', () => {
  const ORDER_SHIPPING = makeOrder({
    code: 'TUBU20260919001',
    status: 'SHIPPING',
    subtotal: 250000,
    shippingFee: 0,
    total: 250000,
    pointsEarned: 25,
    shippingPartner: 'Giao Hàng Nhanh',
    shippingCode: 'GHN123456789',
    shippingStatus: 'Đang vận chuyển tới người nhận',
    trackingLink: 'https://tracking.ghn.vn/?code=GHN123456789',
    shippingHistory: [
      { at: '2026-09-19T08:00:00.000Z', status: 'Lấy hàng thành công', carrier: 'Giao Hàng Nhanh', code: 'GHN123456789' },
      {
        at: '2026-09-19T10:30:00.000Z',
        status: 'Đang luân chuyển qua kho trung chuyển',
        carrier: 'Giao Hàng Nhanh',
        code: 'GHN123456789',
      },
      {
        at: '2026-09-19T13:15:00.000Z',
        status: 'Đang vận chuyển tới người nhận',
        carrier: 'Giao Hàng Nhanh',
        code: 'GHN123456789',
      },
    ],
    createdAt: '2026-09-19T07:30:00.000Z',
    updatedAt: '2026-09-19T13:15:00.000Z',
  });

  const ORDER_PENDING = makeOrder({
    code: 'TUBU20260919002',
    status: 'CONFIRMED',
    subtotal: 150000,
    shippingFee: 19000,
    total: 169000,
    pointsEarned: 15,
    shippingPartner: null,
    shippingCode: null,
    shippingStatus: null,
    trackingLink: null,
    shippingHistory: [],
  });

  test.beforeEach(async ({ api }) => {
    mockSession(api, makeUser({ id: 'user-e2e', fullName: 'Nguyễn Khách Hàng', pointsBalance: 100 }));
    api.get('/orders/:code', ({ params }) =>
      [ORDER_SHIPPING, ORDER_PENDING].find((o) => o.code === params.code) ??
      reply(404, { message: 'Không tìm thấy đơn hàng' }),
    );
  });

  test('Hiển thị đầy đủ thông tin vận chuyển Pancake: Đơn vị VC, Mã vận đơn, Trạng thái & Hành trình', async ({
    page,
  }, testInfo) => {
    await page.goto(`/order/${ORDER_SHIPPING.code}`);

    // Nhãn thật của trạng thái SHIPPING (i18n vi.orderStatus.SHIPPING = 'Đang giao').
    await expect(page.getByText('Đang giao', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText('Vận chuyển', { exact: true })).toBeVisible();
    await expect(page.getByText('Giao Hàng Nhanh', { exact: true })).toBeVisible();
    await expect(page.getByText('Mã vận đơn: GHN123456789')).toBeVisible();
    // Trạng thái VC hiện ở dòng tóm tắt VÀ ở chặng mới nhất của hành trình.
    await expect(page.getByText('Đang vận chuyển tới người nhận', { exact: true })).toHaveCount(2);

    await expect(page.getByRole('button', { name: 'Sao chép' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tra cứu hành trình' })).toBeVisible();

    await expect(page.getByText('Lấy hàng thành công')).toBeVisible();
    await expect(page.getByText('Đang luân chuyển qua kho trung chuyển')).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('shipping-order-detail-view.png'), fullPage: true });
  });

  test('Bấm nút "Sao chép" mã vận đơn: chép đúng mã và báo thành công', async ({ page }) => {
    // navigator.clipboard là getter chỉ-đọc → Object.assign ném lỗi (mock cũ không bao giờ cài được).
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (t: string) => {
            (window as unknown as { __copied?: string }).__copied = t;
            return Promise.resolve();
          },
        },
      });
    });

    await page.goto(`/order/${ORDER_SHIPPING.code}`);
    const copyBtn = page.getByRole('button', { name: 'Sao chép' });
    await expect(copyBtn).toBeVisible({ timeout: 15_000 });
    await copyBtn.click();

    await expect(page.getByText('Đã sao chép mã vận đơn')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Không sao chép được')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe('GHN123456789');
  });

  test('Đơn hàng mới chưa gán vận chuyển (chờ xử lý kho Pancake) không hiện khối vận chuyển rỗng', async ({
    page,
  }) => {
    await page.goto(`/order/${ORDER_PENDING.code}`);
    await expect(page.getByText('Đã xác nhận').first()).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText('Vận chuyển', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Mã vận đơn:')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sao chép' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Tra cứu hành trình' })).toHaveCount(0);
  });
});
