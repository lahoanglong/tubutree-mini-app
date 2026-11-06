import { test, expect, makeOrder } from './support/mock-api';
import { mockBuyFlowSession, mockOrdersTab, THUMB } from './support/buy-flow-mocks';

/**
 * Zalo Mini App E2E: "Mua lại" ở /orders nói rõ từng món của đơn cũ (W27).
 * Đơn đã giao 5 dòng: còn hàng giá như cũ, tạm hết hàng, ngừng bán, còn ít hơn số đã mua kèm giá tăng, giá giảm.
 * Sheet báo dưới từng dòng, câu đầu sheet đếm món không thêm được, chỉ gửi dòng còn bán với số lượng đã kẹp theo tồn.
 */
const CODE = 'TUBU-W27-RE';
const line = (id: string, name: string, over: Record<string, unknown>) => ({
  id, variationId: `var-${id}`, productName: name, productSlug: `sp-${id}`, variationName: '', backorderedQty: 0, thumbnail: THUMB,
  ...over,
});
const ORDER = {
  ...makeOrder({ code: CODE, status: 'DELIVERED', paymentStatus: 'PAID' }),
  items: [
    line('ok', 'Nước rửa chén Tubu', { unitPrice: 65000, quantity: 2, total: 130000, stock: 10, available: true, discontinued: false, currentPrice: 65000, flashActive: false }),
    line('out', 'Xà phòng Tubu tạm hết', { unitPrice: 19000, quantity: 1, total: 19000, stock: 0, available: false, discontinued: false, currentPrice: 19000, flashActive: false }),
    line('gone', 'Nước lau sàn Tubu cũ', { unitPrice: 45000, quantity: 1, total: 45000, stock: 3, available: false, discontinued: true, currentPrice: 45000, flashActive: false }),
    line('few', 'Nước giặt Tubu 2L', { unitPrice: 60000, quantity: 3, total: 180000, stock: 1, available: true, discontinued: false, currentPrice: 70000, flashActive: false }),
    line('down', 'Nước xả vải Tubu', { unitPrice: 50000, quantity: 1, total: 50000, stock: 10, available: true, discontinued: false, currentPrice: 45000, flashActive: false }),
  ],
};

for (const width of [320, 375]) {
  test(`Mua lại ở ${width}px: báo hết hàng, ngừng bán, giảm số lượng, đổi giá từng món; chỉ gửi món còn bán`, async ({ page, api }) => {
    mockBuyFlowSession(api);
    mockOrdersTab(api);
    api.get('/orders', { data: [ORDER], meta: { page: 1, limit: 20, total: 1 } });
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/orders');

    const card = page.getByTestId('order-card').filter({ has: page.getByRole('button', { name: `Đơn ${CODE}` }) });
    await card.getByRole('button', { name: 'Mua lại', exact: true }).click({ timeout: 15_000 });
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByTestId('reorder-skipped-note')).toHaveText('2 món hết hàng hoặc ngừng bán sẽ không được thêm vào giỏ.');

    const row = (name: string) => sheet.getByTestId('reorder-line').filter({ hasText: name });
    await expect(row('Xà phòng Tubu tạm hết').locator('[data-notice="out"]')).toHaveText('Tạm hết hàng');
    await expect(row('Nước lau sàn Tubu cũ').locator('[data-notice="discontinued"]')).toHaveText('Ngừng bán');
    await expect(row('Nước giặt Tubu 2L').locator('[data-notice="reduced"]')).toHaveText('Không đủ 3 như đơn trước, đã giảm số lượng');
    await expect(row('Nước giặt Tubu 2L').locator('[data-notice="priceUp"]')).toHaveText('Giá tăng so với đơn trước (60.000đ)');
    await expect(row('Nước xả vải Tubu').locator('[data-notice="priceDown"]')).toHaveText('Giá giảm so với đơn trước (50.000đ)');
    await expect(row('Nước rửa chén Tubu').locator('[data-notice]')).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Chọn Xà phòng Tubu tạm hết' })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'Chọn Nước lau sàn Tubu cũ' })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const overflow = await sheet.evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>('[data-notice]')).filter((n) => n.scrollWidth > n.clientWidth + 1).length);
    expect(overflow).toBe(0);

    const posted = api.waitForCall('POST', '/orders/:code/repurchase');
    await sheet.getByRole('button', { name: 'Thêm vào giỏ (4)' }).click();
    expect((await posted).body).toEqual({
      items: [
        { orderItemId: 'ok', quantity: 2 },
        { orderItemId: 'few', quantity: 1 },
        { orderItemId: 'down', quantity: 1 },
      ],
      addSource: 'repurchase',
    });
  });
}
