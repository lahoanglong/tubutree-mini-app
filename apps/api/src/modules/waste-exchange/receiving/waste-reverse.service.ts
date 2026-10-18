import { ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import type { WasteMethod } from '@prisma/client';
import type { WasteReverseRequest, WasteReverseResultDTO } from '@tubutree/shared-types';
import { assertActiveAdmin } from '../../../common/staff-access';
import { PrismaService } from '../../../prisma/prisma.service';
import { applyPointsDelta } from '../../loyalty/points-ledger';
import { loadPointExpiryTxns, lotRecoverable, recycleLotKey } from '../../loyalty/loyalty-expiry.service';
import { WasteConfigService } from '../core/waste-config.service';
import { writeWasteEvent } from '../core/waste-events';
import { WasteNotifierService } from '../core/waste-notifier.service';
import { WasteShipLockService } from '../core/waste-ship-lock.service';

type TxResult = { replay: boolean; result: WasteReverseResultDTO; userId: string; code: string; method: WasteMethod; taken: number };

const NOT_FOUND = 'Không tìm thấy mã';
const RETRY = 'Vui lòng thử lại';

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
}

@Injectable()
export class WasteReverseService {
  private readonly logger = new Logger(WasteReverseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WasteConfigService,
    private readonly notifier: WasteNotifierService,
    private readonly shipLock: WasteShipLockService,
  ) {}

  async reverse(adminUserId: string, requestId: string, body: WasteReverseRequest): Promise<WasteReverseResultDTO> {
    const id = requestId;
    await assertActiveAdmin(this.prisma, adminUserId);
    const cfg = await this.config.snapshot();
    const now = new Date();

    let done: TxResult;
    try {
      done = await this.prisma.$transaction(async (tx): Promise<TxResult> => {
        await tx.$queryRaw`SELECT "id" FROM "waste_requests" WHERE "id" = ${id} FOR UPDATE`;
        const req = await tx.wasteRequest.findUnique({
          where: { id },
          select: { id: true, code: true, userId: true, method: true, status: true, pointId: true, orderId: true, pointsAwarded: true, reversalShortfallPoints: true },
        });
        if (!req) throw new NotFoundException(NOT_FOUND);
        const awarded = req.pointsAwarded ?? 0;
        if (req.status === 'REVERSED') {
          const shortfall = req.reversalShortfallPoints ?? 0;
          const result: WasteReverseResultDTO = { requestId: id, status: 'REVERSED', pointsTaken: awarded - shortfall, shortfallPoints: shortfall };
          return { replay: true, result, userId: req.userId, code: req.code, method: req.method, taken: awarded - shortfall };
        }
        if (req.status !== 'COMPLETED') throw new ConflictException('Chỉ thu hồi được yêu cầu đã hoàn tất');

        const [u] = await tx.$queryRaw<{ pointsBalance: number }[]>`SELECT "pointsBalance" FROM "users" WHERE "id" = ${req.userId} FOR UPDATE`;
        let take = 0;
        if (awarded > 0) {
          const recoverable = lotRecoverable(await loadPointExpiryTxns(tx, req.userId), recycleLotKey(id)) ?? awarded;
          take = Math.min(awarded, recoverable, Math.max(0, u?.pointsBalance ?? 0));
        }

        const moved = await tx.wasteRequest.updateMany({
          where: { id, status: 'COMPLETED', ...(req.method === 'PICKUP' ? { orderId: req.orderId } : {}) },
          data: { status: 'REVERSED', reversedAt: now, reversedByUserId: adminUserId, reversalReason: body.reason, reversalShortfallPoints: awarded - take },
        });
        if (moved.count !== 1) throw new ConflictException(RETRY);

        if (take > 0) {
          const r = await applyPointsDelta(tx, {
            userId: req.userId,
            delta: -take,
            lot: 'STANDARD',
            reason: `RECYCLE_REVERSED:${req.code}`,
            refType: 'RECYCLE_REVERSED',
            refId: id,
          });
          if (!r.applied) {
            this.logger.error(`Yêu cầu ${req.code}: không trừ được ${take} điểm khi thu hồi`);
            throw new InternalServerErrorException('Không thu hồi được Điểm Xanh, đã báo quản trị viên.');
          }
        }

        await writeWasteEvent(tx, {
          kind: 'POINTS_REVERSED',
          actorUserId: adminUserId,
          actorRole: 'ADMIN',
          requestId: id,
          pointId: req.pointId,
          meta: {
            reason: body.reason,
            pointsAwarded: awarded,
            pointsTaken: take,
            shortfallPoints: awarded - take,
            subjectUserId: req.userId,
            before: { status: 'COMPLETED' },
            after: { status: 'REVERSED' },
          },
        });
        return {
          replay: false,
          result: { requestId: id, status: 'REVERSED', pointsTaken: take, shortfallPoints: awarded - take },
          userId: req.userId,
          code: req.code,
          method: req.method,
          taken: take,
        };
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        this.logger.error(`Thu hồi yêu cầu ${id}: vi phạm khoá duy nhất ${String(e)}`);
        throw new InternalServerErrorException('Trạng thái thu hồi không nhất quán, đã báo quản trị viên.');
      }
      throw e;
    }

    if (done.replay) return done.result;

    try {
      await this.notifier.pointsReversed(done.userId, { id, code: done.code }, done.taken, body.reason);
    } catch (e) {
      this.logger.warn(`pointsReversed failed for ${id}: ${String(e)}`);
    }
    if (done.method === 'MAIL_IN' || done.method === 'PICKUP') {
      try {
        await this.shipLock.evaluateAndLock(done.userId, { shortfallLockPct: cfg.shortfallLockPct, shortfallLockStreak: cfg.shortfallLockStreak });
      } catch (e) {
        this.logger.warn(`evaluateAndLock failed for ${done.userId}: ${String(e)}`);
      }
    }
    return done.result;
  }
}
