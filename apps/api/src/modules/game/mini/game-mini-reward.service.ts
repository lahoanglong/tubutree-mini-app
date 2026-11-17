import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { MINI_ERROR_CODES, type MiniCapId, type MiniGameId } from '@tubutree/shared-types';
import { PrismaService } from '../../../prisma/prisma.service';
import { applyPointsDelta } from '../../loyalty/points-ledger';
import type { MiniSettings } from './game-mini.settings';

/** refType của dòng sổ Điểm Xanh game mini; partial unique "points_transactions_game_mini_ref_key" (refType, refId) chặn trùng mỗi ván. */
export const GAME_MINI_REF_TYPE = 'GAME_MINI';

/**
 * Thời gian chờ khoá `users` tính vào thời hạn transaction: nhiều lần nộp/bấm Chơi dồn của một tài khoản xếp hàng nối tiếp, mặc định
 * 5 giây của Prisma làm lời gọi cuối hết hạn khi máy chủ bận. Hết hạn thì rollback sạch (ván vẫn chưa nộp, khách nộp lại được).
 */
export const MINI_TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

export const miniWaterReason = (game: MiniGameId): string => `MINI_${game.toUpperCase()}`;
export const miniPointsReason = (game: MiniGameId): string => `${GAME_MINI_REF_TYPE}:${game}`;

export interface MiniSettleInput {
  roundId: string;
  userId: string;
  game: MiniGameId;
  /** Ngày VN của ván (ngày phát): trần tính theo ngày này, cùng ngày với ô ván có thưởng. */
  dayKey: string;
  now: Date;
  correct: number;
  total: number;
  correctIds: string[];
  /** Thưởng trước trần; 0 khi khách không phải người dùng thật (đã kiểm ngoài transaction). */
  base: { water: number; points: number };
  deviceHash: string | null;
  settings: Pick<MiniSettings, 'waterCap' | 'pointsCap' | 'accountsPerDevice' | 'globalBudget' | 'tankCapacity'>;
  /** Hạn của lô điểm (đọc ngoài transaction); bắt buộc khi `base.points > 0`. */
  pointsExpiresAt: Date | null;
}

export interface MiniSettleResult {
  /** Ô ván có thưởng lúc chốt (null = ván không thưởng). */
  slot: number | null;
  water: number;
  points: number;
  capped: MiniCapId[];
  /** Số 💧 trong bình sau khi cộng; null khi ván không cộng 💧. */
  totalSeeds: number | null;
}

/**
 * Chốt một lần nộp bài và cộng thưởng, tất cả trong MỘT transaction. Đây là tệp duy nhất trong `game/mini/**` được ghi sổ Điểm Xanh
 * (`game-mint-allowlist.spec.ts` ghim đúng một lời gọi `applyPointsDelta`).
 *
 * Thứ tự khoá: `users` → ván (UPDATE có điều kiện) → `game_profiles` → dòng sổ ngày của tài khoản → khoá tư vấn theo thiết bị → dòng
 * ngân sách toàn hệ thống. `users` rồi `game_profiles` là thứ tự chung với arcade, nước theo đơn và Đổi rác; các khoá sau chỉ game
 * mini giữ và luôn theo cùng thứ tự, nên không có vòng chờ.
 *
 * Mọi số đếm đọc SAU khi đã giữ khoá nên hai ván song song của cùng tài khoản xếp hàng ở `users`; điều kiện của từng UPDATE là lớp
 * chặn thứ hai. Dòng nước dùng unique (reason, refId = id ván), dòng điểm dùng partial unique (refType, refId) và
 * `skipDuplicates` (không bắt P2002 trong transaction: Postgres huỷ cả transaction).
 */
@Injectable()
export class GameMiniRewardService {
  constructor(private readonly prisma: PrismaService) {}

  async settle(input: MiniSettleInput): Promise<MiniSettleResult> {
    const { roundId, userId, game, dayKey, now, settings } = input;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;

      const claimed = await tx.gamePlayRound.updateMany({
        where: { id: roundId, userId, submittedAt: null, expiresAt: { gt: now } },
        data: {
          submittedAt: now,
          correct: input.correct,
          total: input.total,
          correctIds: input.correctIds,
          deviceHash: input.deviceHash,
        },
      });
      if (claimed.count === 0) {
        const round = await tx.gamePlayRound.findUnique({ where: { id: roundId }, select: { submittedAt: true } });
        if (round?.submittedAt) {
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            code: MINI_ERROR_CODES.roundSubmitted,
            message: 'Ván này đã nộp rồi. Bạn bấm Chơi để bắt đầu ván mới nhé.',
          });
        }
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: MINI_ERROR_CODES.roundExpired,
          message: 'Ván này đã quá 10 phút nên không chấm được. Bạn chơi ván mới nhé.',
        });
      }
      const { slot } = await tx.gamePlayRound.findUniqueOrThrow({ where: { id: roundId }, select: { slot: true } });
      const none: MiniSettleResult = { slot, water: 0, points: 0, capped: [], totalSeeds: null };
      if (slot === null || (input.base.water <= 0 && input.base.points <= 0)) return none;

      const capped: MiniCapId[] = [];
      let water = input.base.water;
      let points = input.base.points;

      const profile = await tx.$queryRaw<{ totalSeeds: number }[]>`
        SELECT "totalSeeds" FROM "game_profiles" WHERE "userId" = ${userId} FOR UPDATE`;
      if (profile.length === 0) throw new ConflictException('Hồ sơ game đang được cập nhật. Bạn thử lại sau ít giây nhé.');
      const seedsBefore = profile[0]!.totalSeeds;

      await tx.gameDailyLedger.createMany({ data: [{ userId, dayKey }], skipDuplicates: true });
      const [ledger] = await tx.$queryRaw<{ waterFromGames: number; pointsFromGames: number }[]>`
        SELECT "waterFromGames", "pointsFromGames" FROM "game_daily_ledger" WHERE "userId" = ${userId} AND "dayKey" = ${dayKey} FOR UPDATE`;
      const waterLeft = Math.max(0, settings.waterCap - ledger!.waterFromGames);
      const pointsLeft = Math.max(0, settings.pointsCap - ledger!.pointsFromGames);
      if (water > waterLeft) {
        water = waterLeft;
        capped.push('account_water');
      }
      if (points > pointsLeft) {
        points = pointsLeft;
        capped.push('account_points');
      }

      // deviceId do ứng dụng tự sinh nên giả được: trần này chỉ là ma sát với một máy nhiều tài khoản; lớp chặn thật là trần tài khoản
      // và ngân sách toàn hệ thống. Không gửi deviceId thì không thưởng (bỏ trống không được là cách né trần). Khoá tư vấn theo (thiết
      // bị, ngày) vì các tài khoản khác nhau không chung khoá `users`: thiếu nó, hai tài khoản mới cùng đếm "1 < 2" rồi cùng được thưởng.
      let registerDevice = false;
      if (!input.deviceHash && water + points > 0) {
        water = 0;
        points = 0;
        capped.push('device');
      } else if (input.deviceHash && water + points > 0) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`game-mini-device:${input.deviceHash}:${dayKey}`}, 0))`;
        const seen = await tx.gameDeviceDaily.findMany({ where: { deviceHash: input.deviceHash, dayKey }, select: { userId: true } });
        if (!seen.some((r) => r.userId === userId)) {
          if (seen.length >= settings.accountsPerDevice) {
            water = 0;
            points = 0;
            capped.push('device');
          } else {
            registerDevice = true;
          }
        }
      }

      const tankRoom = Math.max(0, settings.tankCapacity - seedsBefore);
      if (water > tankRoom) {
        water = tankRoom;
        capped.push('tank');
      }

      if (points > 0) {
        await tx.gameGlobalDaily.createMany({ data: [{ dayKey }], skipDuplicates: true });
        const [global] = await tx.$queryRaw<{ pointsMinted: number }[]>`
          SELECT "pointsMinted" FROM "game_global_daily" WHERE "dayKey" = ${dayKey} FOR UPDATE`;
        const budgetLeft = Math.max(0, settings.globalBudget - global!.pointsMinted);
        if (points > budgetLeft) {
          points = budgetLeft;
          capped.push('global');
        }
        if (points > 0) {
          const g = await tx.gameGlobalDaily.updateMany({
            where: { dayKey, pointsMinted: { lte: settings.globalBudget - points } },
            data: { pointsMinted: { increment: points } },
          });
          if (g.count !== 1) throw new Error(`game mini: ngân sách điểm ngày ${dayKey} lệch khi cộng ván ${roundId}`);
        }
      }

      const cappedBy = capped.length > 0 ? capped.join(',') : null;
      if (water === 0 && points === 0) {
        await tx.gamePlayRound.update({ where: { id: roundId }, data: { cappedBy } });
        return { ...none, capped };
      }

      const led = await tx.gameDailyLedger.updateMany({
        where: {
          userId,
          dayKey,
          ...(water > 0 ? { waterFromGames: { lte: settings.waterCap - water } } : {}),
          ...(points > 0 ? { pointsFromGames: { lte: settings.pointsCap - points } } : {}),
        },
        data: { waterFromGames: { increment: water }, pointsFromGames: { increment: points }, rewardedRounds: { increment: 1 } },
      });
      if (led.count !== 1) throw new Error(`game mini: sổ ngày của ${userId} lệch khi cộng ván ${roundId}`);
      if (registerDevice) {
        await tx.gameDeviceDaily.createMany({ data: [{ deviceHash: input.deviceHash!, dayKey, userId }], skipDuplicates: true });
      }

      let totalSeeds: number | null = null;
      if (water > 0) {
        const taken = await tx.gameWaterEvent.createMany({
          data: [{ userId, delta: water, reason: miniWaterReason(game), refId: roundId, createdAt: now }],
          skipDuplicates: true,
        });
        if (taken.count !== 1) throw new Error(`game mini: ván ${roundId} đã có dòng nước`);
        totalSeeds = (
          await tx.gameProfile.update({ where: { userId }, data: { totalSeeds: { increment: water } }, select: { totalSeeds: true } })
        ).totalSeeds;
      }
      if (points > 0) {
        const credited = await applyPointsDelta(tx, {
          userId,
          delta: points,
          lot: 'STANDARD',
          reason: miniPointsReason(game),
          refType: GAME_MINI_REF_TYPE,
          refId: roundId,
          expiresAt: input.pointsExpiresAt,
          skipDuplicates: true,
        });
        if (!credited.applied) throw new Error(`game mini: ván ${roundId} đã có dòng Điểm Xanh`);
      }

      await tx.gamePlayRound.update({ where: { id: roundId }, data: { waterAwarded: water, pointsAwarded: points, cappedBy } });
      return { slot, water, points, capped, totalSeeds };
    }, MINI_TX_OPTIONS);
  }
}
