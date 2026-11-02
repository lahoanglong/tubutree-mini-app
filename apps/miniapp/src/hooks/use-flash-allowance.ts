import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { allowanceItemIds, flashAllowanceKey, withFlashAllowance } from '@tubutree/app-core/commerce/flash-allowance';
import { fetchFlashAllowance } from '../services/shop-api';
import { useAuthPhase } from './use-auth-phase';

const STALE_MS = 15_000;
const EMPTY: readonly never[] = [];

/**
 * Trộn số suất Giờ vàng khách còn mua được (`perUserLeft`, đã trừ các đơn trước) vào danh sách Giờ vàng đang chạy, để nút, tổng và ghi chú ghi đúng số máy chủ
 * sẽ tính. Một request cho các suất của `variationIds` (một sản phẩm hoặc một bảng chọn), khoá không chứa số lượng nên đổi số lượng không gọi lại; chỉ khi đã đăng nhập.
 * Chưa về, lỗi hoặc API cũ thì trả đúng `flash` đầu vào (UI như trước: máy chủ vẫn tính đúng và giỏ báo lý do).
 */
export function useFlashAllowance<T extends { itemId?: string; variationId: string }>(
  flash: readonly T[] | undefined,
  variationIds: readonly string[],
): (T & { perUserLeft?: number | null })[] {
  const phase = useAuthPhase();
  const list = flash ?? EMPTY;
  const ids = allowanceItemIds(list, variationIds);
  const query = useQuery({
    queryKey: flashAllowanceKey(ids),
    queryFn: () => fetchFlashAllowance(ids),
    enabled: phase === 'authenticated' && ids.length > 0,
    staleTime: STALE_MS,
    retry: false,
  });
  return useMemo(() => withFlashAllowance(list, query.data), [list, query.data]);
}
