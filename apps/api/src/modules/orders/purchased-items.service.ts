import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { exposedStock } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { isPartnerOwnedProduct } from '../cart/partner-goods';
import { isPancakeFulfilledLine } from '../integrations/pancake/pancake-fulfilment';
import { VARIATION_ID_RE } from './variation-id';
import { publicProductThumb } from '../../common/public-image';
import { withCoverImages } from '../catalog/card-select';
import { FlashSaleService, type EffectivePrice } from '../flash-sale/flash-sale.service';
import { NOT_PILOT_CLEANED_SQL } from '../admin/admin-revenue';
import { RESTOCK_ALERT_ENABLED_KEY } from '../restock-alerts/restock-alerts.service';
import { SystemConfigService } from '../system-config/system-config.service';

export interface PurchasedItem {
  variationId: string;
  productId: string;
  slug: string;
  productName: string;
  variationName: string;
  brand: string;
  thumbnail: string | null;
  price: number;
  salePrice: number | null;
  stock: number;
  inStock: boolean;
  timesBought: number;
  lastPurchasedAt: string;
  /** Hàng chỉ bán lẻ (gian hàng đối tác hoặc do đối tác tự giao): không đặt định kỳ được. Cùng luật isRetailOnly ở trang chi tiết sản phẩm. */
  retailOnly: boolean;
  /**
   * Giá Giờ vàng giỏ sẽ tính cho khách đang xem khi số lượng không vượt `flashAllowance` (đã lấy min với giá đang bán, cùng luật
   * priceFlashLine của giỏ); null = không có suất Giờ vàng mở.
   */
  flashPrice: number | null;
  /** Số suất Giờ vàng khách này còn mua được (0 = đã dùng hết, giỏ tính giá thường); null khi không có suất mở. */
  flashAllowance: number | null;
  /** Khách đang chờ báo hàng về cho phân loại này (đăng ký "Báo khi có" chưa gửi). Chỉ có thể true khi phân loại hết hàng và cờ báo hàng về bật. */
  restockWaiting: boolean;
}
export interface PurchasedItemsPage {
  items: PurchasedItem[];
  nextCursor: string | null;
  /** Cờ catalog.restock_alert_enabled: bật thì món hết hàng trên kệ Mua lại có nút "Báo khi có" (khỏi hỏi thêm một đường nữa). */
  restockAlertsEnabled: boolean;
}
export interface PurchasedItemsOptions {
  cursor?: string;
  limit?: number;
  variationId?: string;
}

interface PurchasedRow {
  variationId: string;
  timesBought: number;
  lastPurchasedAt: Date;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Cursor = base64url("<epoch ms>|<variationId>"). So sánh bằng epoch ms (không phải timestamp)
 * để không phụ thuộc TimeZone của phiên Postgres với cột `timestamp without time zone`. */
export function encodePurchasedCursor(ms: number, variationId: string): string {
  return Buffer.from(`${ms}|${variationId}`, 'utf8').toString('base64url');
}

export function decodePurchasedCursor(cursor: string): { ms: number; variationId: string } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = raw.indexOf('|');
  const ms = Number(raw.slice(0, sep));
  const variationId = raw.slice(sep + 1);
  // variationId đi thẳng vào SQL thô: NUL / ký tự lạ làm Postgres ném lỗi → 500 thay vì 400.
  if (sep <= 0 || !Number.isSafeInteger(ms) || ms < 0 || !VARIATION_ID_RE.test(variationId)) {
    throw new BadRequestException('Con trỏ phân trang không hợp lệ.');
  }
  return { ms, variationId };
}

/**
 * Sản phẩm khách đã mua THÀNH CÔNG, nhóm theo variation — nguồn cho kệ "Mua lại"
 * (spec §3.1). Chỉ dữ liệu của chính user (userId từ JWT). Mua thành công = đơn DELIVERED chưa bị lật hoàn tiền
 * (`paymentStatus` REFUNDED), không phải đơn thử Giờ G đã dọn, và dòng chưa bị trả hết qua yêu cầu trả hàng đã duyệt.
 * Loại variation/SP ngừng bán hoặc chưa duyệt; SP chỉ hết hàng vẫn trả kèm inStock:false. lastPurchasedAt = createdAt của
 * đơn giao gần nhất (cùng định nghĩa với LifecycleService.sendReorderReminders).
 */
@Injectable()
export class PurchasedItemsService {
  constructor(
    private readonly prisma: PrismaService,
    // Optional: không có thì sản phẩm không mang giá Giờ vàng (sheet Mua lại dùng giá đang bán).
    @Optional() private readonly flashSale?: FlashSaleService,
    // Optional: không có thì coi cờ báo hàng về là tắt (món hết hàng giữ chữ "Tạm hết hàng").
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  async list(userId: string, opts: PurchasedItemsOptions = {}): Promise<PurchasedItemsPage> {
    const limit = Math.min(Math.max(Math.floor(opts.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
    const cursor = opts.cursor ? decodePurchasedCursor(opts.cursor) : null;
    const rows = await this.prisma.$queryRaw<PurchasedRow[]>(Prisma.sql`
      SELECT oi."variationId" AS "variationId",
             COUNT(DISTINCT o.id)::int AS "timesBought",
             MAX(o."createdAt") AS "lastPurchasedAt"
      FROM order_items oi
      JOIN orders o ON o.id = oi."orderId"
      JOIN variations v ON v.id = oi."variationId"
      JOIN products p ON p.id = v."productId"
      WHERE o."userId" = ${userId}
        AND o.status::text = 'DELIVERED'
        AND o."paymentStatus"::text <> 'REFUNDED'
        AND ${NOT_PILOT_CLEANED_SQL}
        AND oi."isGift" = false
        AND oi.quantity > COALESCE((
          SELECT SUM(ri.quantity) FROM return_request_items ri
          JOIN return_requests rr ON rr.id = ri."returnRequestId"
          WHERE ri."orderItemId" = oi.id AND rr.status::text = 'APPROVED'
        ), 0)
        AND v."isActive" = true
        AND p."isActive" = true
        AND p."approvalStatus"::text = 'APPROVED'
        ${opts.variationId ? Prisma.sql`AND oi."variationId" = ${opts.variationId}` : Prisma.empty}
      GROUP BY oi."variationId"
      ${
        cursor
          ? Prisma.sql`HAVING (FLOOR(EXTRACT(EPOCH FROM MAX(o."createdAt")) * 1000)::bigint, oi."variationId") < (${cursor.ms}::bigint, ${cursor.variationId})`
          : Prisma.empty
      }
      ORDER BY MAX(o."createdAt") DESC, oi."variationId" DESC
      LIMIT ${limit + 1}`);

    const page = rows.slice(0, limit);
    const restockAlertsEnabled = (await this.config?.get<unknown>(RESTOCK_ALERT_ENABLED_KEY, false)) === true;
    if (page.length === 0) return { items: [], nextCursor: null, restockAlertsEnabled };

    const variations = await this.prisma.variation.findMany({
      where: { id: { in: page.map((r) => r.variationId) } },
      select: {
        id: true,
        name: true,
        retailPrice: true,
        salePrice: true,
        stock: true,
        pancakeId: true,
        product: { select: { id: true, slug: true, name: true, brand: true, thumbnail: true, fulfilment: true, storefrontId: true } },
      },
    });
    // Ảnh đầu chỉ cần cho sản phẩm không có thumbnail (dự phòng) và chỉ đọc phần tử đầu, không kéo cả mảng base64.
    const [covered, offers] = await Promise.all([
      withCoverImages(this.prisma, variations.map((v) => v.product)),
      // Cùng nguồn giá với giỏ: suất còn lại và số suất của chính khách này.
      this.flashSale?.resolveEffective(page.map((r) => r.variationId), new Date(), userId) ?? new Map<string, EffectivePrice>(),
    ]);
    const coverOf = new Map(covered.map((p) => [p.id, p.images]));
    const byId = new Map(variations.map((v) => [v.id, v]));
    const waiting = await this.waitingRestock(userId, restockAlertsEnabled ? variations.filter((v) => v.stock <= 0).map((v) => v.id) : []);
    const items: PurchasedItem[] = [];
    for (const r of page) {
      const v = byId.get(r.variationId);
      if (!v) continue;
      const offer = offers.get(r.variationId);
      items.push({
        variationId: v.id,
        productId: v.product.id,
        slug: v.product.slug,
        productName: v.product.name,
        variationName: v.name,
        brand: v.product.brand,
        thumbnail: publicProductThumb({ id: v.product.id, thumbnail: v.product.thumbnail, images: coverOf.get(v.product.id) }),
        price: v.retailPrice,
        salePrice: v.salePrice,
        stock: exposedStock(Math.max(v.stock, 0)),
        inStock: v.stock > 0,
        timesBought: Number(r.timesBought),
        lastPurchasedAt: new Date(r.lastPurchasedAt).toISOString(),
        retailOnly: !isPancakeFulfilledLine({ pancakeId: v.pancakeId, fulfilment: v.product.fulfilment }) || isPartnerOwnedProduct(v.product),
        flashPrice: offer ? Math.min(offer.flashPrice, v.salePrice ?? v.retailPrice) : null,
        flashAllowance: offer?.allowance ?? null,
        restockWaiting: waiting.has(v.id),
      });
    }
    const last = page[page.length - 1]!;
    return {
      items,
      nextCursor: rows.length > limit ? encodePurchasedCursor(new Date(last.lastPurchasedAt).getTime(), last.variationId) : null,
      restockAlertsEnabled,
    };
  }

  /** Phân loại hết hàng mà khách đang chờ báo hàng về (đăng ký chưa gửi), một câu cho cả trang; không có phân loại nào thì không hỏi. */
  private async waitingRestock(userId: string, variationIds: string[]): Promise<Set<string>> {
    if (variationIds.length === 0) return new Set();
    const rows = await this.prisma.restockAlert.findMany({
      where: { userId, notifiedAt: null, variationId: { in: variationIds } },
      select: { variationId: true },
    });
    return new Set(rows.map((r) => r.variationId));
  }
}
