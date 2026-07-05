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

  /** Xoá item khỏi đợt flash sale (admin). */
  async removeItem(itemId: string) {
    await this.prisma.flashSaleItem.delete({ where: { id: itemId } });
    return { ok: true };
  }
}
