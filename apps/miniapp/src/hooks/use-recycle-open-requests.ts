import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { isHomeFeedArmed, takeMeBlock, type HomeMeDTO } from '../services/home-feed';

export const RECYCLE_OPEN_COUNT_KEY = ['recycle-open-request-count'] as const;

/**
 * Số yêu cầu đổi rác đang mở. Trang chủ đang mở thì lấy từ khối của request gộp `/home/me` sẵn có (không thêm request); ở trang khác
 * (Ưu đãi mở thẳng) thì hỏi `/home/me` một lần. API cũ không có trường này hoặc lỗi → 0. Không gọi `/waste/me` (nặng).
 */
async function fetchOpenCount(): Promise<number> {
  if (isHomeFeedArmed()) return (await takeMeBlock('wasteOpenRequestCount')) ?? 0;
  const r = await api.get<HomeMeDTO>('/home/me', { params: { purchasedLimit: 1 } });
  return r.data?.wasteOpenRequestCount ?? 0;
}

/**
 * Khách còn yêu cầu đổi rác đang mở. Chỉ hỏi khi chương trình đã tạm dừng (`paused`): lúc đang chạy, mục Đổi rác hiện theo cờ
 * nên không cần biết. Lỗi thì coi như không có.
 */
export function useRecycleOpenRequests(authed: boolean, paused: boolean): boolean {
  const q = useQuery({ queryKey: RECYCLE_OPEN_COUNT_KEY, queryFn: fetchOpenCount, enabled: authed && paused, retry: false, staleTime: 60_000 });
  return authed && paused && (q.data ?? 0) > 0;
}
