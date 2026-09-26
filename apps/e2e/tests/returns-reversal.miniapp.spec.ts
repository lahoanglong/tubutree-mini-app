import type { OrderDTO } from '@tubutree/shared-types';
import type { ReturnRequestDTO } from '../../miniapp/src/services/shop-api';
import { test, expect, makeOrder, makeUser, mockSession, reply } from './support/mock-api';

/**
 * Zalo Mini App E2E - Luồng Huỷ đơn hàng & Yêu cầu Đổi/Trả (Phase 5: Reversals & Returns)
 *
 * Kiểm tra (apps/miniapp/src/pages/order-detail.tsx, route orders.controller.ts):
 * 1. Khách tự huỷ đơn chưa giao (CONFIRMED): nút "Hủy đơn" → sheet xác nhận → POST /orders/:code/cancel
 *    → trạng thái "Đã hủy" + snackbar "Đã hủy đơn cho bạn".
 * 2. Đơn đã giao (DELIVERED): nút "Yêu cầu đổi/trả" → sheet nhập lý do (≥5 ký tự) →
 *    POST /orders/:code/return-request → snackbar thành công → GET /orders/me/returns tải lại →
 *    hiện "⏳ Yêu cầu đổi/trả đang xử lý".
 */
test.describe('Zalo Mini App E2E - Luồng Huỷ đơn & Đổi trả (Phase 5)', () => {
  const ADDRESS: OrderDTO['shippingAddress'] = {
    recipient: 'Trần Khách Hàng',
    phone: '0901234567',
    province: 'TP. Hồ Chí Minh',
    district: 'Quận 1',
    ward: 'Phường Bến Nghé',
    street: '123 Lê Lợi',
    provinceCode: '79',
    districtCode: '760',
    wardCode: '26734',
  };

  const ORDER_CONFIRMED = makeOrder({
    code: 'TUBU-CANCEL-001',
    status: 'CONFIRMED',
    subtotal: 100000,
    shippingFee: 19000,
    total: 119000,
    pointsEarned: 10,
    shippingAddress: ADDRESS,
  });

  const ORDER_DELIVERED = makeOrder({
    code: 'TUBU-DELIVERED-002',
    status: 'DELIVERED',
    subtotal: 200000,
    shippingFee: 0,
    total: 200000,
    pointsEarned: 20,
    paymentStatus: 'PAID',
    shippingPartner: 'Giao Hàng Nhanh',
    shippingCode: 'GHN999999',
    shippingStatus: 'Đã giao hàng thành công',
    shippingHistory: [{ at: '2026-09-19T10:00:00.000Z', status: 'Đã giao hàng', carrier: 'GHN', code: 'GHN999999' }],
    deliveredAt: '2026-09-19T10:00:00.000Z',
    shippingAddress: ADDRESS,
  });

  test.beforeEach(async ({ api }) => {
    mockSession(api, makeUser({ id: 'user-return', fullName: 'Trần Khách Hàng', pointsBalance: 100 }));
    api.get('/orders/:code', ({ params }) =>
      [ORDER_CONFIRMED, ORDER_DELIVERED].find((o) => o.code === params.code) ?? reply(404, { message: 'Không tìm thấy đơn hàng' }),
    );
    api.get('/orders/me/returns', []);
  });

  test('Khách tự huỷ đơn hàng khi đơn chưa giao (CONFIRMED)', async ({ page, api }) => {
    api.post('/orders/:code/cancel', { ...ORDER_CONFIRMED, status: 'CANCELLED' });

    await page.goto(`/order/${ORDER_CONFIRMED.code}`);
    await expect(page.getByText('Đã xác nhận').first()).toBeVisible({ timeout: 15_000 });

    // Nút "Hủy đơn" ở action bar (nút cùng tên trong sheet đang ẩn → role query bỏ qua).
    await page.getByRole('button', { name: 'Hủy đơn', exact: true }).click();

    // Gốc .zaui-sheet có kích thước 0 (nội dung định vị fixed) nên Playwright coi là "hidden" —
    // kiểm tra nội dung sheet thay vì chính gốc.
    const sheet = page.locator('.zaui-sheet').filter({ hasText: 'Bạn muốn hủy đơn này?' });
    await expect(sheet.getByText('Bạn muốn hủy đơn này?')).toBeVisible({ timeout: 5_000 });
    await expect(sheet.getByRole('button', { name: 'Giữ đơn' })).toBeVisible();

    const cancelled = api.waitForCall('POST', '/orders/:code/cancel');
    await sheet.getByRole('button', { name: 'Hủy đơn', exact: true }).click();
    const call = await cancelled;
    expect(call.path).toBe(`/orders/${ORDER_CONFIRMED.code}/cancel`);

    // UI dùng đơn BE trả về (setQueryData) → hero "Đã hủy", snackbar xác nhận, hết nút huỷ.
    await expect(page.getByText('Đã hủy đơn cho bạn')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Đã hủy', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hủy đơn', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mua lại đơn này' })).toBeVisible();
    expect(api.callsTo('POST', '/orders/:code/cancel')).toHaveLength(1);
  });

  test('Đơn đã giao (DELIVERED): gửi yêu cầu đổi/trả và hiện trạng thái đang xử lý', async ({ page, api }) => {
    const submitted: ReturnRequestDTO[] = [];
    api.get('/orders/me/returns', () => submitted);
    api.post('/orders/:code/return-request', ({ call }) => {
      const body = call.body as { reason: string };
      const req: ReturnRequestDTO = {
        id: 'ret-1',
        orderId: ORDER_DELIVERED.id,
        reason: body.reason,
        status: 'REQUESTED',
        adminNote: null,
        createdAt: '2026-09-20T09:00:00.000Z',
      };
      submitted.push(req);
      return req;
    });

    await page.goto(`/order/${ORDER_DELIVERED.code}`);
    // Nhãn thật của trạng thái DELIVERED (i18n vi.orderStatus) — không phải chuỗi của hãng VC.
    await expect(page.getByText('Giao thành công', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    const openBtn = page.getByRole('button', { name: 'Yêu cầu đổi/trả (lỗi nhà sản xuất)' });
    await expect(openBtn).toBeVisible();
    await openBtn.click();

    const sheet = page.locator('.zaui-sheet').filter({ hasText: 'Chỉ áp dụng khi lỗi nhà sản xuất' });
    await expect(sheet.getByText('Chỉ áp dụng khi lỗi nhà sản xuất', { exact: false })).toBeVisible({ timeout: 5_000 });
    const submit = sheet.getByRole('button', { name: 'Gửi yêu cầu' });
    const reason = sheet.getByPlaceholder('Mô tả lỗi sản phẩm (tối thiểu 5 ký tự)…');

    // < 5 ký tự (sau trim) → nút bị khoá, không gọi API.
    await reason.fill('  hư ');
    await expect(submit).toBeDisabled();

    await reason.fill('  Chai bị nứt, rò rỉ nước giặt  ');
    await expect(submit).toBeEnabled();
    const sent = api.waitForCall('POST', '/orders/:code/return-request');
    await submit.click();
    const call = await sent;
    expect(call.path).toBe(`/orders/${ORDER_DELIVERED.code}/return-request`);
    expect(call.body).toEqual({ reason: 'Chai bị nứt, rò rỉ nước giặt', images: [] });

    await expect(page.getByText('Đã gửi yêu cầu đổi/trả. Tubu sẽ phản hồi trong 24h.')).toBeVisible({ timeout: 5_000 });
    // invalidate ['my-returns'] → GET /orders/me/returns trả yêu cầu vừa tạo → thay nút bằng trạng thái.
    await expect(page.getByText('⏳ Yêu cầu đổi/trả đang xử lý (trong 24h)')).toBeVisible({ timeout: 5_000 });
    await expect(openBtn).toHaveCount(0);
    expect(api.callsTo('POST', '/orders/:code/return-request')).toHaveLength(1);
  });
});
