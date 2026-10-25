'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchHomeMe } from '@tubutree/app-core/api/home';
import { coreHttp } from '@/lib/core-http';

export const RECYCLE_OPEN_COUNT_KEY = ['recycle-open-request-count'] as const;

/**
 * Khách còn yêu cầu đổi rác đang mở. Chỉ hỏi khi chương trình đã tạm dừng (`paused`): lúc đang chạy, mục Đổi rác hiện theo cờ nên
 * không cần biết. Đọc `wasteOpenRequestCount` của `/home/me` (một câu đếm phía API, không gọi `/waste/me` nặng); API cũ không có
 * trường này hoặc lỗi thì coi là 0. Dùng chung khoá giữa Trang chủ và Ưu đãi.
 */
export function useRecycleOpenRequests(authed: boolean, paused: boolean): boolean {
  const q = useQuery({
    queryKey: RECYCLE_OPEN_COUNT_KEY,
    queryFn: async () => (await fetchHomeMe(coreHttp, 1)).wasteOpenRequestCount ?? 0,
    enabled: authed && paused,
    retry: false,
    staleTime: 60_000,
  });
  return authed && paused && (q.data ?? 0) > 0;
}
