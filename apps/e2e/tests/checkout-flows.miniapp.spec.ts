import { test, expect } from './support/mock-api';
import { mockWorld, openState } from './support/checkout-states';
import { FLOW_PLAIN, FLOW_PRICE_CHANGED, NEW_TOTAL } from './support/checkout-flow-states';
import { CHECKOUT_QUOTE, ORDER_CODE_COD } from './support/checkout-mocks';

/**
 * Hai luồng của gói hk ở 375px trên Mini App: sửa ô sai rồi đặt được, và giá đổi rồi nhận giá mới rồi đặt được.
 * Toàn bộ API được mock (không cần API/DB).
 */
const money = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

test.describe('Mini App 375: luồng thanh toán sửa lỗi rồi đặt', () => {
  test('ô hoá đơn thiếu: bấm Đặt hàng báo từng ô và chưa đặt, điền đủ rồi đặt thành công', async ({ page, api }) => {
    await mockWorld(api, page, 'miniapp', FLOW_PLAIN, Promise.resolve());
    await openState(page, 'miniapp', 375);
    const place = page.getByRole('button', { name: /Đặt hàng · / });
    await expect(place).toBeEnabled({ timeout: 15_000 });

    await page.getByText('Yêu cầu xuất hoá đơn VAT').click();
    await place.click();
    await expect(page.getByText('Nhập mã số thuế.')).toBeVisible();
    await expect(page.getByText('Nhập tên công ty.')).toBeVisible();
    await expect(page.getByText('Nhập email nhận hoá đơn.')).toBeVisible();
    await expect(page.getByLabel('Mã số thuế')).toBeFocused();
    await expect(page.getByLabel('Mã số thuế')).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST', '/checkout/place-order')).toHaveLength(0);

    await page.getByLabel('Mã số thuế').fill('0312345678');
    await page.getByLabel('Tên công ty').fill('Công ty TNHH Tubu');
    await page.getByLabel('Địa chỉ xuất hoá đơn').fill('12 Lê Lợi, Quận 1, TP. Hồ Chí Minh');
    await page.getByLabel('Email nhận hoá đơn').fill('ketoan@tubu.vn');
    await expect(page.getByText('Nhập mã số thuế.')).toHaveCount(0);

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await place.click();
    expect((await placed).body).toMatchObject({
      invoiceRequest: { taxCode: '0312345678', companyName: 'Công ty TNHH Tubu', email: 'ketoan@tubu.vn' },
    });
    await expect(page.getByText(ORDER_CODE_COD)).toBeVisible({ timeout: 15_000 });
  });

  test('giá đổi: nhận giá mới ngay tại màn rồi đặt với tổng mới thành công', async ({ page, api }) => {
    await mockWorld(api, page, 'miniapp', FLOW_PRICE_CHANGED, Promise.resolve());
    await openState(page, 'miniapp', 375);
    const place = page.getByRole('button', { name: new RegExp(`Đặt hàng · ${money(CHECKOUT_QUOTE.total).replace('.', '\\.')}`) });
    await expect(place).toBeEnabled({ timeout: 15_000 });
    await place.click();

    await expect(page.getByText('Giá ưu đãi đã thay đổi')).toBeVisible();
    await page.getByRole('button', { name: 'Cập nhật giá mới' }).click();
    await expect(page.getByText(`Đã cập nhật giá. Tổng mới ${money(NEW_TOTAL)}.`)).toBeVisible({ timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe('/checkout');

    const retry = page.getByRole('button', { name: new RegExp(`Đặt hàng · ${money(NEW_TOTAL).replace('.', '\\.')}`) });
    await expect(retry).toBeEnabled();
    const placed = api.waitForCall('POST', '/checkout/place-order');
    await retry.click();
    expect((await placed).body).toMatchObject({ expectedTotal: NEW_TOTAL });
    await expect(page.getByText(ORDER_CODE_COD)).toBeVisible({ timeout: 15_000 });
  });
});
