'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeDroppedCart } from '@/lib/use-cart-write';
import {
  couponGoodsOf,
  rememberRemovedCoupon,
  removedCouponNotice,
  type CouponGoodsSource,
  type RemovedCoupon,
  type RemovedCouponMemory,
} from '@tubutree/app-core/coupon-min-order';

type CartLike = CouponGoodsSource & { couponCode?: string | null; couponRemoved?: RemovedCoupon | null };

/** Xoá lời báo gỡ mã khỏi mọi giỏ đang cache: trang khác (giỏ ↔ thanh toán) dựng hook mới từ cache sẽ không dựng lại lời báo khách đã đóng. */
function clearRemovedCoupon(cart: unknown): unknown {
  if (cart && typeof cart === 'object' && (cart as { couponRemoved?: unknown }).couponRemoved) return { ...cart, couponRemoved: null };
  return cart;
}

/**
 * Nhớ mã máy chủ vừa gỡ khỏi giỏ (giỏ rơi dưới đơn tối thiểu, mã hết hạn hay bị tắt): `couponRemoved` chỉ có ở đúng lần đọc giỏ làm nó gỡ.
 * Chỉ nhìn lại khi `couponRemoved` đổi (đối tượng mới từ máy chủ), khi giỏ có hay mất mã, và khi giỏ trống hay có hàng trở lại: giỏ lạc quan
 * (`...cart`) giữ nguyên đối tượng cũ nên không ghi lại phần hàng tính mã lúc gỡ, và số thiếu đi theo phần hàng tính mã hiện tại.
 */
export function useRemovedCoupon(cart: CartLike | null | undefined, formatMoney: (n: number) => string) {
  const qc = useQueryClient();
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

  // Phản hồi giỏ bị `useCartWrite` bỏ (lệnh chồng nhau) vẫn có thể là phản hồi duy nhất mang `couponRemoved`: nhớ thẳng từ nó (như `remember` của Mini App), phần hàng tính theo chính phản hồi.
  useEffect(
    () =>
      subscribeDroppedCart(qc, (response) => {
        if (response.couponRemoved) setMemory((prev) => rememberRemovedCoupon(prev, response));
      }),
    [qc],
  );

  const dismiss = useCallback(() => {
    setMemory(null);
    qc.setQueriesData({ queryKey: ['cart'] }, clearRemovedCoupon);
  }, [qc]);
  return { notice: removedCouponNotice(memory, cart ? couponGoodsOf(cart) : 0, formatMoney), dismiss };
}
