import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';

interface ReorderRow {
  userId: string;
  variationId: string;
  productName: string;
  lastOrderAt: Date;
}

/**
 * Lifecycle Reminder (§6.14.7): nhắc mua lại khi đã qua ~chu kỳ tiêu dùng kể từ
 * đơn DELIVERED cuối của (user × sản phẩm). Tính thuần từ lịch sử đơn; remindedAt
 * chống spam (nhắc lại chỉ khi có đơn mới hơn). Push qua NotificationsService
 * (luôn lưu INAPP; ZNS khi OA cấu hình).
 */
@Injectable()
export class LifecycleService {
  /** Trần người nhận mỗi lần báo giảm giá — hàm chạy trong cron đồng bộ nên không được kéo dài. */
  private static readonly PRICE_DROP_MAX_RECIPIENTS = 2_000;

  private readonly logger = new Logger(LifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Cron 4h sáng: gửi nhắc mua lại cho các sản phẩm đã tới hạn.
   *
   * Toàn thân bọc try/catch: @Cron không tự bắt lỗi — bất kỳ lỗi nào ném ra ngoài (query raw lỗi,
   * hoặc `throw err` ở nhánh create P2002 bên dưới) là unhandledRejection, Node 20 mặc định crash
   * cả process. Lỗi gửi từng user đã được cô lập ở try/catch trong vòng lặp; lớp ngoài này bắt
   * phần còn lại.
   */
  @Cron('0 4 * * *')
  async sendReorderReminders(): Promise<void> {
    try {
      const cycleDays = await this.config.get<number>('reorder.default_cycle_days', 60);
      const ratio = await this.config.get<number>('reorder.remind_ratio', 0.85);
      const threshold = new Date(Date.now() - cycleDays * ratio * 864e5);

      // Đơn DELIVERED cuối của mỗi (user, variation) đã cũ hơn ngưỡng.
      const rows = await this.prisma.$queryRaw<ReorderRow[]>`
        SELECT o."userId",
               oi."variationId",
               (ARRAY_AGG(oi."productName" ORDER BY o."createdAt" DESC))[1] AS "productName",
               MAX(o."createdAt") AS "lastOrderAt"
        FROM order_items oi
        JOIN orders o ON o.id = oi."orderId"
        WHERE o.status::text = 'DELIVERED'
        GROUP BY o."userId", oi."variationId"
        HAVING MAX(o."createdAt") <= ${threshold}
        LIMIT 500`;

      let sent = 0;
      for (const r of rows) {
        const lastOrderAt = new Date(r.lastOrderAt);
        const existing = await this.prisma.reorderReminder.findUnique({
          where: { userId_variationId: { userId: r.userId, variationId: r.variationId } },
        });
        // Đã nhắc cho chu kỳ này (remindedAt sau đơn cuối) → bỏ qua (chống spam).
        if (existing?.remindedAt && existing.remindedAt >= lastOrderAt) continue;

        // Claim atomic chống double-send khi 2 cron instance chạy chồng (mirror RemarketingService):
        // - đã có bản ghi → chỉ update nếu remindedAt vẫn còn cũ hơn lastOrderAt tại thời điểm ghi
        //   (updateMany guard — nếu instance khác đã claim trước, count=0).
        // - chưa có bản ghi → create; unique(userId,variationId) tự chặn instance thứ hai (P2002).
        const claimedAt = new Date();
        let claimed: boolean;
        if (existing) {
          const res = await this.prisma.reorderReminder.updateMany({
            where: {
              userId: r.userId,
              variationId: r.variationId,
              OR: [{ remindedAt: null }, { remindedAt: { lt: lastOrderAt } }],
            },
            data: { productName: r.productName, lastOrderAt, remindedAt: claimedAt },
          });
          claimed = res.count > 0;
        } else {
          try {
            await this.prisma.reorderReminder.create({
              data: { userId: r.userId, variationId: r.variationId, productName: r.productName, lastOrderAt, remindedAt: claimedAt },
            });
            claimed = true;
          } catch (err) {
            if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
              claimed = false;
            } else {
              throw err;
            }
          }
        }
        if (!claimed) continue;

        try {
          await this.notifications.notify(r.userId, 'REORDER_REMINDER', { product: r.productName });
          sent++;
        } catch (err) {
          // Đã CLAIM trước khi gửi (mirror RemarketingService) — nuốt lỗi ở đây là mất hẳn lần
          // nhắc đó: guard đầu hàm coi remindedAt đã set là "đã nhắc cho chu kỳ này", không bao
          // giờ thử lại. Trả cờ về null để lượt sau thử lại (cùng where cho cả 2 nhánh create/
          // update — nhánh create không có bản ghi cũ để revert kiểu update, nhưng row vừa tạo
          // vẫn khớp where này).
          this.logger.error(
            `Nhắc mua lại lỗi (user=${r.userId}, variation=${r.variationId}): ${err instanceof Error ? err.message : err}`,
          );
          await this.prisma.reorderReminder
            .updateMany({
              where: { userId: r.userId, variationId: r.variationId, remindedAt: claimedAt },
              data: { remindedAt: null },
            })
            .catch(() => undefined);
        }
      }
      if (sent) this.logger.log(`Reorder reminders sent: ${sent}`);
    } catch (err) {
      this.logger.error(`sendReorderReminders lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Price Drop Alert (§6.14.10): sản phẩm giảm giá → báo cho user đã ❤️ wishlist.
   * Gọi từ Pancake sync khi phát hiện giá biến thể giảm. Lỗi gửi từng user không
   * chặn cả lô (notify đã nuốt lỗi).
   */
  async notifyWishlistPriceDrop(productId: string, productName: string): Promise<void> {
    // Trần số người nhận: hàm này chạy NGAY TRONG cron đồng bộ Pancake (15 phút/lần). Một sản
    // phẩm hot giảm giá với 20 nghìn lượt yêu thích sẽ gửi 20 nghìn thông báo tuần tự, chặn
    // đứng phần còn lại của lượt đồng bộ và có thể để lượt kế chạy chồng lên.
    const items = await this.prisma.wishlist.findMany({
      where: { productId },
      orderBy: { id: 'asc' },
      take: LifecycleService.PRICE_DROP_MAX_RECIPIENTS,
      select: { userId: true },
    });
    for (const w of items) {
      await this.notifications
        .notify(w.userId, 'PRICE_DROP_ALERT', { product: productName })
        .catch(() => undefined);
    }
    if (items.length) {
      const capped = items.length === LifecycleService.PRICE_DROP_MAX_RECIPIENTS ? ' (đã chạm trần)' : '';
      this.logger.log(`Price-drop alert: ${productName} → ${items.length} user${capped}.`);
    }
  }
}
