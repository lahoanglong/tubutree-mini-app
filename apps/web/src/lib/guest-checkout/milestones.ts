import { buildOrderTimelineSteps, orderTimelineStamps, type OrderTimelineKey, type OrderTimelineStep } from '@tubutree/app-core/commerce/order-timeline';
import { NO_PAYMENT_WAIT } from '@tubutree/app-core/commerce/order-tracking';
import type { GuestOrderTrackDTO } from '@tubutree/shared-types';
import { guestCopy, type GuestCopyKey } from './copy';

const MILESTONE_LABEL: Partial<Record<OrderTimelineKey, GuestCopyKey>> = {
  received: 'milestonePlaced',
  preparing: 'milestoneConfirmed',
  shipping: 'milestoneShipping',
  delivered: 'milestoneDone',
};

/**
 * Các mốc có giờ của trang theo dõi đơn khách (`/don/<mã>`): Đã đặt, Đã xác nhận, Đang giao, Hoàn tất. Cùng bước và cùng trạng thái với thanh tiến
 * trình chung (`buildOrderTimelineSteps`), chỉ đổi tên bước thành tên mốc, vì mỗi dòng ở đây đi kèm giờ: "Đang chuẩn bị 10:03" không nói 10:03 là lúc
 * gì, "Đã xác nhận 10:03" thì có. Bước nhánh Đã huỷ, Đã hoàn trả giữ tên chung. Chữ nằm ở chữ đặt hàng không đăng nhập (chỉ web có trang này).
 *
 * Giờ Đã xác nhận của đơn COD và ví: đơn tạo thẳng ở Đã xác nhận nên sổ trạng thái không có dòng CONFIRMED, và mốc chung lùi về giờ đóng gói
 * (đúng với "Đang chuẩn bị" nhưng sai với "Đã xác nhận"). Ở đây lấy giờ đặt. Đơn huỷ chỉ hiện mốc này khi mốc chung cũng hiện (có bằng chứng đã qua).
 */
export function guestOrderMilestones(
  o: Pick<GuestOrderTrackDTO, 'status' | 'createdAt' | 'paymentMethod' | 'deliveredAt' | 'statusTimes'>,
): OrderTimelineStep[] {
  const stamps = orderTimelineStamps(o);
  const createdConfirmed = NO_PAYMENT_WAIT.has(o.paymentMethod) && !o.statusTimes?.CONFIRMED;
  if (createdConfirmed && (o.status !== 'CANCELLED' || stamps.confirmedAt || stamps.shippingAt)) stamps.confirmedAt = o.createdAt;
  return buildOrderTimelineSteps(o.status, stamps).map((s) => {
    const key = MILESTONE_LABEL[s.key];
    return key ? { ...s, label: guestCopy(key) } : s;
  });
}
