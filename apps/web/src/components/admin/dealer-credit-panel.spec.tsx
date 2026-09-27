// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DealerCreditPanel } from './dealer-credit-panel';
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

const dealerOrder = (over: Partial<AdminOrder> = {}): AdminOrder => ({
  id: 'o1',
  code: 'TB-200',
  type: 'DEALER',
  status: 'CONFIRMED',
  total: 12_500_000,
  paymentMethod: 'BANK_TRANSFER',
  createdAt: '2026-09-27T00:00:00.000Z',
  user: { id: 'u-dealer-1', phone: '0900000000', fullName: 'Đại lý A' },
  ...over,
});

const LEDGER_BODY = {
  balance: -3_000_000, // đang nợ 3tr
  entries: [
    { id: 'e2', delta: -3_000_000, refType: 'ORDER', refId: 'o2', note: 'Đơn TB-199 ghi công nợ', createdAt: '2026-09-20T00:00:00.000Z' },
  ],
};

describe('DealerCreditPanel (chi tiết đơn admin) — A5-09', () => {
  it('đơn không phải ĐẠI LÝ → không render gì', () => {
    const { container } = mount(<DealerCreditPanel order={dealerOrder({ type: 'RETAIL' })} />);
    expect(container.textContent).toBe('');
  });

  it('bấm mở → tải sổ công nợ, hiện dư nợ + lịch sử; xác nhận trả nợ → POST đúng endpoint, hỏi xác nhận trước', async () => {
    const api = mockFetch({
      '/credit-ledger': { body: LEDGER_BODY },
      '/credit-payment': { body: { balance: -1_000_000 } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);

    const { container } = mount(<DealerCreditPanel order={dealerOrder()} />);
    click(byText(container, 'button', 'Công nợ đại lý'));
    await flush();

    expect(api.calls[0]!.url).toContain('/admin/dealers/u-dealer-1/credit-ledger');
    expect(container.textContent).toContain('3.000.000');
    expect(container.textContent).toContain('Đơn TB-199 ghi công nợ');

    typeInto(container.querySelector('input[aria-label="Số tiền đã nhận (đ)"]'), '2000000');
    typeInto(container.querySelector('input[aria-label="Mã giao dịch ngân hàng"]'), 'FT999');
    const btn = byText(container, 'button', 'Xác nhận đã nhận, giảm nợ') as HTMLButtonElement;

    click(btn);
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(String(confirm.mock.calls[0]![0])).toMatch(/2\.000\.000/);
    expect(api.calls).toHaveLength(1); // huỷ hộp thoại → chưa gọi POST

    click(btn);
    await flush();
    // Sau khi POST thành công, panel invalidate query nên sổ công nợ được tải lại (thêm 1 GET) —
    // tìm đúng lượt POST theo URL/method thay vì đoán số thứ tự.
    const postCall = api.calls.find((c) => c.init?.method === 'POST');
    expect(postCall?.url).toContain('/admin/dealers/u-dealer-1/credit-payment');
    expect(JSON.parse(String(postCall?.init?.body))).toEqual({ amount: 2_000_000, bankRef: 'FT999' });
    expect(postCall?.init?.headers).toMatchObject({ 'Idempotency-Key': 'FT999' });
    expect(container.querySelector('[role="status"]')?.textContent).toContain('1.000.000');
  });

  it('không nhập số tiền → báo lỗi tại chỗ, không gọi API', async () => {
    const api = mockFetch({ '/credit-ledger': { body: LEDGER_BODY } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<DealerCreditPanel order={dealerOrder()} />);
    click(byText(container, 'button', 'Công nợ đại lý'));
    await flush();
    click(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/số tiền hợp lệ/i);
    expect(api.calls).toHaveLength(1); // chỉ có lượt tải ledger, không có POST
  });

  it('400 (vượt dư nợ) → hiện NGUYÊN VĂN message của API', async () => {
    const msg = 'Số tiền vượt quá dư nợ hiện tại (3.000.000đ).';
    const api = mockFetch({
      '/credit-ledger': { body: LEDGER_BODY },
      '/credit-payment': { status: 400, body: { statusCode: 400, message: msg } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = mount(<DealerCreditPanel order={dealerOrder()} />);
    click(byText(container, 'button', 'Công nợ đại lý'));
    await flush();
    typeInto(container.querySelector('input[aria-label="Số tiền đã nhận (đ)"]'), '99000000');
    click(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(msg);
  });
});
