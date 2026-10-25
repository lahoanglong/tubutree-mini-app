'use client';

import { useQuery } from '@tanstack/react-query';
import { offersDotReason, type OffersDotReason } from '@tubutree/app-core/home-layout';
import { checkInQuery, couponsQuery } from '@tubutree/app-core/queries/loyalty';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';

/**
 * Lý do tab "Ưu đãi" có chấm đỏ: chưa điểm danh hôm nay, hoặc có mã sắp hết hạn. Dùng chung khoá ['loyalty-checkin'] và ['coupons']
 * với trang Ưu đãi/Điểm Xanh nên mở trang đó không tốn thêm request. Lỗi hay chưa tải thì không chấm.
 */
export function useOffersDot(enabled: boolean): OffersDotReason | null {
  const authed = useAuthPhase() === 'authenticated';
  const on = enabled && authed;
  const checkIn = useQuery({ ...checkInQuery(coreHttp), enabled: on, staleTime: 60_000, retry: false });
  const coupons = useQuery({ ...couponsQuery(coreHttp), enabled: on, staleTime: 60_000, retry: false });
  if (!on) return null;
  return offersDotReason({ checkIn: checkIn.data, coupons: coupons.data }, Date.now());
}
