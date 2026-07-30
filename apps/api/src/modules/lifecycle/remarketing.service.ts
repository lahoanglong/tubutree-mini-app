import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';

/**
 * Remarketing reminders: nhắc user quay lại app.
 *  - Cart-abandonment: giỏ còn món nhưng chưa checkout, bỏ quên đủ lâu.
 *  - Voucher-expiry: voucher cá nhân (scope USER_GROUP) sắp hết hạn, chưa dùng.
 * Mirror LifecycleService: atomic dedup qua updateMany guard (chống double-send
 * khi 2 cron instance chạy chồng), notify() nuốt lỗi (không chặn cả lô).
 */
@Injectable()
export class RemarketingService {
  private readonly logger = new Logger(RemarketingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Cron mỗi giờ: giỏ có món, "updatedAt" đã qua ít nhất min giờ nhưng chưa
   * quá max giờ (khỏi nhắc giỏ quá cũ coi như bỏ hẳn). Chỉ nhắc 1 lần cho mỗi
   * lần bỏ quên — nếu user cập nhật giỏ lại (updatedAt mới hơn lần nhắc trước)
   * thì coi là lần bỏ quên mới, được nhắc lại.
   */
  @Cron('0 * * * *')
  async sendCartAbandonReminders(): Promise<void> {
    const minH = await this.config.get<number>('remarketing.cart_abandon_min_hours', 6);
    const maxH = await this.config.get<number>('remarketing.cart_abandon_max_hours', 72);
    const now = Date.now();
    const carts = await this.prisma.cart.findMany({
      where: {
        updatedAt: { lte: new Date(now - minH * 3600e3), gte: new Date(now - maxH * 3600e3) },
        items: { some: {} },
      },
      include: { items: { include: { variation: { include: { product: true } } } } },
      take: 200,
    });

    let sent = 0;
    for (const cart of carts) {
      if (!cart.items.length) continue;
      // Đã nhắc cho lần bỏ quên hiện tại (nhắc sau lần cập nhật giỏ cuối) → bỏ qua.
      if (cart.abandonRemindedAt && cart.abandonRemindedAt >= cart.updatedAt) continue;

      // Atomic guard chống double-send khi cron chạy chồng: chỉ set nếu vẫn
      // chưa nhắc cho updatedAt này (count 0 nghĩa là instance khác đã nhắc).
      const claimed = await this.prisma.cart.updateMany({
        where: {
          id: cart.id,
          OR: [{ abandonRemindedAt: null }, { abandonRemindedAt: { lt: cart.updatedAt } }],
        },
        data: { abandonRemindedAt: new Date() },
      });
      if (claimed.count === 0) continue;

      const itemCount = cart.items.reduce((s, i) => s + i.quantity, 0);
      const product = cart.items[0]?.variation.product.name ?? '';
      await this.notifications
        .notify(cart.userId, 'CART_ABANDONED', { item_count: String(itemCount), product })
        .catch(() => undefined);
      sent++;
    }
    if (sent) this.logger.log(`Cart abandon reminders sent: ${sent}`);
  }

  /**
   * Cron 5h sáng: voucher cá nhân (VouchersService cấp: scope USER_GROUP,
   * scopeMeta.userId, usageLimit 1) sắp hết hạn trong N ngày, chưa dùng
   * (usedCount 0), chưa nhắc (remindedAt null). PUBLIC/TIER không phải voucher
   * "của riêng" 1 user nên không nằm trong phạm vi nhắc này.
   */
  @Cron('0 5 * * *')
  async sendVoucherExpiryReminders(): Promise<void> {
    const days = await this.config.get<number>('remarketing.voucher_expiry_days', 3);
    const now = new Date();
    const soon = new Date(now.getTime() + days * 864e5);
    const coupons = await this.prisma.coupon.findMany({
      where: {
        scope: 'USER_GROUP',
        usedCount: 0,
        endAt: { gte: now, lte: soon },
        remindedAt: null,
      },
      take: 200,
    });

    let sent = 0;
    for (const c of coupons) {
      const meta = (c.scopeMeta ?? {}) as { userId?: string };
      if (!meta.userId) continue;

      // Atomic guard tương tự cart-abandon: chỉ claim nếu chưa ai nhắc.
      const claimed = await this.prisma.coupon.updateMany({
        where: { id: c.id, remindedAt: null },
        data: { remindedAt: new Date() },
      });
      if (claimed.count === 0) continue;

      await this.notifications
        .notify(meta.userId, 'VOUCHER_EXPIRING', {
          code: c.code,
          expires: c.endAt.toLocaleDateString('vi-VN'),
        })
        .catch(() => undefined);
      sent++;
    }
    if (sent) this.logger.log(`Voucher expiry reminders sent: ${sent}`);
  }
}
