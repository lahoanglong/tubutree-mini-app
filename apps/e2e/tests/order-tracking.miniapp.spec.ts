import { test, expect } from './support/mock-api';
import { mockWorld, openState, type OrderState } from './support/order-detail-states';
import { expectPendingPayment, expectShippingTracking, stateOf } from './support/order-tracking-flow';

/** Mini App /order/:code ở 375×812: đơn đang giao và đơn chờ thanh toán (gói hl). */
test.describe('Mini App theo dõi đơn 375', () => {
  test('đơn đang giao: hành trình, mã vận đơn, một nút chính Liên hệ', async ({ page, api }) => {
    const state = stateOf('shipping');
    const w = await mockWorld(api, page, 'miniapp', state, Date.now());
    await openState(page, 'miniapp', 375, w.order.code);
    await state.ready(page);
    await expectShippingTracking(page);
  });

  test('chép mã vận đơn: mã thật vào clipboard và báo thành công', async ({ page, api }) => {
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
    const state = stateOf('shipping');
    const w = await mockWorld(api, page, 'miniapp', state, Date.now());
    await openState(page, 'miniapp', 375, w.order.code);
    await state.ready(page);
    // Một nút chép mỗi trang: ở viên vận đơn ngay dưới thẻ trạng thái; khối Vận chuyển chỉ in hãng và mã.
    await expect(page.getByTestId('order-shipping').getByRole('button')).toHaveCount(0);
    const pill = page.getByTestId('order-tracking-pill');
    // Tên đọc nói cả hãng (PO A3): khách dùng trình đọc biết dán mã vào ứng dụng nào.
    const pillButton = pill.getByRole('button', { name: 'Sao chép mã vận đơn GHN6789012345 (Giao Hàng Nhanh)', exact: true });
    expect((await pillButton.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await pillButton.click();
    await expect(page.getByText('Đã sao chép mã vận đơn')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe('GHN6789012345');
  });

  for (const status of ['CANCELLED', 'RETURNED'] as const) {
    test(`đơn ${status} mà kho đã gắn mã vận đơn: không có viên vận đơn (PO A3), mã vẫn in ở khối Vận chuyển`, async ({ page, api }) => {
      const shipping = stateOf('shipping');
      const state: OrderState = {
        ...shipping,
        world: (now) => {
          const w = shipping.world(now);
          return { ...w, order: { ...w.order, status } };
        },
        ready: async (p) => {
          await p.getByTestId('order-shipping').waitFor({ state: 'visible', timeout: 15_000 });
        },
      };
      const w = await mockWorld(api, page, 'miniapp', state, Date.now());
      await openState(page, 'miniapp', 375, w.order.code);
      await state.ready(page);
      const card = page.getByTestId('order-shipping');
      await expect(card.getByText('GHN6789012345').first()).toBeVisible();
      await expect(card.getByText('Giao Hàng Nhanh').first()).toBeVisible();
      await expect(page.getByTestId('order-tracking-pill')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Sao chép mã vận đơn/ })).toHaveCount(0);
    });
  }

  test('đơn chờ thanh toán: hạn trả + còn bao lâu, nút Thanh toán ngay, Huỷ đơn trong menu', async ({ page, api }) => {
    const state = stateOf('pending-payment');
    const w = await mockWorld(api, page, 'miniapp', state, Date.now());
    await openState(page, 'miniapp', 375, w.order.code);
    await state.ready(page);
    await expectPendingPayment(page);
  });
});
