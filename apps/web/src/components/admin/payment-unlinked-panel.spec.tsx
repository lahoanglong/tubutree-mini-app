// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PAYMENT_UNLINKED_CLOSED_TEXT, PAYMENT_UNLINKED_OPEN_TEXT, PaymentUnlinkedBadge, PaymentUnlinkedPanel } from './payment-unlinked-panel';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminOrder } from '@/lib/admin-client';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});
const mount = (ui: React.ReactElement) => {
  const r = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
  mounted.push(r);
  return r;
};

const order = (over: Partial<AdminOrder> = {}): AdminOrder => ({
  id: 'o1',
  code: 'TB-100',
  status: 'CONFIRMED',
  total: 300000,
  paymentMethod: 'BANK_TRANSFER',
  paymentStatus: 'UNPAID',
  createdAt: '2026-11-04T00:00:00.000Z',
  paymentUnlinkedAt: '2026-11-04T01:00:00.000Z',
  hasRecyclingPickup: false,
  gomdonStatus: null,
  gomdonOrderId: null,
  gomdonPartnerCode: null,
  gomdonCancelStatus: null,
  ...over,
});

describe('PaymentUnlinkedPanel (chi tiết đơn admin)', () => {
  it('đơn còn mở: lời nhắc bảo bấm "Đã nhận tiền"', () => {
    const { container } = mount(<PaymentUnlinkedPanel order={order()} isAdmin />);
    expect(container.textContent).toContain(PAYMENT_UNLINKED_OPEN_TEXT);
    expect(container.textContent).toContain('khách đã chuyển thì bấm "Đã nhận tiền"');
  });

  it.each(['CANCELLED', 'RETURNED'])('đơn %s: lời nhắc dành cho quản trị viên, bảo ghi tiền về muộn rồi bấm "Đã đối chiếu"', (status) => {
    const { container } = mount(<PaymentUnlinkedPanel order={order({ status })} isAdmin />);
    expect(container.textContent).toContain(PAYMENT_UNLINKED_CLOSED_TEXT);
    expect(container.textContent).not.toContain('bấm "Đã nhận tiền"');
  });

  it('không có cờ hoặc đơn đã PAID: không hiện gì', () => {
    expect(mount(<PaymentUnlinkedPanel order={order({ paymentUnlinkedAt: null })} isAdmin />).container.textContent).toBe('');
    expect(mount(<PaymentUnlinkedPanel order={order({ paymentStatus: 'PAID' })} isAdmin />).container.textContent).toBe('');
    expect(mount(<PaymentUnlinkedBadge order={order({ paymentStatus: 'PAID' })} />).container.textContent).toBe('');
    expect(mount(<PaymentUnlinkedBadge order={order()} />).container.textContent).toContain('Chờ đối chiếu sao kê');
  });

  it('nút "Đã đối chiếu" chỉ có ở ADMIN; Kế toán vẫn thấy lời nhắc', () => {
    const admin = mount(<PaymentUnlinkedPanel order={order()} isAdmin />);
    expect(byText(admin.container, 'button', 'Đã đối chiếu')).not.toBeNull();
    const staff = mount(<PaymentUnlinkedPanel order={order()} isAdmin={false} />);
    expect(byText(staff.container, 'button', 'Đã đối chiếu')).toBeNull();
    expect(staff.container.textContent).toContain(PAYMENT_UNLINKED_OPEN_TEXT);
  });

  it('bấm hỏi ghi chú bắt buộc ≥ 3 ký tự: ngắn thì khoá nút xác nhận, huỷ thì không gọi API, đủ thì POST ghi chú đã trim', async () => {
    const api = mockFetch({ '/payment-unlinked/resolve': { body: { ok: true, message: 'Đã đối chiếu khoản Pancake báo đã thanh toán của đơn TB-100.' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<PaymentUnlinkedPanel order={order({ status: 'CANCELLED' })} isAdmin />);
    click(byText(container, 'button', 'Đã đối chiếu'));
    await flush();
    const accept = () => confirmDialog()!.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!;
    expect(accept().disabled).toBe(true);
    typeInto(confirmDialog()!.querySelector('textarea'), '  ab ');
    expect(accept().disabled).toBe(true);
    answerConfirm(false);
    await flush();
    expect(api.calls).toHaveLength(0);

    click(byText(container, 'button', 'Đã đối chiếu'));
    await flush();
    typeInto(confirmDialog()!.querySelector('textarea'), '  đã ghi tiền về muộn  ');
    expect(accept().disabled).toBe(false);
    answerConfirm(true);
    await flush();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.url).toContain('/admin/orders/o1/payment-unlinked/resolve');
    expect(api.calls[0]!.init?.method).toBe('POST');
    expect(api.calls[0]!.init?.body).toBe(JSON.stringify({ note: 'đã ghi tiền về muộn' }));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Đã đối chiếu khoản Pancake');
  });

  it('API trả 400 (bên kia đã đóng): hiện lỗi nguyên văn', async () => {
    const msg = 'Đơn TB-100 không còn khoản Pancake báo đã thanh toán chờ đối chiếu.';
    const api = mockFetch({ '/payment-unlinked/resolve': { status: 400, body: { message: msg } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<PaymentUnlinkedPanel order={order()} isAdmin />);
    click(byText(container, 'button', 'Đã đối chiếu'));
    await flush();
    typeInto(confirmDialog()!.querySelector('textarea'), 'đã xử lý');
    answerConfirm(true);
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(msg);
  });
});
