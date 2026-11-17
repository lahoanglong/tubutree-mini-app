import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import {
  MINI_ERROR_CODES,
  MINI_GAME_IDS,
  MINI_GAME_RULES,
  MINI_MAX_ROUNDS_PER_GAME_PER_DAY,
  MINI_MIN_ROUND_MS,
  MINI_ROUND_TTL_MS,
  isMiniGameId,
  miniBaseReward,
  type MiniCheckInResult,
  type MiniErrorCode,
  type MiniGameId,
  type MiniNoRewardReason,
  type MiniStartResponse,
  type MiniSubmitResponse,
  type MiniTodayResponse,
} from '@tubutree/shared-types';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { LoyaltyService } from '../../loyalty/loyalty.service';
import { AnalyticsEventsService } from '../../analytics/analytics-events.service';
import { DailyCheckInService } from '../../daily-check-in/daily-check-in.service';
import { isRealUser } from '../../../common/real-user';
import { vnDateKey } from '../../../common/vn-time';
import { ensureGameProfile } from '../game-profile';
import { GameMiniContentService } from './game-mini-content.service';
import { GameMiniRewardService } from './game-mini-reward.service';
import { deviceHash, matchCardId, readGuestRound, signGuestRound } from './game-mini-crypto';
import { MINI_GAMES, type MiniBuildCtx, type MiniContentRow } from './games';
import { readMiniSettings, rewardedRoundsFor, type MiniSettings } from './game-mini.settings';

export interface MiniSubmitInput {
  roundId?: string | null;
  token?: string | null;
  answers: unknown[];
  deviceId?: string | null;
}

type Eligibility = { ok: true } | { ok: false; reason: MiniNoRewardReason };
type UserRow = { zaloId: string | null; phone: string | null; createdAt: Date };

function miniError(status: HttpStatus, code: MiniErrorCode, message: string): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}

const disabled = () => miniError(HttpStatus.NOT_FOUND, MINI_ERROR_CODES.disabled, 'Trò chơi này đang tạm nghỉ. Bạn quay lại sau nhé.');
const noContent = () =>
  miniError(HttpStatus.NOT_FOUND, MINI_ERROR_CODES.noContent, 'Trò chơi này đang được cập nhật nội dung. Bạn chơi trò khác nhé.');

/** [0, 1) từ bộ sinh số của hệ điều hành: thứ tự mục và thẻ không đoán trước được. */
const cryptoRng = (): number => randomInt(0, 2 ** 47) / 2 ** 47;

@Injectable()
export class GameMiniService {
  private readonly logger = new Logger(GameMiniService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly loyalty: LoyaltyService,
    private readonly env: ConfigService,
    private readonly content: GameMiniContentService,
    private readonly reward: GameMiniRewardService,
    private readonly analytics: AnalyticsEventsService,
    private readonly dailyCheckIn: DailyCheckInService,
  ) {}

  private secret(): string | undefined {
    return this.env.get<string>('JWT_ACCESS_SECRET') || undefined;
  }

  /** Cờ chung và cờ của game; tắt (hoặc game lạ) thì 404 GAME_DISABLED, không lộ game nào có thật. */
  private async settingsFor(game?: string): Promise<MiniSettings> {
    if (game !== undefined && !isMiniGameId(game)) throw disabled();
    const settings = await readMiniSettings(this.config);
    if (!settings.enabled || (game !== undefined && !settings.games[game as MiniGameId])) throw disabled();
    return settings;
  }

  private eligibility(user: UserRow | null, settings: MiniSettings, at: Date): Eligibility {
    if (!user) return { ok: false, reason: 'NOT_LOGGED_IN' };
    if (!isRealUser(user)) return { ok: false, reason: 'NOT_REAL_USER' };
    if (settings.minAccountAgeHours > 0 && at.getTime() - user.createdAt.getTime() < settings.minAccountAgeHours * 3_600_000) {
      return { ok: false, reason: 'ACCOUNT_TOO_NEW' };
    }
    return { ok: true };
  }

  private user(userId: string): Promise<UserRow | null> {
    return this.prisma.user.findUnique({ where: { id: userId }, select: { zaloId: true, phone: true, createdAt: true } });
  }

  private buildCtx(roundKey: string, dayKey: string, extra?: Partial<MiniBuildCtx>): MiniBuildCtx {
    const secret = this.secret();
    return {
      rng: cryptoRng,
      dayKey,
      products: new Map(),
      sortHazardous: false,
      cardId: (contentId, side) => matchCardId(secret, roundKey, contentId, side),
      ...extra,
    };
  }

  private track(eventName: string, userId: string | null, props: Record<string, unknown>): Promise<void> {
    return this.analytics.recordBestEffort({ eventName, userId, platform: 'system', props });
  }

  /** Game đang bật và đủ nội dung, lượt thưởng còn lại và trạng thái trần hôm nay. Không trả nội dung hay đáp án. */
  async today(userId: string | null, now: Date = new Date()): Promise<MiniTodayResponse> {
    const settings = await this.settingsFor();
    const dayKey = vnDateKey(now);
    const on = MINI_GAME_IDS.filter((g) => settings.games[g]);
    const pools = await Promise.all(on.map((g) => this.content.pool(g, dayKey)));
    const visible = on.filter((_, i) => pools[i]!.available);
    const [user, rounds, ledger, global] = await Promise.all([
      userId ? this.user(userId) : Promise.resolve(null),
      userId
        ? this.prisma.gamePlayRound.findMany({ where: { userId, dayKey }, select: { game: true, slot: true, submittedAt: true, expiresAt: true } })
        : Promise.resolve([]),
      userId ? this.prisma.gameDailyLedger.findUnique({ where: { userId_dayKey: { userId, dayKey } } }) : Promise.resolve(null),
      this.prisma.gameGlobalDaily.findUnique({ where: { dayKey } }),
    ]);
    const elig = this.eligibility(user, settings, now);
    const waterUsed = ledger?.waterFromGames ?? 0;
    const pointsUsed = ledger?.pointsFromGames ?? 0;
    const pointsBudgetExhausted = (global?.pointsMinted ?? 0) >= settings.globalBudget;
    return {
      dayKey,
      games: visible.map((game) => {
        const mine = rounds.filter((r) => r.game === game);
        const perDay = rewardedRoundsFor(settings, game);
        const reserved = mine.filter((r) => r.slot !== null && (r.submittedAt !== null || r.expiresAt > now)).length;
        return {
          game,
          items: MINI_GAME_RULES[game].items,
          timeLimitMs: MINI_GAME_RULES[game].timeLimitMs,
          rewardedRoundsPerDay: perDay,
          rewardedRoundsLeft: elig.ok ? Math.max(0, perDay - reserved) : 0,
          playedToday: mine.filter((r) => r.submittedAt !== null).length,
        };
      }),
      rewardEligible: elig.ok,
      noRewardReason: elig.ok ? null : elig.reason,
      caps: {
        waterUsed,
        waterCap: settings.waterCap,
        pointsUsed,
        pointsCap: settings.pointsCap,
        accountCapReached: waterUsed >= settings.waterCap && (pointsUsed >= settings.pointsCap || pointsBudgetExhausted),
        pointsBudgetExhausted,
      },
      dailyQuizDoneToday: rounds.some((r) => r.game === 'daily_quiz' && r.submittedAt !== null),
    };
  }

  /**
   * Phát một ván: máy chủ chọn nội dung và chỉ trả phần không có đáp án. Khách đã đăng nhập: ghi ván (`roundId`), giữ một ô ván có thưởng
   * nếu còn. Khách chưa đăng nhập: không ghi DB, trả mã ván ký chứa danh sách mục (không thưởng).
   */
  async start(userId: string | null, gameParam: string, now: Date = new Date()): Promise<MiniStartResponse> {
    const settings = await this.settingsFor(gameParam);
    const game = gameParam as MiniGameId;
    const dayKey = vnDateKey(now);
    const pool = await this.content.pool(game, dayKey);
    if (!pool.available) throw noContent();
    const def = MINI_GAMES[game];
    const picked = def.pick(pool.rows, { rng: cryptoRng, dayKey, products: pool.products });
    if (!picked) throw noContent();
    const contentIds = picked.map((r) => r.id);
    const expiresAt = new Date(now.getTime() + MINI_ROUND_TTL_MS);
    const extra = { products: pool.products, sortHazardous: pool.sortHazardous };

    if (!userId) {
      const { token, nonce } = signGuestRound({ game, issuedAt: now.getTime(), contentIds }, this.secret());
      await this.track('game_round_started', null, { game, slot: null, rewarded: false });
      return {
        game,
        roundId: null,
        token,
        issuedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        rewarded: false,
        noRewardReason: 'NOT_LOGGED_IN',
        content: def.build(picked, this.buildCtx(nonce, dayKey, extra)),
      };
    }

    const elig = this.eligibility(await this.user(userId), settings, now);
    const perDay = rewardedRoundsFor(settings, game);
    // Khoá tư vấn theo (tài khoản, game, ngày): hai lần bấm Chơi song song không cùng giành một ô; partial unique của ô là lớp chặn sau.
    const round = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`game-mini-start:${userId}:${game}:${dayKey}`}, 0))`;
      const started = await tx.gamePlayRound.count({ where: { userId, game, dayKey } });
      if (started >= MINI_MAX_ROUNDS_PER_GAME_PER_DAY) {
        throw miniError(HttpStatus.TOO_MANY_REQUESTS, MINI_ERROR_CODES.roundLimit, 'Hôm nay bạn đã chơi trò này rất nhiều ván. Mai mình chơi tiếp nhé.');
      }
      let slot: number | null = null;
      if (elig.ok && perDay > 0) {
        // Ván bỏ dở quá hạn trả lại ô: mất mạng giữa ván không làm mất lượt thưởng.
        await tx.gamePlayRound.updateMany({
          where: { userId, game, dayKey, slot: { not: null }, submittedAt: null, expiresAt: { lte: now } },
          data: { slot: null },
        });
        const held = await tx.gamePlayRound.findMany({ where: { userId, game, dayKey, slot: { not: null } }, select: { slot: true } });
        const taken = new Set(held.map((r) => r.slot));
        for (let s = 1; s <= perDay; s++) {
          if (!taken.has(s)) {
            slot = s;
            break;
          }
        }
      }
      return tx.gamePlayRound.create({
        data: { userId, game, dayKey, slot, contentIds, issuedAt: now, expiresAt },
        select: { id: true, slot: true },
      });
    });
    const rewarded = round.slot !== null;
    await this.track('game_round_started', userId, { game, slot: round.slot, rewarded });
    return {
      game,
      roundId: round.id,
      token: null,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      rewarded,
      noRewardReason: rewarded ? null : elig.ok ? 'NO_REWARDED_ROUNDS_LEFT' : elig.reason,
      content: def.build(picked, this.buildCtx(round.id, dayKey, extra)),
    };
  }

  private assertTiming(issuedAt: number, now: Date): number {
    const elapsed = now.getTime() - issuedAt;
    if (elapsed > MINI_ROUND_TTL_MS) {
      throw miniError(HttpStatus.BAD_REQUEST, MINI_ERROR_CODES.roundExpired, 'Ván này đã quá 10 phút nên không chấm được. Bạn chơi ván mới nhé.');
    }
    if (elapsed < MINI_MIN_ROUND_MS) {
      throw miniError(HttpStatus.BAD_REQUEST, MINI_ERROR_CODES.tooFast, 'Ván này nộp nhanh quá. Bạn đọc kỹ rồi nộp lại nhé.');
    }
    return elapsed;
  }

  private grade(game: MiniGameId, rows: MiniContentRow[], answers: unknown[], ctx: MiniBuildCtx) {
    const def = MINI_GAMES[game];
    const parsed = def.parseAnswers(answers, rows, ctx);
    if (parsed === null) {
      throw miniError(HttpStatus.BAD_REQUEST, MINI_ERROR_CODES.answersInvalid, 'Bài nộp chưa đúng dạng. Bạn tải lại trò chơi rồi thử lại nhé.');
    }
    return def.grade(rows, parsed, ctx);
  }

  /** Đố Xanh xong là điểm danh của ngày: gọi đúng luồng điểm danh gộp (idempotent theo ngày), không có chuỗi thứ hai. */
  private async checkInAfterQuiz(userId: string): Promise<MiniCheckInResult> {
    try {
      const result = await this.dailyCheckIn.run(userId);
      const streakDays =
        result.water?.streakDays ??
        (await this.prisma.gameProfile.findUnique({ where: { userId }, select: { streakDays: true } }))?.streakDays ??
        null;
      return { done: result.pending.length === 0, newlyCheckedIn: result.points !== null || result.water !== null, streakDays };
    } catch (err) {
      this.logger.warn(`Đố Xanh của ${userId}: điểm danh chưa xong (${String(err)})`);
      return { done: false, newlyCheckedIn: false, streakDays: null };
    }
  }

  async submit(userId: string | null, gameParam: string, input: MiniSubmitInput, now: Date = new Date()): Promise<MiniSubmitResponse> {
    const settings = await this.settingsFor(gameParam);
    const game = gameParam as MiniGameId;
    if (input.roundId) return this.submitRound(userId, game, input.roundId, input, settings, now);
    if (input.token) return this.submitGuest(userId, game, input.token, input.answers, now);
    throw miniError(HttpStatus.BAD_REQUEST, MINI_ERROR_CODES.tokenInvalid, 'Thiếu mã ván. Bạn bấm Chơi để bắt đầu ván mới nhé.');
  }

  private async submitRound(
    userId: string | null,
    game: MiniGameId,
    roundId: string,
    input: MiniSubmitInput,
    settings: MiniSettings,
    now: Date,
  ): Promise<MiniSubmitResponse> {
    if (!userId) throw miniError(HttpStatus.UNAUTHORIZED, MINI_ERROR_CODES.loginRequired, 'Bạn đăng nhập lại để nộp ván này nhé.');
    const round = await this.prisma.gamePlayRound.findUnique({ where: { id: roundId } });
    // Ván của người khác trả cùng câu với ván không có: không lộ id ván nào tồn tại.
    if (!round || round.userId !== userId || round.game !== game) {
      throw miniError(HttpStatus.NOT_FOUND, MINI_ERROR_CODES.roundNotFound, 'Không tìm thấy ván này. Bạn bấm Chơi để bắt đầu ván mới nhé.');
    }
    if (round.submittedAt) {
      throw miniError(HttpStatus.CONFLICT, MINI_ERROR_CODES.roundSubmitted, 'Ván này đã nộp rồi. Bạn bấm Chơi để bắt đầu ván mới nhé.');
    }
    const durationMs = this.assertTiming(round.issuedAt.getTime(), now);
    const rows = await this.content.byIds(game, round.contentIds);
    if (!rows) throw noContent();
    const graded = this.grade(game, rows, input.answers, this.buildCtx(round.id, round.dayKey));

    const user = await this.user(userId);
    const real = isRealUser(user);
    const base = round.slot !== null && real ? miniBaseReward(graded.correct, graded.total) : { water: 0, points: 0 };
    if (base.water > 0) await ensureGameProfile(this.prisma, this.config, userId);
    const pointsExpiresAt = base.points > 0 ? await this.loyalty.pointsExpiresAt(now) : null;
    const settled = await this.reward.settle({
      roundId: round.id,
      userId,
      game,
      dayKey: round.dayKey,
      now,
      correct: graded.correct,
      total: graded.total,
      correctIds: graded.correctIds,
      base,
      deviceHash: input.deviceId ? deviceHash(this.secret(), input.deviceId) : null,
      settings,
      pointsExpiresAt,
    });

    const rewarded = settled.slot !== null && real;
    const elig = this.eligibility(user, settings, round.issuedAt);
    const checkIn = game === 'daily_quiz' && real ? await this.checkInAfterQuiz(userId) : null;
    await this.track('game_round_completed', userId, {
      game,
      correct: graded.correct,
      total: graded.total,
      durationMs,
      water: settled.water,
      points: settled.points,
      capped: settled.capped,
      rewarded,
    });
    for (const cap of settled.capped) await this.track('game_cap_hit', userId, { game, cap });
    return {
      game,
      roundId: round.id,
      correct: graded.correct,
      total: graded.total,
      durationMs,
      rewarded,
      noRewardReason: rewarded ? null : elig.ok ? 'NO_REWARDED_ROUNDS_LEFT' : elig.reason,
      baseWater: base.water,
      basePoints: base.points,
      water: settled.water,
      points: settled.points,
      capped: settled.capped,
      totalSeeds: settled.totalSeeds,
      checkIn,
      review: graded.review,
    };
  }

  /** Ván của khách chưa đăng nhập: chấm theo danh sách mục trong mã đã ký, không ghi DB, không thưởng. */
  private async submitGuest(userId: string | null, game: MiniGameId, token: string, answers: unknown[], now: Date): Promise<MiniSubmitResponse> {
    const guest = readGuestRound(token, this.secret());
    if (!guest || guest.game !== game) {
      throw miniError(HttpStatus.BAD_REQUEST, MINI_ERROR_CODES.tokenInvalid, 'Mã ván chưa hợp lệ. Bạn bấm Chơi để bắt đầu ván mới nhé.');
    }
    const durationMs = this.assertTiming(guest.issuedAt, now);
    const rows = await this.content.byIds(game, guest.contentIds);
    if (!rows) {
      throw miniError(HttpStatus.BAD_REQUEST, MINI_ERROR_CODES.tokenInvalid, 'Mã ván chưa hợp lệ. Bạn bấm Chơi để bắt đầu ván mới nhé.');
    }
    const graded = this.grade(game, rows, answers, this.buildCtx(guest.nonce, vnDateKey(new Date(guest.issuedAt))));
    await this.track('game_round_completed', userId, {
      game,
      correct: graded.correct,
      total: graded.total,
      durationMs,
      water: 0,
      points: 0,
      capped: [],
      rewarded: false,
    });
    return {
      game,
      roundId: null,
      correct: graded.correct,
      total: graded.total,
      durationMs,
      rewarded: false,
      noRewardReason: 'NOT_LOGGED_IN',
      baseWater: 0,
      basePoints: 0,
      water: 0,
      points: 0,
      capped: [],
      totalSeeds: null,
      checkIn: null,
      review: graded.review,
    };
  }
}
