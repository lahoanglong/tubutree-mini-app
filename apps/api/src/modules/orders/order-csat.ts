import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { REVIEWABLE_ORDER } from '../reviews/review-eligibility';

/**
 * Thẻ "Đơn này thế nào?" ở chi tiết đơn đã giao (Mini App và web): khách chạm 👍 hay 👎 một lần. 👍 dẫn sang viết đánh giá, 👎 mở chat hỗ trợ
 * kèm mã đơn để CS gỡ vấn đề trước khi khách chấm 1★.
 *
 * Câu trả lời nằm ở `analytics_events` (không thêm bảng): mỗi đơn đúng một dòng nhờ `eventId` cố định theo id đơn (cột unique), nên chạm đúp, hai
 * thiết bị hay gửi lại đều chỉ giữ lần đầu. Client không giả được dòng này qua POST /events: sự kiện client phải có eventId UUID và tên thuộc
 * CLIENT_EVENT_NAMES. Hạn lưu analytics_events (tối thiểu 90 ngày) dài hơn ORDER_CSAT_ASK_DAYS nên thẻ không hỏi lại đơn đã trả lời.
 */
export const ORDER_CSAT_EVENT = 'order_csat';
export const ORDER_CSAT_ANSWERS = ['up', 'down'] as const;
export type OrderCsatAnswer = (typeof ORDER_CSAT_ANSWERS)[number];
export const ORDER_CSAT_PLATFORMS = ['miniapp', 'web'] as const;
export type OrderCsatPlatform = (typeof ORDER_CSAT_PLATFORMS)[number];
/** Chỉ hỏi trong chừng này ngày sau khi giao: đơn cũ hơn thì câu trả lời không còn giúp CS gỡ kịp. */
export const ORDER_CSAT_ASK_DAYS = 30;

const DAY_MS = 864e5;

export const orderCsatEventId = (orderId: string): string => `${ORDER_CSAT_EVENT}:${orderId}`;

type CsatOrderFacts = { status: string; type: string; placedForCustomer: boolean };

/** Đơn lẻ đã giao mua cho chính mình (cùng REVIEWABLE_ORDER): đơn CTV đặt hộ hay đơn đại lý thì người xem không phải người dùng hàng. */
const isCsatOrder = (o: CsatOrderFacts): boolean =>
  o.status === REVIEWABLE_ORDER.status && o.type === REVIEWABLE_ORDER.type && o.placedForCustomer === REVIEWABLE_ORDER.placedForCustomer;

/**
 * Chi tiết đơn có hiện thẻ không: đơn đủ `isCsatOrder`, giao chưa quá ORDER_CSAT_ASK_DAYS ngày (đơn cũ thiếu deliveredAt dùng updatedAt), chưa
 * có câu trả lời, và chưa có yêu cầu trả nào (khách đã báo vấn đề qua đổi/trả thì không hỏi lại). Đơn không đủ điều kiện không tốn truy vấn.
 */
export async function orderCsatAsk(
  db: Pick<PrismaClient, 'analyticsEvent' | 'returnRequest'>,
  order: CsatOrderFacts & { id: string; deliveredAt: Date | null; updatedAt: Date },
  now: Date = new Date(),
): Promise<boolean> {
  if (!isCsatOrder(order)) return false;
  const deliveredAt = order.deliveredAt ?? order.updatedAt;
  if (now.getTime() - deliveredAt.getTime() > ORDER_CSAT_ASK_DAYS * DAY_MS) return false;
  const [answered, returnRequest] = await Promise.all([
    db.analyticsEvent.findUnique({ where: { eventId: orderCsatEventId(order.id) }, select: { id: true } }),
    db.returnRequest.findFirst({ where: { orderId: order.id }, select: { id: true } }),
  ]);
  return !answered && !returnRequest;
}

/**
 * Ghi câu trả lời của chủ đơn. Đơn không tồn tại hay của người khác: 404 (không lộ mã đơn); đơn chưa giao hoặc không phải đơn lẻ của chính khách:
 * 409. Không xét hạn ngày hay yêu cầu trả: thẻ đang mở trên màn vẫn gửi được. `recorded` false khi đơn đã có câu trả lời (giữ lần đầu).
 */
export async function recordOrderCsat(
  db: Pick<PrismaClient, 'order' | 'analyticsEvent'>,
  userId: string,
  code: string,
  input: { answer: OrderCsatAnswer; platform: OrderCsatPlatform },
): Promise<{ recorded: boolean }> {
  const order = await db.order.findUnique({
    where: { code },
    select: { id: true, userId: true, code: true, status: true, type: true, placedForCustomer: true },
  });
  if (!order || order.userId !== userId) throw new NotFoundException('Không tìm thấy đơn hàng.');
  if (!isCsatOrder(order)) throw new ConflictException('Đơn này chưa giao tới bạn nên chưa ghi cảm nhận được.');
  const { count } = await db.analyticsEvent.createMany({
    data: [
      {
        eventId: orderCsatEventId(order.id),
        eventName: ORDER_CSAT_EVENT,
        occurredAt: new Date(),
        userId,
        platform: input.platform,
        props: { orderCode: order.code, answer: input.answer },
      },
    ],
    skipDuplicates: true,
  });
  return { recorded: count === 1 };
}
