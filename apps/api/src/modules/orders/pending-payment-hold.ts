import type { Prisma } from '@prisma/client';

/**
 * Đơn có cờ "Pancake báo đã thanh toán, chờ đối chiếu" được hoãn tự huỷ chừng này giờ kể từ khoản đầu tiên (paymentUnlinkedFirstAt): đủ để Kế toán đối
 * chiếu sao kê. Quá hạn mà khách không trả thì cron huỷ như thường; cờ còn nguyên nên đơn sang hàng đợi của ADMIN (đơn đã huỷ).
 * File riêng, không import service: ô đếm của bàn vận hành dùng chung điều kiện này với cron mà không kéo cron vào AdminModule.
 */
export const PAYMENT_UNLINKED_HOLD_HOURS = 48;

/**
 * Đơn KHÔNG còn trong thời gian giữ vì khoản chưa gắn được: không có cờ, hoặc khoản đầu tiên đã quá PAYMENT_UNLINKED_HOLD_HOURS. Dòng chưa có mốc đầu
 * (cờ đặt trước khi có cột) thì tính theo paymentUnlinkedAt. Cron tự huỷ chỉ huỷ đơn khớp điều kiện này, nên ô "N quá hạn" cũng chỉ đếm các đơn đó.
 */
export function paymentUnlinkedHoldOverWhere(now: Date): Prisma.OrderWhereInput {
  const cutoff = new Date(now.getTime() - PAYMENT_UNLINKED_HOLD_HOURS * 3_600_000);
  return { OR: [{ paymentUnlinkedAt: null }, { paymentUnlinkedFirstAt: { lt: cutoff } }, { paymentUnlinkedFirstAt: null, paymentUnlinkedAt: { lt: cutoff } }] };
}
