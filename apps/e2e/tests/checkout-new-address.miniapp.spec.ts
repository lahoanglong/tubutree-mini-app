import { test, expect } from './support/mock-api';
import { mockWorld, openState } from './support/checkout-states';
import { FLOW_PLAIN } from './support/checkout-flow-states';
import { CHECKOUT_ADDRESS, ORDER_CODE_COD } from './support/checkout-mocks';

/**
 * W31, Mini App 375px: khách đã có địa chỉ mặc định, thêm địa chỉ mới ngay ở màn thanh toán rồi đặt.
 * Trước đây danh sách địa chỉ tải lại về sau lúc chọn, màn thấy id lạ nên chọn lại địa chỉ mặc định cũ và đơn đi về đó.
 * Toàn bộ API được mock; danh sách tải lại chậm 800 ms như mạng điện thoại.
 */
const OFFICE = { ...CHECKOUT_ADDRESS, id: 'addr-office-2', recipient: 'Trần Thị Bình', phone: '0912345678', street: '9 Hai Bà Trưng', isDefault: false };

test('Mini App 375: thêm địa chỉ mới ở thanh toán thì địa chỉ đó được chọn và đơn đặt về đó, không về địa chỉ mặc định cũ (W31)', async ({ page, api }) => {
  await mockWorld(api, page, 'miniapp', FLOW_PLAIN, Promise.resolve());
  let saved = false;
  api.get('/me/addresses', async () => {
    if (!saved) return [CHECKOUT_ADDRESS];
    await new Promise((resolve) => setTimeout(resolve, 800));
    return [CHECKOUT_ADDRESS, OFFICE];
  });
  api.post('/me/addresses', () => {
    saved = true;
    return OFFICE;
  });
  await openState(page, 'miniapp', 375);
  const place = page.getByRole('button', { name: /Đặt hàng · / });
  await expect(place).toBeEnabled({ timeout: 15_000 });

  await page.getByRole('button', { name: /Thêm địa chỉ mới/ }).click();
  await page.getByLabel(/Người nhận/).first().fill(OFFICE.recipient);
  await page.getByLabel(/Số điện thoại/).first().fill(OFFICE.phone);
  await page.getByLabel('Số nhà, tên đường').fill(OFFICE.street);
  await page.getByRole('button', { name: /^Tỉnh\/Thành phố/ }).click();
  await page.getByRole('option', { name: OFFICE.province }).click();
  await page.getByRole('button', { name: /^Phường\/Xã/ }).click();
  await page.getByRole('option', { name: OFFICE.ward }).click();
  const created = api.waitForCall('POST', '/me/addresses');
  await page.getByRole('button', { name: /^Lưu$/ }).click();
  expect((await created).body).toMatchObject({ street: OFFICE.street, wardCode: OFFICE.wardCode });

  const office = page.getByRole('radio').filter({ hasText: OFFICE.street });
  const home = page.getByRole('radio').filter({ hasText: CHECKOUT_ADDRESS.street });
  await expect(office).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => api.callsTo('GET', '/me/addresses').length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  await expect(office).toHaveAttribute('aria-checked', 'true');
  await expect(home).toHaveAttribute('aria-checked', 'false');

  await expect(place).toBeEnabled();
  const placed = api.waitForCall('POST', '/checkout/place-order');
  await place.click();
  expect((await placed).body).toMatchObject({ addressId: OFFICE.id });
  await expect(page.getByText(ORDER_CODE_COD)).toBeVisible({ timeout: 15_000 });
});
