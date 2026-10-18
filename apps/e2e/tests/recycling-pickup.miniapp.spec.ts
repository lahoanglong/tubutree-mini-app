import { test, expect, makeOrder, mockSession, makeUser, reply, wasteMe } from './support/mock-api';
import type { MockApi } from './support/mock-api';
import { mockCheckout, publicConfig } from './support/checkout-mocks';
import { wasteDetail, wasteSummary } from './support/waste-mocks';

/**
 * Zalo Mini App E2E — Thu kèm rác (yêu cầu PICKUP gắn vào đơn đổi hàng).
 *
 * UI dưới test:
 *   - apps/miniapp/src/pages/checkout.tsx: khối #checkout-waste-pickup, công tắc role=checkbox "Thu kèm rác"
 *     với thẻ tóm tắt yêu cầu PICKUP đang mở; chưa có yêu cầu thì là dòng dẫn tới /recycle/new. Body
 *     POST /checkout/place-order mang wasteRequestId khi khách bật; hai trường thu gom cũ đã bỏ.
 *   - apps/miniapp/src/pages/order-detail.tsx: dòng "Yêu cầu thu rác TR-…" dẫn tới trang theo dõi yêu cầu.
 */

const PICKUP = wasteDetail({
  id: 'wr-pk-1',
  code: 'TR-PK9MV',
  method: 'PICKUP',
  status: 'OPEN',
  pointName: 'Kho Tubu TP.HCM',
  expiresAt: '2026-10-24T03:00:00.000Z',
});
const FLAGS_ON = { enabled: true, dropoff: true, mailin: true, pickup: true };
const PLACE_BTN = /Đặt hàng · 149\.000đ/;

function setup(api: MockApi, me: Parameters<typeof wasteMe>[0] = {}, flags = FLAGS_ON): void {
  mockSession(api, makeUser({ id: 'user-checkout' }));
  mockCheckout(api);
  api.get('/config/public', publicConfig({ waste: flags }));
  api.get(
    '/waste/me',
    wasteMe({
      programmeEnabled: true,
      laneFlags: { dropoff: true, mailin: true, pickup: true },
      openRequests: [wasteSummary(PICKUP)],
      ...me,
    }),
  );
}

test.describe('Checkout — Thu kèm rác', () => {
  test('cờ pickup bật + có yêu cầu PICKUP chưa gắn đơn: hiện công tắc Thu kèm rác và thẻ tóm tắt; bật thì đơn mang wasteRequestId', async ({ page, api }) => {
    setup(api);
    await page.goto('/checkout');
    const placeBtn = page.getByRole('button', { name: PLACE_BTN });
    await expect(placeBtn).toBeEnabled({ timeout: 15_000 });

    const toggle = page.getByRole('checkbox', { name: 'Thu kèm rác', exact: true });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('TR-PK9MV')).toBeVisible();
    await expect(page.getByText(/3 thùng Thùng carton cũ|Thùng carton cũ: 3 thùng/)).toBeVisible();
    await expect(page.getByText('Ước tính 3.000 điểm')).toBeVisible();
    await expect(page.getByText(/quần áo cũ|cục pin/)).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeBtn.click();
    const call = await placed;
    expect(call.body).toMatchObject({ wasteRequestId: 'wr-pk-1' });
    expect(call.body).not.toHaveProperty('hasRecyclingPickup');
    expect(call.body).not.toHaveProperty('recyclingNote');
  });

  test('công tắc mặc định tắt: đơn không có wasteRequestId', async ({ page, api }) => {
    setup(api);
    await page.goto('/checkout');
    const placeBtn = page.getByRole('button', { name: PLACE_BTN });
    await expect(placeBtn).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByRole('checkbox', { name: 'Thu kèm rác', exact: true })).toBeVisible();

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeBtn.click();
    await placed;
    expect(api.callsTo('POST', '/checkout/place-order')[0]!.body).not.toHaveProperty('wasteRequestId');
  });

  test('cờ pickup tắt: không có công tắc', async ({ page, api }) => {
    setup(api, {}, { ...FLAGS_ON, pickup: false });
    await page.goto('/checkout');
    const placeBtn = page.getByRole('button', { name: PLACE_BTN });
    await expect(placeBtn).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByRole('checkbox', { name: 'Thu kèm rác' })).toHaveCount(0);
    expect(api.callsTo('GET', '/waste/me')).toHaveLength(0);

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeBtn.click();
    await placed;
    expect(api.callsTo('POST', '/checkout/place-order')[0]!.body).not.toHaveProperty('wasteRequestId');
  });

  for (const [name, me] of [
    ['shipLockedAt', { shipLockedAt: '2026-10-10T00:00:00.000Z' }],
    ['blocked', { blocked: true }],
  ] as const) {
    test(`khách bị khoá gửi (${name}): không có công tắc`, async ({ page, api }) => {
      setup(api, me);
      await page.goto('/checkout');
      await expect(page.getByRole('button', { name: PLACE_BTN })).toBeEnabled({ timeout: 15_000 });
      await expect.poll(() => api.callsTo('GET', '/waste/me').length).toBeGreaterThan(0);
      await expect(page.getByText('Thu kèm rác')).toHaveCount(0);
    });
  }

  test('chưa có yêu cầu: dòng dẫn tới màn Chọn món', async ({ page, api }) => {
    setup(api, { openRequests: [] });
    await page.goto('/checkout');
    await expect(page.getByRole('button', { name: PLACE_BTN })).toBeEnabled({ timeout: 15_000 });
    await page.getByRole('button', { name: /Thu kèm rác/ }).click();
    await expect(page).toHaveURL(/\/recycle\/new/);
  });

  test('server báo yêu cầu đã hết hạn: hiện câu 409, không sang màn đơn thành công', async ({ page, api }) => {
    setup(api);
    api.post('/checkout/place-order', () => reply(409, { statusCode: 409, message: 'Yêu cầu thu rác đã hết hạn hoặc đã huỷ' }));
    await page.goto('/checkout');
    const placeBtn = page.getByRole('button', { name: PLACE_BTN });
    await expect(placeBtn).toBeEnabled({ timeout: 15_000 });
    await page.getByRole('checkbox', { name: 'Thu kèm rác', exact: true }).click();
    await placeBtn.click();
    await expect(page.getByText('Yêu cầu thu rác đã hết hạn hoặc đã huỷ')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Cảm ơn bạn đã chọn Tubu')).not.toBeVisible();
  });
});

test.describe('Chi tiết đơn — yêu cầu thu rác gắn kèm', () => {
  test.beforeEach(async ({ api }) => {
    mockSession(api, makeUser({ id: 'user-recycle' }));
    api.get('/orders/me/returns', []);
  });

  test('chi tiết đơn có yêu cầu gắn kèm: dòng dẫn tới trang theo dõi yêu cầu', async ({ page, api }) => {
    api.get('/orders/:code', makeOrder({ code: 'TUBU-PK-1', id: 'ord-pk-1', status: 'CONFIRMED', hasRecyclingPickup: true }));
    api.get('/waste/requests/by-order/:orderId', { ...PICKUP, orderId: 'ord-pk-1', orderCode: 'TUBU-PK-1' });
    await page.goto('/order/TUBU-PK-1');
    await page.getByRole('button', { name: /Yêu cầu thu rác TR-PK9MV/ }).click();
    await expect(page).toHaveURL(/\/recycle\/r\/wr-pk-1/);
  });

  test('chi tiết đơn không gắn yêu cầu: không có dòng thu kèm', async ({ page, api }) => {
    api.get('/orders/:code', makeOrder({ code: 'TUBU-PK-2', id: 'ord-pk-2', status: 'CONFIRMED', hasRecyclingPickup: true }));
    api.get('/waste/requests/by-order/:orderId', () => reply(404, { statusCode: 404, message: 'Không tìm thấy mã' }));
    await page.goto('/order/TUBU-PK-2');
    await expect(page.getByText('Đã xác nhận').first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => api.callsTo('GET', '/waste/requests/by-order/:orderId').length).toBeGreaterThan(0);
    await expect(page.getByText(/Yêu cầu thu rác/)).toHaveCount(0);
    await expect(page.getByText(/Không tìm thấy mã/)).toHaveCount(0);
  });
});
