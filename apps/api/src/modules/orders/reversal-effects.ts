import type { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

/** Đường chính chạy phần đảo ngay trong request huỷ/trả; trước mốc này (tính từ lần ghi cuối của đơn) cron không đụng để không chạy chồng lên nó. */
export const REVERSAL_EFFECTS_GRACE_MINUTES = 5;
/** Cron chỉ tự sửa đơn cập nhật trong chừng này ngày; cũ hơn mà vẫn chưa xong thì để người xử lý. */
export const REVERSAL_EFFECTS_WINDOW_DAYS = 14;

/**
 * Ghi mốc "phần đảo sau commit của lần huỷ/trả đã xong". Chỉ lên dòng còn null nên ghi lặp không đổi gì. Best-effort: lỗi ghi mốc
 * không được làm hỏng lần huỷ/trả đã commit — đơn còn null thì cron chạy lại (mọi việc idempotent).
 */
export async function markReversalEffectsDone(
  prisma: Pick<PrismaClient, 'order'>,
  orderId: string,
  logger: Pick<Logger, 'warn'>,
): Promise<void> {
  try {
    await prisma.order.updateMany({ where: { id: orderId, reversalEffectsAt: null }, data: { reversalEffectsAt: new Date() } });
  } catch (err) {
    logger.warn(`Không ghi được mốc xong phần đảo sau huỷ/trả cho đơn ${orderId}: ${err instanceof Error ? err.message : err} — cron sẽ chạy lại (idempotent).`);
  }
}
