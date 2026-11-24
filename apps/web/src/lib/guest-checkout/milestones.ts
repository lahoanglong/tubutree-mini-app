import { buildOrderTimelineSteps, orderTimelineStamps, type OrderTimelineKey, type OrderTimelineStep } from '@tubutree/app-core/commerce/order-timeline';
import type { GuestOrderTrackDTO } from '@tubutree/shared-types';
import { guestCopy, type GuestCopyKey } from './copy';

const MILESTONE_LABEL: Partial<Record<OrderTimelineKey, GuestCopyKey>> = {
  received: 'milestonePlaced',
  preparing: 'milestoneConfirmed',
  shipping: 'milestoneShipping',
  delivered: 'milestoneDone',
};

/**
 * Các mốc có giờ của trang theo dõi đơn khách (`/don/<mã>`): Đã đặt, Đã xác nhận, Đang giao, Hoàn tất. Cùng bước, cùng trạng thái và cùng giờ với
 * thanh tiến trình chung (`buildOrderTimelineSteps`), chỉ đổi tên bước thành việc đã xảy ra, vì mỗi dòng ở đây đi kèm giờ: "Đang chuẩn bị 10:03" không nói
 * 10:03 là lúc gì, "Đã xác nhận 10:03" thì có. Bước nhánh Đã huỷ, Đã hoàn trả giữ tên chung. Chữ nằm ở chữ đặt hàng không đăng nhập (chỉ web có trang này).
 */
export function guestOrderMilestones(
  o: Pick<GuestOrderTrackDTO, 'status' | 'createdAt' | 'paymentMethod' | 'deliveredAt' | 'statusTimes'>,
): OrderTimelineStep[] {
  return buildOrderTimelineSteps(o.status, orderTimelineStamps(o)).map((s) => {
    const key = MILESTONE_LABEL[s.key];
    return key ? { ...s, label: guestCopy(key) } : s;
  });
}
