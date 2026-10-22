// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { OrderStatusActions, orderStatusActions } from './order-status-actions';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
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
    expect(labels).toEqual(expect.arrayContaining(['Xác nhận', 'Đã đóng gói', 'Huỷ đơn']));
    expect(labels).not.toContain('Giao vận');
    expect(labels).not.toContain('Đã giao hàng');
    expect(container.textContent).toMatch(/chưa ghi nhận thanh toán/i);
  });

  it('đơn đã giao: không còn nút "Huỷ đơn" nào', () => {
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
  it('"Huỷ đơn": hộp thoại tông đỏ nêu mã đơn — "Giữ đơn" thì KHÔNG gọi API, "Huỷ đơn" thì PUT CANCELLED', async () => {
    const api = mockFetch({ '/status': { body: { id: 'o1', status: 'CANCELLED' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const native = vi.spyOn(window, 'confirm');
    const { container } = mount(<OrderStatusActions order={order({ canConfirmPayment: false })} />);
    click(byText(container, 'button', 'Huỷ đơn'));
    await flush();
    const d = confirmDialog()!;
    expect(d.textContent).toContain('TB-300');
    expect(d.querySelector('[data-confirm="accept"]')?.className).toContain('bg-danger-fg');
    expect(d.querySelector('[data-confirm="cancel"]')?.textContent).toBe('Giữ đơn');
    answerConfirm(false);
    await flush();
    expect(api.calls).toHaveLength(0);

    click(byText(container, 'button', 'Huỷ đơn'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(api.calls[0]!.url).toContain('/admin/orders/o1/status');
    expect(JSON.parse(String(api.calls[0]!.init?.body))).toEqual({ status: 'CANCELLED' });
    expect(native).not.toHaveBeenCalled();
  });

  describe('"Huỷ đơn" nêu đúng nơi tiền/điểm hoàn về', () => {
    const cancelText = async (o: AdminOrder) => {
      const { container } = mount(<OrderStatusActions order={o} />);
      click(byText(container, 'button', 'Huỷ đơn'));
      await flush();
      const text = confirmDialog()?.textContent ?? '';
      answerConfirm(false);
      await flush();
      return text;
    };
    const paid = (over: Partial<AdminOrder> = {}) =>
      order({ paymentStatus: 'PAID', status: 'CONFIRMED', canConfirmPayment: false, allowedTransitions: ['CANCELLED'], ...over });

    it('đơn thường đã trả trước: hoàn vào Ví Tubu của khách', async () => {
      const text = await cancelText(paid());
      expect(text).toMatch(/Hoàn 450\.000.*vào Ví Tubu của khách ngay khi huỷ/);
    });

    it('đơn CTV lên hộ: hoàn cho khách cuối (ví nếu có tài khoản, không thì hàng đợi Hoàn tiền khách), không hứa vào Ví của CTV', async () => {
      const text = await cancelText(paid({ placedForCustomer: true }));
      expect(text).toMatch(/Hoàn 450\.000.*khách cuối/);
      expect(text).toMatch(/hàng đợi "Hoàn tiền khách"/);
      expect(text).not.toMatch(/vào Ví Tubu của khách ngay khi huỷ/);
    });

    it('đơn trả bằng xu cũ: không hoàn tiền, trả lại Điểm Xanh', async () => {
      const text = await cancelText(paid({ paymentMethod: 'XU' }));
      expect(text).toMatch(/xu cũ — không hoàn tiền/);
      expect(text).toMatch(/Điểm Xanh/);
      expect(text).not.toMatch(/Ví Tubu/);
      expect(text).not.toMatch(/450\.000/);
    });

    it('đơn chưa trả tiền: không có khoản hoàn', async () => {
      const text = await cancelText(order({ placedForCustomer: true }));
      expect(text).toMatch(/Khách chưa trả tiền — không có khoản hoàn tiền/);
    });
  });

  it('đơn chuyển khoản đã huỷ mà tiền về muộn: nút "Ghi nhận tiền về muộn" → hỏi xác nhận rồi POST confirm-payment, hiện câu của API (R2-ADMINOPS-3)', async () => {
    const api = mockFetch({
      '/confirm-payment': { body: { ok: true, alreadyPaid: false, latePayment: true, message: 'Đã ghi khoản hoàn 450.000đ tiền về muộn, xem mục Hoàn tiền khách.' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(
      <OrderStatusActions
        order={order({ status: 'CANCELLED', allowedTransitions: [], canConfirmPayment: false, canRecordLatePayment: true })}
      />,
    );
    expect(buttonLabels(container)).not.toContain('Đã nhận tiền');
    click(byText(container, 'button', 'Ghi nhận tiền về muộn'));
    await flush();
    expect(confirmDialog()?.textContent).toMatch(/hàng đợi Hoàn tiền khách/);
    answerConfirm(true);
    await flush();
    expect(api.calls[0]!.url).toContain('/admin/orders/o1/confirm-payment');
    expect(container.textContent).toContain('xem mục Hoàn tiền khách');
  });

  it('R3-MONEY-3: "Ghi nhận tiền về muộn" có ô số tiền thực nhận (mặc định tổng đơn); khách chuyển thiếu thì ghi đúng số đó', async () => {
    const api = mockFetch({
      '/confirm-payment': { body: { ok: true, alreadyPaid: false, latePayment: true, message: 'Đã ghi khoản hoàn 50.000đ tiền về muộn.' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(
      <OrderStatusActions
        order={order({ status: 'CANCELLED', allowedTransitions: [], canConfirmPayment: false, canRecordLatePayment: true })}
      />,
    );
    const amount = container.querySelector('input[name="receivedAmount"]') as HTMLInputElement;
    expect(amount.value).toBe('450.000');
    expect(amount.className).toContain('min-h-[44px]');
    typeInto(amount, '50000');
    expect(amount.value).toBe('50.000');
    click(byText(container, 'button', 'Ghi nhận tiền về muộn'));
    await flush();
    const text = confirmDialog()?.textContent ?? '';
    expect(text).toMatch(/đã nhận 50\.000\s?đ chuyển khoản/);
    expect(text).toMatch(/khoản hoàn 50\.000\s?đ/);
    answerConfirm(true);
    await flush();
    expect(JSON.parse(String(api.calls[0]!.init?.body))).toEqual({ amount: 50_000 });
  });

  it.each([
    ['0', 'lớn hơn 0'],
    ['', 'lớn hơn 0'],
    ['450001', 'không vượt quá tổng đơn 450.000'],
  ])('R3-MONEY-3: số tiền thực nhận "%s" → báo lỗi ngay, không hỏi xác nhận, không gọi API', async (typed, msg) => {
    const api = mockFetch({});
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(
      <OrderStatusActions
        order={order({ status: 'CANCELLED', allowedTransitions: [], canConfirmPayment: false, canRecordLatePayment: true })}
      />,
    );
    typeInto(container.querySelector('input[name="receivedAmount"]') as HTMLInputElement, typed);
    click(byText(container, 'button', 'Ghi nhận tiền về muộn'));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(msg);
    expect(api.calls).toHaveLength(0);
  });

  it('"Đã nhận tiền" đơn còn sống: không có ô số tiền (phải nhận đủ), body không kèm amount', async () => {
    const api = mockFetch({ '/confirm-payment': { body: { ok: true, alreadyPaid: false, message: 'ok' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<OrderStatusActions order={order()} />);
    expect(container.querySelector('input[name="receivedAmount"]')).toBeNull();
    click(byText(container, 'button', 'Đã nhận tiền'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(JSON.parse(String(api.calls[0]!.init?.body))).toEqual({});
  });

  it('R3-MONEY-7: "Huỷ đơn" có ô lý do (khách đọc trong thông báo); nhập thì PUT kèm note', async () => {
    const api = mockFetch({ '/status': { body: { id: 'o1', status: 'CANCELLED' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<OrderStatusActions order={order({ canConfirmPayment: false })} />);
    click(byText(container, 'button', 'Huỷ đơn'));
    await flush();
    const d = confirmDialog()!;
    expect(d.textContent).toContain('khách sẽ đọc trong thông báo huỷ đơn');
    typeInto(d.querySelector('textarea') as HTMLTextAreaElement, '  Hết hàng nhà cung cấp ');
    answerConfirm(true);
    await flush();
    expect(JSON.parse(String(api.calls[0]!.init?.body))).toEqual({ status: 'CANCELLED', note: 'Hết hàng nhà cung cấp' });
  });

  it('nhân viên (canConfirmPayment=false ở cấp trang) không thấy nút ghi nhận tiền về muộn', () => {
    const { container } = mount(
      <OrderStatusActions order={order({ status: 'CANCELLED', allowedTransitions: [], canConfirmPayment: false, canRecordLatePayment: true })} canConfirmPayment={false} />,
    );
    expect(buttonLabels(container)).not.toContain('Ghi nhận tiền về muộn');
  });

  it('Kế toán (canConfirmPayment=true, canRecordLate=false): đơn đã huỷ không có nút ghi nhận tiền về muộn; đơn đang chờ vẫn có "Đã nhận tiền"', () => {
    const late = mount(
      <OrderStatusActions
        order={order({ status: 'CANCELLED', allowedTransitions: [], canConfirmPayment: false, canRecordLatePayment: true })}
        canConfirmPayment
        canRecordLate={false}
      />,
    );
    expect(buttonLabels(late.container)).not.toContain('Ghi nhận tiền về muộn');
    const live = mount(
      <OrderStatusActions order={order({ status: 'PENDING_PAYMENT', allowedTransitions: [], canConfirmPayment: true })} canConfirmPayment canRecordLate={false} />,
    );
    expect(buttonLabels(live.container)).toContain('Đã nhận tiền');
  });

  it('"Huỷ đơn" đơn đã trả trước: hộp thoại nêu số tiền hoàn và nơi nhận (Ví Tubu của khách), điểm đã dùng được trả lại', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetch({}).fn));
    const { container } = mount(
      <OrderStatusActions
        order={order({ status: 'CONFIRMED', paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', total: 300_000, pointsUsed: 50, canConfirmPayment: false })}
      />,
    );
    click(byText(container, 'button', 'Huỷ đơn'));
    await flush();
    const text = confirmDialog()!.textContent ?? '';
    expect(text).toMatch(/Hoàn 300\.000\s?đ vào Ví Tubu của khách/);
    expect(text).toMatch(/50 Điểm Xanh/);
    answerConfirm(false);
    await flush();
  });

  it('"Huỷ đơn" đơn chưa thu tiền: hộp thoại nói rõ không có khoản hoàn tiền; đơn Pancake nhắc sẽ huỷ cả bên kho', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetch({}).fn));
    const { container } = mount(
      <OrderStatusActions
        order={order({ status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID', pancakeOrderId: 'pk-9', canConfirmPayment: false })}
      />,
    );
    click(byText(container, 'button', 'Huỷ đơn'));
    await flush();
    const text = confirmDialog()!.textContent ?? '';
    expect(text).toMatch(/Khách chưa trả tiền — không có khoản hoàn/);
    expect(text).toMatch(/huỷ cả đơn trên kho Pancake/);
    answerConfirm(false);
    await flush();
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

// C-097 (Q-29): admin tối ưu máy tính nhưng nút thao tác tiền/đơn phải chạm được trên điện thoại.
describe('OrderStatusActions — DS v2, vùng chạm 44px ở điện thoại', () => {
  it('mọi nút trạng thái và "Đã nhận tiền" cao 44px (về gọn từ sm), ô mã giao dịch cũng vậy', () => {
    const { container } = mount(
      <OrderStatusActions order={order({ allowedTransitions: ['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED', 'CANCELLED'] })} />,
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(6);
    for (const b of buttons) expect(b.className).toContain('min-h-[44px]');
    expect(container.querySelector('input')?.className).toContain('min-h-[44px]');
  });

  it('nút "Huỷ đơn" tông nguy hiểm theo token (viền/chữ danger-fg), "Đã giao hàng" là nút chính forest', () => {
    const { container } = mount(
      <OrderStatusActions order={order({ canConfirmPayment: false, allowedTransitions: ['DELIVERED', 'CANCELLED'] })} />,
    );
    expect(byText(container, 'button', 'Huỷ đơn')?.className).toContain('text-danger-fg');
    expect(byText(container, 'button', 'Huỷ đơn')?.className).toContain('border-danger-fg');
    expect(byText(container, 'button', 'Đã giao hàng')?.className).toContain('bg-forest-600');
  });

  it('lỗi xác nhận tiền dùng danger-fg, thành công dùng success-fg', async () => {
    const api = mockFetch({ '/confirm-payment': { status: 400, body: { statusCode: 400, message: 'Chưa thấy giao dịch.' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<OrderStatusActions order={order()} />);
    click(byText(container, 'button', 'Đã nhận tiền'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(container.querySelector('[role="alert"]')?.className).toContain('text-danger-fg');
  });
});

describe('Chạy lại việc sau giao (đơn DELIVERED chưa có deliveredEffectsAt)', () => {
  const delivered = (over: Partial<AdminOrder> = {}) =>
    order({ status: 'DELIVERED', paymentStatus: 'PAID', allowedTransitions: ['RETURNED'], canConfirmPayment: false, deliveredEffectsAt: null, ...over });
  const RESYNC = 'Chạy lại việc sau giao';

  it('chỉ hiện cho ADMIN và khi đơn đã giao mà chưa có mốc xong việc', () => {
    expect(buttonLabels(mount(<OrderStatusActions order={delivered()} canResync />).container)).toContain(RESYNC);
    expect(buttonLabels(mount(<OrderStatusActions order={delivered()} />).container)).not.toContain(RESYNC);
    expect(
      buttonLabels(mount(<OrderStatusActions order={delivered({ deliveredEffectsAt: '2026-10-02T00:00:00.000Z' })} canResync />).container),
    ).not.toContain(RESYNC);
    expect(buttonLabels(mount(<OrderStatusActions order={order({ canConfirmPayment: false })} canResync />).container)).not.toContain(RESYNC);
  });

  it('hộp xác nhận nêu 3 việc; "Đóng" không gọi API; đồng ý → POST resync, hiện "Đã chạy xong"', async () => {
    const api = mockFetch({ '/resync-delivered-effects': { body: { orderId: 'o1', code: 'TB-300', outcome: 'DONE', pointsCredited: true, commissionsLocked: 1 } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<OrderStatusActions order={delivered()} canResync />);
    const btn = byText(container, 'button', RESYNC);
    click(btn);
    await flush();
    const text = confirmDialog()?.textContent ?? '';
    expect(text).toMatch(/Điểm Xanh/);
    expect(text).toMatch(/hoa hồng CTV/);
    expect(text).toMatch(/thưởng giới thiệu/);
    expect(text).toMatch(/không cộng hai lần/);
    answerConfirm(false);
    await flush();
    expect(api.calls).toHaveLength(0);

    click(btn);
    await flush();
    answerConfirm(true);
    await flush();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.url).toContain('/admin/orders/o1/resync-delivered-effects');
    expect(api.calls[0]!.init?.method).toBe('POST');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Đã chạy xong');
  });

  it.each([
    ['ALREADY_DONE', 'Đơn này đã xong từ trước', 'status'],
    ['INCOMPLETE', 'Chưa xong hết, xem lại sau', 'alert'],
  ])('kết quả %s hiện "%s"', async (outcome, text, role) => {
    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/resync-delivered-effects': { body: { orderId: 'o1', code: 'TB-300', outcome } } }).fn));
    const { container } = mount(<OrderStatusActions order={delivered()} canResync />);
    click(byText(container, 'button', RESYNC));
    await flush();
    answerConfirm(true);
    await flush();
    expect(container.querySelector(`[role="${role}"]`)?.textContent).toBe(text);
  });

  it('đang chạy thì nút bị khoá và chỉ có 1 request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        await gate;
        return new Response(JSON.stringify({ orderId: 'o1', code: 'TB-300', outcome: 'DONE' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const { container } = mount(<OrderStatusActions order={delivered()} canResync />);
    const btn = byText(container, 'button', RESYNC) as HTMLButtonElement;
    click(btn);
    await flush();
    answerConfirm(true);
    await flush();
    expect(btn.disabled).toBe(true);
    expect(container.textContent).toContain('Đang chạy');
    expect(calls).toHaveLength(1);
    release();
    await flush();
    expect(btn.disabled).toBe(false);
  });

  it('API lỗi → hiện thông báo lỗi', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/resync-delivered-effects': { status: 400, body: { message: 'Đơn TB-300 đang CANCELLED, không phải đơn đã giao.' } } }).fn));
    const { container } = mount(<OrderStatusActions order={delivered()} canResync />);
    click(byText(container, 'button', RESYNC));
    await flush();
    answerConfirm(true);
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('không phải đơn đã giao');
  });
});
