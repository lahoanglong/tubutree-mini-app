import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';

export const FLASH_SOLD_OUT_MSG = 'Hết suất ưu đãi.';
export const FLASH_OVER_LIMIT_MSG = 'Vượt giới hạn mua ưu đãi.';
export const FLASH_ALREADY_STARTED_MSG = 'Ưu đãi đã bắt đầu.';

export interface EffectivePrice {
  flashPrice: number;
  itemId: string;
  endAt: Date;
  soldCount: number;
  quota: number;
}

@Injectable()
export class FlashSaleService {
  private readonly logger = new Logger(FlashSaleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Trả giá flash hiệu lực cho các variation ĐANG có FlashSale active + còn quota.
   * Chỉ chứa variation có flash; caller tự fallback salePrice ?? retailPrice cho phần còn lại.
   * Lưu ý: Prisma không so 2 cột trong where (soldCount<quota) → lọc bằng JS sau khi lấy item active.
   */
  async resolveEffective(variationIds: string[], now: Date = new Date()): Promise<Map<string, EffectivePrice>> {
    const map = new Map<string, EffectivePrice>();
    if (variationIds.length === 0) return map;
    const items = await this.prisma.flashSaleItem.findMany({
      where: {
        variationId: { in: variationIds },
        variation: { isActive: true },
        flashSale: { isActive: true, startAt: { lte: now }, endAt: { gt: now } },
      },
      include: { flashSale: { select: { endAt: true } } },
    });
    for (const it of items) {
      if (it.soldCount >= it.quota) continue;
      map.set(it.variationId, {
        flashPrice: it.flashPrice,
        itemId: it.id,
        endAt: it.flashSale.endAt,
        soldCount: it.soldCount,
        quota: it.quota,
      });
    }
    return map;
  }

  /** Danh sách item flash đang active còn quota — cho FE trang chủ. */
  async listActive(now: Date = new Date()) {
    const items = await this.prisma.flashSaleItem.findMany({
      where: {
        variation: { isActive: true },
        flashSale: { isActive: true, startAt: { lte: now }, endAt: { gt: now } },
      },
      include: {
        flashSale: { select: { endAt: true } },
        variation: { include: { product: { select: { slug: true, name: true, thumbnail: true } } } },
      },
    });
    return items
      .filter((it) => it.soldCount < it.quota)
      .map((it) => ({
        itemId: it.id,
        variationId: it.variationId,
        productSlug: it.variation.product.slug,
        productName: it.variation.product.name,
        thumbnail: it.variation.product.thumbnail,
        flashPrice: it.flashPrice,
        retailPrice: it.variation.retailPrice,
        soldCount: it.soldCount,
        quota: it.quota,
        endAt: it.flashSale.endAt,
      }));
  }

  /**
   * Trừ 1 suất flash ATOMIC trong tx đặt đơn. Guard kép:
   *  (a) soldCount+qty<=quota + flash còn active → raw SQL (Prisma không so 2 cột); rows=0 → hết suất.
   *  (b) FlashSalePurchase.quantity+qty<=perUserLimit → chống vượt giới hạn mua.
   * Fail bất kỳ guard nào → throw (caller rollback toàn bộ đơn). Nếu (b) fail sau khi (a) đã trừ,
   * hoàn lại soldCount để không "khoá" suất.
   */
  async consumeQuota(
    tx: Prisma.TransactionClient,
    itemId: string,
    userId: string,
    qty: number,
    now: Date = new Date(),
  ): Promise<void> {
    // (a) trừ soldCount atomic (raw — so 2 cột + kiểm tra flash còn active).
    const sold = await tx.$executeRaw`
      UPDATE flash_sale_items AS fsi
      SET "soldCount" = fsi."soldCount" + ${qty}
      WHERE fsi.id = ${itemId}
        AND fsi."soldCount" + ${qty} <= fsi."quota"
        AND EXISTS (
          SELECT 1 FROM flash_sales fs
          WHERE fs.id = fsi."flashSaleId"
            AND fs."isActive" = true
            AND fs."startAt" <= ${now}
            AND fs."endAt" > ${now}
        )`;
    if (sold === 0) throw new BadRequestException(FLASH_SOLD_OUT_MSG);

    // (b) perUserLimit
    const item = await tx.flashSaleItem.findUnique({ where: { id: itemId }, select: { perUserLimit: true } });
    const limit = item?.perUserLimit ?? 0;
    const existing = await tx.flashSalePurchase.findUnique({
      where: { flashSaleItemId_userId: { flashSaleItemId: itemId, userId } },
    });
    if (existing) {
      const bumped = await tx.flashSalePurchase.updateMany({
        where: { flashSaleItemId: itemId, userId, quantity: { lte: limit - qty } },
        data: { quantity: { increment: qty } },
      });
      if (bumped.count === 0) {
        await tx.flashSaleItem.updateMany({ where: { id: itemId }, data: { soldCount: { decrement: qty } } });
        throw new BadRequestException(FLASH_OVER_LIMIT_MSG);
      }
    } else {
      if (qty > limit) {
        await tx.flashSaleItem.updateMany({ where: { id: itemId }, data: { soldCount: { decrement: qty } } });
        throw new BadRequestException(FLASH_OVER_LIMIT_MSG);
      }
      await tx.flashSalePurchase.create({ data: { flashSaleItemId: itemId, userId, quantity: qty } });
    }
  }

  /** Hoàn suất flash khi huỷ/hoàn đơn (mirror khôi phục stock). Guard gte để không âm. */
  async restore(tx: Prisma.TransactionClient, itemId: string, userId: string, qty: number): Promise<void> {
    await tx.flashSaleItem.updateMany({
      where: { id: itemId, soldCount: { gte: qty } },
      data: { soldCount: { decrement: qty } },
    });
    await tx.flashSalePurchase.updateMany({
      where: { flashSaleItemId: itemId, userId, quantity: { gte: qty } },
      data: { quantity: { decrement: qty } },
    });
  }

  /** Tạo đợt flash sale mới (admin). */
  async createSale(adminId: string, dto: { title: string; startAt: string; endAt: string }) {
    const startAt = new Date(dto.startAt),
      endAt = new Date(dto.endAt);
    if (!(startAt < endAt)) throw new BadRequestException('startAt phải trước endAt.');
    return this.prisma.flashSale.create({ data: { title: dto.title, startAt, endAt, createdBy: adminId } });
  }

  /** Cập nhật đợt flash sale (admin). */
  async updateSale(id: string, dto: { title?: string; startAt?: string; endAt?: string; isActive?: boolean }) {
    if (dto.startAt !== undefined || dto.endAt !== undefined) {
      const current = await this.prisma.flashSale.findUniqueOrThrow({ where: { id } });
      const start = dto.startAt ? new Date(dto.startAt) : current.startAt;
      const end = dto.endAt ? new Date(dto.endAt) : current.endAt;
      if (!(start < end)) throw new BadRequestException('startAt phải trước endAt.');
    }
    return this.prisma.flashSale.update({
      where: { id },
      data: {
        title: dto.title,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        endAt: dto.endAt ? new Date(dto.endAt) : undefined,
        isActive: dto.isActive,
      },
    });
  }

  /** Danh sách toàn bộ đợt flash sale kèm item (admin). */
  async listSales() {
    return this.prisma.flashSale.findMany({
      orderBy: { startAt: 'desc' },
      include: {
        items: {
          select: { id: true, variationId: true, flashPrice: true, quota: true, soldCount: true, perUserLimit: true },
        },
      },
    });
  }

  /**
   * Thêm variation vào đợt flash sale (admin). Validate:
   *  - đợt flash tồn tại; variation tồn tại; flashPrice < giá đang bán (salePrice ?? retailPrice)
   *    (kèm % giảm tối thiểu theo config).
   *  - quota không vượt tồn kho.
   *  - variation chưa tham gia đợt flash active/tương lai khác.
   */
  async addItem(saleId: string, dto: { variationId: string; flashPrice: number; quota: number; perUserLimit?: number }) {
    const sale = await this.prisma.flashSale.findUnique({ where: { id: saleId } });
    if (!sale) throw new BadRequestException('Đợt flash không tồn tại.');
    const variation = await this.prisma.variation.findUnique({ where: { id: dto.variationId } });
    if (!variation) throw new BadRequestException('Variation không tồn tại.');
    const standing = variation.salePrice ?? variation.retailPrice;
    if (dto.flashPrice >= standing) throw new BadRequestException('Giá flash phải thấp hơn giá đang bán.');
    const minPct = await this.config.get<number>('flashsale.min_discount_pct', 0);
    if (minPct > 0 && dto.flashPrice > standing * (1 - minPct)) {
      throw new BadRequestException(`Mức giảm phải ≥ ${Math.round(minPct * 100)}%.`);
    }
    if (dto.quota > variation.stock) throw new BadRequestException('Quota vượt tồn kho.');
    const clash = await this.prisma.flashSaleItem.findFirst({
      where: { variationId: dto.variationId, flashSale: { endAt: { gt: new Date() } } },
    });
    if (clash) throw new BadRequestException('Sản phẩm đã có trong đợt flash khác.');
    const perUserLimit = dto.perUserLimit ?? (await this.config.get<number>('flashsale.default_per_user_limit', 5));
    return this.prisma.flashSaleItem.create({
      data: { flashSaleId: saleId, variationId: dto.variationId, flashPrice: dto.flashPrice, quota: dto.quota, perUserLimit },
    });
  }

  /** Xoá item khỏi đợt flash sale (admin). Chặn xoá nếu đã phát sinh đơn (soldCount>0). */
  async removeItem(itemId: string) {
    const item = await this.prisma.flashSaleItem.findUnique({ where: { id: itemId }, select: { soldCount: true } });
    if (!item) throw new BadRequestException('Không tìm thấy sản phẩm flash.');
    if (item.soldCount > 0) {
      throw new BadRequestException('Không thể xoá sản phẩm đã phát sinh đơn giờ vàng. Hãy tắt đợt flash thay vì xoá.');
    }
    await this.prisma.flashSaleItem.delete({ where: { id: itemId } });
    return { ok: true };
  }

  /** Danh sách item flash SẮP diễn ra (chưa bắt đầu) — cho FE mục "Sắp diễn ra" + nút Nhắc tôi. */
  async listUpcoming(userId: string, now: Date = new Date()) {
    const items = await this.prisma.flashSaleItem.findMany({
      where: {
        flashSale: { isActive: true, startAt: { gt: now }, endAt: { gt: now } },
      },
      include: {
        flashSale: { select: { startAt: true } },
        variation: { include: { product: { select: { slug: true, name: true, thumbnail: true } } } },
        reminders: { where: { userId }, select: { id: true } },
      },
      orderBy: { flashSale: { startAt: 'asc' } },
    });
    return items.map((it) => ({
      itemId: it.id,
      variationId: it.variationId,
      productSlug: it.variation.product.slug,
      productName: it.variation.product.name,
      thumbnail: it.variation.product.thumbnail,
      flashPrice: it.flashPrice,
      retailPrice: it.variation.retailPrice,
      startAt: it.flashSale.startAt,
      reminded: it.reminders.length > 0,
    }));
  }

  /** Đặt nhắc khi flash sale sắp mở bán. Chỉ cho phép khi sale CHƯA bắt đầu. */
  async setReminder(userId: string, itemId: string, now: Date = new Date()) {
    const item = await this.prisma.flashSaleItem.findUnique({
      where: { id: itemId },
      select: { flashSale: { select: { startAt: true } } },
    });
    if (!item) throw new BadRequestException('Không tìm thấy sản phẩm flash.');
    if (item.flashSale.startAt <= now) throw new BadRequestException(FLASH_ALREADY_STARTED_MSG);
    return this.prisma.flashSaleReminder.upsert({
      where: { userId_flashSaleItemId: { userId, flashSaleItemId: itemId } },
      update: {},
      create: { userId, flashSaleItemId: itemId },
    });
  }

  /** Huỷ nhắc flash sale. */
  async cancelReminder(userId: string, itemId: string): Promise<{ ok: boolean }> {
    await this.prisma.flashSaleReminder.deleteMany({ where: { userId, flashSaleItemId: itemId } });
    return { ok: true };
  }

  /**
   * Cron mỗi giờ: quét reminder chưa notify, item nào sale ĐÃ bắt đầu (startAt<=now<endAt, isActive)
   * thì claim atomic (updateMany guard notifiedAt: null) rồi notify FLASH_STARTING. notify() nuốt lỗi
   * để 1 lần gửi hỏng không chặn cả lô.
   */
  @Cron('0 * * * *')
  async notifyStartedFlashSales(now: Date = new Date()): Promise<void> {
    const reminders = await this.prisma.flashSaleReminder.findMany({
      where: { notifiedAt: null },
      include: {
        item: {
          include: {
            flashSale: { select: { isActive: true, startAt: true, endAt: true } },
            variation: { include: { product: { select: { name: true } } } },
          },
        },
      },
      take: 500,
    });

    let sent = 0;
    for (const r of reminders) {
      const sale = r.item.flashSale;
      const started = sale.isActive && sale.startAt <= now && sale.endAt > now;
      if (!started) continue;

      // Atomic claim chống double-send khi cron chạy chồng.
      const claimed = await this.prisma.flashSaleReminder.updateMany({
        where: { id: r.id, notifiedAt: null },
        data: { notifiedAt: now },
      });
      if (claimed.count === 0) continue;

      await this.notifications
        .notify(r.userId, 'FLASH_STARTING', { product: r.item.variation.product.name })
        .catch(() => undefined);
      sent++;
    }
    if (sent) this.logger.log(`Flash-starting reminders sent: ${sent}`);
  }
}
