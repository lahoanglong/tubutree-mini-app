'use client';

import { useAuthPhase } from '@/lib/auth-phase';
import { usePublicConfig } from '@/lib/use-public-config';
import { useRecycleOpenRequests } from '@/lib/use-recycle-open-requests';

/** Cùng luật với lối tắt Trang chủ: Đổi rác hiện khi cờ bật, hoặc khi đã tạm dừng mà khách còn yêu cầu đang mở. */
export function useWasteVisible(): boolean {
  const cfg = usePublicConfig();
  const authed = useAuthPhase() === 'authenticated';
  const openRequests = useRecycleOpenRequests(authed, cfg.isLoaded && !cfg.waste.enabled);
  return (cfg.isLoaded && cfg.waste.enabled) || openRequests;
}
