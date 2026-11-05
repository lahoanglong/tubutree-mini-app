import { test, expect } from './support/mock-api';
import { mockWorld, openState } from './support/order-detail-states';
import { expectPendingPayment, expectShippingTracking, stateOf } from './support/order-tracking-flow';

/** Web /tai-khoan/don-hang/:code ở 375×812 và 1280×800: đơn đang giao và đơn chờ thanh toán (gói hl). */
for (const size of [375, 1280] as const) {
  test.describe(`Web theo dõi đơn ${size}`, () => {
    test.beforeEach(({}, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Một project đủ cho cả hai khổ: khổ do spec tự đặt');
    });

    test('đơn đang giao: hành trình, mã vận đơn, một nút chính Liên hệ', async ({ page, api }) => {
      const state = stateOf('shipping');
      const w = await mockWorld(api, page, 'web', state, Date.now());
      await openState(page, 'web', size, w.order.code);
      await state.ready(page);
      await expectShippingTracking(page);
    });

    test('đơn chờ thanh toán: hạn trả + còn bao lâu, nút Thanh toán ngay, Huỷ đơn trong menu', async ({ page, api }) => {
      const state = stateOf('pending-payment');
      const w = await mockWorld(api, page, 'web', state, Date.now());
      await openState(page, 'web', size, w.order.code);
      await state.ready(page);
      await expectPendingPayment(page);
    });
  });
}

test('web 1280: hai cột gọn, trái trạng thái + hành trình + sản phẩm, phải tiền + nút', async ({ page, api }, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Một project đủ cho cả hai khổ: khổ do spec tự đặt');
  const state = stateOf('shipping');
  const w = await mockWorld(api, page, 'web', state, Date.now());
  await openState(page, 'web', 1280, w.order.code);
  await state.ready(page);
  const main = await page.getByTestId('order-main').boundingBox();
  const side = await page.getByTestId('order-side').boundingBox();
  expect(main && side).toBeTruthy();
  expect(side!.x).toBeGreaterThan(main!.x + main!.width - 1);
  expect(Math.abs(side!.y - main!.y)).toBeLessThan(40);
  await expect(page.getByTestId('order-main').getByTestId('status-hero')).toBeVisible();
  await expect(page.getByTestId('order-side').getByRole('button', { name: 'Liên hệ Tubu' })).toBeVisible();
});

test('web 375: một cột, cột phải nằm dưới cột trái', async ({ page, api }, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Một project đủ cho cả hai khổ: khổ do spec tự đặt');
  const state = stateOf('shipping');
  const w = await mockWorld(api, page, 'web', state, Date.now());
  await openState(page, 'web', 375, w.order.code);
  await state.ready(page);
  const hero = await page.getByTestId('status-hero').boundingBox();
  const shipping = await page.getByTestId('order-shipping').boundingBox();
  expect(shipping!.y).toBeGreaterThan(hero!.y);
  expect(Math.abs(shipping!.x - hero!.x)).toBeLessThan(40);
});

test('web 375: mở form đổi/trả từ menu thì form nằm trong tầm nhìn và nhận focus (form ở cuối trang, khách đang ở đầu trang)', async ({ page, api }, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Một project đủ cho cả hai khổ: khổ do spec tự đặt');
  const state = stateOf('delivered');
  const w = await mockWorld(api, page, 'web', state, Date.now());
  await openState(page, 'web', 375, w.order.code);
  await state.ready(page);
  await page.getByRole('button', { name: 'Thêm thao tác' }).locator('visible=true').click();
  await page.getByRole('group', { name: 'Thao tác với đơn' }).getByRole('button', { name: 'Yêu cầu đổi/trả' }).click();
  const form = page.locator('form[aria-labelledby="return-form-title"]');
  await expect(form).toBeVisible();
  await expect(page.locator('#return-form-title')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#return-form-title')).toBeFocused();
});

test('web 1280: "Thanh toán ngay" cuộn tới khung QR nhúng và chuyển focus vào khung, không rời trang', async ({ page, api }, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Một project đủ cho cả hai khổ: khổ do spec tự đặt');
  const state = stateOf('pending-payment');
  const w = await mockWorld(api, page, 'web', state, Date.now());
  await openState(page, 'web', 1280, w.order.code);
  await state.ready(page);
  const panel = page.locator('#order-pay-panel');
  await expect(panel).toBeVisible();
  await page.getByTestId('order-side').getByRole('button', { name: 'Thanh toán ngay' }).click();
  await expect(panel).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/tai-khoan/don-hang/${w.order.code}$`));
});
