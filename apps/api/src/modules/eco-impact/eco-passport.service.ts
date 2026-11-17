import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EcoFactsReader } from './eco-facts.reader';
import { computePassport, type EcoPassport, type PassportInput } from './eco-passport.compute';

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_KEYS = 2_000;

/**
 * Hộ chiếu Xanh của khách đang đăng nhập (`GET /me/eco-passport`). Tính lúc đọc từ đơn đã giao, Đổi rác đã xong và cây đã cam kết; không có
 * bảng số dư, không ghi gì, không phát điểm hay huy hiệu. Mọi truy vấn lọc theo `userId` của phiên.
 */
@Injectable()
export class EcoPassportService {
  // Đệm trong tiến trình theo khách: mỗi bản API có đệm riêng, số lệch tối đa CACHE_TTL_MS; có trần số khoá.
  private readonly cache = new Map<string, { value: EcoPassport; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly facts: EcoFactsReader,
  ) {}

  async passport(userId: string, now: Date = new Date()): Promise<EcoPassport> {
    if (!(await this.facts.passportOn())) throw new NotFoundException('Không tìm thấy.');
    const hit = this.cache.get(userId);
    if (hit && hit.expiresAt > now.getTime()) return hit.value;
    const value = computePassport(await this.load(userId), now);
    this.cache.delete(userId);
    if (this.cache.size >= CACHE_MAX_KEYS) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(userId, { value, expiresAt: now.getTime() + CACHE_TTL_MS });
    return value;
  }

  private async load(userId: string): Promise<PassportInput> {
    // Chỉ đơn lẻ khách tự mua: đơn CTV đặt hộ khách (`placedForCustomer`, userId là CTV) và đơn đại lý là hàng của người khác.
    const ownDelivered = { userId, status: 'DELIVERED', type: 'RETAIL', placedForCustomer: false } as const;
    const [orderItems, firstOrder, waste, trees] = await Promise.all([
      this.prisma.orderItem.findMany({
        where: { order: ownDelivered },
        select: { id: true, variationId: true, quantity: true, order: { select: { id: true, deliveredAt: true, createdAt: true } } },
      }),
      this.prisma.order.findFirst({
        where: ownDelivered,
        orderBy: [{ deliveredAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        select: { deliveredAt: true, createdAt: true },
      }),
      this.prisma.wasteRequest.findMany({
        where: { userId, status: 'COMPLETED' },
        select: { completedAt: true, createdAt: true, lines: { select: { receivedQty: true, gramsPerUnit: true } } },
      }),
      this.prisma.plantedTree.findMany({ where: { userId }, select: { status: true, pledgedAt: true } }),
    ]);

    const itemIds = orderItems.map((i) => i.id);
    const variationIds = [...new Set(orderItems.map((i) => i.variationId))];
    const [returned, variations] = await Promise.all([
      // Yêu cầu trả còn chờ duyệt cũng trừ: số trên hộ chiếu không được cao hơn hàng khách thật sự giữ.
      itemIds.length
        ? this.prisma.returnRequestItem.findMany({
            where: { orderItemId: { in: itemIds }, returnRequest: { userId, status: { not: 'REJECTED' } } },
            select: { orderItemId: true, quantity: true },
          })
        : Promise.resolve([]),
      variationIds.length ? this.prisma.variation.findMany({ where: { id: { in: variationIds } }, select: { id: true, productId: true } }) : Promise.resolve([]),
    ]);
    const returnedQty = new Map<string, number>();
    for (const r of returned) returnedQty.set(r.orderItemId, (returnedQty.get(r.orderItemId) ?? 0) + r.quantity);
    const productOf = new Map(variations.map((v) => [v.id, v.productId]));
    const productIds = [...new Set(variations.map((v) => v.productId))];
    const facts = productIds.length
      ? await this.prisma.productEcoFact.findMany({
          where: { status: 'APPROVED', productId: { in: productIds } },
          select: { productId: true, variationId: true, kind: true, valueGrams: true, co2Grams: true },
        })
      : [];

    return {
      items: orderItems.flatMap((i) => {
        const productId = productOf.get(i.variationId);
        if (!productId) return [];
        return [{ orderId: i.order.id, productId, variationId: i.variationId, netQty: i.quantity - (returnedQty.get(i.id) ?? 0), at: i.order.deliveredAt ?? i.order.createdAt }];
      }),
      firstDeliveredAt: firstOrder ? (firstOrder.deliveredAt ?? firstOrder.createdAt) : null,
      facts,
      waste: waste.map((w) => ({ at: w.completedAt ?? w.createdAt, lines: w.lines })),
      trees: trees.map((t) => ({ at: t.pledgedAt, planted: t.status === 'PLANTED' })),
    };
  }
}
