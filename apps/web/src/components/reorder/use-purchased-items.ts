'use client';

import { useQuery } from '@tanstack/react-query';
import { purchasedItemsQuery } from '@tubutree/app-core/queries/orders';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';

/** Trang đầu SP đã mua (kệ "Mua lại"). retry:false — API cũ trả 404 thì ẩn kệ ngay. */
export function usePurchasedItems(limit: number) {
  const authed = useAuthPhase() === 'authenticated';
  return useQuery({ ...purchasedItemsQuery(coreHttp, limit), enabled: authed, staleTime: 60_000, retry: false });
}
