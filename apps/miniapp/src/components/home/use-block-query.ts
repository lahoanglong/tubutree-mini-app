import { useRef } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

export interface BlockQuery<T> {
  data: T | undefined;
  /** Chỉ true ở lần tải ĐẦU (chưa từng lỗi). Tải lại sau lỗi không tính — khối giữ nguyên trạng thái lỗi. */
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  /** Đang có request bay (gồm cả "Thử lại" và poll nền) — để nút "Thử lại" báo đang tải. */
  isFetching: boolean;
  refetch: () => unknown;
}

/**
 * React Query v5 đưa query lỗi-chưa-có-dữ-liệu về `pending` (error=null, isLoading=true) mỗi lần nó tải lại, kể cả
 * poll nền và "Thử lại". Nếu khối vẽ thẳng theo `isLoading/isError` thì khối lỗi biến mất rồi hiện lại (hoặc nhường
 * chỗ cho khung chờ) ở mỗi nhịp. Hook này giữ trạng thái lỗi trong lúc tải lại; `isLoading` chỉ còn true ở lần tải đầu.
 *
 * `errorUpdateCount` chỉ tăng khi lỗi được GHI nhận (sau cả lượt retry tự động của query), và về 0 khi query bị reset
 * → khung chờ vẫn hiện đúng ở lần tải đầu và sau khi reset.
 *
 * Lỗi được nhớ theo TỪNG lần mount của hook (useRef), kèm `errorUpdatedAt` của query đã gây ra nó. React Query bỏ lỗi
 * (error=null) khi tải lại nên không ai khác giữ hộ: instance mới gắn vào giữa lúc tải lại, hay mount lại sau khi
 * unmount, không biết lỗi là gì và coi đó là lần tải đầu của nó (khung chờ) thay vì dựng khối lỗi không có lỗi; còn
 * instance đổi sang query khác (đổi key) không được mượn lỗi của query trước (`errorUpdatedAt` lệch).
 */
export function useBlockQuery<T>(q: UseQueryResult<T>): BlockQuery<T> {
  const seen = useRef<{ error: unknown; at: number } | null>(null);
  if (q.isError) seen.current = { error: q.error, at: q.errorUpdatedAt };
  else if (q.errorUpdateCount === 0) seen.current = null;

  const retryingAfterFailure =
    q.data === undefined && q.isPending && q.errorUpdateCount > 0 && seen.current !== null && seen.current.at === q.errorUpdatedAt;
  return {
    data: q.data,
    isLoading: q.isLoading && !retryingAfterFailure,
    isPending: q.isPending && !retryingAfterFailure,
    isError: q.isError || retryingAfterFailure,
    error: q.isError ? q.error : retryingAfterFailure ? seen.current?.error : null,
    isFetching: q.isFetching,
    refetch: q.refetch,
  };
}
