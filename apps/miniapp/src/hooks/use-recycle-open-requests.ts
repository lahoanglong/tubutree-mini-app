import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { isEndpointMissing } from '../components/home/home-blocks';
import { isHomeFeedArmed, takeMeBlock } from '../services/home-feed';
import { useAuthStore } from '../store/auth';

export const RECYCLE_OPEN_COUNT_KEY = 'recycle-open-request-count';

const askEndpoint = async (): Promise<number> => (await api.get<{ count?: number }>('/waste/me/open-count')).data?.count ?? 0;

/**
 * Số yêu cầu đổi rác đang mở. Lần đầu Trang chủ lấy từ khối của request gộp `/home/me` (không thêm request). Khối đó chỉ được nhận một
 * lần mỗi phiên, nên lần tải lại (kéo làm mới, mở lại mạng, hết hạn cache) và mọi trang khác hỏi endpoint nhẹ `/waste/me/open-count`.
 * API cũ không có khối/endpoint → 0 (ẩn). Không gọi `/waste/me` (nặng).
 */
async function fetchOpenCount(): Promise<number> {
  if (isHomeFeedArmed()) {
    const fromFeed = await takeMeBlock('wasteOpenRequestCount');
    if (typeof fromFeed === 'number') return fromFeed;
  }
  return askEndpoint().catch((err: unknown) => {
    if (isEndpointMissing(err)) return 0;
    throw err;
  });
}

/**
 * Khách còn yêu cầu đổi rác đang mở. Chỉ hỏi khi chương trình đã tạm dừng (`paused`): lúc đang chạy, mục Đổi rác hiện theo cờ
 * nên không cần biết. Khoá theo tài khoản (đổi tài khoản không mang số của người trước) và nằm trong `HOME_QUERY_PREFIXES` để kéo
 * làm mới Trang chủ cập nhật. Lỗi thì coi như không có.
 */
export function useRecycleOpenRequests(authed: boolean, paused: boolean): boolean {
  const userId = useAuthStore((s) => s.user?.id);
  const q = useQuery({ queryKey: [RECYCLE_OPEN_COUNT_KEY, userId ?? null], queryFn: fetchOpenCount, enabled: authed && paused, retry: false, staleTime: 60_000 });
  return authed && paused && (q.data ?? 0) > 0;
}
