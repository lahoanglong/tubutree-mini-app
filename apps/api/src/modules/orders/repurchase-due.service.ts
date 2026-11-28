import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, type ExternalOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { publicProductThumb } from '../../common/public-image';
import { withCoverImages } from '../catalog/card-select';
import { loadRefillPairTable } from '../catalog/refill/refill-pair-table';
import { NOT_PILOT_CLEANED_SQL } from '../admin/admin-revenue';
import { FlashSaleService } from '../flash-sale/flash-sale.service';
import { SystemConfigService } from '../system-config/system-config.service';
import {
  cadenceFor,
  newerScanResetsCycle,
  pickRepurchaseDue,
  repurchaseDueWindow,
  REPURCHASE_DUE_GATE_KEYS,
  scanAnchorDays,
  scanAnchorFrom,
  type RepurchaseCandidateLine,
} from './repurchase-due.rules';

/** Đơn sàn đã trả, đang trả, huỷ hay xoá: khách không giữ hàng nên không là mốc mua. */
const DEAD_EXTERNAL_ORDER_STATUSES: ExternalOrderStatus[] = ['RETURNING', 'RETURNED', 'CANCELLED', 'DELETED'];

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
  /**
   * Chỉ khi `item` là null (w55-01): số ngày lịch VN từ lúc đơn sàn đã quét gần nhất giao xong, trong chu kỳ Refill mặc định, khách chưa đặt gì từ đó. Đơn sàn
   * không có dòng sản phẩm nên máy chủ không chọn món; máy khách ghép gói Refill đầu trang Tiết kiệm với Refill.
   */
  scanDays?: number;
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
 * Thẻ "Mua lại" hàng tiêu hao (w36-01, w55-01). Hiện khi cờ `retention.repurchase_due_card_enabled` HOẶC `retention.refill_21d_reminder_enabled` bật (đều mặc
 * định tắt). Không gửi tin nào và không đọc cờ ZNS: tin "Nhắc mua lại" và nhắc Refill 21 ngày đã có. Chu kỳ theo nhóm hàng (`cadenceFor`). Luôn trả 200; cờ tắt,
 * không có món hay lỗi đọc đều là `{ item: null }`; không có món mà đơn sàn đã quét gần nhất tới chu kỳ thì thêm `scanDays`.
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
    if (!(await this.gateOn())) return NONE;
    try {
      const item = await this.find(userId, now);
      if (item) return { item };
      const scanDays = await this.scanAnchor(userId, now);
      return scanDays === null ? NONE : { item: null, scanDays };
    } catch (err) {
      this.logger.warn(`Không đọc được thẻ mua lại (user=${userId}): ${err instanceof Error ? err.message : String(err)}`);
      return NONE;
    }
  }

  /** Cờ thẻ hoặc cờ nhắc Refill 21 ngày bật thì hiện thẻ. Cờ ZNS không đọc ở đây: thẻ không gửi tin nào. */
  private async gateOn(): Promise<boolean> {
    for (const key of REPURCHASE_DUE_GATE_KEYS) {
      if ((await this.config.get<unknown>(key, false)) === true) return true;
    }
    return false;
  }

  /**
   * Mốc theo đơn sàn đã quét (w55-01): đơn SCAN còn hiệu lực (chờ cộng hay đã cộng) giao xong gần nhất trong chu kỳ Refill mặc định, và khách chưa đặt đơn nào
   * (chưa huỷ) từ lúc đó. Chỉ đọc; đơn sàn không có dòng sản phẩm nên không chọn được món.
   */
  private async scanAnchor(userId: string, now: Date): Promise<number | null> {
    const claims = await this.prisma.externalPointsClaim.findMany({
      where: {
        userId,
        kind: 'SCAN',
        state: { in: ['PENDING', 'CREDITED'] },
        externalOrder: { status: { notIn: DEAD_EXTERNAL_ORDER_STATUSES }, deliveredAt: { gte: scanAnchorFrom(now), lte: now } },
      },
      select: { externalOrder: { select: { deliveredAt: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const deliveredAts = claims.map((c) => c.externalOrder.deliveredAt);
    const days = scanAnchorDays(deliveredAts, now);
    if (days === null) return null;
    const latest = new Date(Math.max(...deliveredAts.filter((d): d is Date => d !== null).map((d) => d.getTime())));
    const since = await this.prisma.order.findFirst({ where: { userId, createdAt: { gt: latest }, status: { in: [...REORDER_STATUSES] } }, select: { id: true } });
    return since ? null : days;
  }

  /** Đơn sàn còn hiệu lực giao gần nhất trong 22 ngày qua (đủ để biết có chu kỳ mới trong nhịp 21 ngày); null khi không có. */
  private async latestScanDelivery(userId: string, now: Date): Promise<Date | null> {
    const claim = await this.prisma.externalPointsClaim.findFirst({
      where: {
        userId,
        kind: 'SCAN',
        state: { in: ['PENDING', 'CREDITED'] },
        externalOrder: { status: { notIn: DEAD_EXTERNAL_ORDER_STATUSES }, deliveredAt: { gte: new Date(now.getTime() - 22 * 864e5), lte: now } },
      },
      orderBy: { externalOrder: { deliveredAt: 'desc' } },
      select: { externalOrder: { select: { deliveredAt: true } } },
    });
    return claim?.externalOrder.deliveredAt ?? null;
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
    if (rows.length === 0) return null;
    // Cặp Refill đọc trước khi lọc: chai có cặp là hàng tiêu hao dù tên không khớp từ khoá nhóm (`cadenceFor`).
    const pairs = await loadRefillPairTable(this.prisma, this.config);
    const lines: RepurchaseCandidateLine[] = rows
      .filter((r) => cadenceFor(r.productName, pairs.has(r.productId)) !== null)
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

    // Đơn sàn mới giao sau đơn trực tiếp và chưa tới nhịp là chu kỳ mới: đọc một lần, chỉ khi đã có món để mời.
    let latestScan: Date | null | undefined;
    for (const pick of picks) {
      latestScan ??= await this.latestScanDelivery(userId, now);
      if (newerScanResetsCycle(latestScan, pick.line.deliveredAt, now)) continue;
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
