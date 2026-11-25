import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { publicProductThumb } from '../../common/public-image';
import { withCoverImages } from '../catalog/card-select';
import { loadRefillPairTable } from '../catalog/refill/refill-pair-table';
import { NOT_PILOT_CLEANED_SQL } from '../admin/admin-revenue';
import { FlashSaleService } from '../flash-sale/flash-sale.service';
import { SystemConfigService } from '../system-config/system-config.service';
import {
  isConsumableName,
  pickRepurchaseDue,
  repurchaseDueWindow,
  REPURCHASE_DUE_CARD_ENABLED_KEY,
  type RepurchaseCandidateLine,
} from './repurchase-due.rules';

/** Món gợi ý mua lại trên thẻ ở Tài khoản và giỏ trống. */
export interface RepurchaseDueItem {
  /** `orderId:variationId`: khoá ẩn thẻ 14 ngày ở máy khách. */
  key: string;
  /** Số ngày lịch VN từ lúc khách nhận đơn. */
  days: number;
  /** Tên sản phẩm khách đã nhận. */
  boughtName: string;
  /** `refill`: gói Refill ghép cặp của chai đã mua; `same`: đúng phân loại đã mua. */
  kind: 'refill' | 'same';
  variationId: string;
  productId: string;
  slug: string;
  productName: string;
  variationName: string;
  thumbnail: string | null;
  /** Giá giỏ sẽ tính cho 1 món (đã xét giá khuyến mãi và suất Giờ vàng còn lại của khách). */
  price: number;
  /** Giá niêm yết. */
  listPrice: number;
}

export interface RepurchaseDueResponse {
  item: RepurchaseDueItem | null;
}

interface CandidateRow {
  orderId: string;
  orderCreatedAt: Date;
  deliveredAt: Date;
  variationId: string;
  productId: string;
  productName: string;
  storefrontId: string | null;
  quantity: number;
  returnedQty: number;
}

const OFFER_SELECT = {
  id: true,
  name: true,
  retailPrice: true,
  salePrice: true,
  product: { select: { id: true, slug: true, name: true, thumbnail: true } },
} as const satisfies Prisma.VariationSelect;
type OfferVariation = Prisma.VariationGetPayload<{ select: typeof OFFER_SELECT }>;

/** Bán được, còn hàng, hàng Tubu (không phải gian hàng đối tác). */
const OFFERABLE_WHERE = {
  isActive: true,
  stock: { gt: 0 },
  product: { isActive: true, approvalStatus: 'APPROVED', storefrontId: null },
} as const satisfies Prisma.VariationWhereInput;

/** Đơn đặt lại tính là "đã mua lại" (chưa huỷ, chưa trả). */
const REORDER_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'] as const;
const CANDIDATE_LIMIT = 100;
const NONE: RepurchaseDueResponse = { item: null };

/**
 * Thẻ "Mua lại" hàng tiêu hao (w36-01, cờ `retention.repurchase_due_card_enabled`, mặc định tắt). Không gửi tin nào: tin "Nhắc mua lại"
 * và nhắc Refill 21 ngày đã có. Luôn trả 200; cờ tắt, không có món hay lỗi đọc đều là `{ item: null }`.
 */
@Injectable()
export class RepurchaseDueService {
  private readonly logger = new Logger(RepurchaseDueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    // Optional: không có thì giá là giá đang bán, không xét Giờ vàng.
    @Optional() private readonly flashSale?: FlashSaleService,
  ) {}

  async forUser(userId: string, now: Date = new Date()): Promise<RepurchaseDueResponse> {
    if ((await this.config.get<unknown>(REPURCHASE_DUE_CARD_ENABLED_KEY, false)) !== true) return NONE;
    try {
      return { item: await this.find(userId, now) };
    } catch (err) {
      this.logger.warn(`Không đọc được thẻ mua lại (user=${userId}): ${err instanceof Error ? err.message : String(err)}`);
      return NONE;
    }
  }

  private async find(userId: string, now: Date): Promise<RepurchaseDueItem | null> {
    const w = repurchaseDueWindow(now);
    // Chặn dưới createdAt để đi qua index (userId, createdAt): đơn giao trong cửa sổ không thể đặt trước đó quá 60 ngày.
    const createdFloor = new Date(w.deliveredFrom.getTime() - 60 * 864e5);
    const rows = await this.prisma.$queryRaw<CandidateRow[]>`
      SELECT o.id AS "orderId", o."createdAt" AS "orderCreatedAt", o."deliveredAt" AS "deliveredAt",
             oi."variationId" AS "variationId", v."productId" AS "productId", p.name AS "productName",
             p."storefrontId" AS "storefrontId", oi.quantity AS quantity,
             COALESCE((
               SELECT SUM(ri.quantity) FROM return_request_items ri
                 JOIN return_requests rr ON rr.id = ri."returnRequestId"
                WHERE ri."orderItemId" = oi.id AND rr.status::text <> 'REJECTED'
             ), 0)::int AS "returnedQty"
        FROM orders o
        JOIN order_items oi ON oi."orderId" = o.id
        JOIN variations v ON v.id = oi."variationId"
        JOIN products p ON p.id = v."productId"
       WHERE o."userId" = ${userId}
         AND o.status::text = 'DELIVERED'
         AND o.type::text = 'RETAIL'
         AND o."placedForCustomer" = false
         AND o."paymentStatus"::text <> 'REFUNDED'
         AND ${NOT_PILOT_CLEANED_SQL}
         AND o."createdAt" >= ${createdFloor}
         AND o."deliveredAt" IS NOT NULL AND o."deliveredAt" >= ${w.deliveredFrom} AND o."deliveredAt" <= ${w.deliveredTo}
         AND oi."isGift" = false
       ORDER BY o."deliveredAt" ASC, oi.id ASC
       LIMIT ${CANDIDATE_LIMIT}`;
    const lines: RepurchaseCandidateLine[] = rows
      .filter((r) => isConsumableName(r.productName))
      .map((r) => ({
        orderId: r.orderId,
        orderCreatedAt: new Date(r.orderCreatedAt),
        deliveredAt: new Date(r.deliveredAt),
        variationId: r.variationId,
        productId: r.productId,
        productName: r.productName,
        quantity: Number(r.quantity),
        returnedQty: Number(r.returnedQty),
        partnerOwned: r.storefrontId != null,
      }));
    if (lines.length === 0) return null;

    const pairs = await loadRefillPairTable(this.prisma, this.config);
    const related = [...new Set(lines.flatMap((l) => [l.productId, pairs.get(l.productId)].filter((id): id is string => !!id)))];
    const earliest = new Date(Math.min(...lines.map((l) => l.orderCreatedAt.getTime())));
    const [reordered, subs] = await Promise.all([
      this.prisma.$queryRaw<{ productId: string; lastAt: Date }[]>`
        SELECT v."productId" AS "productId", MAX(o2."createdAt") AS "lastAt"
          FROM order_items oi
          JOIN orders o2 ON o2.id = oi."orderId"
          JOIN variations v ON v.id = oi."variationId"
         WHERE o2."userId" = ${userId}
           AND o2."createdAt" > ${earliest}
           AND o2.status::text IN (${Prisma.join([...REORDER_STATUSES])})
           AND v."productId" IN (${Prisma.join(related)})
         GROUP BY v."productId"`,
      this.prisma.subscription.findMany({
        // Gói tạm dừng vẫn là gói của khách: mời mua lẻ lúc đó là lặp.
        where: { userId, status: { in: ['ACTIVE', 'PAUSED'] }, variation: { productId: { in: related } } },
        select: { variation: { select: { productId: true } } },
      }),
    ]);
    const picks = pickRepurchaseDue({
      lines,
      now,
      pairs,
      reorderedAt: new Map(reordered.map((r) => [r.productId, new Date(r.lastAt)])),
      subscribedProductIds: new Set(subs.map((s) => s.variation.productId)),
    });

    for (const pick of picks) {
      const refillId = pairs.get(pick.line.productId);
      const refill = refillId
        ? await this.prisma.variation.findFirst({ where: { productId: refillId, ...OFFERABLE_WHERE }, orderBy: [{ retailPrice: 'asc' }, { id: 'asc' }], select: OFFER_SELECT })
        : null;
      const offer = refill ?? (await this.prisma.variation.findFirst({ where: { id: pick.line.variationId, ...OFFERABLE_WHERE }, select: OFFER_SELECT }));
      if (!offer) continue;
      // Món đã nằm trong giỏ thì thẻ chỉ lặp lại cái khách đã có.
      const inCart = await this.prisma.cartItem.findFirst({ where: { cart: { userId }, variationId: offer.id }, select: { id: true } });
      if (inCart) continue;
      return this.toItem(userId, pick.line, pick.days, refill ? 'refill' : 'same', offer, now);
    }
    return null;
  }

  private async toItem(
    userId: string,
    line: RepurchaseCandidateLine,
    days: number,
    kind: 'refill' | 'same',
    v: OfferVariation,
    now: Date,
  ): Promise<RepurchaseDueItem> {
    const [covered, offers] = await Promise.all([
      withCoverImages(this.prisma, [v.product]),
      this.flashSale?.resolveEffective([v.id], now, userId) ?? Promise.resolve(new Map()),
    ]);
    const base = v.salePrice ?? v.retailPrice;
    const flash = offers.get(v.id);
    // Cùng luật giỏ (priceFlashLine): còn suất của chính khách thì giá Giờ vàng, không lớn hơn giá đang bán.
    const price = flash && (flash.allowance ?? 0) > 0 ? Math.min(flash.flashPrice, base) : base;
    return {
      key: `${line.orderId}:${v.id}`,
      days,
      boughtName: line.productName,
      kind,
      variationId: v.id,
      productId: v.product.id,
      slug: v.product.slug,
      productName: v.product.name,
      variationName: v.name,
      thumbnail: publicProductThumb({ id: v.product.id, thumbnail: v.product.thumbnail, images: covered[0]?.images }),
      price,
      listPrice: v.retailPrice,
    };
  }
}
