import type { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

interface Notifier {
  notify(userId: string, templateCode: string, data: Record<string, string>): Promise<void>;
}

/**
 * Báo chủ gian hàng đang giao đơn (đơn fulfiller=MERCHANT). Đơn kho Tubu thì không làm gì. Best-effort: đơn đã ghi xong,
 * lỗi gửi tin chỉ ghi log.
 */
export async function notifyMerchantOwner(
  prisma: Pick<PrismaClient, 'order'>,
  notifications: Notifier | undefined,
  logger: Pick<Logger, 'error'>,
  orderId: string,
  template: string,
  data: Record<string, string>,
): Promise<void> {
  if (!notifications) return;
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { fulfiller: true, fulfillerStorefront: { select: { ownerUserId: true } } },
    });
    const ownerId = order?.fulfiller === 'MERCHANT' ? order.fulfillerStorefront?.ownerUserId : null;
    if (!ownerId) return;
    await notifications.notify(ownerId, template, data);
  } catch (err) {
    logger.error(`Báo đối tác ${template} lỗi cho đơn ${orderId}: ${err instanceof Error ? err.message : err}`);
  }
}
