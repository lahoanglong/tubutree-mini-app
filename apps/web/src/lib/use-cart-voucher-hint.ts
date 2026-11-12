'use client';

// Nguồn: apps/miniapp/src/components/checkout/use-cart-voucher-hint.ts (cùng đầu vào, cùng kết quả; khác chỗ lấy dữ liệu và cách báo áp thành công).
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cartVoucherHint, type CartVoucherHint } from '@tubutree/app-core/commerce/cart-voucher-hint';
import { serverNow } from '@tubutree/app-core/server-clock';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { applyCoupon, getCouponPreviews, getMyCoupons, type CouponPreviewParams } from '@/lib/shop-client';
import { COUPON_MUTATION_KEY, PREVIEW_DEBOUNCE_MS, useSettled } from '@/components/coupon-box';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { autoCouponName } from '@/lib/coupon-name';
import { actionErrorText } from '@/lib/error-text';
import { useCartWrite } from '@/lib/use-cart-write';
import { holdForCouponReload } from '@/lib/coupon-reload';
import { serverRejectedState } from '@/lib/server-rejected-state';

export interface CartVoucherHintState {
  /** Null khi chưa có xem trước của máy chủ, giỏ đã có mã, hoặc không có gì đáng nói. */
  hint: CartVoucherHint | null;
  apply: (code: string) => void;
  applying: boolean;
  /** Lời báo áp không được, chỉ khi còn đang mời đúng mã đó. */
  error: string | null;
  /** Câu "Đã áp dụng mã …" sau khi áp xong, tự tắt: dòng gợi ý biến mất nên cần chỗ báo cho trình đọc màn hình. */
  appliedNote: string | null;
}

const NOTE_MS = 4000;

/**
 * Gợi ý mã giảm giá ở đầu Giỏ: mời áp mã đã đủ điều kiện và nhắc mã sắp mở khoá. Dùng chung khoá truy vấn `['my-coupons']` và `['coupon-previews', …]` với
 * `CouponBox` nên không thêm lượt gọi máy chủ. Chỉ hỏi khi giỏ chưa có mã. Mã nào, số nào do `cartVoucherHint` (app-core) quyết, giống Mini App.
 */
export function useCartVoucherHint(opts: {
  currentCode: string | null | undefined;
  /** Tiền hàng đang chọn, đúng số bảng chọn mã dùng. */
  subtotal: number;
  productIds?: string[] | undefined;
  /** Món đang chọn (itemIds undefined = cả giỏ); undefined = chưa chọn món nào thì không hỏi. */
  preview?: CouponPreviewParams | undefined;
  previewKey: string;
}): CartVoucherHintState {
  const { currentCode } = opts;
  const qc = useQueryClient();
  const cartWrite = useCartWrite();
  const [failed, setFailed] = useState<{ code: string; text: string } | null>(null);
  const [appliedNote, setAppliedNote] = useState<string | null>(null);
  useEffect(() => {
    if (!appliedNote) return;
    const t = setTimeout(() => setAppliedNote(null), NOTE_MS);
    return () => clearTimeout(t);
  }, [appliedNote]);

  const couponsQ = useQuery({ queryKey: ['my-coupons'], queryFn: getMyCoupons });
  const previewSig = opts.preview ? JSON.stringify([opts.preview, opts.previewKey]) : null;
  const settledSig = useSettled(previewSig, PREVIEW_DEBOUNCE_MS);
  const previewsQ = useQuery({
    queryKey: ['coupon-previews', settledSig],
    queryFn: () => getCouponPreviews((JSON.parse(settledSig!) as [CouponPreviewParams, string])[0]),
    // Ví không có mã nào thì không có gì để tính; giỏ đã có mã thì không ai cần số.
    enabled: !!settledSig && !currentCode && (couponsQ.data?.length ?? 0) > 0,
    retry: false,
  });
  // Số chỉ đúng cho đúng giỏ đã hỏi: giỏ vừa đổi (chưa hỏi lại) hoặc đang tải lại thì không nói gì, không hiện số cũ.
  const trusted = !!previewSig && settledSig === previewSig && previewsQ.isSuccess && !previewsQ.isFetching;

  const hint =
    trusted && couponsQ.data
      ? cartVoucherHint(couponsQ.data, {
          currentCode,
          subtotal: opts.subtotal,
          productIds: opts.productIds,
          previews: new Map((previewsQ.data ?? []).map((p) => [p.code.toUpperCase(), p])),
          now: serverNow(),
          displayCode: autoCouponName,
        })
      : null;

  // Khoá ref đồng bộ: `isPending` chỉ đúng sau lần vẽ kế tiếp, hai cú chạm sát nhau vẫn đều gọi applyCoupon.
  const mut = useLockedMutation({
    // Khách chạm "Áp mã" ở giỏ rồi sang Thanh toán ngay: dải gợi ý bị gỡ nhưng lệnh vẫn bay, nút Đặt hàng đọc khoá này để chờ.
    mutationKey: COUPON_MUTATION_KEY,
    mutationFn: (code: string) => applyCoupon(code.trim().toUpperCase()),
    // Xoá lời báo cũ lúc bắt đầu: lỗi lặp lại cùng câu vẫn dựng lại lời báo.
    onMutate: () => {
      setFailed(null);
      return cartWrite.begin();
    },
    onSuccess: (cart, _code, cmd) => {
      const held = cartWrite.write(cmd, cart);
      void qc.invalidateQueries({ queryKey: ['quote'] });
      const code = cart.couponCode ?? '';
      setAppliedNote(fillCopy('cart.voucherHint.applied', { code: autoCouponName(code) ?? code }));
      return held;
    },
    onError: (e, code, cmd) => {
      const rejected = serverRejectedState(e);
      const cartReloaded = cartWrite.fail(cmd, rejected);
      setFailed({ code: code.trim().toUpperCase(), text: actionErrorText(e) });
      // Máy chủ vừa từ chối mã mà xem trước còn nói dùng được (hết lượt, bị tắt giữa chừng): hỏi lại để dải không giữ câu "đủ điều kiện" đã sai.
      // Từ chối vì màn đã cũ thì đọc thêm giỏ và báo giá, nút "Áp mã" giữ khoá tới khi dữ liệu về (xem `holdForCouponReload`). Lỗi khác chỉ hỏi lại xem trước, nhả khoá ngay.
      if (rejected) return holdForCouponReload(qc, cartReloaded);
      void qc.invalidateQueries({ queryKey: ['coupon-previews'] });
      void qc.invalidateQueries({ queryKey: ['my-coupons'] });
      return undefined;
    },
  });

  const offered = hint?.apply?.code ?? null;
  return {
    hint: hint && (hint.apply || hint.unlock) ? hint : null,
    apply: (code) => mut.mutate(code),
    applying: mut.isPending,
    error: failed && offered && failed.code === offered.trim().toUpperCase() ? failed.text : null,
    appliedNote,
  };
}
