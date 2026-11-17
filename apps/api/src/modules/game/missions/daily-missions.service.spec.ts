import { HttpException } from '@nestjs/common';
import { DAILY_ERROR_CODES, DAILY_MISSION_IDS, type DailyMissionId } from '@tubutree/shared-types';
import { DailyMissionsService } from './daily-missions.service';
import { DAILY_TEMPLATE_IDS, dailyMissionPool, pickDailyMissions } from './daily-missions';
import { deviceHash } from '../mini/game-mini-crypto';

jest.mock('../game-profile', () => ({ ensureGameProfile: jest.fn(async () => undefined) }));

const NOW = new Date('2026-11-17T03:00:00.000Z');
const DAY = '2026-11-17';
const USER = 'user-daily-1';
const REAL = { phone: '0900000001', zaloId: 'z1', createdAt: new Date('2026-10-01T00:00:00.000Z') };
const GUEST = { phone: null, zaloId: 'guest_abc' };

function setup(opts: { flags?: Record<string, unknown>; user?: object | null; done?: DailyMissionId[]; claimed?: string[]; ledger?: object | null; templates?: number } = {}) {
  const flags: Record<string, unknown> = {
    'engagement.daily_missions_enabled': true,
    'game.mini.enabled': true,
    'game.mini.daily_quiz.enabled': true,
    ...opts.flags,
  };
  const done = new Set(opts.done ?? []);
  const hit = (k: DailyMissionId) => jest.fn(async () => (done.has(k) ? { id: 'x' } : null));
  const prisma = {
    user: { findUnique: jest.fn(async () => (opts.user === undefined ? REAL : opts.user)) },
    gamePlayRound: {
      findFirst: jest.fn(async (args: { where: { game?: string } }) => {
        if (args.where.game === 'daily_quiz') return done.has('DAILY_QUIZ') ? { id: 'q' } : null;
        return done.has('DAILY_PLAY') ? { id: 'p' } : null;
      }),
    },
    gameArcadeScore: { findFirst: jest.fn(async () => null) },
    gameQuizAttempt: { findFirst: jest.fn(async () => null) },
    analyticsEvent: { findFirst: hit('DAILY_STORY') },
    wishlist: { findFirst: hit('DAILY_WISHLIST') },
    gameProfile: { findFirst: hit('DAILY_WATER') },
    gardenPlot: { findFirst: jest.fn(async () => null) },
    missionProgress: { findMany: jest.fn(async () => (opts.claimed ?? []).map((missionId) => ({ missionId }))) },
    gameDailyLedger: { findUnique: jest.fn(async () => opts.ledger ?? null) },
    mission: { count: jest.fn(async () => opts.templates ?? 4) },
  };
  const config = { get: jest.fn(async (key: string, fb: unknown) => (key in flags ? flags[key] : fb)) };
  const loyalty = { pointsExpiresAt: jest.fn(async () => new Date('2027-11-17T00:00:00.000Z')) };
  const env = { get: jest.fn(() => 'secret-for-test') };
  const reward = {
    settleDailyMission: jest.fn(async () => ({ water: 5, points: 0, bonus: false, capped: [], totalSeeds: 105 })),
  };
  const svc = new DailyMissionsService(prisma as never, config as never, loyalty as never, env as never, reward as never);
  return { svc, prisma, config, reward };
}

const todays = (quizOn = true) => pickDailyMissions(USER, DAY, dailyMissionPool(quizOn)) as [DailyMissionId, DailyMissionId, DailyMissionId];
const notTodays = (quizOn = true) => DAILY_MISSION_IDS.filter((x) => !todays(quizOn).includes(x));

async function codeOf(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), code: (e.getResponse() as { code: string }).code };
    throw e;
  }
  throw new Error('không ném lỗi');
}

describe('DailyMissionsService.today', () => {
  it('cờ tắt: trả enabled false, không đọc gì khác', async () => {
    const { svc, prisma } = setup({ flags: { 'engagement.daily_missions_enabled': false } });
    const r = await svc.today(USER, NOW);
    expect(r).toMatchObject({ enabled: false, dayKey: null, missions: [] });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.missionProgress.findMany).not.toHaveBeenCalled();
  });

  it('cờ bật: đúng 3 nhiệm vụ của ngày, đánh dấu đã làm/đã nhận, trần còn lại tính từ sổ ngày', async () => {
    const ids = todays();
    const { svc } = setup({
      done: [ids[0], ids[1]],
      claimed: [DAILY_TEMPLATE_IDS[ids[0]]],
      ledger: { waterFromGames: 30, pointsFromGames: 95 },
    });
    const r = await svc.today(USER, NOW);
    expect(r.enabled).toBe(true);
    expect(r.dayKey).toBe(DAY);
    expect(r.missions).toEqual([
      { id: ids[0], done: true, claimed: true },
      { id: ids[1], done: true, claimed: false },
      { id: ids[2], done: false, claimed: false },
    ]);
    expect(r).toMatchObject({ water: 5, bonusPoints: 10, bonusClaimed: false, pointsBlocked: false, waterLeft: 10, pointsLeft: 5 });
  });

  it('khách vãng lai: pointsBlocked true (vẫn xem được thẻ)', async () => {
    const { svc } = setup({ user: GUEST });
    expect((await svc.today(USER, NOW)).pointsBlocked).toBe(true);
  });

  it('quizPending theo Đố Xanh hôm nay, kể cả khi Đố Xanh không nằm trong 3 nhiệm vụ', async () => {
    expect((await setup({ done: [] }).svc.today(USER, NOW)).quizPending).toBe(true);
    expect((await setup({ done: ['DAILY_QUIZ'] }).svc.today(USER, NOW)).quizPending).toBe(false);
  });

  it('Đố Xanh tắt: không có DAILY_QUIZ trong ngày và không nhắc Đố Xanh', async () => {
    const { svc } = setup({ flags: { 'game.mini.daily_quiz.enabled': false } });
    const r = await svc.today(USER, NOW);
    expect(r.missions.map((m) => m.id)).toEqual(todays(false));
    expect(r.missions.map((m) => m.id)).not.toContain('DAILY_QUIZ');
    expect(r.quizPending).toBe(false);
  });

  it('đã nhận thưởng cả ngày: bonusClaimed true', async () => {
    const { svc } = setup({ claimed: [DAILY_TEMPLATE_IDS.DAILY_BONUS] });
    expect((await svc.today(USER, NOW)).bonusClaimed).toBe(true);
  });
});

describe('DailyMissionsService.claim', () => {
  const DEVICE = 'device-abcdef-123';

  it('cờ tắt: 404 DAILY_DISABLED, không ghi gì', async () => {
    const { svc, reward } = setup({ flags: { 'engagement.daily_missions_enabled': false } });
    expect(await codeOf(svc.claim(USER, todays()[0], DEVICE, NOW))).toEqual({ status: 404, code: DAILY_ERROR_CODES.disabled });
    expect(reward.settleDailyMission).not.toHaveBeenCalled();
  });

  it('mã lạ: 400 DAILY_NOT_TODAY', async () => {
    const { svc } = setup();
    expect(await codeOf(svc.claim(USER, 'DAILY_BONUS', DEVICE, NOW))).toEqual({ status: 400, code: DAILY_ERROR_CODES.notToday });
    expect(await codeOf(svc.claim(USER, 'drop table', DEVICE, NOW))).toEqual({ status: 400, code: DAILY_ERROR_CODES.notToday });
  });

  it('khách vãng lai: 403 DAILY_GUEST', async () => {
    const { svc, reward } = setup({ user: GUEST, done: todays() });
    expect(await codeOf(svc.claim(USER, todays()[0], DEVICE, NOW))).toEqual({ status: 403, code: DAILY_ERROR_CODES.guest });
    expect(reward.settleDailyMission).not.toHaveBeenCalled();
  });

  it('nhiệm vụ không thuộc 3 nhiệm vụ hôm nay: 400 DAILY_NOT_TODAY dù đã làm', async () => {
    const other = notTodays()[0]!;
    const { svc, reward } = setup({ done: [...DAILY_MISSION_IDS] });
    expect(await codeOf(svc.claim(USER, other, DEVICE, NOW))).toEqual({ status: 400, code: DAILY_ERROR_CODES.notToday });
    expect(reward.settleDailyMission).not.toHaveBeenCalled();
  });

  it('chưa làm: 400 DAILY_NOT_DONE', async () => {
    const { svc, reward } = setup({ done: [] });
    expect(await codeOf(svc.claim(USER, todays()[0], DEVICE, NOW))).toEqual({ status: 400, code: DAILY_ERROR_CODES.notDone });
    expect(reward.settleDailyMission).not.toHaveBeenCalled();
  });

  it('thiếu dòng mẫu trong bảng missions (DB chưa migrate): 404 DAILY_DISABLED', async () => {
    const { svc, reward } = setup({ done: todays(), templates: 2 });
    expect(await codeOf(svc.claim(USER, todays()[0], DEVICE, NOW))).toEqual({ status: 404, code: DAILY_ERROR_CODES.disabled });
    expect(reward.settleDailyMission).not.toHaveBeenCalled();
  });

  it('đủ điều kiện: gọi settleDailyMission đúng một lần với đủ tham số, trả đúng kết quả', async () => {
    const ids = todays();
    const { svc, reward } = setup({ done: ids });
    const r = await svc.claim(USER, ids[1], DEVICE, NOW);
    expect(reward.settleDailyMission).toHaveBeenCalledTimes(1);
    expect(reward.settleDailyMission).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        dayKey: DAY,
        now: NOW,
        missionId: DAILY_TEMPLATE_IDS[ids[1]],
        bonusMissionId: 'daily-bonus',
        dayMissionIds: ids.map((x) => DAILY_TEMPLATE_IDS[x]),
        water: 5,
        bonusPoints: 10,
        deviceHash: deviceHash('secret-for-test', DEVICE),
        pointsExpiresAt: new Date('2027-11-17T00:00:00.000Z'),
        settings: expect.objectContaining({ waterCap: 40, pointsCap: 100 }),
      }),
    );
    expect(r).toEqual({ id: ids[1], water: 5, points: 0, bonus: false, capped: [], totalSeeds: 105 });
  });
});

describe('DailyMissionsService: chặn chung của game mini', () => {
  it('công tắc tổng game.mini.enabled tắt: không có nhiệm vụ ngày và không nhận được thưởng', async () => {
    const { svc, reward } = setup({ flags: { 'game.mini.enabled': false }, done: [...DAILY_MISSION_IDS] });
    expect(await svc.today(USER, NOW)).toMatchObject({ enabled: false, missions: [] });
    expect(await codeOf(svc.claim(USER, todays()[0], 'a'.repeat(32), NOW))).toEqual({ status: 404, code: DAILY_ERROR_CODES.disabled });
    expect(reward.settleDailyMission).not.toHaveBeenCalled();
  });

  it('tài khoản chưa đủ game.mini.min_account_age_hours: 403 DAILY_TOO_NEW, không cộng gì', async () => {
    const young = { ...REAL, createdAt: new Date(NOW.getTime() - 3_600_000) };
    const { svc, reward } = setup({ flags: { 'game.mini.min_account_age_hours': 24 }, user: young, done: [...DAILY_MISSION_IDS] });
    expect(await codeOf(svc.claim(USER, todays()[0], 'a'.repeat(32), NOW))).toEqual({ status: 403, code: DAILY_ERROR_CODES.tooNew });
    expect(reward.settleDailyMission).not.toHaveBeenCalled();
  });

  it('tài khoản đủ tuổi: nhận bình thường', async () => {
    const { svc, reward } = setup({ flags: { 'game.mini.min_account_age_hours': 24 }, done: [...DAILY_MISSION_IDS] });
    await expect(svc.claim(USER, todays()[0], 'a'.repeat(32), NOW)).resolves.toMatchObject({ water: 5 });
    expect(reward.settleDailyMission).toHaveBeenCalledTimes(1);
  });
});
