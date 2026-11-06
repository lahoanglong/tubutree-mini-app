import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRemovedCoupon } from './use-removed-coupon';

// W28: máy chủ chỉ báo `couponRemoved` ở đúng lần đọc giỏ làm nó gỡ mã; trang phải nhớ lời báo tới khi giỏ lại có mã, khách đóng, hoặc giỏ trống.

type Cart = { couponCode: string | null; couponRemoved?: { code: string; reason: string; shortfall?: number } | null; subtotal: number };

const fmt = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const REMOVED = { code: 'MIN300', reason: 'Đơn tối thiểu 300.000đ để dùng mã này.', shortfall: 90_000 };
const hook = (cart: Cart | undefined) => renderHook((props: { cart: Cart | undefined }) => useRemovedCoupon(props.cart, fmt), { initialProps: { cart } });

describe('useRemovedCoupon (Mini App)', () => {
  it('giỏ báo vừa gỡ mã: có lời báo kèm số thiếu', () => {
    const { result } = hook({ couponCode: null, couponRemoved: REMOVED, subtotal: 210_000 });
    expect(result.current.notice).toEqual({ code: 'MIN300', text: 'Đã gỡ mã MIN300 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 90.000đ để dùng lại.' });
  });

  it('lần đọc giỏ sau không còn couponRemoved (máy chủ chỉ báo một lần): lời báo vẫn còn', () => {
    const { result, rerender } = hook({ couponCode: null, couponRemoved: REMOVED, subtotal: 210_000 });
    rerender({ cart: { couponCode: null, couponRemoved: null, subtotal: 210_000 } });
    expect(result.current.notice?.code).toBe('MIN300');
  });

  it('giỏ lại có mã: lời báo mất', () => {
    const { result, rerender } = hook({ couponCode: null, couponRemoved: REMOVED, subtotal: 210_000 });
    rerender({ cart: { couponCode: 'GIAM10', couponRemoved: null, subtotal: 310_000 } });
    expect(result.current.notice).toBeNull();
  });

  it('khách đóng: lời báo mất và không tự hiện lại khi trang vẽ lại với đúng giỏ cũ', () => {
    const cart: Cart = { couponCode: null, couponRemoved: REMOVED, subtotal: 210_000 };
    const { result, rerender } = hook(cart);
    act(() => result.current.dismiss());
    expect(result.current.notice).toBeNull();
    rerender({ cart });
    expect(result.current.notice).toBeNull();
  });

  it('khách mua thêm sau khi mã bị gỡ (giỏ lạc quan giữ nguyên couponRemoved): số thiếu giảm theo, đủ thì mời chọn lại mã', () => {
    const { result, rerender } = hook({ couponCode: null, couponRemoved: REMOVED, subtotal: 210_000 });
    rerender({ cart: { couponCode: null, couponRemoved: REMOVED, subtotal: 250_000 } });
    expect(result.current.notice?.text).toBe('Đã gỡ mã MIN300 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 50.000đ để dùng lại.');
    rerender({ cart: { couponCode: null, couponRemoved: REMOVED, subtotal: 310_000 } });
    expect(result.current.notice?.text).toBe('Giỏ đã đủ đơn tối thiểu của mã MIN300. Bấm Chọn mã để dùng lại.');
  });

  it('giỏ trống: lời báo mất', () => {
    const { result, rerender } = hook({ couponCode: null, couponRemoved: REMOVED, subtotal: 210_000 });
    rerender({ cart: { couponCode: null, couponRemoved: null, subtotal: 0 } });
    expect(result.current.notice).toBeNull();
  });

  it('chưa có giỏ (đang tải): không có lời báo, không lỗi', () => {
    const { result } = hook(undefined);
    expect(result.current.notice).toBeNull();
  });
});
