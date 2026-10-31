import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CouponPreviewDTO, CouponPreviewRequest } from '@tubutree/shared-types';
import { couponHint, pickBestCoupon, type CouponHint } from '@tubutree/app-core/coupon-use';
import { getCoupons, type CouponDTO } from '../../services/account-api';
import { applyCoupon, getCouponPreviews, removeCoupon } from '../../services/shop-api';
import { cartKey } from '../../services/cart-key';
import { PREVIEW_DEBOUNCE_MS, useDebounced } from '../../utils/use-debounced';

/**
 * Số xem trước từng mã của ví cho giỏ chưa có mã. Cùng khoá truy vấn và nhịp debounce với VoucherSheet nên khi khách
 * mở tấm chọn mã, số xem trước đã nằm sẵn trong bộ nhớ đệm và không phải hỏi lại. `enabled` tắt khi giỏ đã có mã: lúc đó
 * không ai cần số nên không gọi máy chủ. Ví không có mã nào thì cũng không hỏi: xem trước tính cả giỏ trên máy chủ để rồi
 * trả rỗng, còn ví thì đọc rẻ và dùng chung bộ nhớ đệm `['coupons']` với tấm chọn mã.
 * Số chỉ đúng cho đúng giỏ đã hỏi: giỏ vừa đổi hoặc đang tải lại thì trả null; lỗi cũng null.
 */
function useCouponPreviews(
  enabled: boolean,
  previewParams: CouponPreviewRequest | undefined,
  previewKey: string,
): { previews: CouponPreviewDTO[]; wallet: CouponDTO[] } | null {
  const sig = enabled && previewParams ? JSON.stringify([previewParams, previewKey]) : null;
  const settled = useDebounced(sig, PREVIEW_DEBOUNCE_MS);
  const settledNow = !!sig && settled === sig;
  const walletQ = useQuery({ queryKey: ['coupons'], queryFn: getCoupons, enabled });
  const hasCoupons = (walletQ.data?.length ?? 0) > 0;
  const q = useQuery({
    queryKey: ['coupon-previews', settled],
    queryFn: () => getCouponPreviews((JSON.parse(settled!) as [CouponPreviewRequest, string])[0]),
    enabled: settledNow && hasCoupons,
    retry: false,
  });
  return settledNow && hasCoupons && q.isSuccess && !q.isFetching ? { previews: q.data, wallet: walletQ.data! } : null;
}

/** Dòng gợi ý "Bạn có N mã dùng được" cho giỏ chưa có mã (sau khi khách gỡ mã tự áp, hoặc khi tự áp không được). */
export function useCouponHint(enabled: boolean, previewParams: CouponPreviewRequest | undefined, previewKey: string): CouponHint | null {
  const data = useCouponPreviews(enabled, previewParams, previewKey);
  return data ? couponHint(data.previews) : null;
}

/**
 * Mã giảm giá ở màn thanh toán: tự áp mã giảm nhiều nhất khách đang có, đúng một lần cho mỗi lượt mở màn. Khách gỡ (hay tự
 * đổi mã) rồi thì không tự áp lại; giỏ đã có mã thì không tự áp và cũng không bao giờ tự áp về sau. Lỗi (mạng, mã vừa hết
 * hạn) im lặng: màn giữ như chưa áp và còn câu gợi ý. `enabled` tắt khi chưa đủ điều kiện (chưa đăng nhập, giỏ chưa tải
 * hay đã có mã). Gợi ý và tự áp dùng chung MỘT lần hỏi xem trước.
 */
export function useCheckoutCoupon(opts: {
  enabled: boolean;
  /** Địa chỉ đã chốt (hoặc khách chưa có địa chỉ): số xem trước có cả phí giao được miễn nên mới đủ để chọn mã. */
  addressReady: boolean;
  currentCode: string | null | undefined;
  previewParams: CouponPreviewRequest | undefined;
  previewKey: string;
  onChanged: () => void;
}): { hint: CouponHint | null; autoCode: string | null; remove: () => void; removing: boolean } {
  const { enabled, currentCode, onChanged } = opts;
  const queryClient = useQueryClient();
  const settled = useRef(false);
  const [autoCode, setAutoCode] = useState<string | null>(null);
  useEffect(() => {
    if (currentCode) settled.current = true;
  }, [currentCode]);
  const data = useCouponPreviews(enabled, opts.previewParams, opts.previewKey);

  const applyMut = useMutation({
    mutationFn: (code: string) => applyCoupon(code),
    onSuccess: (cart, code) => {
      queryClient.setQueryData(cartKey(), cart);
      void queryClient.invalidateQueries({ queryKey: ['quote'] });
      setAutoCode(code.toUpperCase());
      onChanged();
    },
  });
  const removeMut = useMutation({
    mutationFn: removeCoupon,
    onSuccess: (cart) => {
      queryClient.setQueryData(cartKey(), cart);
      void queryClient.invalidateQueries({ queryKey: ['quote'] });
      setAutoCode(null);
      onChanged();
    },
  });

  useEffect(() => {
    if (!data || settled.current || !opts.addressReady) return;
    settled.current = true;
    const best = pickBestCoupon(data.previews, data.wallet);
    if (best) applyMut.mutate(best);
  }, [data, applyMut.mutate, opts.addressReady]);

  const isAuto = !!autoCode && !!currentCode && currentCode.toUpperCase() === autoCode;
  return {
    hint: data ? couponHint(data.previews) : null,
    autoCode: isAuto ? autoCode : null,
    remove: () => removeMut.mutate(),
    removing: removeMut.isPending,
  };
}
