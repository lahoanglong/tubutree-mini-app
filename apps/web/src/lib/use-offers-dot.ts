'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CouponDTO } from '@tubutree/app-core/api/loyalty';
import { expiringCouponIds, mergeSeenCouponIds, offersDotReason, readSeenCoupons, writeSeenCoupons, type OffersDotReason } from '@tubutree/app-core/home-layout';
import { checkInQuery, couponsQuery } from '@tubutree/app-core/queries/loyalty';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { browserStorage } from '@/lib/recently-viewed';

const seenQueryKey = (userId: string | null | undefined) => ['offers-seen-coupons', userId ?? null] as const;
const readSeen = (userId: string | null | undefined) => readSeenCoupons(browserStorage(), userId);

/**
 * Lý do tab "Ưu đãi" có chấm đỏ: chưa điểm danh hôm nay (giữ đến khi điểm danh), hoặc có mã sắp hết hạn mà khách chưa thấy khi mở
 * trang Ưu đãi (`useMarkExpiringSeen`). Dùng chung khoá ['loyalty-checkin'] và ['coupons'] với trang Ưu đãi/Điểm Xanh nên mở trang đó
 * không tốn thêm request. Lỗi hay chưa tải thì không chấm.
 */
export function useOffersDot(enabled: boolean): OffersDotReason | null {
  const authed = useAuthPhase() === 'authenticated';
  const on = enabled && authed;
  const userId = useAuth().user?.id;
  const checkIn = useQuery({ ...checkInQuery(coreHttp), enabled: on, staleTime: 60_000, retry: false });
  const coupons = useQuery({ ...couponsQuery(coreHttp), enabled: on, staleTime: 60_000, retry: false });
  const seen = useQuery({ queryKey: seenQueryKey(userId), queryFn: async () => readSeen(userId), initialData: () => readSeen(userId), staleTime: Infinity, gcTime: Infinity });
  if (!on) return null;
  return offersDotReason({ checkIn: checkIn.data, coupons: coupons.data, seenExpiringIds: seen.data }, Date.now());
}

/** Khách mở trang Ưu đãi và thấy danh sách mã: nhớ các mã sắp hết hạn đã xem để chấm đỏ tắt, chỉ bật lại khi có mã mới sắp hết hạn. */
export function useMarkExpiringSeen(coupons: readonly CouponDTO[] | undefined): void {
  const qc = useQueryClient();
  const userId = useAuth().user?.id;
  useEffect(() => {
    if (!coupons || !userId) return;
    const ids = expiringCouponIds(coupons, Date.now());
    if (ids.length === 0) return;
    const seen = qc.getQueryData<string[]>(seenQueryKey(userId)) ?? readSeen(userId);
    const next = mergeSeenCouponIds(seen, ids);
    if (next.length === seen.length && next.every((x, i) => x === seen[i])) return;
    writeSeenCoupons(browserStorage(), userId, next);
    qc.setQueryData(seenQueryKey(userId), next);
  }, [coupons, qc, userId]);
}
