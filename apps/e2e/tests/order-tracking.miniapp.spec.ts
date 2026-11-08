import { test, expect } from './support/mock-api';
import { mockWorld, openState } from './support/order-detail-states';
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
    await page.getByTestId('order-shipping').getByRole('button', { name: 'Sao chép mã vận đơn GHN6789012345' }).click();
    await expect(page.getByText('Đã sao chép mã vận đơn')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe('GHN6789012345');
  });

  test('đơn chờ thanh toán: hạn trả + còn bao lâu, nút Thanh toán ngay, Huỷ đơn trong menu', async ({ page, api }) => {
    const state = stateOf('pending-payment');
    const w = await mockWorld(api, page, 'miniapp', state, Date.now());
    await openState(page, 'miniapp', 375, w.order.code);
    await state.ready(page);
    await expectPendingPayment(page);
  });
});
