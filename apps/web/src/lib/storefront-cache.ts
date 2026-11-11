import type { QueryClient, QueryKey, Updater } from '@tanstack/react-query';

/**
 * `setQueryData` gửi action success với `isInvalidated: false` (TanStack Query 5.100): ghi gian hàng bằng bản dựng tại chỗ (dời khối lạc quan, khối mới, khôi phục khi lỗi)
 * xoá cờ "đã cũ" dù dữ liệu vẫn là bản trước lệnh làm mới. Hàng rào độ mới của các tấm Lưu đọc đúng cờ đó, nên nó mở ra và Lưu gửi giá trị cũ đè lên bản mới.
 * Mọi chỗ ghi tay lên khoá gian hàng đi qua đây: cờ đang bật thì dựng lại sau khi ghi, không tải lại (chỉ lần đọc thành công mới xoá cờ).
 */
export function setStorefrontData<T>(qc: QueryClient, queryKey: QueryKey, updater: Updater<T | undefined, T | undefined>): T | undefined {
  const wasInvalidated = qc.getQueryState(queryKey)?.isInvalidated === true;
  const next = qc.setQueryData<T>(queryKey, updater);
  if (wasInvalidated) void qc.invalidateQueries({ queryKey, exact: true, refetchType: 'none' });
  return next;
}
