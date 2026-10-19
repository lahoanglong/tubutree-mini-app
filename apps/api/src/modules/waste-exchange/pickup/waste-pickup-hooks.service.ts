import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteConfigService } from '../core/waste-config.service';
import { WasteNotifierService } from '../core/waste-notifier.service';
import { writeWasteEvent } from '../core/waste-events';

export type WastePickupHookOutcome = 'APPLIED' | 'SKIPPED' | 'ANOMALY' | 'NO_REQUEST';

type AttachedRequest = { id: string; code: string; userId: string; status: string };

const DAY_MS = 86_400_000;

@Injectable()
export class WastePickupHooks {
  private readonly logger = new Logger(WastePickupHooks.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WasteConfigService,
    private readonly notifier: WasteNotifierService,
  ) {}

  async onOrderDelivered(orderId: string): Promise<void> {
    try {
      await this.applyOrderDelivered(orderId);
    } catch (err) {
      this.logger.error(`Hook thu kèm rác lỗi cho đơn ${orderId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  async onOrderCancelled(orderId: string): Promise<void> {
    try {
      await this.applyOrderCancelled(orderId);
    } catch (err) {
      this.logger.error(`Hook thu kèm rác lỗi cho đơn ${orderId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  async applyOrderDelivered(orderId: string): Promise<WastePickupHookOutcome> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { status: true, deliveredAt: true } });
    if (!order || (order.status !== 'DELIVERED' && order.status !== 'RETURNED') || !order.deliveredAt) return 'SKIPPED';
    const req = await this.findRequest(orderId);
    if (!req) return 'NO_REQUEST';
    const expiresAt = new Date(order.deliveredAt.getTime() + (await this.config.snapshot()).pickupWaitDays * DAY_MS);
    const applied = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.wasteRequest.updateMany({
        where: { id: req.id, orderId, method: 'PICKUP', status: 'OPEN' },
        data: { status: 'IN_TRANSIT', inTransitAt: new Date(), expiresAt },
      });
      if (count !== 1) return false;
      await writeWasteEvent(tx, {
        kind: 'PICKUP_STARTED',
        actorUserId: null,
        actorRole: 'SYSTEM',
        requestId: req.id,
        meta: { orderId, expiresAt: expiresAt.toISOString(), before: { status: 'OPEN' }, after: { status: 'IN_TRANSIT' } },
      });
      return true;
    });
    if (applied) {
      await this.notifier.pickupStarted(req.userId, { id: req.id, code: req.code }, expiresAt);
      return 'APPLIED';
    }
    // EXPIRED next to a delivered order is not a contradiction (§12.2 step 3); only CANCELLED is.
    return this.settleMiss(req.id, orderId, order.status, (status) => status === 'CANCELLED');
  }

  async applyOrderCancelled(orderId: string): Promise<WastePickupHookOutcome> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { status: true, deliveredAt: true } });
    if (!order || order.status !== 'CANCELLED') return 'SKIPPED';
    const req = await this.findRequest(orderId);
    if (!req) return 'NO_REQUEST';
    const applied = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.wasteRequest.updateMany({
        where: { id: req.id, orderId, status: 'OPEN' },
        data: { status: 'CANCELLED', closeReason: 'ORDER_CANCELLED', closedAt: new Date() },
      });
      if (count !== 1) return false;
      await writeWasteEvent(tx, {
        kind: 'PICKUP_ORDER_CANCELLED',
        actorUserId: null,
        actorRole: 'SYSTEM',
        requestId: req.id,
        meta: { orderId, before: { status: 'OPEN' }, after: { status: 'CANCELLED', closeReason: 'ORDER_CANCELLED' } },
      });
      return true;
    });
    if (applied) {
      await this.notifier.pickupCancelled(req.userId, { id: req.id, code: req.code });
      return 'APPLIED';
    }
    return this.settleMiss(req.id, orderId, order.status, (status) => status !== 'CANCELLED');
  }

  private findRequest(orderId: string): Promise<AttachedRequest | null> {
    return this.prisma.wasteRequest.findUnique({ where: { orderId }, select: { id: true, code: true, userId: true, status: true } });
  }

  private async settleMiss(
    requestId: string,
    orderId: string,
    orderStatus: string,
    isAnomaly: (requestStatus: string) => boolean,
  ): Promise<WastePickupHookOutcome> {
    const now = await this.prisma.wasteRequest.findUnique({ where: { id: requestId }, select: { status: true } });
    if (!now || !isAnomaly(now.status)) return 'SKIPPED';
    // The anomaly changes nothing, so before equals after.
    const state = { requestStatus: now.status, orderStatus };
    await writeWasteEvent(this.prisma, {
      kind: 'HOOK_ANOMALY',
      actorUserId: null,
      actorRole: 'SYSTEM',
      requestId,
      meta: { orderId, before: state, after: { ...state } },
    });
    return 'ANOMALY';
  }
}
