'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { couponUseCopy, couponUseOutcome, couponUseTarget } from '@tubutree/app-core/coupon-use';
import { cartKey } from '@/lib/cart-key';
import { copyText } from '@/lib/copy-text';
import { applyCoupon, getCart } from '@/lib/shop-client';
import { actionErrorText } from '@/lib/error-text';

const errMessage = actionErrorText;

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
  // Hẹn giờ sang giỏ giữ trong ref: lần "Dùng ngay" kế tiếp, lúc rời trang và `cancel` đều huỷ nó, để một hẹn giờ cũ không kéo khách sang giỏ.
  const holdTimer = useRef<number | null>(null);
  // Khoá đồng bộ chống chạm đúp: chỉ một lần "Dùng ngay" đang chạy.
  const busy = useRef(false);
  // Đổi số mỗi lần huỷ/rời trang: lần chạy đang chờ getCart/applyCoupon thấy số đã đổi thì không đặt hẹn giờ hay chuyển trang nữa.
  const epoch = useRef(0);
  const clearHold = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  const cancel = useCallback(() => {
    epoch.current += 1;
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const copy = async (code: string) => {
    const ok = await copyText(code);
    setNotice(ok ? { code, text: couponUseCopy.copied, error: false } : { code, text: couponUseCopy.copyFailed, error: true });
  };

  const goToCart = (onBeforeNavigate?: () => void) => {
    onBeforeNavigate?.();
    router.push('/gio-hang');
  };

  const use = async (code: string, onBeforeNavigate?: () => void) => {
    if (busy.current) return;
    busy.current = true;
    clearHold();
    try {
      await run(code, onBeforeNavigate, epoch.current);
    } finally {
      busy.current = false;
    }
  };

  const run = async (code: string, onBeforeNavigate: (() => void) | undefined, startEpoch: number) => {
    const stale = () => epoch.current !== startEpoch;
    const hold = (n: CouponNotice) => {
      if (stale()) return;
      setNotice(n);
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null;
        goToCart(onBeforeNavigate);
      }, NOTICE_HOLD_MS);
    };
    let before;
    try {
      before = await qc.fetchQuery({ queryKey: cartKey(), queryFn: getCart, staleTime: 15_000 });
    } catch (e) {
      // Không đọc được giỏ: không đoán là trống, đưa khách tới giỏ để thấy tình trạng thật.
      hold({ code, text: couponUseCopy.notApplied(errMessage(e)), error: true });
      return;
    }
    if (stale()) return;
    if (couponUseTarget(before.itemCount) === 'products') {
      onBeforeNavigate?.();
      router.push('/san-pham');
      return;
    }
    try {
      const cart = await applyCoupon(code.trim().toUpperCase());
      qc.setQueryData(cartKey(), cart);
      void qc.invalidateQueries({ queryKey: ['quote'] });
      if (stale()) return;
      const outcome = couponUseOutcome(before.couponCode, code, cart);
      if (outcome.kind === 'ok') goToCart(onBeforeNavigate);
      else hold({ code, text: outcome.text, error: outcome.kind === 'notApplied' });
    } catch (e) {
      hold({ code, text: couponUseCopy.notApplied(errMessage(e)), error: true });
    }
  };

  return { copy, use, notice, cancel };
}
