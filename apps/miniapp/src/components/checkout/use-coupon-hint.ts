import { useQuery } from '@tanstack/react-query';
import type { CouponPreviewRequest } from '@tubutree/shared-types';
import { couponHint, type CouponHint } from '@tubutree/app-core/coupon-use';
import { getCouponPreviews } from '../../services/shop-api';
import { PREVIEW_DEBOUNCE_MS, useDebounced } from '../../utils/use-debounced';

/**
 * Dòng gợi ý "Bạn có N mã dùng được" cho giỏ chưa có mã. Cùng khoá truy vấn và nhịp debounce với VoucherSheet nên khi khách
 * mở tấm chọn mã, số xem trước đã nằm sẵn trong bộ nhớ đệm và không phải hỏi lại. `enabled` tắt khi giỏ đã có mã: lúc đó
 * không ai cần gợi ý nên không gọi máy chủ.
 */
export function useCouponHint(enabled: boolean, previewParams: CouponPreviewRequest | undefined, previewKey: string): CouponHint | null {
  const sig = enabled && previewParams ? JSON.stringify([previewParams, previewKey]) : null;
  const settled = useDebounced(sig, PREVIEW_DEBOUNCE_MS);
  const settledNow = !!sig && settled === sig;
  const q = useQuery({
    queryKey: ['coupon-previews', settled],
    queryFn: () => getCouponPreviews((JSON.parse(settled!) as [CouponPreviewRequest, string])[0]),
    enabled: settledNow,
    retry: false,
  });
  // Số chỉ đúng cho đúng giỏ đã hỏi: giỏ vừa đổi hoặc đang tải lại thì không hiện số cũ; lỗi thì im lặng (câu cũ vẫn đủ dùng).
  return settledNow && q.isSuccess && !q.isFetching ? couponHint(q.data) : null;
}
