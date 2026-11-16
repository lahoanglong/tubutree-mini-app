'use client';

import { useCallback, useEffect, useRef } from 'react';
import { CHECKOUT_STEPS, type CheckoutLastStep, type CheckoutStep } from '@tubutree/shared-types';
import { onPageHide, takeCheckoutEntry, trackPurchase } from '@/lib/analytics';

const PAYMENT_METHOD_RE = /^[A-Za-z_]{2,32}$/;

interface Funnel {
  started: boolean;
  /** Bước xa nhất đã tới (theo thứ tự CHECKOUT_STEPS): khách quay lại sửa địa chỉ sau khi đã bấm đặt vẫn tính là bỏ dở ở bước đặt. */
  lastStep: CheckoutLastStep;
  /** Bước xảy ra trước `checkout_started` (khách mới chưa có địa chỉ: tạo địa chỉ rồi mới có báo giá): phát ngay sau nó để thứ tự phễu đúng. */
  pending: { step: CheckoutStep; paymentMethod?: string }[];
  ordered: boolean;
  abandoned: boolean;
  mounted: boolean;
}

export interface CheckoutFunnel {
  /** Khách tự làm một bước (lưu địa chỉ mới, đổi cách thanh toán, bấm Đặt hàng). */
  step: (step: CheckoutStep, paymentMethod?: string) => void;
  /** Đơn đã tạo (kể cả chuyển sang trang chuyển khoản): từ đây rời trang không còn là bỏ dở. */
  ordered: () => void;
}

const rank = (s: CheckoutLastStep) => (s === 'started' ? -1 : CHECKOUT_STEPS.indexOf(s));

/**
 * Phễu của màn thanh toán web: `checkout_started` một lần cho báo giá thành công đầu tiên (như Mini App), `checkout_step` cho từng bước,
 * `checkout_abandoned` tối đa một lần khi rời màn (đổi trang hoặc đóng tab) mà chưa đặt được đơn. Chưa có `checkout_started` thì không có gì để bỏ dở.
 */
export function useCheckoutFunnel({ quoteReady, itemCount, addressId }: { quoteReady: boolean; itemCount: number; addressId: string | null }): CheckoutFunnel {
  const f = useRef<Funnel>({ started: false, lastStep: 'started', pending: [], ordered: false, abandoned: false, mounted: false });

  const emit = useCallback((step: CheckoutStep, paymentMethod?: string) => {
    const st = f.current;
    if (rank(step) > rank(st.lastStep)) st.lastStep = step;
    trackPurchase('checkout_step', paymentMethod && PAYMENT_METHOD_RE.test(paymentMethod) ? { step, paymentMethod } : { step });
  }, []);

  const step = useCallback(
    (s: CheckoutStep, paymentMethod?: string) => {
      const st = f.current;
      if (st.ordered) return;
      if (!st.started) st.pending.push({ step: s, ...(paymentMethod ? { paymentMethod } : {}) });
      else emit(s, paymentMethod);
    },
    [emit],
  );

  useEffect(() => {
    const st = f.current;
    if (!quoteReady || st.started) return;
    st.started = true;
    trackPurchase('checkout_started', { entry: takeCheckoutEntry(), itemCount: Math.min(500, Math.max(0, itemCount)) });
    // Địa chỉ mặc định được chọn sẵn trước khi có báo giá: đó là lần "có địa chỉ cho đơn" đầu tiên, trừ khi khách đã tự lưu địa chỉ mới (nằm trong `pending`).
    if (addressId && !st.pending.some((p) => p.step === 'address_saved')) emit('address_saved');
    for (const p of st.pending.splice(0)) emit(p.step, p.paymentMethod);
    // Báo giá đầu tiên là lần đầu khách thấy phí giao.
    emit('shipping_quote_shown');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ theo lần báo giá thành công đầu tiên
  }, [quoteReady]);

  useEffect(() => {
    const st = f.current;
    st.mounted = true;
    const abandon = () => {
      if (!st.started || st.ordered || st.abandoned) return;
      st.abandoned = true;
      trackPurchase('checkout_abandoned', { lastStep: st.lastStep });
    };
    const off = onPageHide(abandon);
    return () => {
      off();
      st.mounted = false;
      // StrictMode gỡ rồi gắn lại effect ngay trong cùng lượt: chờ một nhịp, còn gắn lại thì không phải khách rời màn.
      setTimeout(() => {
        if (!st.mounted) abandon();
      }, 0);
    };
  }, []);

  const ordered = useCallback(() => {
    f.current.ordered = true;
  }, []);

  return { step, ordered };
}
