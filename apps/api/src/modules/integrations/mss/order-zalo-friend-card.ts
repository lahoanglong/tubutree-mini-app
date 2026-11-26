import type { PrismaService } from '../../../prisma/prisma.service';
import { ORDER_ZALO_FRIEND_KNOWN_DAYS, orderZaloGateOpen, type OrderZaloGate } from '../../system-config/order-zalo-config';
import { ORDER_ZALO_ACTIVE_STATUSES } from './mss-order-event-types';

const DAY_MS = 86_400_000;

type OutboxReader = Pick<PrismaService, 'mssOrderEventOutbox'>;

export type OrderZaloFriendScope = 'order' | 'account';

/**
 * Khách đã nhận tin Zalo đơn như bạn bè trong 90 ngày: MSS gửi xong một tin đơn của chính khách mà không phải tin người lạ (`RESULT_SENT`, lý do
 * null, dòng người mua). Một truy vấn, không gọi MSS.
 */
export async function friendKnownFor(prisma: OutboxReader, userId: string, now = Date.now()): Promise<boolean> {
  const row = await prisma.mssOrderEventOutbox.findFirst({
    where: {
      order: { userId },
      recipientRole: 'buyer',
      status: 'RESULT_SENT',
      resultReason: null,
      resultAt: { gte: new Date(now - ORDER_ZALO_FRIEND_KNOWN_DAYS * DAY_MS) },
    },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Thẻ kết bạn Zalo ở màn sau khi đặt (trang chuyển khoản, /don): cổng tin đơn mở, khách đồng ý ở đơn này, đơn còn đang đi, và chưa có tin bạn bè
 * nào tới. Tin người lạ (`stranger`) vẫn mời kết bạn.
 * - `order` (khách vãng lai): chỉ xét tin của đơn này; khách không có lịch sử tài khoản để dựa vào.
 * - `account` (khách đăng nhập): xét `friendKnownFor` của chủ đơn, cùng luật màn đặt xong và chi tiết đơn dùng qua GET /config/order-zalo. Đơn
 *   còn đang đi nên tin của chính đơn này nằm trong cửa sổ 90 ngày.
 * Ba điều kiện rẻ xét trước; chỉ khi qua cả ba mới có đúng một truy vấn outbox (màn chuyển khoản dò lại mỗi 4 giây).
 */
export async function orderZaloFriendCard(
  prisma: OutboxReader,
  gate: OrderZaloGate | null | undefined,
  order: { id: string; userId: string; status: string; orderZaloConsent: boolean | null },
  scope: OrderZaloFriendScope,
  now = Date.now(),
): Promise<boolean> {
  if (!orderZaloGateOpen(gate) || order.orderZaloConsent !== true || !ORDER_ZALO_ACTIVE_STATUSES.includes(order.status)) return false;
  if (scope === 'account') return !(await friendKnownFor(prisma, order.userId, now));
  const friend = await prisma.mssOrderEventOutbox.findFirst({
    where: { orderId: order.id, recipientRole: 'buyer', status: 'RESULT_SENT', resultReason: null },
    select: { id: true },
  });
  return friend === null;
}
