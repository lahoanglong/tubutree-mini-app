import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { loadRefillPairTable } from '../catalog/refill/refill-pair-table';
import { ECO_BADGES_KEY } from '../eco-impact/eco-facts.rules';
import { canEarnAsReferrer, referrerFirstOrderCount } from './first-order-reward';
import { computeOrderEcoImpact, ecoImpactEligible, type EcoImpactLine } from './order-eco-impact';
import { readViralRules } from './viral-config';

/** `GET /me/eco-impact/orders/:code`: cùng dạng `OrderEcoImpact` ở packages/app-core/src/eco/order-impact.ts. */
export interface OrderEcoImpact {
  orderCode: string;
  /** Chai nhựa dùng một lần khách không phải mua nhờ gói Refill trong đơn (đã trừ trả hàng). */
  bottlesSaved: number;
  /** Nhựa bớt theo sự thật xanh đã duyệt (gram); 0 khi cờ eco.product_badges_enabled tắt. */
  plasticGrams: number;
  refillPacks: number;
  /** Điểm Xanh của đơn, đã trừ phần thu lại khi trả hàng. */
  points: number;
  /** Đơn đã giao (điểm đã vào ví); chưa giao thì điểm cộng khi nhận hàng. */
  pointsCredited: boolean;
  referralCode: string;
  /** Thưởng đơn đầu mỗi bên khi bạn được mời mua; null khi khách không nhận thưởng giới thiệu lúc này hay Admin đặt 0 điểm. */
  inviteReward: { points: number; minOrderAmount: number } | null;
}

const PAIRS_TTL_MS = 60_000;

/**
 * Thẻ tác động xanh của một đơn (tubu-w11-03). Cờ growth.referral_viral_enabled tắt hay đơn không phải của khách: 404. Đơn chưa đủ điều
 * kiện (chưa thanh toán, huỷ, CTV lên hộ) hay không có món Refill/sự thật xanh: số 0, app không vẽ thẻ. Chỉ đọc, không ghi gì.
 */
@Injectable()
export class OrderEcoImpactService {
  // Bảng cặp quét cả danh mục công khai: đệm trong tiến trình như RefillPairsService (module này không kéo CatalogService vào).
  private pairs: { table: Map<string, string>; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async forOrder(userId: string, code: string, now: Date = new Date()): Promise<OrderEcoImpact> {
    const rules = await readViralRules(this.config);
    if (!rules.enabled) throw new NotFoundException('Không tìm thấy.');
    const [order, user] = await Promise.all([
      this.prisma.order.findFirst({
        where: { code, userId },
        select: { id: true, code: true, status: true, paymentStatus: true, type: true, placedForCustomer: true, pointsEarned: true },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true, role: true, isBlocked: true, metadata: true, phone: true, zaloId: true } }),
    ]);
    if (!order || !user) throw new NotFoundException('Không tìm thấy đơn hàng.');
    const empty: OrderEcoImpact = {
      orderCode: order.code,
      bottlesSaved: 0,
      plasticGrams: 0,
      refillPacks: 0,
      points: 0,
      pointsCredited: false,
      referralCode: user.referralCode,
      inviteReward: null,
    };
    if (!ecoImpactEligible(order)) return empty;

    const items = await this.prisma.orderItem.findMany({ where: { orderId: order.id, isGift: false }, select: { id: true, variationId: true, variationName: true, quantity: true } });
    if (items.length === 0) return empty;
    const [returned, reversals, variations, pairs, badgesOn] = await Promise.all([
      // Yêu cầu trả còn chờ duyệt cũng trừ: thẻ không được khoe nhiều hơn hàng khách thật sự giữ (cùng luật Hộ chiếu Xanh).
      this.prisma.returnRequestItem.findMany({
        where: { orderItemId: { in: items.map((i) => i.id) }, returnRequest: { status: { not: 'REJECTED' } } },
        select: { orderItemId: true, quantity: true },
      }),
      this.prisma.returnRequest.findMany({ where: { orderId: order.id, status: 'APPROVED' }, select: { pointsReversed: true } }),
      this.prisma.variation.findMany({ where: { id: { in: [...new Set(items.map((i) => i.variationId))] } }, select: { id: true, productId: true } }),
      this.pairTable(),
      this.config.get<unknown>(ECO_BADGES_KEY, false).then((v) => v === true),
    ]);
    const returnedQty = new Map<string, number>();
    for (const r of returned) returnedQty.set(r.orderItemId, (returnedQty.get(r.orderItemId) ?? 0) + r.quantity);
    const productOf = new Map(variations.map((v) => [v.id, v.productId]));
    const lineProductIds = [...new Set(variations.map((v) => v.productId))];
    const lineSet = new Set(lineProductIds);
    const bottleIds = [...pairs].filter(([, refillId]) => lineSet.has(refillId)).map(([bottleId]) => bottleId);
    const [products, facts] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: [...lineProductIds, ...bottleIds] } }, select: { id: true, slug: true, name: true } }),
      badgesOn
        ? this.prisma.productEcoFact.findMany({
            where: { status: 'APPROVED', kind: 'PLASTIC_AVOIDED', productId: { in: lineProductIds } },
            select: { productId: true, variationId: true, kind: true, valueGrams: true },
          })
        : Promise.resolve([]),
    ]);
    const byId = new Map(products.map((p) => [p.id, p]));
    const lines: EcoImpactLine[] = items.flatMap((i) => {
      const product = byId.get(productOf.get(i.variationId) ?? '');
      if (!product) return [];
      return [
        {
          productId: product.id,
          variationId: i.variationId,
          slug: product.slug,
          name: product.name,
          variationName: i.variationName,
          netQty: i.quantity - (returnedQty.get(i.id) ?? 0),
        },
      ];
    });
    const numbers = computeOrderEcoImpact(lines, { pairs, names: new Map(products.map((p) => [p.id, p.name])), facts });
    if (numbers.bottlesSaved === 0 && numbers.plasticGrams === 0) return empty;

    const earns = rules.points > 0 && canEarnAsReferrer(user) && (await referrerFirstOrderCount(this.prisma, userId, now)) < rules.monthlyCap;
    const reversed = reversals.reduce((sum, r) => sum + Math.max(0, r.pointsReversed), 0);
    return {
      ...empty,
      ...numbers,
      points: Math.max(0, order.pointsEarned - reversed),
      pointsCredited: order.status === 'DELIVERED',
      inviteReward: earns ? { points: rules.points, minOrderAmount: rules.minOrder } : null,
    };
  }

  private async pairTable(): Promise<Map<string, string>> {
    const now = Date.now();
    if (this.pairs && this.pairs.expiresAt > now) return this.pairs.table;
    const table = await loadRefillPairTable(this.prisma, this.config);
    this.pairs = { table, expiresAt: now + PAIRS_TTL_MS };
    return table;
  }
}
