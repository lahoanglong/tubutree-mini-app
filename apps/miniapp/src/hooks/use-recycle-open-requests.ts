import { useQuery } from '@tanstack/react-query';
import { getWasteMe, WASTE_QUERY_KEYS } from '../services/waste-api';

/**
 * Khách còn yêu cầu đổi rác đang mở. Chỉ gọi khi chương trình đã tạm dừng (`paused`): lúc đang chạy, mục Đổi rác hiện theo
 * cờ nên không cần biết. Dùng chung khoá với trang Đổi rác; lỗi thì coi như không có.
 */
export function useRecycleOpenRequests(authed: boolean, paused: boolean): boolean {
  const q = useQuery({ queryKey: WASTE_QUERY_KEYS.me, queryFn: getWasteMe, enabled: authed && paused, retry: false, staleTime: 60_000 });
  return authed && paused && (q.data?.openRequests.length ?? 0) > 0;
}
