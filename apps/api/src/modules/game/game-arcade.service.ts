import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { applyPointsDelta } from '../loyalty/points-ledger';
import { isRealUser } from '../../common/real-user';
import { startOfVnDay, vnDateKey } from '../../common/vn-time';
import { ensureGameProfile } from './game-profile';
import {
  ARCADE_DURATION_SLACK_MS,
  ARCADE_ENABLED_DEFAULT,
  ARCADE_GAME_IDS,
  ARCADE_MIN_DURATION_MS,
  ARCADE_MIN_REWARD_SCORE,
  ARCADE_NOMINAL_MS,
  ARCADE_POINTS_PER_RUN_DEFAULT,
  ARCADE_POINTS_PER_RUN_MAX,
  ARCADE_POINTS_REASON_PREFIX,
  ARCADE_RUN_SLACK_MS,
  ARCADE_RUN_TTL_MS,
  ARCADE_WATER_BASE_DEFAULT,
  ARCADE_WATER_BASE_MAX,
  ARCADE_WATER_REASONS,
  HOME_QUIZ_REASON,
  HOME_QUIZ_SEEDS_DEFAULT,
  HOME_QUIZ_SEEDS_MAX,
  arcadeBaseRefId,
  arcadeBonusRefId,
  arcadeCap,
  arcadeUsageOf,
  arcadeWater,
  arcadeWindowAt,
  arcadeWindowBonusOpen,
  maxScoreFor,
  nextArcadeSlot,
  nextArcadeWindowStart,
  type ArcadeGameId,
  type ArcadeUsage,
  type ArcadeWindowId,
} from './game-arcade.constants';
import { readArcadeRun, signArcadeRun } from './game-arcade-run';

export interface ArcadeCompleteInput {
  gameId: ArcadeGameId;
  score: number;
  durationMs: number;
  /** Mã ván do `start` cấp; bắt buộc để ván được ghi. */
  runId: string;
}

/** Mã ván vừa cấp: khách gửi lại nguyên văn khi báo kết quả. */
export interface ArcadeStartResult {
  runId: string;
  startedAt: string;
  expiresAt: string;
}

export type ArcadeNoRewardReason = 'DAILY_CAP' | 'LOW_SCORE' | 'NOT_REAL_USER' | 'DISABLED';

export interface ArcadeCompleteResult {
  gameId: ArcadeGameId;
  score: number;
  bestScore: number;
  isNewBest: boolean;
  rewarded: boolean;
  reason: ArcadeNoRewardReason | null;
  waterEarned: number;
  pointsEarned: number;
  totalSeeds: number;
  /** Tổng lượt thưởng (cơ sở cộng thưởng khung) đã dùng hôm nay giờ VN, tính SAU ván này. */
  used: number;
  /** 3 + số lượt thưởng khung đã dùng hôm nay + 1 nếu đang trong khung mà lượt thưởng khung đó chưa dùng. */
  cap: number;
  window: ArcadeWindowId | null;
  /** Lúc ván xong (trước khi tiêu lượt): đang trong khung và lượt thưởng của khung đó chưa dùng. */
  windowBonus: boolean;
}

export interface ArcadeStatus {
  games: Record<ArcadeGameId, { bestScore: number; plays: number; used: number; cap: number }>;
  window: ArcadeWindowId | null;
  windowBonus: boolean;
  nextWindowAt: string | null;
  quizClaimed: boolean;
}

export interface HomeQuizResult {
  granted: number;
  alreadyClaimed: boolean;
  totalSeeds: number;
}

interface ArcadeSettings {
  enabled: boolean;
  waterBase: number;
  pointsPerRun: number;
}

@Injectable()
export class GameArcadeService {
  private readonly logger = new Logger(GameArcadeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly loyalty: LoyaltyService,
    private readonly env: ConfigService,
  ) {}

  private runSecret(): string | undefined {
    return this.env.get<string>('JWT_ACCESS_SECRET') || undefined;
  }

  /**
   * Cấp mã ván lúc khách bấm Chơi. Công khai cho cả khách chưa đăng nhập (web chơi thử rồi đăng nhập nhận thưởng; Mini App chơi bằng
   * tài khoản khách rồi gộp vào tài khoản thật), nên mã KHÔNG buộc với userId: thứ nó chứng minh là ván này có thật và đã kéo dài bao lâu,
   * còn "ván của ai" chỉ có nghĩa lúc ghi, khi người nhận đã đăng nhập. Mỗi lần cấp không tốn gì ngoài một HMAC (có Throttle ở controller).
   */
  start(gameId: ArcadeGameId, now: Date = new Date()): ArcadeStartResult {
    const issuedAt = now.getTime();
    return {
      runId: signArcadeRun(gameId, issuedAt, this.runSecret()),
      startedAt: now.toISOString(),
      expiresAt: new Date(issuedAt + ARCADE_RUN_TTL_MS).toISOString(),
    };
  }

  /**
   * Kiểm mã ván trước khi chạm DB: chữ ký, đúng game, còn hạn (tối đa 10 phút) và khách không khai ván dài hơn thời gian thật. Điểm tối
   * đa hợp lệ đã bị `assertPlausible` buộc theo `durationMs` (`maxScoreFor` tăng theo thời lượng), nên `durationMs <= thời gian đo + slack`
   * cũng chính là "thời gian đo >= thời gian tối thiểu để đạt điểm này": bắn thẳng kết quả vài chục mili giây sau `arcade-start` thì
   * ván tự khai 40 giây bị loại, ván tự khai ngắn thì điểm tối đa của nó nhỏ.
   * @returns giờ cấp mã (mili giây), dùng để chốt "mã dùng một lần" trong transaction.
   */
  private assertRun(runId: unknown, gameId: ArcadeGameId, durationMs: number, now: Date): number {
    const run = readArcadeRun(runId, this.runSecret());
    if (!run || run.gameId !== gameId) {
      throw new BadRequestException('Mã ván chơi chưa hợp lệ. Bạn bấm Chơi để bắt đầu một ván mới nhé.');
    }
    const elapsed = now.getTime() - run.issuedAt;
    if (elapsed > ARCADE_RUN_TTL_MS) {
      throw new BadRequestException('Ván này đã quá hạn ghi điểm (tối đa 10 phút). Bạn chơi một ván mới nhé.');
    }
    if (durationMs > elapsed + ARCADE_RUN_SLACK_MS) {
      throw new BadRequestException('Ván chơi kết thúc quá nhanh so với lúc bắt đầu. Bạn thử chơi lại một ván nhé.');
    }
    return run.issuedAt;
  }

  /**
   * Số nguyên không âm trong [0, max]. Hỏng (chuỗi lạ, âm, NaN): `whenInvalid` 'off' coi là 0 và cảnh báo (khoá tính bằng Điểm
   * Xanh, tương đương tiền: không rơi về mặc định bật ngoài ý admin), 'default' rơi về mặc định.
   */
  private async intSetting(key: string, fallback: number, max: number, whenInvalid: 'off' | 'default'): Promise<number> {
    const raw = await this.config.get<unknown>(key, fallback);
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
    if (Number.isFinite(n) && n >= 0) return Math.min(Math.floor(n), max);
    this.logger.warn(`Cấu hình ${key} không hợp lệ (${JSON.stringify(raw)}): ${whenInvalid === 'off' ? 'coi như 0' : `dùng mặc định ${fallback}`}`);
    return whenInvalid === 'off' ? 0 : fallback;
  }

  private async settings(): Promise<ArcadeSettings> {
    const [enabledRaw, waterBase, pointsPerRun] = await Promise.all([
      this.config.get<unknown>('game.arcade_enabled', ARCADE_ENABLED_DEFAULT),
      this.intSetting('game.arcade_water_base', ARCADE_WATER_BASE_DEFAULT, ARCADE_WATER_BASE_MAX, 'default'),
      this.intSetting('game.arcade_points_per_run', ARCADE_POINTS_PER_RUN_DEFAULT, ARCADE_POINTS_PER_RUN_MAX, 'off'),
    ]);
    return { enabled: enabledRaw !== false && enabledRaw !== 'false', waterBase, pointsPerRun };
  }

  /** Khung giờ thưởng chỉ có nghĩa khi game đang thưởng: tắt game thì không quảng cáo khung. */
  private windowFor(now: Date, enabled: boolean): ArcadeWindowId | null {
    return enabled ? arcadeWindowAt(now) : null;
  }

  /** Lượt thưởng đã dùng hôm nay của một game: đọc refId các dòng sổ để tách lượt cơ sở và lượt thưởng khung. */
  private usageOf(rows: readonly { refId: string | null }[]): ArcadeUsage {
    return arcadeUsageOf(rows.map((r) => r.refId));
  }

  /** Chặn điểm bịa trước khi chạm DB: thời lượng phải nằm trong khoảng một ván thật, điểm không vượt `maxScoreFor`. */
  private assertPlausible(input: ArcadeCompleteInput): void {
    const { gameId, score, durationMs } = input;
    if (!ARCADE_GAME_IDS.includes(gameId)) throw new BadRequestException('Trò chơi này chưa có trong Tubu.');
    if (!Number.isInteger(durationMs) || durationMs < ARCADE_MIN_DURATION_MS) {
      throw new BadRequestException('Ván chơi quá ngắn để ghi điểm. Bạn chơi thêm một chút rồi thử lại nhé.');
    }
    if (durationMs > ARCADE_NOMINAL_MS[gameId] + ARCADE_DURATION_SLACK_MS) {
      throw new BadRequestException('Thời gian ván chơi chưa hợp lệ. Bạn thử chơi lại một ván nhé.');
    }
    if (!Number.isInteger(score) || score < 0 || score > maxScoreFor(gameId, durationMs)) {
      throw new BadRequestException('Điểm của ván này chưa hợp lệ. Bạn thử chơi lại một ván nhé.');
    }
  }

  /**
   * Ghi một ván vừa xong: cập nhật kỷ lục rồi (nếu đủ điều kiện) cộng giọt nước và Điểm Xanh của một lượt thưởng.
   *
   * Lượt thưởng mỗi ngày VN mỗi game: 3 lượt cơ sở (refId `userId:ngày:n`) và, cho MỖI khung giờ, thêm một lượt riêng của khung đó
   * (refId `userId:ngày:bonus:khung`). Ván xong LÚC trong khung W dùng lượt cơ sở nếu còn; hết lượt cơ sở thì dùng lượt thưởng của
   * W nếu hôm nay chưa dùng; còn lại hết lượt. Ngoài khung chỉ có lượt cơ sở. Tối đa 3 + 2 = 5 lượt mỗi game mỗi ngày, và lượt
   * của khung tối không phụ thuộc buổi sáng đã dùng hết hay chưa.
   *
   * Lý do không thưởng, theo thứ tự ưu tiên: DISABLED, NOT_REAL_USER, LOW_SCORE, DAILY_CAP; ván nào cũng ghi kỷ lục, số ván và
   * `lastRunAt`. LOW_SCORE và DAILY_CAP không tiêu lượt.
   *
   * Ván phải mang `runId` do `start` cấp (xem `assertRun`): sai chữ ký, sai game, quá 10 phút, hay khai dài hơn thời gian thật thì 400;
   * mã đã dùng (cấp không muộn hơn `lastRunAt` của người nhận) thì 409. Ván bắt đầu trước khi ván trước kết thúc vì thế cũng 409.
   *
   * Mọi thứ nằm trong một transaction giữ khoá `users` rồi `game_profiles` (cùng thứ tự với nước theo đơn và Đổi rác), nên hai
   * ván của cùng khách hoàn thành song song được xếp hàng: lượt thưởng cuối của ngày chỉ có một ván ăn, và ván thứ hai thấy
   * `lastRunAt` của ván thứ nhất (cùng mã thì 409). Đếm lượt đọc sổ `game_water_events` sau
   * khi đã khoá; unique (reason, refId) theo ô lượt là chốt chặn nếu khoá bị bỏ qua ở đâu đó. `createMany(skipDuplicates)` thay
   * `create` rồi bắt P2002: lỗi unique trong transaction Postgres huỷ cả transaction, mất luôn kỷ lục vừa ghi.
   * Khách vãng lai (zaloId guest_, không SĐT) vẫn được ghi kỷ lục nhưng không nhận thưởng, và không bị tạo hồ sơ game.
   */
  async complete(userId: string, input: ArcadeCompleteInput, now: Date = new Date()): Promise<ArcadeCompleteResult> {
    this.assertPlausible(input);
    const { gameId, score, durationMs } = input;
    const issuedAt = this.assertRun(input.runId, gameId, durationMs, now);
    const settings = await this.settings();
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { zaloId: true, phone: true } });
    const real = isRealUser(user);
    const lowScore = score < ARCADE_MIN_REWARD_SCORE[gameId];
    const eligible = settings.enabled && real && !lowScore;
    const water = arcadeWater(gameId, score, settings.waterBase);
    // Đọc hạn điểm bằng kết nối pool riêng nên phải gọi ngoài transaction.
    const expiresAt = eligible && settings.pointsPerRun > 0 ? await this.loyalty.pointsExpiresAt(now) : null;
    if (eligible) await ensureGameProfile(this.prisma, this.config, userId);

    const window = this.windowFor(now, settings.enabled);
    const reason = ARCADE_WATER_REASONS[gameId];
    const dateKey = vnDateKey(now);
    const dayStart = startOfVnDay(now);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      let totalSeeds = 0;
      if (eligible) {
        const profile = await tx.$queryRaw<{ totalSeeds: number }[]>`
          SELECT "totalSeeds" FROM "game_profiles" WHERE "userId" = ${userId} FOR UPDATE`;
        if (profile.length === 0) throw new ConflictException('Hồ sơ game đang được cập nhật. Bạn thử lại sau ít giây nhé.');
        totalSeeds = profile[0]!.totalSeeds;
      } else {
        totalSeeds = (await tx.gameProfile.findUnique({ where: { userId }, select: { totalSeeds: true } }))?.totalSeeds ?? 0;
      }
      const readUsage = async () =>
        this.usageOf(await tx.gameWaterEvent.findMany({ where: { userId, reason, createdAt: { gte: dayStart } }, select: { refId: true } }));
      const prev = await tx.gameArcadeScore.findUnique({ where: { userId_gameId: { userId, gameId } } });
      // Mã dùng một lần không cần bảng riêng: ván nào cũng ghi `lastRunAt` (lúc hoàn thành, luôn sau lúc cấp mã), nên mã cấp không muộn
      // hơn `lastRunAt` của người nhận đã được dùng rồi (hoặc đã bị một ván khác vượt mặt). Giữ khoá `users` ở trên nên hai lần gửi song
      // song cùng một mã xếp hàng và lần sau thấy `lastRunAt` của lần trước.
      if (prev?.lastRunAt && issuedAt <= prev.lastRunAt.getTime()) {
        throw new ConflictException('Ván này đã được ghi rồi. Bạn bấm Chơi để bắt đầu một ván mới nhé.');
      }
      const usage = await readUsage();
      const result = (
        extra: Partial<ArcadeCompleteResult> & { bestScore: number },
        at: ArcadeUsage = usage,
      ): ArcadeCompleteResult => ({
        gameId,
        score,
        isNewBest: false,
        rewarded: false,
        reason: null,
        waterEarned: 0,
        pointsEarned: 0,
        totalSeeds,
        used: at.total,
        cap: arcadeCap(window, at),
        window,
        windowBonus: arcadeWindowBonusOpen(window, at),
        ...extra,
      });

      const isNewBest = score > (prev?.bestScore ?? 0);
      const bestScore = Math.max(prev?.bestScore ?? 0, score);
      if (prev) {
        await tx.gameArcadeScore.update({ where: { id: prev.id }, data: { bestScore, plays: { increment: 1 }, lastRunAt: now } });
      } else {
        await tx.gameArcadeScore.create({ data: { userId, gameId, bestScore, plays: 1, lastRunAt: now } });
      }

      if (!settings.enabled) return result({ bestScore, isNewBest, reason: 'DISABLED' });
      if (!real) return result({ bestScore, isNewBest, reason: 'NOT_REAL_USER' });
      if (lowScore) return result({ bestScore, isNewBest, reason: 'LOW_SCORE' });
      const slot = nextArcadeSlot(window, usage);
      if (!slot) return result({ bestScore, isNewBest, reason: 'DAILY_CAP' });

      const refId =
        slot.kind === 'base' ? arcadeBaseRefId(userId, dateKey, slot.slot) : arcadeBonusRefId(userId, dateKey, slot.window);
      const taken = await tx.gameWaterEvent.createMany({
        data: [{ userId, delta: water, reason, refId, createdAt: now }],
        skipDuplicates: true,
      });
      if (taken.count === 0) return result({ bestScore, isNewBest, reason: 'DAILY_CAP' }, await readUsage());

      const profile = await tx.gameProfile.update({
        where: { userId },
        data: { totalSeeds: { increment: water } },
        select: { totalSeeds: true },
      });
      let pointsEarned = 0;
      if (settings.pointsPerRun > 0) {
        const credited = await applyPointsDelta(tx, {
          userId,
          delta: settings.pointsPerRun,
          lot: 'STANDARD',
          reason: `${ARCADE_POINTS_REASON_PREFIX}:${gameId}`,
          refType: 'GAME',
          refId,
          expiresAt,
          skipDuplicates: true,
        });
        if (credited.applied) pointsEarned = settings.pointsPerRun;
      }
      return result({
        bestScore,
        isNewBest,
        rewarded: true,
        waterEarned: water,
        pointsEarned,
        totalSeeds: profile.totalSeeds,
        used: usage.total + 1,
      });
    });
  }

  /**
   * Kỷ lục, số ván và lượt thưởng hôm nay của từng game, cùng khung giờ thưởng đang chạy. `cap` tính riêng từng game (lượt thưởng
   * khung là của từng game); `windowBonus` ở đây là còn ít nhất một game chưa dùng lượt thưởng của khung đang chạy.
   */
  async status(userId: string, now: Date = new Date()): Promise<ArcadeStatus> {
    const settings = await this.settings();
    const window = this.windowFor(now, settings.enabled);
    const reasons = ARCADE_GAME_IDS.map((g) => ARCADE_WATER_REASONS[g]);
    const [scores, todayRows, quiz] = await Promise.all([
      this.prisma.gameArcadeScore.findMany({ where: { userId }, select: { gameId: true, bestScore: true, plays: true } }),
      this.prisma.gameWaterEvent.findMany({
        where: { userId, reason: { in: reasons }, createdAt: { gte: startOfVnDay(now) } },
        select: { reason: true, refId: true },
      }),
      this.prisma.gameWaterEvent.findUnique({
        where: { reason_refId: { reason: HOME_QUIZ_REASON, refId: userId } },
        select: { id: true },
      }),
    ]);
    const usages = Object.fromEntries(
      ARCADE_GAME_IDS.map((gameId) => [gameId, this.usageOf(todayRows.filter((r) => r.reason === ARCADE_WATER_REASONS[gameId]))]),
    ) as Record<ArcadeGameId, ArcadeUsage>;
    const games = Object.fromEntries(
      ARCADE_GAME_IDS.map((gameId) => {
        const row = scores.find((s) => s.gameId === gameId);
        const usage = usages[gameId];
        return [gameId, { bestScore: row?.bestScore ?? 0, plays: row?.plays ?? 0, used: usage.total, cap: arcadeCap(window, usage) }];
      }),
    ) as ArcadeStatus['games'];
    return {
      games,
      window,
      windowBonus: ARCADE_GAME_IDS.some((gameId) => arcadeWindowBonusOpen(window, usages[gameId])),
      nextWindowAt: settings.enabled ? nextArcadeWindowStart(now).toISOString() : null,
      quizClaimed: quiz !== null,
    };
  }

  /**
   * Thưởng một lần cho mỗi tài khoản khi làm xong thẻ chẩn đoán (unique reason+refId, refId = userId). Gọi lại trả
   * alreadyClaimed. Thưởng 0 (admin tắt) không ghi dòng sổ, nên bật lại sau vẫn nhận được. Khách vãng lai không nhận và không bị
   * tạo hồ sơ game.
   */
  async completeHomeQuiz(userId: string, now: Date = new Date()): Promise<HomeQuizResult> {
    const seeds = await this.intSetting('game.home_quiz_seeds', HOME_QUIZ_SEEDS_DEFAULT, HOME_QUIZ_SEEDS_MAX, 'default');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { zaloId: true, phone: true } });
    if (!isRealUser(user)) {
      const profile = await this.prisma.gameProfile.findUnique({ where: { userId }, select: { totalSeeds: true } });
      return { granted: 0, alreadyClaimed: false, totalSeeds: profile?.totalSeeds ?? 0 };
    }
    await ensureGameProfile(this.prisma, this.config, userId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      const profile = await tx.$queryRaw<{ totalSeeds: number }[]>`
        SELECT "totalSeeds" FROM "game_profiles" WHERE "userId" = ${userId} FOR UPDATE`;
      if (profile.length === 0) throw new ConflictException('Hồ sơ game đang được cập nhật. Bạn thử lại sau ít giây nhé.');
      const totalSeeds = profile[0]!.totalSeeds;
      const existing = await tx.gameWaterEvent.findUnique({
        where: { reason_refId: { reason: HOME_QUIZ_REASON, refId: userId } },
        select: { id: true },
      });
      if (existing) return { granted: 0, alreadyClaimed: true, totalSeeds };
      if (seeds <= 0) return { granted: 0, alreadyClaimed: false, totalSeeds };
      const taken = await tx.gameWaterEvent.createMany({
        data: [{ userId, delta: seeds, reason: HOME_QUIZ_REASON, refId: userId, createdAt: now }],
        skipDuplicates: true,
      });
      if (taken.count === 0) return { granted: 0, alreadyClaimed: true, totalSeeds };
      const updated = await tx.gameProfile.update({
        where: { userId },
        data: { totalSeeds: { increment: seeds } },
        select: { totalSeeds: true },
      });
      return { granted: seeds, alreadyClaimed: false, totalSeeds: updated.totalSeeds };
    });
  }
}
