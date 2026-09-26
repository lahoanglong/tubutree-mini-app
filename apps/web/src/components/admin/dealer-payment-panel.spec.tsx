// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { DealerPaymentPanel, canConfirmDealerPayment } from './dealer-payment-panel';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
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

/** Đơn đại lý TRẢ TRƯỚC đang chờ chuyển khoản (BE gắn dealerOnCredit=false). */
const dealerOrder = (over: Partial<AdminOrder> = {}): AdminOrder => ({
  id: 'o1',
  code: 'TB-200',
  type: 'DEALER',
  dealerOnCredit: false,
  status: 'PENDING_PAYMENT',
  total: 12_500_000,
  paymentMethod: 'BANK_TRANSFER',
  paymentStatus: 'UNPAID',
  createdAt: '2026-09-27T00:00:00.000Z',
  ...over,
});

const OK_BODY = {
  ok: true,
  alreadyPaid: false,
  message: 'Đã xác nhận thanh toán đơn TB-200.',
  order: { id: 'o1', code: 'TB-200', status: 'CONFIRMED', paymentStatus: 'PAID' },
};

describe('canConfirmDealerPayment — khi nào hiện "Xác nhận đã nhận chuyển khoản"', () => {
  it('đơn đại lý trả trước còn UNPAID (PENDING_PAYMENT hay đã CONFIRMED/đang giao) → hiện', () => {
    expect(canConfirmDealerPayment(dealerOrder())).toBe(true);
    expect(canConfirmDealerPayment(dealerOrder({ status: 'CONFIRMED' }))).toBe(true);
    expect(canConfirmDealerPayment(dealerOrder({ status: 'SHIPPING' }))).toBe(true);
  });

  it('đơn lẻ / đã thanh toán / đã hoàn / công nợ / đã huỷ-trả / không rõ công nợ → ẩn', () => {
    expect(canConfirmDealerPayment(dealerOrder({ type: 'RETAIL' }))).toBe(false);
    expect(canConfirmDealerPayment(dealerOrder({ paymentStatus: 'PAID' }))).toBe(false);
    expect(canConfirmDealerPayment(dealerOrder({ paymentStatus: 'REFUNDED' }))).toBe(false);
    expect(canConfirmDealerPayment(dealerOrder({ dealerOnCredit: true, status: 'CONFIRMED' }))).toBe(false);
    expect(canConfirmDealerPayment(dealerOrder({ status: 'CANCELLED' }))).toBe(false);
    expect(canConfirmDealerPayment(dealerOrder({ status: 'RETURNED' }))).toBe(false);
    // API cũ không trả cờ công nợ → không đoán, ẩn nút (BE vẫn là chốt chặn cuối).
    expect(canConfirmDealerPayment(dealerOrder({ dealerOnCredit: undefined }))).toBe(false);
  });
});

describe('DealerPaymentPanel (chi tiết đơn admin)', () => {
  it('đơn không đủ điều kiện → không render gì', () => {
    const { container } = mount(<DealerPaymentPanel order={dealerOrder({ dealerOnCredit: true })} />);
    expect(container.textContent).toBe('');
  });

  it('hỏi xác nhận (mã đơn + số tiền) — huỷ thì KHÔNG gọi API; đồng ý thì POST kèm mã GD + ghi chú, hiện message của API', async () => {
    const api = mockFetch({ '/confirm-payment': { body: OK_BODY } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { container } = mount(<DealerPaymentPanel order={dealerOrder()} />);
    typeInto(container.querySelector('input[aria-label="Mã giao dịch ngân hàng"]'), ' FT26270123 ');
    typeInto(container.querySelector('input[aria-label="Ghi chú xác nhận thanh toán"]'), 'đã đối soát sao kê');
    const btn = byText(container, 'button', 'Xác nhận đã nhận chuyển khoản') as HTMLButtonElement;

    click(btn);
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    const question = String(confirm.mock.calls[0]![0]);
    expect(question).toContain('TB-200');
    expect(question).toMatch(/12\.500\.000/);
    expect(api.calls).toHaveLength(0);

    click(btn);
    await flush();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.url).toContain('/admin/dealer-orders/o1/confirm-payment');
    expect(api.calls[0]!.init?.method).toBe('POST');
    expect(api.calls[0]!.init?.body).toBe(JSON.stringify({ bankRef: 'FT26270123', note: 'đã đối soát sao kê' }));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Đã xác nhận thanh toán đơn TB-200.');
  });

  it('không nhập gì → body {} (mã GD và ghi chú đều tuỳ chọn)', async () => {
    const api = mockFetch({ '/confirm-payment': { body: OK_BODY } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = mount(<DealerPaymentPanel order={dealerOrder()} />);
    click(byText(container, 'button', 'Xác nhận đã nhận chuyển khoản'));
    await flush();
    expect(api.calls[0]!.init?.body).toBe('{}');
  });

  it('400 → hiện NGUYÊN VĂN message của API (role=alert), không báo thành công', async () => {
    const msg = 'Đơn TB-200 là đơn "Ghi công nợ" — ghi nhận thanh toán qua sổ công nợ đại lý, không xác nhận ở đây.';
    const api = mockFetch({ '/confirm-payment': { status: 400, body: { statusCode: 400, message: msg } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = mount(<DealerPaymentPanel order={dealerOrder({ status: 'CONFIRMED' })} />);
    click(byText(container, 'button', 'Xác nhận đã nhận chuyển khoản'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(msg);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('bấm dồn khi đang gửi → chỉ 1 request (chống double-submit), nút khoá tới khi xong', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        await gate;
        return new Response(JSON.stringify(OK_BODY), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = mount(<DealerPaymentPanel order={dealerOrder()} />);
    const btn = byText(container, 'button', 'Xác nhận đã nhận chuyển khoản') as HTMLButtonElement;
    // 2 cú bấm trong CÙNG 1 lượt (React chưa kịp render nút disabled) + 1 cú sau khi render.
    act(() => {
      btn.click();
      btn.click();
    });
    click(btn);
    await flush();
    expect(calls).toHaveLength(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((byText(container, 'button', /Đang xác nhận|Xác nhận đã nhận chuyển khoản/) as HTMLButtonElement).disabled).toBe(true);
    release();
    await flush();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Đã xác nhận thanh toán đơn TB-200.');
  });

  it('API báo đơn đã được ghi nhận thanh toán từ trước (alreadyPaid) → hiện đúng message đó', async () => {
    const already = { ...OK_BODY, alreadyPaid: true, message: 'Đơn TB-200 đã được ghi nhận thanh toán trước đó.' };
    const api = mockFetch({ '/confirm-payment': { body: already } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = mount(<DealerPaymentPanel order={dealerOrder()} />);
    click(byText(container, 'button', 'Xác nhận đã nhận chuyển khoản'));
    await flush();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Đơn TB-200 đã được ghi nhận thanh toán trước đó.');
  });
});
