import { useEffect, useMemo, useRef, useState } from 'react';
import { useSnackbar } from 'zmp-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CouponPreviewDTO, CouponPreviewRequest } from '@tubutree/shared-types';
import { autoCouponMemory, couponHint, pickBestCoupon, type CouponHint } from '@tubutree/app-core/coupon-use';
import { getCoupons, type CouponDTO } from '../../services/account-api';
import { applyCoupon, getCouponPreviews, removeCoupon } from '../../services/shop-api';
import { getErrorMessage } from '../../services/api';
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
 * Mã giảm giá ở màn thanh toán: tự áp mã giảm nhiều nhất khách đang có, đúng một lần cho mỗi lượt thanh toán. Khách gỡ (hay tự
 * đổi mã) rồi thì không tự áp lại, kể cả khi tải lại trang (nhớ theo phiên, theo khách); giỏ đã có mã thì không tự áp. Lỗi
 * khi tự áp (mạng, mã vừa hết hạn) im lặng: màn giữ như chưa áp và còn câu gợi ý. Gợi ý và tự áp dùng chung MỘT lần hỏi xem trước.
 */
export function useCheckoutCoupon(opts: {
  /** Có hỏi xem trước để gợi ý không (đã đăng nhập, giỏ có hàng và chưa có mã). */
  enabled: boolean;
  /** Được phép tự áp: toàn giỏ (không phải thanh toán một phần) và địa chỉ đã chốt (hoặc chưa có địa chỉ nào). */
  autoAllowed: boolean;
  userId: string | null | undefined;
  cartLoaded: boolean;
  currentCode: string | null | undefined;
  previewParams: CouponPreviewRequest | undefined;
  previewKey: string;
  onChanged: () => void;
}): { hint: CouponHint | null; autoCode: string | null; busy: boolean; remove: () => void; removing: boolean; forget: () => void } {
  const { enabled, currentCode, onChanged, userId, cartLoaded } = opts;
  const queryClient = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const memory = useMemo(() => autoCouponMemory(browserSession(), userId), [userId]);
  const settled = useRef(memory.off());
  const [applied, setApplied] = useState<string | null>(() => memory.applied());

  useEffect(() => {
    if (!cartLoaded) return;
    const stored = memory.applied();
    if (currentCode) {
      settled.current = true;
      if (stored && stored !== currentCode.toUpperCase()) {
        memory.markOff();
        setApplied(null);
      }
    } else if (stored) {
      memory.markOff();
      settled.current = true;
      setApplied(null);
    }
  }, [cartLoaded, currentCode, memory]);

  const data = useCouponPreviews(enabled, opts.previewParams, opts.previewKey);

  const applyMut = useMutation({
    mutationFn: (code: string) => applyCoupon(code),
    onSuccess: (cart, code) => {
      memory.markApplied(code);
      setApplied(code.toUpperCase());
      queryClient.setQueryData(cartKey(), cart);
      void queryClient.invalidateQueries({ queryKey: ['quote'] });
      onChanged();
    },
  });
  const removeMut = useMutation({
    mutationFn: removeCoupon,
    onSuccess: (cart) => {
      memory.markOff();
      setApplied(null);
      queryClient.setQueryData(cartKey(), cart);
      void queryClient.invalidateQueries({ queryKey: ['quote'] });
      onChanged();
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  useEffect(() => {
    if (!data || settled.current || !opts.autoAllowed) return;
    settled.current = true;
    const best = pickBestCoupon(data.previews, data.wallet);
    if (best) applyMut.mutate(best);
  }, [data, applyMut.mutate, opts.autoAllowed]);

  const isAuto = !!applied && !!currentCode && currentCode.toUpperCase() === applied;
  return {
    hint: data ? couponHint(data.previews) : null,
    autoCode: isAuto ? applied : null,
    busy: applyMut.isPending || removeMut.isPending,
    remove: () => removeMut.mutate(),
    removing: removeMut.isPending,
    forget: () => memory.clear(),
  };
}

function browserSession(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
