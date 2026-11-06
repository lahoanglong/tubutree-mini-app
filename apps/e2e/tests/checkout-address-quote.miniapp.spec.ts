import { test, expect, reply } from './support/mock-api';
import { mockWorld, openState } from './support/checkout-states';
import { FLOW_PLAIN } from './support/checkout-flow-states';
import { CHECKOUT_ADDRESS, CHECKOUT_QUOTE, ORDER_CODE_COD, placedOrderFor } from './support/checkout-mocks';

/**
 * W33, Mini App 375px, API mock. Hai lỗi của địa chỉ giao hàng ở thanh toán:
 * 1. Địa chỉ đã theo địa giới mới nhưng phường không thuộc tỉnh (lưu lúc danh mục Pancake chưa tải được): máy chủ trả ADDRESS_OUTDATED.
 *    Trước đây màn chỉ hiện lời lỗi và "Thử lại", không có lối sửa địa chỉ.
 * 2. Sửa địa chỉ ở Sổ địa chỉ rồi quay lại thanh toán trong 10 giây (thời gian giữ báo giá): màn dùng lại báo giá cũ,
 *    đặt đơn thì máy chủ báo tổng tiền đổi.
 */
const BEN_THANH = { code: '84_VN79_26740', name: 'Phường Bến Thành' };
const MOVED = { ...CHECKOUT_ADDRESS, ward: BEN_THANH.name, wardCode: BEN_THANH.code };
const WARD_MISMATCH = 'Phường/xã không thuộc tỉnh/thành đã chọn. Bạn chọn lại địa chỉ nhé.';

test('Mini App 375: máy chủ báo phường không thuộc tỉnh cho địa chỉ hệ mới → thẻ địa chỉ có nút Sửa địa chỉ, sửa xong đặt được (W33)', async ({ page, api }) => {
  await mockWorld(api, page, 'miniapp', FLOW_PLAIN, Promise.resolve());
  let fixed = false;
  api.get('/geo/communes', [{ code: CHECKOUT_ADDRESS.wardCode, name: CHECKOUT_ADDRESS.ward }, BEN_THANH]);
  api.get('/me/addresses', () => [fixed ? MOVED : CHECKOUT_ADDRESS]);
  api.post('/checkout/quote', () =>
    fixed ? CHECKOUT_QUOTE : reply(400, { statusCode: 400, error: 'Bad Request', code: 'ADDRESS_OUTDATED', message: WARD_MISMATCH }),
  );
  api.patch('/me/addresses/:id', () => {
    fixed = true;
    return MOVED;
  });
  await openState(page, 'miniapp', 375);

  const card = page.locator('[data-ds="checkout-address-card"]').filter({ hasText: CHECKOUT_ADDRESS.street });
  const alert = card.getByRole('alert');
  await expect(alert).toContainText('không khớp với tỉnh/thành', { timeout: 15_000 });
  await alert.getByRole('button', { name: 'Sửa địa chỉ' }).click();
  await expect(page.getByLabel(/Người nhận/).first()).toHaveValue(CHECKOUT_ADDRESS.recipient);

  await page.getByRole('button', { name: /^Phường\/Xã/ }).click();
  await page.getByRole('option', { name: BEN_THANH.name }).click();
  const patched = api.waitForCall('PATCH', '/me/addresses/:id');
  await page.getByRole('button', { name: /^Lưu$/ }).click();
  expect((await patched).body).toMatchObject({ wardCode: BEN_THANH.code });

  await expect(card.getByRole('alert')).toHaveCount(0);
  const place = page.getByRole('button', { name: /Đặt hàng · / });
  await expect(place).toBeEnabled({ timeout: 15_000 });
  const placed = api.waitForCall('POST', '/checkout/place-order');
  await place.click();
  expect((await placed).body).toMatchObject({ addressId: CHECKOUT_ADDRESS.id });
  await expect(page.getByText(ORDER_CODE_COD)).toBeVisible({ timeout: 15_000 });
});

test('Mini App 375: sửa địa chỉ ở Sổ địa chỉ rồi quay lại thanh toán ngay → phí ship tính lại, đặt không bị báo tổng tiền đổi (W33)', async ({ page, api }) => {
  await mockWorld(api, page, 'miniapp', FLOW_PLAIN, Promise.resolve());
  const farQuote = { ...CHECKOUT_QUOTE, shippingFee: 30_000, total: CHECKOUT_QUOTE.subtotal + 30_000 };
  let moved = false;
  api.get('/geo/communes', [{ code: CHECKOUT_ADDRESS.wardCode, name: CHECKOUT_ADDRESS.ward }, BEN_THANH]);
  api.get('/me/addresses', () => [moved ? MOVED : CHECKOUT_ADDRESS]);
  api.post('/checkout/quote', () => (moved ? farQuote : CHECKOUT_QUOTE));
  api.patch('/me/addresses/:id', () => {
    moved = true;
    return MOVED;
  });
  // Như máy chủ thật: tổng khách thấy lệch tổng tính lại theo địa chỉ hiện tại thì từ chối với TOTAL_CHANGED.
  api.post('/checkout/place-order', ({ call }) => {
    const body = (call.body ?? {}) as Record<string, unknown>;
    const total = moved ? farQuote.total : CHECKOUT_QUOTE.total;
    if (body.expectedTotal !== total) {
      return reply(400, { statusCode: 400, code: 'TOTAL_CHANGED', message: 'Tổng tiền đơn vừa thay đổi do giá hoặc phí giao vừa cập nhật.' });
    }
    return placedOrderFor(body);
  });
  await openState(page, 'miniapp', 375);
  await expect(page.getByRole('button', { name: /Đặt hàng · 149\.000/ })).toBeEnabled({ timeout: 15_000 });

  // Điều hướng trong app (giữ bộ nhớ đệm như khi khách mở Sổ địa chỉ rồi bấm quay lại), không tải lại trang.
  await page.evaluate(() => {
    history.pushState({}, '', '/addresses');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.getByRole('button', { name: 'Sửa', exact: true }).click();
  await page.getByRole('button', { name: /^Phường\/Xã/ }).click();
  await page.getByRole('option', { name: BEN_THANH.name }).click();
  const patched = api.waitForCall('PATCH', '/me/addresses/:id');
  await page.getByRole('button', { name: /^Lưu$/ }).click();
  expect((await patched).body).toMatchObject({ wardCode: BEN_THANH.code });
  await expect(page.getByRole('heading', { name: 'Sửa địa chỉ' })).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/checkout$/);
  const place = page.getByRole('button', { name: /Đặt hàng · 160\.000/ });
  await expect(place).toBeEnabled({ timeout: 15_000 });
  const placed = api.waitForCall('POST', '/checkout/place-order');
  await place.click();
  expect((await placed).body).toMatchObject({ expectedTotal: farQuote.total });
  await expect(page.getByText(ORDER_CODE_COD)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Tổng tiền đơn vừa thay đổi')).toHaveCount(0);
});
