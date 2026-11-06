'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { rememberRemovedCoupon, removedCouponNotice, type RemovedCoupon, type RemovedCouponMemory } from '@tubutree/app-core/coupon-min-order';

type CartLike = { couponCode?: string | null; couponRemoved?: RemovedCoupon | null; subtotal?: number };

/**
 * Nhớ mã máy chủ vừa gỡ khỏi giỏ (giỏ rơi dưới đơn tối thiểu, mã hết hạn hay bị tắt): `couponRemoved` chỉ có ở đúng lần đọc giỏ làm nó gỡ.
 * Chỉ nhìn lại khi `couponRemoved` đổi (đối tượng mới từ máy chủ), khi giỏ có hay mất mã, và khi giỏ trống hay có hàng trở lại: giỏ lạc quan
 * (`...cart`) giữ nguyên đối tượng cũ nên không ghi lại tổng giỏ lúc gỡ, và số thiếu đi theo tổng giỏ hiện tại.
 */
export function useRemovedCoupon(cart: CartLike | null | undefined, formatMoney: (n: number) => string) {
  const [memory, setMemory] = useState<RemovedCouponMemory | null>(null);
  const latest = useRef(cart);
  latest.current = cart;
  const removed = cart?.couponRemoved ?? null;
  const code = cart?.couponCode ?? null;
  const hasItems = (cart?.subtotal ?? 0) > 0;

  useEffect(() => {
    const now = latest.current;
    if (now) setMemory((prev) => rememberRemovedCoupon(prev, now));
  }, [removed, code, hasItems]);

  const dismiss = useCallback(() => setMemory(null), []);
  return { notice: removedCouponNotice(memory, cart?.subtotal ?? 0, formatMoney), dismiss };
}
