import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type WasteGiftKind } from '@prisma/client';
import { startOfVnDay } from '../../../common/vn-time';
import { PrismaService } from '../../../prisma/prisma.service';
import { writeWasteEvent } from '../core/waste-events';

export interface PendingGiftRedemption {
  id: string;
  code: string | null;
  giftName: string;
  kind: 'GIFT' | 'SEED_PACK';
  pointsCost: number;
}

const ATTACHABLE_KINDS: readonly WasteGiftKind[] = ['GIFT', 'SEED_PACK'];
const SELECT = { id: true, code: true, giftName: true, giftKind: true, pointsCost: true } as const;
const RECONCILE_PAGE = 500;

type PendingRow = { id: string; code: string | null; giftName: string; giftKind: WasteGiftKind; pointsCost: number };

const toPending = (r: PendingRow): PendingGiftRedemption => ({
  id: r.id,
  code: r.code,
  giftName: r.giftName,
  kind: r.giftKind === 'SEED_PACK' ? 'SEED_PACK' : 'GIFT',
  pointsCost: r.pointsCost,
});

/** Còn trong hạn nhận: cùng quy ước ngày VN với cron huỷ quà quá hạn và quầy trao quà. */
const claimOpenWhere = (now: Date): Prisma.WasteGiftRedemptionWhereInput => ({
  OR: [{ claimExpiresAt: null }, { claimExpiresAt: { gte: startOfVnDay(now) } }],
});

/**
 * Quà hiện vật (READY) đi kèm đơn mua kế tiếp của khách với giá 0đ. attachedOrderId khác null nghĩa là quà đang nằm trong một đơn chưa
 * chốt: không hiện lại cho đơn khác, cron huỷ quá hạn không đụng tới. Đơn giao thành công thì quà thành FULFILLED; đơn huỷ/trả thì nhả
 * gắn để quà hiện lại, vẫn READY.
 */
@Injectable()
export class WasteGiftAttachService {
  private readonly logger = new Logger(WasteGiftAttachService.name);

  constructor(private readonly prisma: PrismaService) {}

  listPending(userId: string, db: Prisma.TransactionClient = this.prisma): Promise<PendingGiftRedemption[]> {
    return db.wasteGiftRedemption
      .findMany({
        where: { userId, status: 'READY', giftKind: { in: [...ATTACHABLE_KINDS] }, attachedOrderId: null, ...claimOpenWhere(new Date()) },
        select: SELECT,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      .then((rows) => rows.map(toPending));
  }

  /**
   * Chạy trong transaction của placeOrder. Khoá hàng trước (FOR UPDATE, theo id để hai đơn cùng lúc không khoá chéo) rồi mới gắn, nên một
   * quà không bao giờ gắn vào hai đơn. Id sai chủ, đã gắn, đã trao/huỷ hay quá hạn bị bỏ qua, không ném lỗi: đơn vẫn đặt được, chỉ thiếu quà đó.
   */
  async attachInTx(tx: Prisma.TransactionClient, userId: string, ids: string[], orderId: string): Promise<PendingGiftRedemption[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const now = new Date();
    const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "waste_gift_redemptions"
      WHERE "userId" = ${userId}
        AND "id" IN (${Prisma.join(unique)})
        AND "status" = 'READY'
        AND "attachedOrderId" IS NULL
        AND "giftKind" IN ('GIFT', 'SEED_PACK')
        AND ("claimExpiresAt" IS NULL OR "claimExpiresAt" >= ${startOfVnDay(now)})
      ORDER BY "id"
      FOR UPDATE`);
    const lockedIds = locked.map((r) => r.id);
    if (lockedIds.length === 0) return [];
    await tx.wasteGiftRedemption.updateMany({
      where: { id: { in: lockedIds }, userId, status: 'READY', attachedOrderId: null },
      data: { attachedOrderId: orderId },
    });
    const rows = await tx.wasteGiftRedemption.findMany({
      where: { id: { in: lockedIds }, attachedOrderId: orderId },
      select: SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toPending);
  }

  /** Đơn DELIVERED: quà đang gắn đơn đó thành FULFILLED. Chạy lại không đổi gì vì chỉ chạm hàng còn READY. */
  onOrderDelivered(orderId: string): Promise<number> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.wasteGiftRedemption.findMany({
        where: { attachedOrderId: orderId, status: 'READY', attachedOrder: { is: { status: 'DELIVERED' } } },
        select: { id: true, giftId: true, userId: true },
        orderBy: { id: 'asc' },
      });
      let fulfilled = 0;
      for (const row of rows) {
        const { count } = await tx.wasteGiftRedemption.updateMany({
          where: { id: row.id, status: 'READY', attachedOrderId: orderId },
          data: { status: 'FULFILLED', fulfilledAt: now },
        });
        if (count !== 1) continue;
        fulfilled += 1;
        await writeWasteEvent(tx, {
          kind: 'GIFT_FULFILLED',
          actorUserId: null,
          actorRole: 'SYSTEM',
          giftRedemptionId: row.id,
          meta: { giftId: row.giftId, subjectUserId: row.userId, orderId, via: 'ORDER_DELIVERED', before: { status: 'READY' }, after: { status: 'FULFILLED' } },
        });
      }
      return fulfilled;
    });
  }

  /** Đơn CANCELLED/RETURNED: bỏ gắn đơn, quà vẫn READY nên tự hiện lại cho đơn kế tiếp. Chạy lại không đổi gì. */
  async onOrderReleased(orderId: string): Promise<number> {
    const { count } = await this.prisma.wasteGiftRedemption.updateMany({
      where: { attachedOrderId: orderId, status: 'READY', attachedOrder: { is: { status: { in: ['CANCELLED', 'RETURNED'] } } } },
      data: { attachedOrderId: null },
    });
    return count;
  }

  /**
   * Quét bù cho hook sau đổi trạng thái đơn bị lỗi (hook nuốt lỗi để không làm hỏng việc đổi trạng thái): quà READY còn gắn một đơn
   * đã chốt thì xử lý theo trạng thái đơn, không thì quà kẹt mãi, vừa không hiện lại vừa không bị cron huỷ quá hạn.
   */
  async reconcile(): Promise<{ fulfilled: number; released: number }> {
    const rows = await this.prisma.wasteGiftRedemption.findMany({
      where: { status: 'READY', attachedOrderId: { not: null }, attachedOrder: { is: { status: { in: ['DELIVERED', 'CANCELLED', 'RETURNED'] } } } },
      select: { attachedOrderId: true, attachedOrder: { select: { status: true } } },
      orderBy: { id: 'asc' },
      take: RECONCILE_PAGE,
    });
    const delivered = new Set<string>();
    const closed = new Set<string>();
    for (const r of rows) {
      if (!r.attachedOrderId || !r.attachedOrder) continue;
      (r.attachedOrder.status === 'DELIVERED' ? delivered : closed).add(r.attachedOrderId);
    }
    let fulfilled = 0;
    let released = 0;
    for (const orderId of delivered) {
      try { fulfilled += await this.onOrderDelivered(orderId); } catch (err) { this.logger.error(`Quét bù quà giao kèm đơn ${orderId} lỗi: ${err instanceof Error ? err.message : err}`); }
    }
    for (const orderId of closed) {
      try { released += await this.onOrderReleased(orderId); } catch (err) { this.logger.error(`Quét bù nhả quà khỏi đơn ${orderId} lỗi: ${err instanceof Error ? err.message : err}`); }
    }
    return { fulfilled, released };
  }
}
