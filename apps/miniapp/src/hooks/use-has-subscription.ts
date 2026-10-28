import { useQuery } from '@tanstack/react-query';
import { getSubscriptions, type SubscriptionDTO } from '../services/subscriptions-api';
import { SUBSCRIPTIONS_IN_MINIAPP } from '../utils/features';

/** Gói còn hiệu lực với khách: đang chạy hoặc tạm dừng (gói đã huỷ không tính). */
export const hasLiveSubscription = (subs: readonly Pick<SubscriptionDTO, 'status'>[] | undefined): boolean =>
  !!subs?.some((s) => s.status === 'ACTIVE' || s.status === 'PAUSED');

/**
 * Khách đã có gói định kỳ chưa. Mini App không có lối tạo gói (cờ tắt) nhưng khách đặt trên web vẫn cần xem và quản lý gói ở đây,
 * nên tab "Định kỳ" chỉ hiện khi có gói. Cờ bật thì tab luôn có, khỏi gọi API.
 */
export function useHasSubscription(enabled: boolean): { hasSubscription: boolean; isLoading: boolean } {
  const q = useQuery({ queryKey: ['subscriptions'], queryFn: getSubscriptions, enabled: enabled && !SUBSCRIPTIONS_IN_MINIAPP });
  return { hasSubscription: hasLiveSubscription(q.data), isLoading: q.isLoading };
}
