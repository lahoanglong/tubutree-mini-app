import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DAILY_BONUS_POINTS,
  DAILY_ERROR_CODES,
  DAILY_MISSION_WATER,
  isDailyMissionId,
  type DailyErrorCode,
  type DailyMissionClaimResponse,
  type DailyMissionId,
  type DailyMissionsResponse,
} from '@tubutree/shared-types';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { LoyaltyService } from '../../loyalty/loyalty.service';
import { isRealUser } from '../../../common/real-user';
import { startOfVnDay, vnDateKey } from '../../../common/vn-time';
import { ensureGameProfile } from '../game-profile';
import { GameMiniRewardService } from '../mini/game-mini-reward.service';
import { deviceHash } from '../mini/game-mini-crypto';
import { isGameOn, readMiniSettings, type MiniSettings } from '../mini/game-mini.settings';
import {
  DAILY_MISSIONS_ENABLED_KEY,
  DAILY_TEMPLATE_IDS,
  dailyMissionPool,
  pickDailyMissions,
  readEngagementFlag,
} from './daily-missions';

function dailyError(status: HttpStatus, code: DailyErrorCode, message: string): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}

const OFF: DailyMissionsResponse = {
  enabled: false,
  dayKey: null,
  missions: [],
  water: DAILY_MISSION_WATER,
  bonusPoints: DAILY_BONUS_POINTS,
  bonusClaimed: false,
  pointsBlocked: false,
  waterLeft: 0,
  pointsLeft: 0,
  quizPending: false,
};

/** Sự kiện client gửi khi khách mở trang sản phẩm (trang có khối câu chuyện): dấu "xem câu chuyện sản phẩm" của ngày. */
const STORY_EVENT = 'product_viewed';

/**
 * Nhiệm vụ hằng ngày (cờ engagement.daily_missions_enabled). Việc của từng nhiệm vụ đọc từ dữ liệu sẵn có trong ngày VN, không thêm
 * đường ghi nào ở các module khác: ván game mini đã nộp, ván arcade, câu đố cũ, sự kiện mở trang sản phẩm, dòng yêu thích, lần tưới cây.
 * Thưởng chỉ đi qua GameMiniRewardService.settleDailyMission nên tính chung trần ngày, thiết bị và ngân sách của game mini.
 */
@Injectable()
export class DailyMissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly loyalty: LoyaltyService,
    private readonly env: ConfigService,
    private readonly reward: GameMiniRewardService,
  ) {}

  /**
   * Cờ riêng VÀ công tắc tổng game.mini.enabled: tắt game mini là dừng mọi đường phát 💧/điểm của nó, kể cả nhiệm vụ ngày (cùng sổ, cùng
   * trần), không để một đường phát thứ hai còn chạy.
   */
  private async settingsIfOn(): Promise<MiniSettings | null> {
    if (!(await readEngagementFlag(this.config, DAILY_MISSIONS_ENABLED_KEY))) return null;
    const settings = await readMiniSettings(this.config);
    return settings.enabled ? settings : null;
  }

  async today(userId: string, now: Date = new Date()): Promise<DailyMissionsResponse> {
    const settings = await this.settingsIfOn();
    if (!settings) return OFF;
    const quizOn = isGameOn(settings, 'daily_quiz');
    const dayKey = vnDateKey(now);
    const ids = pickDailyMissions(userId, dayKey, dailyMissionPool(quizOn));
    const doneKinds = new Set<DailyMissionId>([...ids, ...(quizOn ? (['DAILY_QUIZ'] as const) : [])]);
    const [user, done, claims, ledger] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true, zaloId: true } }),
      this.doneToday(userId, [...doneKinds], now),
      this.prisma.missionProgress.findMany({
        where: { userId, cycleKey: dayKey, missionId: { in: [...ids.map((id) => DAILY_TEMPLATE_IDS[id]), DAILY_TEMPLATE_IDS.DAILY_BONUS] } },
        select: { missionId: true },
      }),
      this.prisma.gameDailyLedger.findUnique({ where: { userId_dayKey: { userId, dayKey } } }),
    ]);
    const claimed = new Set(claims.map((c) => c.missionId));
    return {
      enabled: true,
      dayKey,
      missions: ids.map((id) => ({ id, done: done.has(id), claimed: claimed.has(DAILY_TEMPLATE_IDS[id]) })),
      water: DAILY_MISSION_WATER,
      bonusPoints: DAILY_BONUS_POINTS,
      bonusClaimed: claimed.has(DAILY_TEMPLATE_IDS.DAILY_BONUS),
      pointsBlocked: !isRealUser(user),
      waterLeft: Math.max(0, settings.waterCap - (ledger?.waterFromGames ?? 0)),
      pointsLeft: Math.max(0, settings.pointsCap - (ledger?.pointsFromGames ?? 0)),
      quizPending: quizOn && !done.has('DAILY_QUIZ'),
    };
  }

  async claim(userId: string, rawId: string, deviceId: string, now: Date = new Date()): Promise<DailyMissionClaimResponse> {
    const settings = await this.settingsIfOn();
    if (!settings) {
      throw dailyError(HttpStatus.NOT_FOUND, DAILY_ERROR_CODES.disabled, 'Nhiệm vụ hằng ngày đang tạm nghỉ.');
    }
    if (!isDailyMissionId(rawId)) {
      throw dailyError(HttpStatus.BAD_REQUEST, DAILY_ERROR_CODES.notToday, 'Nhiệm vụ này không có trong ngày hôm nay của bạn.');
    }
    const id = rawId;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true, zaloId: true, createdAt: true } });
    if (!user || !isRealUser(user)) {
      throw dailyError(HttpStatus.FORBIDDEN, DAILY_ERROR_CODES.guest, 'Bạn đăng nhập Zalo để nhận thưởng nhiệm vụ nhé.');
    }
    if (settings.minAccountAgeHours > 0 && now.getTime() - user.createdAt.getTime() < settings.minAccountAgeHours * 3_600_000) {
      throw dailyError(HttpStatus.FORBIDDEN, DAILY_ERROR_CODES.tooNew, 'Tài khoản mới tạo chưa nhận được thưởng nhiệm vụ, bạn quay lại sau nhé.');
    }
    const dayKey = vnDateKey(now);
    const ids = pickDailyMissions(userId, dayKey, dailyMissionPool(isGameOn(settings, 'daily_quiz')));
    if (!ids.includes(id)) {
      throw dailyError(HttpStatus.BAD_REQUEST, DAILY_ERROR_CODES.notToday, 'Nhiệm vụ này không có trong ngày hôm nay của bạn.');
    }
    if (!(await this.doneToday(userId, [id], now)).has(id)) {
      throw dailyError(HttpStatus.BAD_REQUEST, DAILY_ERROR_CODES.notDone, 'Bạn làm xong nhiệm vụ này rồi bấm nhận nhé.');
    }
    const templates = await this.prisma.mission.count({ where: { id: { in: [...ids.map((x) => DAILY_TEMPLATE_IDS[x]), DAILY_TEMPLATE_IDS.DAILY_BONUS] } } });
    if (templates !== ids.length + 1) {
      throw dailyError(HttpStatus.NOT_FOUND, DAILY_ERROR_CODES.disabled, 'Nhiệm vụ hằng ngày đang tạm nghỉ.');
    }

    await ensureGameProfile(this.prisma, this.config, userId);
    const pointsExpiresAt = await this.loyalty.pointsExpiresAt(now);
    const settled = await this.reward.settleDailyMission({
      userId,
      dayKey,
      now,
      missionId: DAILY_TEMPLATE_IDS[id],
      bonusMissionId: DAILY_TEMPLATE_IDS.DAILY_BONUS,
      dayMissionIds: ids.map((x) => DAILY_TEMPLATE_IDS[x]),
      water: DAILY_MISSION_WATER,
      bonusPoints: DAILY_BONUS_POINTS,
      deviceHash: deviceHash(this.env.get<string>('JWT_ACCESS_SECRET') || undefined, deviceId),
      settings,
      pointsExpiresAt,
    });
    return { id, water: settled.water, points: settled.points, bonus: settled.bonus, capped: settled.capped, totalSeeds: settled.totalSeeds };
  }

  /**
   * Nhiệm vụ nào trong `kinds` khách đã làm trong ngày VN của `now`. Chỉ đọc. Mốc "trong ngày" là giờ máy chủ: sự kiện mở trang sản
   * phẩm lọc theo lúc máy chủ nhận (`receivedAt`), không theo giờ client tự khai.
   */
  private async doneToday(userId: string, kinds: DailyMissionId[], now: Date): Promise<Set<DailyMissionId>> {
    const dayKey = vnDateKey(now);
    const since = startOfVnDay(now);
    const want = new Set(kinds);
    const found = (p: Promise<unknown>): Promise<boolean> => p.then((r) => r !== null && r !== undefined);
    const checks: Array<Promise<[DailyMissionId, boolean]>> = [];
    const add = (id: DailyMissionId, probes: Array<Promise<unknown>>) =>
      checks.push(Promise.all(probes.map(found)).then((r): [DailyMissionId, boolean] => [id, r.some(Boolean)]));
    const pick = { select: { id: true } } as const;
    if (want.has('DAILY_QUIZ')) {
      add('DAILY_QUIZ', [this.prisma.gamePlayRound.findFirst({ where: { userId, game: 'daily_quiz', dayKey, submittedAt: { not: null } }, ...pick })]);
    }
    if (want.has('DAILY_PLAY')) {
      add('DAILY_PLAY', [
        this.prisma.gamePlayRound.findFirst({ where: { userId, dayKey, submittedAt: { not: null } }, ...pick }),
        this.prisma.gameArcadeScore.findFirst({ where: { userId, lastRunAt: { gte: since } }, ...pick }),
        this.prisma.gameQuizAttempt.findFirst({ where: { userId, dayKey }, ...pick }),
      ]);
    }
    if (want.has('DAILY_STORY')) {
      add('DAILY_STORY', [this.prisma.analyticsEvent.findFirst({ where: { userId, eventName: STORY_EVENT, receivedAt: { gte: since } }, ...pick })]);
    }
    if (want.has('DAILY_WISHLIST')) {
      add('DAILY_WISHLIST', [this.prisma.wishlist.findFirst({ where: { userId, createdAt: { gte: since } }, ...pick })]);
    }
    if (want.has('DAILY_WATER')) {
      add('DAILY_WATER', [
        this.prisma.gameProfile.findFirst({ where: { userId, lastWateredAt: { gte: since } }, ...pick }),
        this.prisma.gardenPlot.findFirst({ where: { userId, lastWateredAt: { gte: since } }, ...pick }),
      ]);
    }
    const results = await Promise.all(checks);
    return new Set(results.filter(([, ok]) => ok).map(([k]) => k));
  }
}
