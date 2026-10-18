import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { WasteConfigSnapshot } from './waste-config.service';
import { writeWasteEvent } from './waste-events';
import { WasteNotifierService } from './waste-notifier.service';

type ShipLockResult = { locked: boolean; shipLockedAt: Date | null; cancelledRequestIds: string[] };

@Injectable()
export class WasteShipLockService {
  private readonly logger = new Logger(WasteShipLockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: WasteNotifierService,
  ) {}

  async shouldLock(db: Prisma.TransactionClient, userId: string, pct: number, streak: number): Promise<boolean> {
    const rows = await db.$queryRaw<{ should_lock: boolean | null }[]>`
      WITH recent AS (
        SELECT r.id,
               (r.status IN ('REJECTED', 'REVERSED', 'EXPIRED')
                OR COALESCE(r."pointsAwarded", 0) * 100 < r."estimatedPoints" * (100 - ${pct}::int)) AS strike
        FROM waste_requests r
        WHERE r."userId" = ${userId}
          AND r.method IN ('MAIL_IN', 'PICKUP')
          AND (r.status IN ('COMPLETED', 'REVERSED', 'REJECTED')
               OR (r.status = 'EXPIRED' AND r."closeReason" = 'PICKUP_NO_SHOW'))
          AND r."closedAt" > COALESCE((SELECT f."shipUnlockedAt" FROM waste_user_flags f WHERE f."userId" = ${userId}), '-infinity')
        ORDER BY r."closedAt" DESC, r.id DESC
        LIMIT ${streak}::int
      )
      SELECT count(*) = ${streak}::int AND bool_and(strike) AS should_lock FROM recent`;
    return rows[0]?.should_lock === true;
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
      where: { userId, method: 'PICKUP', status: 'OPEN', orderId: null },
      select: { id: true },
    });
    for (const { id } of pending) {
      try {
        const cancelled = await this.prisma.$transaction(async (tx) => {
          const { count } = await tx.wasteRequest.updateMany({
            where: { id, userId, method: 'PICKUP', status: 'OPEN', orderId: null },
            data: { status: 'CANCELLED', closedAt: new Date(), closeReason: 'SHIP_LOCKED' },
          });
          if (count !== 1) return false;
          await writeWasteEvent(tx, {
            kind: 'REQUEST_CANCELLED_SHIP_LOCK',
            actorUserId: null,
            actorRole: 'SYSTEM',
            requestId: id,
            meta: { subjectUserId: userId, before: { status: 'OPEN' }, after: { status: 'CANCELLED', closeReason: 'SHIP_LOCKED' } },
          });
          return true;
        });
        if (cancelled) cancelledRequestIds.push(id);
      } catch (e) {
        this.logger.warn(`ship-lock cancel of request ${id} failed: ${String(e)}`);
      }
    }
    return { locked: true, shipLockedAt: at, cancelledRequestIds };
  }
}
