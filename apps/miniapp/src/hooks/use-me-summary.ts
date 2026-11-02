import { useQuery } from '@tanstack/react-query';
import { meSummaryQuery, type MeSummaryDTO } from '@tubutree/app-core/api/me-summary';
import { coreHttp } from '../services/core-http';
import { useAuthStore } from '../store/auth';

/**
 * Nguồn chung của mọi số đếm ở Cá nhân và thanh đáy (một lời gọi GET /me/summary, một khoá ['me', 'summary']).
 * Khách chưa đăng nhập không gọi. Lỗi (kể cả API cũ 404) thì `data` rỗng để màn không hiện số sai.
 * `select` để mỗi nơi chỉ re-render khi số mình dùng đổi; `staleTime` chỉ đặt khi nơi dùng muốn đè mặc định của app.
 */
export function useMeSummary<T = MeSummaryDTO>(opts: { enabled?: boolean; select?: (s: MeSummaryDTO) => T; staleTime?: number } = {}) {
  const authed = useAuthStore((s) => s.status === 'authenticated');
  return useQuery({
    ...meSummaryQuery(coreHttp),
    select: opts.select,
    enabled: (opts.enabled ?? true) && authed,
    staleTime: opts.staleTime,
    retry: false,
  });
}
