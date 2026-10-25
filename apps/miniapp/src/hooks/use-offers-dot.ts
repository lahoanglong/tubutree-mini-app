import { useQuery } from '@tanstack/react-query';
import { offersDotReason, type OffersDotReason } from '@tubutree/app-core/home-layout';
import { getCoupons, getDailyCheckInStatus } from '../services/account-api';
import { useAuthStore } from '../store/auth';

/**
 * Lý do tab "Ưu đãi" có chấm đỏ: chưa điểm danh hôm nay, hoặc có mã sắp hết hạn. Dùng chung khoá ['loyalty-checkin'] và ['coupons']
 * với trang Ưu đãi/Điểm Xanh nên mở trang đó không tốn thêm request. Lỗi hay chưa tải → không chấm.
 */
export function useOffersDot(enabled: boolean): OffersDotReason | null {
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const on = enabled && authed;
  const checkIn = useQuery({ queryKey: ['loyalty-checkin'], queryFn: getDailyCheckInStatus, enabled: on, staleTime: 60_000, retry: false });
  const coupons = useQuery({ queryKey: ['coupons'], queryFn: getCoupons, enabled: on, staleTime: 60_000, retry: false });
  if (!on) return null;
  return offersDotReason({ checkIn: checkIn.data, coupons: coupons.data }, Date.now());
}
