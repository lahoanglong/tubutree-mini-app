'use client';

import { useAuthPhase } from '@/lib/auth-phase';
import { useHydrated } from '@/lib/use-hydrated';
import { usePublicConfig } from '@/lib/use-public-config';
import { useRecycleOpenRequests } from '@/lib/use-recycle-open-requests';

/**
 * Cùng luật với lối tắt Trang chủ: Đổi rác hiện khi cờ bật, hoặc khi đã tạm dừng mà khách còn yêu cầu đang mở.
 * Đầu trang và chân trang nằm ngoài Suspense của trang nên được dựng ở máy chủ trước khi trang async có cấu hình, còn ở trình duyệt
 * trang nạp sẵn cấu hình (initialData, ví dụ /gioi-thieu) trước khi chúng hydrate: chờ hydrate xong mới đọc cờ để hai bên cùng HTML.
 */
export function useWasteVisible(): boolean {
  const hydrated = useHydrated();
  const cfg = usePublicConfig();
  const authed = useAuthPhase() === 'authenticated';
  const openRequests = useRecycleOpenRequests(authed, cfg.isLoaded && !cfg.waste.enabled);
  return hydrated && ((cfg.isLoaded && cfg.waste.enabled) || openRequests);
}
