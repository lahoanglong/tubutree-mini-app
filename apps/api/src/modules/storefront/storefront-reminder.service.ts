import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Nhắc CTV thêm sản phẩm nổi bật họ chưa có trong gian hàng — giữ CTV quay lại cập nhật thay vì
 * tạo gian hàng 1 lần rồi quên. Mirror RemarketingService (lifecycle module): atomic-claim qua
 * updateMany guard chống double-send khi cron chạy chồng, notify() lỗi không chặn cả lô.
 *
 * Đơn giản hoá so với thiết kế ban đầu (theo category CTV đã có collection): StorefrontCollection
 * không có cột categoryId — collection có thể tạo tay hoặc từ apply-template (chỉ copy tên danh
 * mục làm title, không lưu liên kết FK) — nên "khớp category" sẽ dựa vào so khớp chuỗi title,
 * mong manh (CTV đổi tên collection là gãy). Thay bằng tiêu chí chắc chắn đúng: gian hàng ĐANG
 * HOẠT ĐỘNG (đã publish + đã có ít nhất 1 sản phẩm — gian hàng trắng hoàn toàn đã có
 * TemplatePickerSheet/EmptyState mời tạo, nhắc thêm là thừa) mà còn thiếu sản phẩm isFeatured.
 */
@Injectable()
export class StorefrontReminderService {
  private readonly logger = new Logger(StorefrontReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Cron 9h sáng thứ Hai hàng tuần — đủ thưa để không gây phiền. Toàn thân bọc try/catch:
   * @Cron không tự bắt lỗi — findMany/updateMany lỗi (DB blip...) ném ra ngoài là
   * unhandledRejection, Node 20 mặc định crash cả process. Lỗi notify từng gian hàng đã được cô
   * lập ở try/catch trong vòng lặp bên dưới.
   */
  @Cron('0 9 * * 1')
  async remindTrendingProducts(): Promise<void> {
    try {
      const trending = await this.prisma.product.findMany({
        where: { isFeatured: true, isActive: true, affiliateBlocked: false },
        select: { id: true, name: true },
        take: 50,
      });
      if (trending.length === 0) return;

      const cooldown = new Date(Date.now() - 6 * 24 * 3600e3);
      const stores = await this.prisma.storefront.findMany({
        where: {
          type: 'CTV',
          isPublished: true,
          OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: cooldown } }],
        },
        select: {
          id: true,
          ownerUserId: true,
          lastReminderAt: true,
          collections: { select: { items: { select: { productId: true } } } },
        },
        take: 200,
      });

      let sent = 0;
      for (const sf of stores) {
        if (!sf.ownerUserId) continue;
        const haveIds = new Set(sf.collections.flatMap((c) => c.items.map((i) => i.productId)));
        if (haveIds.size === 0) continue; // gian hàng trắng — xem comment đầu file
        const missing = trending.filter((p) => !haveIds.has(p.id));
        if (missing.length === 0) continue;

        // Atomic guard chống double-send khi cron chạy chồng (mirror remarketing.service.ts) —
        // chỉ claim nếu vẫn còn trong điều kiện cooldown lúc đọc ở trên (chưa bị lượt khác nhắc).
        const claimedAt = new Date();
        const claimed = await this.prisma.storefront.updateMany({
          where: { id: sf.id, OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: cooldown } }] },
          data: { lastReminderAt: claimedAt },
        });
        if (claimed.count === 0) continue;

        try {
          await this.notifications.notify(sf.ownerUserId, 'STOREFRONT_TRENDING_PRODUCTS', {
            count: String(missing.length),
            sample: missing[0]!.name,
          });
          sent++;
        } catch (err) {
          // Đã CLAIM trước khi gửi — nuốt lỗi ở đây là mất hẳn lần nhắc đó (guard cooldown chặn
          // mọi lượt sau trong tuần). Trả lại mốc cũ để lượt sau thử lại, log để phát hiện lỗi.
          this.logger.error(
            `Nhắc SP nổi bật lỗi (storefront=${sf.id}): ${err instanceof Error ? err.message : err}`,
          );
          await this.prisma.storefront
            .updateMany({ where: { id: sf.id, lastReminderAt: claimedAt }, data: { lastReminderAt: sf.lastReminderAt } })
            .catch(() => undefined);
        }
      }
      if (sent) this.logger.log(`Storefront trending-product reminders sent: ${sent}`);
    } catch (err) {
      this.logger.error(`remindTrendingProducts lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }
}
