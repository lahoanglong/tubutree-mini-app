// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { useRemovedCoupon } from './use-removed-coupon';

// W28: máy chủ chỉ báo `couponRemoved` ở đúng lần đọc giỏ làm nó gỡ mã; trang phải nhớ lời báo tới khi giỏ lại có mã, khách đóng, hoặc giỏ trống.

type Cart = { couponCode: string | null; couponRemoved?: { code: string; reason: string; shortfall?: number } | null; subtotal: number };

const fmt = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const REMOVED = { code: 'MIN300', reason: 'Đơn tối thiểu 300.000đ để dùng mã này.', shortfall: 90_000 };

function Probe({ cart }: { cart: Cart | undefined }) {
  const { notice, dismiss } = useRemovedCoupon(cart, fmt);
  return (
    <div>
      <p data-testid="text">{notice?.text ?? ''}</p>
      <p data-testid="code">{notice?.code ?? ''}</p>
      <button type="button" onClick={dismiss}>
        dismiss
      </button>
    </div>
  );
}

let r: Rendered | null = null;
afterEach(() => {
  r?.unmount();
  r = null;
});

// Vẽ lại bằng đúng wrapper của `render` (cùng QueryClientProvider): khác cây thì React dựng lại và state của hook mất, không còn là một lần vẽ lại.
const client = new QueryClient();
const show = (cart: Cart | undefined) => {
  if (!r) r = render(<Probe cart={cart} />, client);
  else act(() => r!.root.render(<QueryClientProvider client={client}><Probe cart={cart} /></QueryClientProvider>));
};
const text = () => r!.container.querySelector('[data-testid="text"]')!.textContent;

describe('useRemovedCoupon (web)', () => {
  it('giỏ báo vừa gỡ mã: có lời báo kèm số thiếu', () => {
    show({ couponCode: null, couponRemoved: REMOVED, subtotal: 210_000 });
    expect(text()).toBe('Đã gỡ mã MIN300 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 90.000đ để dùng lại.');
    expect(r!.container.querySelector('[data-testid="code"]')!.textContent).toBe('MIN300');
  });

  it('lần đọc giỏ sau không còn couponRemoved (máy chủ chỉ báo một lần): lời báo vẫn còn', () => {
    show({ couponCode: null, couponRemoved: REMOVED, subtotal: 210_000 });
    show({ couponCode: null, couponRemoved: null, subtotal: 210_000 });
    expect(text()).toContain('Đã gỡ mã MIN300');
  });

  it('giỏ lại có mã: lời báo mất', () => {
    show({ couponCode: null, couponRemoved: REMOVED, subtotal: 210_000 });
    show({ couponCode: 'GIAM10', couponRemoved: null, subtotal: 310_000 });
    expect(text()).toBe('');
  });

  it('khách đóng: lời báo mất và không tự hiện lại khi trang vẽ lại với đúng giỏ cũ', () => {
    const cart: Cart = { couponCode: null, couponRemoved: REMOVED, subtotal: 210_000 };
    show(cart);
    act(() => r!.container.querySelector('button')!.click());
    expect(text()).toBe('');
    show(cart);
    expect(text()).toBe('');
  });

  it('khách mua thêm sau khi mã bị gỡ (giỏ lạc quan giữ nguyên couponRemoved): số thiếu giảm theo và không ghi lại tổng giỏ mới', () => {
    show({ couponCode: null, couponRemoved: REMOVED, subtotal: 210_000 });
    show({ couponCode: null, couponRemoved: REMOVED, subtotal: 250_000 });
    expect(text()).toBe('Đã gỡ mã MIN300 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 50.000đ để dùng lại.');
    show({ couponCode: null, couponRemoved: REMOVED, subtotal: 310_000 });
    expect(text()).toBe('Giỏ đã đủ đơn tối thiểu của mã MIN300. Bấm Chọn mã để dùng lại.');
  });

  it('giỏ trống: lời báo mất', () => {
    show({ couponCode: null, couponRemoved: REMOVED, subtotal: 210_000 });
    show({ couponCode: null, couponRemoved: null, subtotal: 0 });
    expect(text()).toBe('');
  });

  it('chưa có giỏ (đang tải): không có lời báo, không lỗi', () => {
    show(undefined);
    expect(text()).toBe('');
  });
});
