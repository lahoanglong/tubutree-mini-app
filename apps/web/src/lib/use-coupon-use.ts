'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { couponUseCopy, couponUseOutcome, couponUseTarget } from '@tubutree/app-core/coupon-use';
import { cartKey } from '@/lib/cart-key';
import { copyText } from '@/lib/copy-text';
import { applyCoupon, getCart } from '@/lib/shop-client';

const errMessage = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra');

export interface CouponNotice {
  code: string;
  text: string;
  error: boolean;
}

/** Thời gian giữ câu báo trên màn trước khi sang giỏ: đủ đọc một câu ngắn. */
const NOTICE_HOLD_MS = 1800;

/**
 * "Sao chép" và "Dùng ngay" của thẻ mã giảm giá (cùng luật với Mini App). Web không có snackbar nên câu báo trả ở `notice`
 * để thẻ (hoặc khung đổi quà thành công) in một dòng `role="status"`/`role="alert"`. Dùng ngay: chờ giỏ tải xong rồi mới quyết;
 * giỏ có hàng thì chọn sẵn mã ở giỏ rồi tới giỏ, chưa có hàng thì tới sản phẩm. Có điều cần báo (mã chưa áp được, đã đổi mã
 * cũ, lỗi) thì giữ câu báo trên màn một lúc rồi mới sang giỏ.
 */
export function useCouponUse() {
  const router = useRouter();
  const qc = useQueryClient();
  const [notice, setNotice] = useState<CouponNotice | null>(null);

  const copy = async (code: string) => {
    const ok = await copyText(code);
    setNotice(ok ? { code, text: couponUseCopy.copied, error: false } : { code, text: couponUseCopy.copyFailed, error: true });
  };

  const goToCart = (onBeforeNavigate?: () => void) => {
    onBeforeNavigate?.();
    router.push('/gio-hang');
  };

  const use = async (code: string, onBeforeNavigate?: () => void) => {
    const hold = (n: CouponNotice) => {
      setNotice(n);
      window.setTimeout(() => goToCart(onBeforeNavigate), NOTICE_HOLD_MS);
    };
    let before;
    try {
      before = await qc.fetchQuery({ queryKey: cartKey(), queryFn: getCart, staleTime: 15_000 });
    } catch (e) {
      // Không đọc được giỏ: không đoán là trống, đưa khách tới giỏ để thấy tình trạng thật.
      hold({ code, text: couponUseCopy.notApplied(errMessage(e)), error: true });
      return;
    }
    if (couponUseTarget(before.itemCount) === 'products') {
      onBeforeNavigate?.();
      router.push('/san-pham');
      return;
    }
    try {
      const cart = await applyCoupon(code.trim().toUpperCase());
      qc.setQueryData(cartKey(), cart);
      void qc.invalidateQueries({ queryKey: ['quote'] });
      const outcome = couponUseOutcome(before.couponCode, code, cart);
      if (outcome.kind === 'ok') goToCart(onBeforeNavigate);
      else hold({ code, text: outcome.text, error: outcome.kind === 'notApplied' });
    } catch (e) {
      hold({ code, text: couponUseCopy.notApplied(errMessage(e)), error: true });
    }
  };

  return { copy, use, notice };
}
