import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma, WasteCloseReason, WasteMethod, WasteRequestStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import { QUEUE_GOMDON_PUSH } from '../../../jobs/queues';
import { PrismaService } from '../../../prisma/prisma.service';
import { enqueueGomdonWasteCancel } from '../../integrations/gomdon/gomdon-queue';
import { closeHomePickupRequest } from '../home-pickup/waste-home-pickup-ledger';
import { WasteConfigService, type WasteConfigSnapshot } from './waste-config.service';
import { writeWasteEvent } from './waste-events';
import { WasteNotifierService } from './waste-notifier.service';

type ShipLockResult = { locked: boolean; shipLockedAt: Date | null; cancelledRequestIds: string[] };

/** Ba đường hàng gửi về kho: bưu điện, shipper của đơn mua, shipper tới tận nhà lấy. */
export const SHIP_LOCK_METHODS: readonly WasteMethod[] = ['MAIL_IN', 'PICKUP', 'HOME_PICKUP'];

export interface ShipLockRow {
  status: WasteRequestStatus;
  closeReason: WasteCloseReason | null;
  pointsAwarded: number | null;
  estimatedPoints: number;
}

/** Một lần hụt: kho từ chối, thu hồi, hết hạn không giao, hoặc điểm kho cộng thấp hơn ngưỡng so với ước tính. */
export function isShipLockStrike(row: ShipLockRow, shortfallPct: number): boolean {
  if (row.status === 'REJECTED' || row.status === 'REVERSED' || row.status === 'EXPIRED') return true;
  return (row.pointsAwarded ?? 0) * 100 < row.estimatedPoints * (100 - shortfallPct);
}

/** `rowsNewestFirst` là `streak` phiếu đã đóng gần nhất: khoá khi đủ `streak` phiếu và phiếu nào cũng là một lần hụt (một phiếu thành công chen giữa thì chuỗi đứt). */
export function shipLockStreakReached(rowsNewestFirst: readonly ShipLockRow[], shortfallPct: number, streak: number): boolean {
  return streak > 0 && rowsNewestFirst.length === streak && rowsNewestFirst.every((r) => isShipLockStrike(r, shortfallPct));
}

@Injectable()
export class WasteShipLockService {
  private readonly logger = new Logger(WasteShipLockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: WasteNotifierService,
    @Optional() private readonly config?: WasteConfigService,
    @Optional() @InjectQueue(QUEUE_GOMDON_PUSH) private readonly gomdonQueue?: Queue,
  ) {}

  async shouldLock(db: Prisma.TransactionClient, userId: string, pct: number, streak: number): Promise<boolean> {
    if (streak <= 0) return false;
    const flags = await db.wasteUserFlags.findUnique({ where: { userId }, select: { shipUnlockedAt: true } });
    const rows = await db.wasteRequest.findMany({
      where: {
        userId,
        method: { in: [...SHIP_LOCK_METHODS] },
        OR: [{ status: { in: ['COMPLETED', 'REVERSED', 'REJECTED'] } }, { status: 'EXPIRED', closeReason: 'PICKUP_NO_SHOW' }],
        // Phiếu chưa có closedAt không tính; sau lần mở khoá chỉ tính phiếu đóng sau mốc đó.
        closedAt: flags?.shipUnlockedAt ? { gt: flags.shipUnlockedAt } : { not: null },
      },
      select: { status: true, closeReason: true, pointsAwarded: true, estimatedPoints: true },
      orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
      take: streak,
    });
    return shipLockStreakReached(rows, pct, streak);
  }

  // Post-commit only (registry 4.12 item 16): step 1 and step 2 are separate on purpose, spec 15.6.
  async evaluateAndLock(userId: string, cfg: Pick<WasteConfigSnapshot, 'shortfallLockPct' | 'shortfallLockStreak'>): Promise<ShipLockResult> {
    const notLocked: ShipLockResult = { locked: false, shipLockedAt: null, cancelledRequestIds: [] };
    if (!(await this.shouldLock(this.prisma, userId, cfg.shortfallLockPct, cfg.shortfallLockStreak))) return notLocked;

    const at = await this.prisma.$transaction(async (tx) => {
      await tx.wasteUserFlags.createMany({ data: [{ userId }], skipDuplicates: true });
      await tx.$queryRaw`SELECT 1 FROM waste_user_flags WHERE "userId" = ${userId} FOR UPDATE`;
      // An admin unlock committed after the first evaluation moves shipUnlockedAt (spec 15.6 "Mở khoá").
      if (!(await this.shouldLock(tx, userId, cfg.shortfallLockPct, cfg.shortfallLockStreak))) return null;
      const lockedAt = new Date();
      const { count } = await tx.wasteUserFlags.updateMany({ where: { userId, shipLockedAt: null }, data: { shipLockedAt: lockedAt } });
      if (count !== 1) return null;
      await writeWasteEvent(tx, {
        kind: 'SHIP_LOCKED',
        actorUserId: null,
        actorRole: 'SYSTEM',
        meta: { subjectUserId: userId, before: { shipLockedAt: null }, after: { shipLockedAt: lockedAt.toISOString() } },
      });
      return lockedAt;
    });
    if (!at) return notLocked;

    await this.notifier.shipLocked(userId, at);

    const cancelledRequestIds: string[] = [];
    const pending = await this.prisma.wasteRequest.findMany({
      where: { userId, method: { in: ['PICKUP', 'HOME_PICKUP'] }, status: 'OPEN', orderId: null },
      select: { id: true, code: true, method: true, pointId: true, shipFeePointsUsed: true, gomdonOrderId: true },
    });
    const refundExpiresAt = pending.some((p) => p.method === 'HOME_PICKUP') && this.config ? await this.config.pointExpiresAt() : null;
    for (const row of pending) {
      try {
        const cancelled = await this.prisma.$transaction(async (tx) => {
          if (row.method === 'HOME_PICKUP') {
            if (!refundExpiresAt) throw new Error('Thiếu WasteConfigService để hoàn Điểm Xanh phí shipper');
            const res = await closeHomePickupRequest(tx, {
              req: { id: row.id, userId, code: row.code, pointId: row.pointId, shipFeePointsUsed: row.shipFeePointsUsed ?? 0 },
              from: ['OPEN'],
              to: 'CANCELLED',
              closeReason: 'SHIP_LOCKED',
              now: new Date(),
              refundExpiresAt,
              event: {
                kind: 'REQUEST_CANCELLED_SHIP_LOCK',
                actorUserId: null,
                actorRole: 'SYSTEM',
                meta: { subjectUserId: userId, before: { status: 'OPEN' }, after: { status: 'CANCELLED', closeReason: 'SHIP_LOCKED' } },
              },
            });
            return res.closed;
          }
          const { count } = await tx.wasteRequest.updateMany({
            where: { id: row.id, userId, method: 'PICKUP', status: 'OPEN', orderId: null },
            data: { status: 'CANCELLED', closedAt: new Date(), closeReason: 'SHIP_LOCKED' },
          });
          if (count !== 1) return false;
          await writeWasteEvent(tx, {
            kind: 'REQUEST_CANCELLED_SHIP_LOCK',
            actorUserId: null,
            actorRole: 'SYSTEM',
            requestId: row.id,
            meta: { subjectUserId: userId, before: { status: 'OPEN' }, after: { status: 'CANCELLED', closeReason: 'SHIP_LOCKED' } },
          });
          return true;
        });
        if (!cancelled) continue;
        cancelledRequestIds.push(row.id);
        if (row.method === 'HOME_PICKUP' && row.gomdonOrderId && this.gomdonQueue) {
          await enqueueGomdonWasteCancel(this.gomdonQueue, row.id, row.code).catch((e) =>
            this.logger.error(`ship-lock: xếp lệnh huỷ vận đơn Gomdon của ${row.code} lỗi: ${String(e)}`),
          );
        }
      } catch (e) {
        this.logger.warn(`ship-lock cancel of request ${row.id} failed: ${String(e)}`);
      }
    }
    return { locked: true, shipLockedAt: at, cancelledRequestIds };
  }
}
