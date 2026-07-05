import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

export interface EffectivePrice {
  flashPrice: number;
  itemId: string;
  endAt: Date;
  soldCount: number;
  quota: number;
}

@Injectable()
export class FlashSaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
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
      where: { flashSale: { isActive: true, startAt: { lte: now }, endAt: { gt: now } } },
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
    if (sold === 0) throw new BadRequestException('Hết suất ưu đãi.');

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
        throw new BadRequestException('Vượt giới hạn mua ưu đãi.');
      }
    } else {
      if (qty > limit) {
        await tx.flashSaleItem.updateMany({ where: { id: itemId }, data: { soldCount: { decrement: qty } } });
        throw new BadRequestException('Vượt giới hạn mua ưu đãi.');
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
}
