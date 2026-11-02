'use client';

import { useQuery } from '@tanstack/react-query';
import { meSummaryQuery, type MeSummaryDTO } from '@tubutree/app-core/api/me-summary';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';

/**
 * Nguồn chung của mọi số đếm ở Cá nhân, thanh đáy và chuông (một lời gọi GET /me/summary, một khoá ['me', 'summary']).
 * Khách chưa đăng nhập không gọi. Lỗi thì `data` rỗng để màn không hiện số sai.
 * `select` để mỗi nơi chỉ re-render khi số mình dùng đổi; `staleTime` chỉ đặt khi nơi dùng muốn đè mặc định của app.
 */
export function useMeSummary<T = MeSummaryDTO>(opts: { enabled?: boolean; select?: (s: MeSummaryDTO) => T; staleTime?: number } = {}) {
  const authed = useAuthPhase() === 'authenticated';
  return useQuery({
    ...meSummaryQuery(coreHttp),
    select: opts.select,
    enabled: (opts.enabled ?? true) && authed,
    staleTime: opts.staleTime,
    retry: false,
  });
}
