import type { OrderDTO } from '@tubutree/shared-types';
import type { ReturnEstimateDTO, ReturnRequestDTO } from '../../miniapp/src/services/shop-api';
import { test, expect, makeOrder, makeUser, mockSession, reply } from './support/mock-api';

/**
 * Zalo Mini App E2E - Luồng Huỷ đơn hàng & Yêu cầu Đổi/Trả (Phase 5: Reversals & Returns)
 *
 * Kiểm tra (apps/miniapp/src/pages/order-detail.tsx, route orders.controller.ts):
 * 1. Khách tự huỷ đơn chưa giao (CONFIRMED): nút "Hủy đơn" → sheet xác nhận → POST /orders/:code/cancel
 *    → trạng thái "Đã hủy" + snackbar "Đã hủy đơn cho bạn".
 * 2. Đơn đã giao (DELIVERED, còn trong hạn đổi/trả): nút "Yêu cầu đổi/trả" → sheet chọn dòng + số lượng, lý do
 *    chọn sẵn ("Lý do khác" bắt buộc mô tả ≥5 ký tự), nơi nhận tiền hoàn, số tiền dự kiến
 *    (POST /orders/:code/return-estimate) → POST /orders/:code/return-request → snackbar thành công →
 *    GET /orders/me/returns tải lại → hiện "Yêu cầu đổi/trả đang xử lý (trong 24h)".
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
    // Hạn đổi/trả tính theo giờ thật của trình duyệt (utils/order-status.ts returnWindowState) nên mốc giao phải gần "bây giờ".
    deliveredAt: new Date(Date.now() - 864e5).toISOString(),
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
    // Sau khi huỷ, GET /orders/:code trả đơn đã huỷ NHƯNG bị giữ lại (cổng `releaseRefetch`): màn chi tiết phải
    // đổi trạng thái NGAY từ phản hồi huỷ, không chờ refetch (cửa sổ cũ vẫn hiện "Hủy đơn" + trạng thái cũ).
    let cancelledOnServer = false;
    let refetchStarted = false;
    let releaseRefetch: () => void = () => undefined;
    const refetchGate = new Promise<void>((resolve) => {
      releaseRefetch = resolve;
    });
    api.get('/orders/:code', async () => {
      if (!cancelledOnServer) return ORDER_CONFIRMED;
      refetchStarted = true;
      await refetchGate;
      return { ...ORDER_CONFIRMED, status: 'CANCELLED' };
    });
    api.post('/orders/:code/cancel', () => {
      cancelledOnServer = true;
      return { ...ORDER_CONFIRMED, status: 'CANCELLED' };
    });

    await page.goto(`/order/${ORDER_CONFIRMED.code}`);
    await expect(page.getByText('Đã xác nhận').first()).toBeVisible({ timeout: 15_000 });

    // Nút "Hủy đơn" ở action bar (nút cùng tên trong sheet đang ẩn → role query bỏ qua).
    await page.getByRole('button', { name: 'Huỷ đơn', exact: true }).click();

    // Gốc .zaui-sheet có kích thước 0 (nội dung định vị fixed) nên Playwright coi là "hidden" —
    // kiểm tra nội dung sheet thay vì chính gốc.
    const sheet = page.locator('.zaui-sheet').filter({ hasText: 'Bạn muốn huỷ đơn này?' });
    await expect(sheet.getByText('Bạn muốn huỷ đơn này?')).toBeVisible({ timeout: 5_000 });
    await expect(sheet.getByRole('button', { name: 'Giữ đơn' })).toBeVisible();

    const cancelled = api.waitForCall('POST', '/orders/:code/cancel');
    await sheet.getByRole('button', { name: 'Huỷ đơn', exact: true }).click();
    const call = await cancelled;
    expect(call.path).toBe(`/orders/${ORDER_CONFIRMED.code}/cancel`);

    // Refetch còn đang treo: hero đã "Đã hủy", hết nút huỷ, snackbar xác nhận.
    await expect(page.getByText('Đã huỷ đơn cho bạn')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Đã huỷ', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Huỷ đơn', exact: true })).toHaveCount(0);
    // Xác nhận refetch THẬT SỰ đang treo (không phải chưa kịp chạy) khi các khẳng định trên đúng.
    await expect.poll(() => refetchStarted, { timeout: 5_000 }).toBe(true);

    // Thả refetch → dữ liệu đầy đủ, vẫn hết nút huỷ, có "Mua lại đơn này".
    releaseRefetch();
    await expect(page.getByRole('button', { name: 'Mua lại đơn này' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Huỷ đơn', exact: true })).toHaveCount(0);
    expect(api.callsTo('POST', '/orders/:code/cancel')).toHaveLength(1);
  });

  test('Huỷ đơn thành công nhưng refetch lỗi: trang KHÔNG bị thay bằng màn lỗi', async ({ page, api }) => {
    let cancelledOnServer = false;
    api.get('/orders/:code', () => (cancelledOnServer ? reply(500, { message: 'Lỗi máy chủ tạm thời' }) : ORDER_CONFIRMED));
    api.post('/orders/:code/cancel', () => {
      cancelledOnServer = true;
      return { ...ORDER_CONFIRMED, status: 'CANCELLED' };
    });

    await page.goto(`/order/${ORDER_CONFIRMED.code}`);
    await expect(page.getByText('Đã xác nhận').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Huỷ đơn', exact: true }).click();
    const sheet = page.locator('.zaui-sheet').filter({ hasText: 'Bạn muốn huỷ đơn này?' });
    await expect(sheet.getByText('Bạn muốn huỷ đơn này?')).toBeVisible({ timeout: 5_000 });
    await sheet.getByRole('button', { name: 'Huỷ đơn', exact: true }).click();

    await expect(page.getByText('Đã huỷ đơn cho bạn')).toBeVisible({ timeout: 5_000 });
    // Chờ refetch lỗi thật sự xảy ra (query mặc định có thể retry) rồi mới khẳng định trang còn nguyên.
    await expect.poll(() => api.callsTo('GET', '/orders/:code').length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(1_500);
    await expect(page.getByText('Đã huỷ', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Huỷ đơn', exact: true })).toHaveCount(0);
    await expect(page.getByText('Lỗi máy chủ tạm thời')).toHaveCount(0);
  });

  test('Đơn đã giao (DELIVERED): gửi yêu cầu đổi/trả và hiện trạng thái đang xử lý', async ({ page, api }) => {
    const line = ORDER_DELIVERED.items[0]!;
    const submitted: ReturnRequestDTO[] = [];
    api.get('/orders/me/returns', () => submitted);
    const estimate: ReturnEstimateDTO = {
      isFull: false,
      goods: line.unitPrice,
      shipping: 0,
      refund: line.unitPrice,
      moneyRefundable: true,
      pointsUsedBack: 0,
      lines: [{ orderItemId: line.id, quantity: 1, refundAmount: line.unitPrice }],
    };
    api.post('/orders/:code/return-estimate', estimate);
    api.post('/orders/:code/return-request', ({ call }) => {
      const body = call.body as { reasonCode: string; reason?: string; items: { orderItemId: string; quantity: number }[] };
      const req: ReturnRequestDTO = {
        id: 'ret-1',
        orderId: ORDER_DELIVERED.id,
        reason: body.reason ?? '',
        reasonCode: body.reasonCode,
        status: 'REQUESTED',
        adminNote: null,
        refundMethod: 'WALLET',
        items: body.items.map((i) => ({ ...i, refundAmount: line.unitPrice })),
        createdAt: '2026-09-20T09:00:00.000Z',
      };
      submitted.push(req);
      return req;
    });

    await page.goto(`/order/${ORDER_DELIVERED.code}`);
    // Nhãn thật của trạng thái DELIVERED (i18n vi.orderStatus) — không phải chuỗi của hãng VC.
    await expect(page.getByText('Giao thành công', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    const openBtn = page.getByRole('button', { name: 'Yêu cầu đổi/trả' });
    await expect(openBtn).toBeVisible();
    await openBtn.click();

    const sheet = page.locator('.zaui-sheet').filter({ hasText: 'Chọn đúng sản phẩm và số lượng muốn trả' });
    await expect(sheet.getByText('Chọn đúng sản phẩm và số lượng muốn trả', { exact: false })).toBeVisible({ timeout: 5_000 });
    // Đơn một dòng: dòng được chọn sẵn → báo giá hoàn tiền dự kiến chạy ngay.
    await expect(sheet.getByRole('checkbox', { name: `Trả ${line.productName} ${line.variationName}` })).toBeChecked();
    await expect(sheet.getByText('Dự kiến hoàn 65.000đ')).toBeVisible({ timeout: 5_000 });
    expect(api.callsTo('POST', '/orders/:code/return-estimate').at(-1)?.body).toMatchObject({ items: [{ orderItemId: line.id, quantity: 1 }] });

    const submit = sheet.getByRole('button', { name: 'Gửi yêu cầu' });
    const detail = sheet.getByLabel('Mô tả thêm');

    // "Lý do khác" cần mô tả ≥ 5 ký tự (sau trim) → báo lỗi dưới nút, không gọi API.
    await sheet.getByRole('button', { name: 'Lý do khác' }).click();
    await detail.fill('  hư ');
    await submit.click();
    await expect(sheet.getByRole('alert')).toHaveText('Mô tả lý do (tối thiểu 5 ký tự).');
    expect(api.callsTo('POST', '/orders/:code/return-request')).toHaveLength(0);

    await detail.fill('  Chai bị nứt, rò rỉ nước giặt  ');
    const sent = api.waitForCall('POST', '/orders/:code/return-request');
    await submit.click();
    const call = await sent;
    expect(call.path).toBe(`/orders/${ORDER_DELIVERED.code}/return-request`);
    expect(call.body).toEqual({
      reasonCode: 'OTHER',
      reason: 'Chai bị nứt, rò rỉ nước giặt',
      images: [],
      items: [{ orderItemId: line.id, quantity: 1 }],
      refundMethod: 'WALLET',
    });

    await expect(page.getByText('Đã gửi yêu cầu đổi/trả. Tubu sẽ phản hồi trong 24h.')).toBeVisible({ timeout: 5_000 });
    // invalidate ['my-returns'] → GET /orders/me/returns trả yêu cầu vừa tạo → thay nút bằng trạng thái.
    await expect(page.getByText('Yêu cầu đổi/trả đang xử lý (trong 24h)')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(`Trả: ${line.productName} ×1`)).toBeVisible();
    await expect(openBtn).toHaveCount(0);
    expect(api.callsTo('POST', '/orders/:code/return-request')).toHaveLength(1);
  });
});
