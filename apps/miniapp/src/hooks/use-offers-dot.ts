import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { expiringCouponIds, mergeSeenCouponIds, offersDotReason, type OffersDotReason } from '@tubutree/app-core/home-layout';
import type { CouponDTO } from '@tubutree/app-core/api/loyalty';
import { getCoupons, getDailyCheckInStatus } from '../services/account-api';
import { useAuthStore } from '../store/auth';
import { browserStorage } from '../utils/recently-viewed';

const SEEN_KEY = 'tubu_offers_seen_coupons';
const SEEN_QUERY_KEY = ['offers-seen-coupons'] as const;

function readSeen(): string[] {
  try {
    const v = JSON.parse(browserStorage()?.getItem(SEEN_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Lý do tab "Ưu đãi" có chấm đỏ: chưa điểm danh hôm nay (giữ đến khi điểm danh), hoặc có mã sắp hết hạn mà khách chưa thấy khi mở
 * trang Ưu đãi (`useMarkExpiringSeen`). Dùng chung khoá ['loyalty-checkin'] và ['coupons'] với trang Ưu đãi/Điểm Xanh nên mở trang đó
 * không tốn thêm request. Lỗi hay chưa tải → không chấm.
 */
export function useOffersDot(enabled: boolean): OffersDotReason | null {
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const on = enabled && authed;
  const checkIn = useQuery({ queryKey: ['loyalty-checkin'], queryFn: getDailyCheckInStatus, enabled: on, staleTime: 60_000, retry: false });
  const coupons = useQuery({ queryKey: ['coupons'], queryFn: getCoupons, enabled: on, staleTime: 60_000, retry: false });
  const seen = useQuery({ queryKey: SEEN_QUERY_KEY, queryFn: async () => readSeen(), initialData: readSeen, staleTime: Infinity, gcTime: Infinity });
  if (!on) return null;
  return offersDotReason({ checkIn: checkIn.data, coupons: coupons.data, seenExpiringIds: seen.data }, Date.now());
}

/** Khách mở trang Ưu đãi và thấy danh sách mã: nhớ các mã sắp hết hạn đã xem để chấm đỏ tắt, chỉ bật lại khi có mã mới sắp hết hạn. */
export function useMarkExpiringSeen(coupons: readonly CouponDTO[] | undefined): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!coupons) return;
    const ids = expiringCouponIds(coupons, Date.now());
    if (ids.length === 0) return;
    const seen = qc.getQueryData<string[]>(SEEN_QUERY_KEY) ?? readSeen();
    const next = mergeSeenCouponIds(seen, ids);
    if (next.length === seen.length && next.every((x, i) => x === seen[i])) return;
    try {
      browserStorage()?.setItem(SEEN_KEY, JSON.stringify(next));
    } catch {
      /* kho bị chặn: chấm tắt trong phiên này, lần mở sau có thể bật lại */
    }
    qc.setQueryData(SEEN_QUERY_KEY, next);
  }, [coupons, qc]);
}
