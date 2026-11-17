import { useQuery } from '@tanstack/react-query';
import { dailyMissionsQuery } from '@tubutree/app-core/engagement/api';
import { checkInDotMovesToGarden, gardenDotOn, profileDotOn } from '@tubutree/app-core/engagement/view';
import { coreHttp } from '../services/core-http';
import { getDailyCheckInStatus } from '../services/account-api';
import { useAuthStore } from '../store/auth';
import { useMeSummary } from './use-me-summary';

export interface EngagementDots {
  garden: boolean;
  profile: boolean;
  /** Chấm Vườn Xanh đang lo lý do "chưa điểm danh", tab Ưu đãi bỏ lý do đó. */
  checkInElsewhere: boolean;
}

/**
 * Chấm nhắc của nhiệm vụ hằng ngày ở thanh đáy. Chỉ khi cờ engagement.daily_missions_enabled bật (máy chủ trả `enabled`); cờ tắt, API cũ
 * hay chưa tải thì cả ba là false và thanh đáy như trước. Dùng chung khoá ['game','daily'], ['loyalty-checkin'] và /me/summary với Vườn
 * Xanh, Ưu đãi, Cá nhân nên không thêm request khi các trang đó đã mở.
 */
export function useEngagementDots(enabled: boolean, activeOrders: number): EngagementDots {
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const daily = useQuery({ ...dailyMissionsQuery(coreHttp), enabled: enabled && authed }).data;
  const on = enabled && authed && daily?.enabled === true;
  const checkIn = useQuery({ queryKey: ['loyalty-checkin'], queryFn: getDailyCheckInStatus, enabled: on, staleTime: 60_000, retry: false }).data;
  const unread = useMeSummary({ enabled: on, select: (s) => s.unreadNotifications }).data;
  return {
    garden: on && gardenDotOn(daily, checkIn),
    profile: on && profileDotOn(daily, unread, activeOrders),
    checkInElsewhere: on && checkInDotMovesToGarden(daily),
  };
}
