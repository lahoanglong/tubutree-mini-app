import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CouponPreviewRequest } from '@tubutree/shared-types';
import { cartVoucherHint, type CartVoucherHint } from '@tubutree/app-core/commerce/cart-voucher-hint';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { applyCoupon } from '../../services/shop-api';
import { getErrorMessage } from '../../services/api';
import { cartKey } from '../../services/cart-key';
import { useNotify } from '../../hooks/use-notify';
import { useLockedMutation } from '../game/use-locked-mutation';
import { haptic } from '../../utils/haptic';
import { autoCouponName } from '../../utils/coupon-name';
import { serverNow } from '../../utils/server-clock';
import { COUPON_CHANGE_KEY, useCouponPreviews } from './use-coupon-hint';

export interface CartVoucherHintState {
  /** Null khi chưa có xem trước của máy chủ, giỏ đã có mã, hoặc không có gì đáng nói. */
  hint: CartVoucherHint | null;
  apply: (code: string) => void;
  applying: boolean;
  /** Lời báo áp không được, chỉ khi còn đang mời đúng mã đó. */
  error: string | null;
}

/**
 * Gợi ý mã giảm giá ở đầu Giỏ: mời áp mã đã đủ điều kiện và nhắc mã sắp mở khoá. Dùng chung MỘT lần hỏi xem trước với dòng mã ở chân dính (cùng khoá
 * truy vấn), nên không thêm lượt gọi máy chủ. Chỉ hỏi khi giỏ chưa có mã. Mã nào, số nào do `cartVoucherHint` (app-core) quyết, giống web.
 */
export function useCartVoucherHint(opts: {
  currentCode: string | null | undefined;
  /** Tiền hàng đang chọn, đúng số bảng chọn mã dùng. */
  subtotal: number;
  productIds?: string[];
  previewParams?: CouponPreviewRequest | undefined;
  previewKey: string;
}): CartVoucherHintState {
  const { currentCode } = opts;
  const queryClient = useQueryClient();
  const { notify } = useNotify();
  const [failed, setFailed] = useState<{ code: string; text: string } | null>(null);
  const data = useCouponPreviews(!currentCode, opts.previewParams, opts.previewKey);

  const hint = data
    ? cartVoucherHint(data.wallet, {
        currentCode,
        subtotal: opts.subtotal,
        productIds: opts.productIds,
        previews: new Map(data.previews.map((p) => [p.code.toUpperCase(), p])),
        now: serverNow(),
        displayCode: autoCouponName,
      })
    : null;

  // Khoá ref đồng bộ: `isPending` chỉ đúng sau lần vẽ kế tiếp, hai cú chạm sát nhau vẫn đều gọi applyCoupon.
  const mut = useLockedMutation({
    // Khách chạm "Áp mã" ở giỏ rồi sang Thanh toán ngay: trang giỏ gỡ đi nhưng lệnh vẫn bay, nút Đặt hàng đọc khoá này để chờ.
    mutationKey: COUPON_CHANGE_KEY,
    mutationFn: (code: string) => applyCoupon(code.trim().toUpperCase()),
    // Xoá lời báo cũ lúc bắt đầu: lỗi lặp lại cùng câu vẫn dựng lại lời báo.
    onMutate: () => setFailed(null),
    onSuccess: (cart) => {
      queryClient.setQueryData(cartKey(), cart);
      void queryClient.invalidateQueries({ queryKey: ['quote'] });
      haptic('medium');
      const code = cart.couponCode ?? '';
      notify({ text: fillCopy('cart.voucherHint.applied', { code: autoCouponName(code) ?? code }), type: 'success', duration: 2000 });
    },
    onError: (e, code) => {
      setFailed({ code: code.trim().toUpperCase(), text: getErrorMessage(e) });
      // Máy chủ vừa từ chối mã mà xem trước còn nói dùng được (hết lượt, bị tắt giữa chừng): hỏi lại để dải không giữ câu "đủ điều kiện" đã sai.
      void queryClient.invalidateQueries({ queryKey: ['coupon-previews'] });
      void queryClient.invalidateQueries({ queryKey: ['coupons'] });
    },
  });

  const offered = hint?.apply?.code ?? null;
  return {
    hint: hint && (hint.apply || hint.unlock) ? hint : null,
    apply: (code) => mut.mutate(code),
    applying: mut.isPending,
    error: failed && offered && failed.code === offered.trim().toUpperCase() ? failed.text : null,
  };
}
