// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { OrderStatusActions, orderStatusActions } from './order-status-actions';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import type { AdminOrder } from '@/lib/admin-client';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Đơn chuyển khoản lẻ chưa trả — allowedTransitions/canConfirmPayment như AdminService.listOrders trả. */
const order = (over: Partial<AdminOrder> = {}): AdminOrder => ({
  id: 'o1',
  code: 'TB-300',
  type: 'RETAIL',
  status: 'PENDING_PAYMENT',
  total: 450_000,
  paymentMethod: 'BANK_TRANSFER',
  paymentStatus: 'UNPAID',
  createdAt: '2026-10-01T00:00:00.000Z',
  allowedTransitions: ['CONFIRMED', 'PACKED', 'CANCELLED'],
  canConfirmPayment: true,
  ...over,
});

const buttonLabels = (c: HTMLElement) => Array.from(c.querySelectorAll('button')).map((b) => b.textContent?.trim());

// C-024 yêu cầu 3 (A1-006): trước đây nút dựng bằng điều kiện cứng — "Đã giao hàng" hiện trên đơn chuyển khoản
// chưa trả, "Hủy đơn" hiện trên đơn đã giao; bấm mới biết bị 400. Giờ chỉ hiện đúng allowedTransitions của API.
describe('orderStatusActions — chỉ nút API cho phép', () => {
  it('lấy theo allowedTransitions, giữ thứ tự luồng giao, không có nút RETURNED (đổi trả đi tab Đổi/Trả)', () => {
    expect(orderStatusActions(order()).map((a) => a.status)).toEqual(['CONFIRMED', 'PACKED', 'CANCELLED']);
    expect(
      orderStatusActions(order({ allowedTransitions: ['CANCELLED', 'DELIVERED', 'SHIPPING', 'PACKED'] })).map((a) => a.status),
    ).toEqual(['PACKED', 'SHIPPING', 'DELIVERED', 'CANCELLED']);
    expect(orderStatusActions(order({ status: 'DELIVERED', allowedTransitions: ['RETURNED'] }))).toEqual([]);
  });

  it('API cũ không trả allowedTransitions → không hiện nút nào (không đoán)', () => {
    expect(orderStatusActions(order({ allowedTransitions: undefined }))).toEqual([]);
  });

  it('DELIVERED và CANCELLED hỏi xác nhận', () => {
    const acts = orderStatusActions(order({ allowedTransitions: ['DELIVERED', 'CANCELLED', 'PACKED'] }));
    expect(acts.find((a) => a.status === 'DELIVERED')?.confirm).toBe(true);
    expect(acts.find((a) => a.status === 'CANCELLED')?.confirm).toBe(true);
    expect(acts.find((a) => a.status === 'PACKED')?.confirm).toBe(false);
  });
});

describe('OrderStatusActions (chi tiết đơn admin)', () => {
  it('chuyển khoản chưa trả: có "Đã nhận tiền", KHÔNG có "Giao vận"/"Đã giao hàng"', () => {
    const { container } = mount(<OrderStatusActions order={order()} />);
    const labels = buttonLabels(container);
    expect(labels).toContain('Đã nhận tiền');
    expect(labels).toEqual(expect.arrayContaining(['Xác nhận', 'Đã đóng gói', 'Hủy đơn']));
    expect(labels).not.toContain('Giao vận');
    expect(labels).not.toContain('Đã giao hàng');
    expect(container.textContent).toMatch(/chưa ghi nhận thanh toán/i);
  });

  it('đơn đã giao: không còn nút "Hủy đơn" nào', () => {
    const { container } = mount(
      <OrderStatusActions
        order={order({ status: 'DELIVERED', paymentStatus: 'PAID', allowedTransitions: ['RETURNED'], canConfirmPayment: false })}
      />,
    );
    expect(buttonLabels(container)).toEqual([]);
  });

  it('"Đã nhận tiền": huỷ hộp xác nhận → không gọi API; đồng ý → POST /admin/orders/:id/confirm-payment, hiện message API', async () => {
    const api = mockFetch({
      '/confirm-payment': { body: { ok: true, alreadyPaid: false, message: 'Đã xác nhận nhận tiền đơn TB-300.', order: {} } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const native = vi.spyOn(window, 'confirm');
    const { container } = mount(<OrderStatusActions order={order()} />);
    const btn = byText(container, 'button', 'Đã nhận tiền');

    click(btn);
    await flush();
    expect(confirmDialog()?.textContent).toContain('TB-300');
    expect(confirmDialog()?.textContent).toMatch(/450\.000/);
    answerConfirm(false);
    await flush();
    expect(api.calls).toHaveLength(0);

    click(btn);
    await flush();
    answerConfirm(true);
    await flush();
    expect(native).not.toHaveBeenCalled();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.url).toContain('/admin/orders/o1/confirm-payment');
    expect(api.calls[0]!.init?.method).toBe('POST');
    expect(api.calls[0]!.init?.body).toBe('{}');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Đã xác nhận nhận tiền đơn TB-300.');
  });

  it('"Đã nhận tiền" bấm dồn → chỉ 1 request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        await gate;
        return new Response(JSON.stringify({ ok: true, alreadyPaid: false, message: 'ok', order: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const { container } = mount(<OrderStatusActions order={order()} />);
    const btn = byText(container, 'button', 'Đã nhận tiền') as HTMLButtonElement;
    act(() => {
      btn.click();
      btn.click();
    });
    await flush();
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    answerConfirm(true);
    await flush();
    expect(calls).toHaveLength(1);
    release();
    await flush();
  });

  // C-122: huỷ đơn / giao xong là thao tác kích hoạt hoặc đảo ngược tiền-điểm, nên có hộp thoại xác nhận riêng (không còn window.confirm).
  it('"Hủy đơn": hộp thoại tông đỏ nêu mã đơn — "Giữ đơn" thì KHÔNG gọi API, "Huỷ đơn" thì PUT CANCELLED', async () => {
    const api = mockFetch({ '/status': { body: { id: 'o1', status: 'CANCELLED' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const native = vi.spyOn(window, 'confirm');
    const { container } = mount(<OrderStatusActions order={order({ canConfirmPayment: false })} />);
    click(byText(container, 'button', 'Hủy đơn'));
    await flush();
    const d = confirmDialog()!;
    expect(d.textContent).toContain('TB-300');
    expect(d.querySelector('[data-confirm="accept"]')?.className).toContain('bg-red-600');
    expect(d.querySelector('[data-confirm="cancel"]')?.textContent).toBe('Giữ đơn');
    answerConfirm(false);
    await flush();
    expect(api.calls).toHaveLength(0);

    click(byText(container, 'button', 'Hủy đơn'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(api.calls[0]!.url).toContain('/admin/orders/o1/status');
    expect(JSON.parse(String(api.calls[0]!.init?.body))).toEqual({ status: 'CANCELLED' });
    expect(native).not.toHaveBeenCalled();
  });

  it('"Đã giao hàng": hộp thoại nhắc điểm Xanh + hoa hồng sẽ kích hoạt; đồng ý mới PUT DELIVERED', async () => {
    const api = mockFetch({ '/status': { body: { id: 'o1', status: 'DELIVERED' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(
      <OrderStatusActions order={order({ status: 'SHIPPING', paymentStatus: 'PAID', canConfirmPayment: false, allowedTransitions: ['DELIVERED'] })} />,
    );
    click(byText(container, 'button', 'Đã giao hàng'));
    await flush();
    expect(confirmDialog()?.textContent).toMatch(/Điểm Xanh/);
    expect(api.calls).toHaveLength(0);
    answerConfirm(true);
    await flush();
    expect(JSON.parse(String(api.calls[0]!.init?.body))).toEqual({ status: 'DELIVERED' });
  });

  it('nút trạng thái gọi PUT /admin/orders/:id/status; lỗi 400 hiện nguyên văn', async () => {
    const msg = 'Không thể chuyển đơn từ PENDING_PAYMENT sang PACKED.';
    const api = mockFetch({ '/status': { status: 400, body: { statusCode: 400, message: msg } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<OrderStatusActions order={order()} />);
    click(byText(container, 'button', 'Đã đóng gói'));
    await flush();
    expect(api.calls[0]!.url).toContain('/admin/orders/o1/status');
    expect(api.calls[0]!.init?.method).toBe('PUT');
    expect(JSON.parse(String(api.calls[0]!.init?.body))).toEqual({ status: 'PACKED' });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(msg);
  });
});

describe('admin-client — setUserRole gửi tierId khi cấp DEALER (C-008)', () => {
  it('DEALER kèm tierId (trim); role khác không gửi tierId', async () => {
    const { setUserRole } = await import('@/lib/admin-client');
    const api = mockFetch({ '/admin/users/role': { body: { ok: true } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    await setUserRole('0899625240', 'DEALER', ' dealer_l3 ');
    await setUserRole('0899625240', 'AFFILIATE', 'dealer_l3');
    expect(JSON.parse(String(api.calls[0]!.init?.body))).toEqual({ phone: '0899625240', role: 'DEALER', tierId: 'dealer_l3' });
    expect(JSON.parse(String(api.calls[1]!.init?.body))).toEqual({ phone: '0899625240', role: 'AFFILIATE' });
  });
});
