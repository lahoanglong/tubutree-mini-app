'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchWasteOpenCount } from '@tubutree/app-core/api/home';
import { ApiError } from '@/lib/client-api';
import { useAuth } from '@/lib/auth-context';
import { coreHttp } from '@/lib/core-http';

export const RECYCLE_OPEN_COUNT_KEY = 'recycle-open-request-count';

/**
 * Khách còn yêu cầu đổi rác đang mở. Chỉ hỏi khi chương trình đã tạm dừng (`paused`): lúc đang chạy, mục Đổi rác hiện theo cờ nên
 * không cần biết. Hỏi endpoint nhẹ `/waste/me/open-count` (một câu đếm phía API, không gọi `/waste/me` nặng); API cũ chưa có (404)
 * hoặc lỗi thì coi là 0. Khoá theo tài khoản, dùng chung giữa Trang chủ và Ưu đãi, nằm trong `HOME_QUERY_PREFIXES`.
 */
export function useRecycleOpenRequests(authed: boolean, paused: boolean): boolean {
  const userId = useAuth().user?.id;
  const q = useQuery({
    queryKey: [RECYCLE_OPEN_COUNT_KEY, userId ?? null],
    queryFn: async () => {
      try {
        return (await fetchWasteOpenCount(coreHttp)).count ?? 0;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return 0;
        throw err;
      }
    },
    enabled: authed && paused,
    retry: false,
    staleTime: 60_000,
  });
  return authed && paused && (q.data ?? 0) > 0;
}
