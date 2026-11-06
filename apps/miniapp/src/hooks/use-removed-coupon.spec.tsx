import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { useRemovedCoupon } from './use-removed-coupon';

// W28: máy chủ chỉ báo `couponRemoved` ở đúng lần đọc giỏ làm nó gỡ mã; trang phải nhớ lời báo tới khi giỏ lại có mã, khách đóng, hoặc giỏ trống.

type Cart = {
  couponCode: string | null;
  couponRemoved?: { code: string; reason: string; shortfall?: number } | null;
  subtotal: number;
  items?: { total: number; isFlash?: boolean }[];
};

const fmt = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const REMOVED = { code: 'MIN300', reason: 'Đơn tối thiểu 300.000đ để dùng mã này.', shortfall: 90_000 };
const hook = (cart: Cart | undefined, client = new QueryClient()) =>
  renderHook((props: { cart: Cart | undefined }) => useRemovedCoupon(props.cart, fmt), {
    initialProps: { cart },
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });

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

  it('khách đóng: couponRemoved cũng bị xoá khỏi cache giỏ, trang khác dựng hook mới từ cache không dựng lại lời báo', () => {
    const client = new QueryClient();
    client.setQueryData(['cart', null], { couponCode: null, couponRemoved: REMOVED, subtotal: 210_000 });
    const { result } = hook({ couponCode: null, couponRemoved: REMOVED, subtotal: 210_000 }, client);
    act(() => result.current.dismiss());
    expect((client.getQueryData(['cart', null]) as Cart).couponRemoved).toBeNull();
  });

  it('remember: phản hồi của lệnh sửa/xoá mang couponRemoved thì có lời báo dù giỏ đọc lại không còn couponRemoved', () => {
    const { result, rerender } = hook({ couponCode: 'MIN300', subtotal: 210_000, items: [{ total: 210_000 }] });
    act(() => result.current.remember({ couponCode: null, couponRemoved: REMOVED, subtotal: 210_000, items: [{ total: 210_000 }] }));
    expect(result.current.notice?.text).toBe('Đã gỡ mã MIN300 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 90.000đ để dùng lại.');
    rerender({ cart: { couponCode: null, couponRemoved: null, subtotal: 210_000, items: [{ total: 210_000 }] } });
    expect(result.current.notice?.code).toBe('MIN300');
  });

  it('remember: phản hồi không có couponRemoved thì không đổi gì', () => {
    const { result } = hook({ couponCode: 'GIAM10', subtotal: 210_000 });
    act(() => result.current.remember({ couponCode: 'GIAM10', subtotal: 160_000 }));
    expect(result.current.notice).toBeNull();
  });

  it('khách mua thêm hàng Giờ vàng sau khi mã bị gỡ: phần hàng tính mã không đổi nên số thiếu giữ nguyên', () => {
    const { result, rerender } = hook({ couponCode: null, couponRemoved: REMOVED, subtotal: 210_000, items: [{ total: 210_000 }] });
    rerender({ cart: { couponCode: null, couponRemoved: REMOVED, subtotal: 420_000, items: [{ total: 210_000 }, { total: 210_000, isFlash: true }] } });
    expect(result.current.notice?.text).toBe('Đã gỡ mã MIN300 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 90.000đ để dùng lại.');
  });
});
