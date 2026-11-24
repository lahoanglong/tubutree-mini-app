// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({
  trackPurchase: vi.fn(),
  takeCheckoutEntry: vi.fn(() => 'buy_now'),
  hooks: new Set<() => void>(),
}));
vi.mock('@/lib/analytics', () => ({
  trackPurchase: m.trackPurchase,
  takeCheckoutEntry: m.takeCheckoutEntry,
  onPageHide: (fn: () => void) => {
    m.hooks.add(fn);
    return () => m.hooks.delete(fn);
  },
}));

import { useCheckoutFunnel, type CheckoutFunnel } from './use-checkout-funnel';

type Props = { quoteReady: boolean; itemCount: number; addressId: string | null };
let root: Root;
let funnel: CheckoutFunnel;
function Probe(props: Props) {
  funnel = useCheckoutFunnel(props);
  return null;
}
const show = (props: Props) =>
  act(() =>
    root.render(
      <StrictMode>
        <Probe {...props} />
      </StrictMode>,
    ),
  );
const leave = async () => {
  act(() => root.render(<></>));
  // Bản ghi bỏ dở chờ một nhịp (StrictMode gắn lại effect ngay); rời màn thật thì nhịp đó trôi qua.
  await act(async () => new Promise((r) => setTimeout(r, 0)));
};
const named = (name: string) => m.trackPurchase.mock.calls.filter((c) => c[0] === name);

beforeEach(() => {
  m.trackPurchase.mockClear();
  m.takeCheckoutEntry.mockClear();
  m.hooks.clear();
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  act(() => root.unmount());
  // Gỡ màn hẹn checkout_abandoned sau một nhịp: chờ nhịp đó ngay trong ca này, để bản ghi không rơi sang ca sau (sau mockClear của ca sau).
  await act(async () => new Promise((r) => setTimeout(r, 0)));
});

describe('useCheckoutFunnel', () => {
  it('checkout_started một lần ở báo giá thành công đầu tiên, entry lấy từ takeCheckoutEntry; báo giá tải lại không phát thêm', () => {
    show({ quoteReady: false, itemCount: 2, addressId: 'a1' });
    expect(named('checkout_started')).toHaveLength(0);
    show({ quoteReady: true, itemCount: 2, addressId: 'a1' });
    show({ quoteReady: true, itemCount: 3, addressId: 'a1' });
    show({ quoteReady: false, itemCount: 3, addressId: 'a1' });
    show({ quoteReady: true, itemCount: 3, addressId: 'a1' });
    expect(named('checkout_started')).toEqual([['checkout_started', { entry: 'buy_now', itemCount: 2 }]]);
    expect(m.takeCheckoutEntry).toHaveBeenCalledTimes(1);
    expect(named('checkout_step').map((c) => c[1])).toEqual([{ step: 'address_saved' }, { step: 'shipping_quote_shown' }]);
  });

  it('bước làm trước báo giá đầu (khách mới tạo địa chỉ) phát ngay sau checkout_started, không trùng địa chỉ', () => {
    show({ quoteReady: false, itemCount: 1, addressId: null });
    act(() => funnel.step('address_saved'));
    act(() => funnel.step('payment_method_selected', 'BANK_TRANSFER'));
    expect(m.trackPurchase).not.toHaveBeenCalled();
    show({ quoteReady: true, itemCount: 1, addressId: 'a9' });
    expect(m.trackPurchase.mock.calls.map((c) => [c[0], c[1].step ?? c[1].entry])).toEqual([
      ['checkout_started', 'buy_now'],
      ['checkout_step', 'address_saved'],
      ['checkout_step', 'payment_method_selected'],
      ['checkout_step', 'shipping_quote_shown'],
    ]);
    expect(named('checkout_step')[1]![1]).toEqual({ step: 'payment_method_selected', paymentMethod: 'BANK_TRANSFER' });
  });

  it('rời màn khi chưa đặt: checkout_abandoned đúng một lần với bước xa nhất đã tới (đóng tab rồi gỡ màn không phát lần hai)', async () => {
    show({ quoteReady: true, itemCount: 1, addressId: 'a1' });
    act(() => funnel.step('place_order_click'));
    act(() => funnel.step('address_saved'));
    act(() => m.hooks.forEach((fn) => fn()));
    await leave();
    expect(named('checkout_abandoned')).toEqual([['checkout_abandoned', { lastStep: 'place_order_click' }]]);
  });

  it('gỡ màn (đổi trang) khi chưa đặt cũng phát một lần', async () => {
    show({ quoteReady: true, itemCount: 1, addressId: 'a1' });
    await leave();
    expect(named('checkout_abandoned')).toEqual([['checkout_abandoned', { lastStep: 'shipping_quote_shown' }]]);
  });

  it('đặt đơn xong (kể cả chuyển sang trang chuyển khoản) thì rời màn không phải bỏ dở', async () => {
    show({ quoteReady: true, itemCount: 1, addressId: 'a1' });
    act(() => funnel.step('place_order_click'));
    act(() => funnel.ordered());
    act(() => m.hooks.forEach((fn) => fn()));
    await leave();
    expect(named('checkout_abandoned')).toHaveLength(0);
  });

  it('chưa có checkout_started (báo giá chưa về, khách vãng lai) thì không có gì bỏ dở', async () => {
    show({ quoteReady: false, itemCount: 0, addressId: null });
    act(() => m.hooks.forEach((fn) => fn()));
    await leave();
    expect(m.trackPurchase).not.toHaveBeenCalled();
  });
});
