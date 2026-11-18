import { randomInt } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import type { MiniGameId, MiniStartResponse, MiniSubmitResponse } from '@tubutree/shared-types';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameEconomyService } from '../../src/modules/game/game-economy.service';
import type { SeasonPassService } from '../../src/modules/game/season-pass.service';
import { DailyCheckInService } from '../../src/modules/daily-check-in/daily-check-in.service';
import { ensureGameProfile } from '../../src/modules/game/game-profile';
import { GameMiniService } from '../../src/modules/game/mini/game-mini.service';
import { GameMiniContentService } from '../../src/modules/game/mini/game-mini-content.service';
import { GameMiniRewardService } from '../../src/modules/game/mini/game-mini-reward.service';
import { vnDateKey } from '../../src/common/vn-time';
import { createRealUser, createUser, randCode, setConfig, warmPool } from './helpers';

/**
 * Lượt chơi có thưởng của game mini trên Postgres thật: nộp trùng, nhiều ván song song, trần tài khoản/thiết bị/ngân sách toàn hệ
 * thống, bình nước, Đố Xanh là điểm danh, người dùng không thật. Mỗi ca dùng một ngày giả riêng (`now` truyền vào service), lấy ngẫu
 * nhiên mỗi lần chạy, để sổ ngày và dòng ngân sách toàn hệ thống không dính ca khác hay lần chạy trước trên cùng DB; riêng Đố Xanh
 * dùng giờ thật vì điểm danh gộp đọc đồng hồ thật.
 */
describe('game mini race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;
  let analytics: AnalyticsEventsService;
  const touchedUsers: string[] = [];
  const env = { get: (k: string) => (k === 'JWT_ACCESS_SECRET' ? 'race-secret-game-mini' : undefined) } as unknown as ConfigService;

  const BASE: Record<string, Prisma.InputJsonValue> = {
    'game.mini.enabled': true,
    'game.mini.sort.enabled': true,
    'game.mini.daily_quiz.enabled': true,
    'game.mini.origin.enabled': true,
    'game.mini.match.enabled': false,
    'game.mini.basket.enabled': false,
    'game.mini.kitchen_swap.enabled': false,
    'game.mini.rounds_per_game_per_day': 2,
    'game.mini.water_daily_cap': 40,
    'game.mini.points_daily_cap': 100,
    'game.mini.accounts_per_device_per_day': 2,
    'game.mini.global_points_daily_budget': 200_000,
    'game.mini.min_account_age_hours': 0,
    'game.tank_capacity': 1000,
  };

  /** Service mới với SystemConfigService mới (cache 60 giây của bản cũ không giữ cấu hình ca trước). */
  async function makeSvc(over: Record<string, Prisma.InputJsonValue> = {}) {
    for (const [k, v] of Object.entries({ ...BASE, ...over })) await setConfig(prisma, k, v);
    const config = new SystemConfigService(prisma);
    const seasonPass = { addXp: async () => undefined } as unknown as SeasonPassService;
    const economy = new GameEconomyService(prisma, config, seasonPass, analytics);
    const checkIn = new DailyCheckInService(prisma, config, loyalty, economy);
    const content = new GameMiniContentService(prisma);
    return new GameMiniService(prisma, config, loyalty, env, content, new GameMiniRewardService(prisma), analytics, checkIn);
  }

  const BASE_DAY = Date.UTC(2031, 0, 1, 3, 0, 0) + randomInt(0, 20_000) * 86_400_000;
  const day = (n: number) => new Date(BASE_DAY + n * 86_400_000);
  const after = (d: Date, ms: number) => new Date(d.getTime() + ms);

  async function realUser() {
    const u = await createRealUser(prisma, { pointsBalance: 0 });
    touchedUsers.push(u.id);
    return u;
  }

  async function correctAnswers(start: MiniStartResponse): Promise<unknown[]> {
    const c = start.content;
    if (c.game !== 'sort' && c.game !== 'origin' && c.game !== 'daily_quiz') throw new Error(`chưa hỗ trợ ${c.game}`);
    const ids = c.items.map((i) => i.id);
    const rows = await prisma.gameContentItem.findMany({ where: { id: { in: ids } }, select: { id: true, payload: true } });
    const byId = new Map(rows.map((r) => [r.id, r.payload as Record<string, unknown>]));
    return ids.map((id) => (c.game === 'sort' ? byId.get(id)!.bin : byId.get(id)!.answer));
  }

  async function play(svc: GameMiniService, userId: string, game: MiniGameId, now: Date, deviceId = `race-dev-${userId}`) {
    const start = await svc.start(userId, game, now);
    const answers = await correctAnswers(start);
    return svc.submit(userId, game, { roundId: start.roundId, answers, deviceId }, after(now, 6_000));
  }

  /** Ván có ô thưởng ghi thẳng vào DB (như `start` đã cấp), để nộp song song nhiều ván của một tài khoản. */
  async function seedRewardedRound(userId: string, game: 'sort' | 'origin', slot: number, now: Date) {
    const size = game === 'sort' ? 10 : 5;
    const items = await prisma.gameContentItem.findMany({ where: { game, active: true }, take: size, orderBy: { id: 'asc' } });
    const round = await prisma.gamePlayRound.create({
      data: { userId, game, dayKey: vnDateKey(now), slot, contentIds: items.map((i) => i.id), issuedAt: now, expiresAt: after(now, 600_000) },
    });
    const answers = items.map((i) => (i.payload as Record<string, unknown>)[game === 'sort' ? 'bin' : 'answer']);
    return { roundId: round.id, game, answers };
  }

  function httpOf(r: PromiseSettledResult<unknown>): { status: number; code: unknown } | null {
    if (r.status !== 'rejected' || !(r.reason instanceof HttpException)) return null;
    const body = r.reason.getResponse() as { code?: unknown };
    return { status: r.reason.getStatus(), code: body?.code };
  }

  async function ledgerOf(userId: string) {
    const [rounds, water, points, ledger, user, profile] = await Promise.all([
      prisma.gamePlayRound.findMany({ where: { userId } }),
      prisma.gameWaterEvent.findMany({ where: { userId, reason: { startsWith: 'MINI_' } } }),
      prisma.pointsTransaction.findMany({ where: { userId, refType: 'GAME_MINI' } }),
      prisma.gameDailyLedger.findMany({ where: { userId } }),
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } }),
      prisma.gameProfile.findUnique({ where: { userId }, select: { totalSeeds: true, streakDays: true } }),
    ]);
    return { rounds, water, points, ledger, user, profile };
  }

  async function expectError(p: Promise<unknown>, status: number, code: string) {
    const [r] = await Promise.allSettled([p]);
    expect(httpOf(r!)).toEqual({ status, code });
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    loyalty = moduleRef.get(LoyaltyService);
    analytics = moduleRef.get(AnalyticsEventsService);
    await warmPool(prisma);

    const tag = randCode(4);
    const bins = ['recycle', 'food', 'other'];
    const source = { explanation: 'Giải thích ngắn có nguồn.', sourceUrl: 'https://example.org/nguon', active: true };
    await prisma.gameContentItem.createMany({
      data: [
        ...Array.from({ length: 12 }, (_, i) => ({
          game: 'sort',
          kind: 'sort_item',
          payload: { label: `Vật ${tag} ${i}`, bin: bins[i % 3]! },
          ...source,
        })),
        ...(['origin', 'daily_quiz'] as const).flatMap((game) =>
          Array.from({ length: 12 }, (_, i) => ({
            game,
            kind: game === 'origin' ? 'origin_question' : 'quiz_question',
            payload: { prompt: `Câu ${game} ${tag} ${i}?`, options: ['Một', 'Hai', 'Ba'], answer: i % 3 },
            ...source,
          })),
        ),
      ],
    });
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('1. 20 lần nộp song song cùng một ván: đúng 1 lần thưởng, 19 lần 409', async () => {
    const svc = await makeSvc();
    const u = await realUser();
    const now = day(1);
    const start = await svc.start(u.id, 'sort', now);
    expect(start.rewarded).toBe(true);
    const answers = await correctAnswers(start);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => svc.submit(u.id, 'sort', { roundId: start.roundId, answers, deviceId: `race-dev-${u.id}` }, after(now, 6_000))),
    );
    const ok = results.filter((r): r is PromiseFulfilledResult<MiniSubmitResponse> => r.status === 'fulfilled');
    const conflicts = results.map(httpOf).filter((h) => h?.status === 409 && h.code === 'ROUND_SUBMITTED');
    console.log('[game-mini] submit trùng ok=%d conflict=%d', ok.length, conflicts.length);
    expect(ok).toHaveLength(1);
    expect(conflicts).toHaveLength(19);
    expect(ok[0]!.value).toMatchObject({ correct: 10, total: 10, water: 10, points: 10, rewarded: true, capped: [] });

    const t = await ledgerOf(u.id);
    expect(t.water.map((w) => w.delta)).toEqual([10]);
    expect(t.points.map((p) => p.delta)).toEqual([10]);
    expect(t.user.pointsBalance).toBe(10);
    expect(t.ledger).toEqual([expect.objectContaining({ waterFromGames: 10, pointsFromGames: 10, rewardedRounds: 1 })]);
  });

  it('2. 20 ván có thưởng của một tài khoản nộp song song (2 game × 10 ô): 💧 ≤ 40, điểm ≤ 100, khớp từng dòng sổ', async () => {
    const svc = await makeSvc({ 'game.mini.rounds_per_game_per_day': 10 });
    const u = await realUser();
    const now = day(2);
    const rounds = await Promise.all(
      (['sort', 'origin'] as const).flatMap((g) => Array.from({ length: 10 }, (_, i) => seedRewardedRound(u.id, g, i + 1, now))),
    );
    const submitted = await Promise.allSettled(
      rounds.map((r) => svc.submit(u.id, r.game, { roundId: r.roundId, answers: r.answers, deviceId: `race-dev-${u.id}` }, after(now, 6_000))),
    );
    const failed = submitted.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => String(r.reason).slice(0, 300));
    expect(failed).toEqual([]);
    const out = submitted.map((r) => (r as PromiseFulfilledResult<MiniSubmitResponse>).value);
    const water = out.reduce((s, r) => s + r.water, 0);
    const points = out.reduce((s, r) => s + r.points, 0);
    console.log('[game-mini] 20 ván song song water=%d points=%d', water, points);
    expect(water).toBe(40);
    expect(points).toBe(100);

    const t = await ledgerOf(u.id);
    expect(t.water.reduce((s, w) => s + w.delta, 0)).toBe(40);
    expect(t.points.reduce((s, p) => s + p.delta, 0)).toBe(100);
    expect(t.rounds.reduce((s, r) => s + r.waterAwarded, 0)).toBe(40);
    expect(t.rounds.reduce((s, r) => s + r.pointsAwarded, 0)).toBe(100);
    expect(t.ledger).toEqual([expect.objectContaining({ waterFromGames: 40, pointsFromGames: 100 })]);
    expect(t.user.pointsBalance).toBe(100);
    expect(t.profile?.totalSeeds).toBe(40);
  });

  it('2b. 20 lần bấm Chơi song song cùng game: chỉ một ván mở, mọi lần nhận lại đúng ván đó', async () => {
    const svc = await makeSvc();
    const u = await realUser();
    const now = day(12);
    const starts = await Promise.all(Array.from({ length: 20 }, () => svc.start(u.id, 'sort', now)));
    expect(new Set(starts.map((s) => s.roundId)).size).toBe(1);
    expect(starts.every((s) => s.rewarded)).toBe(true);
    expect(new Set(starts.map((s) => JSON.stringify(s.content.game === 'sort' ? s.content.items.map((i) => i.id).sort() : []))).size).toBe(1);
    expect(await prisma.gamePlayRound.count({ where: { userId: u.id } })).toBe(1);
    const r = await svc.submit(u.id, 'sort', { roundId: starts[0]!.roundId, answers: await correctAnswers(starts[0]!), deviceId: `race-dev-${u.id}` }, after(now, 6_000));
    expect(r.rewarded).toBe(true);
    const next = await svc.start(u.id, 'sort', after(now, 7_000));
    expect(next.roundId).not.toBe(starts[0]!.roundId);
  });

  it('2c. Không gửi deviceId: ván có thưởng không được cộng (trần device)', async () => {
    const svc = await makeSvc();
    const u = await realUser();
    const now = day(13);
    const start = await svc.start(u.id, 'sort', now);
    const r = await svc.submit(u.id, 'sort', { roundId: start.roundId, answers: await correctAnswers(start) }, after(now, 6_000));
    expect(r).toMatchObject({ rewarded: true, water: 0, points: 0, capped: ['device'] });
    const t = await ledgerOf(u.id);
    expect(t.water).toEqual([]);
    expect(t.points).toEqual([]);
  });

  it('3. Cùng một thiết bị: 2 tài khoản được thưởng, tài khoản thứ 3 nhận 0 (song song)', async () => {
    const svc = await makeSvc();
    const users = await Promise.all([realUser(), realUser(), realUser()]);
    const now = day(3);
    const deviceId = `race-device-${randCode(8)}`;
    const out = await Promise.all(users.map((u) => play(svc, u.id, 'sort', now, deviceId)));
    const rewarded = out.filter((r) => r.water > 0);
    const blocked = out.filter((r) => r.water === 0);
    console.log('[game-mini] thiết bị rewarded=%d blocked=%d', rewarded.length, blocked.length);
    expect(rewarded).toHaveLength(2);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ water: 0, points: 0, capped: ['device'] });
    const registered = await prisma.gameDeviceDaily.count({ where: { dayKey: vnDateKey(day(3)), userId: { in: users.map((u) => u.id) } } });
    expect(registered).toBe(2);
  });

  it('4. Ngân sách điểm toàn hệ thống còn 5, 3 ván song song mỗi ván 10 điểm: tổng điểm ≤ 5, ván nào cũng nhận 💧', async () => {
    const svc = await makeSvc({ 'game.mini.global_points_daily_budget': 5 });
    const users = await Promise.all([realUser(), realUser(), realUser()]);
    const now = day(4);
    const out = await Promise.all(users.map((u) => play(svc, u.id, 'sort', now)));
    const points = out.reduce((s, r) => s + r.points, 0);
    console.log('[game-mini] ngân sách points=%j water=%j', out.map((r) => r.points), out.map((r) => r.water));
    expect(points).toBe(5);
    for (const r of out) expect(r.water).toBe(10);
    expect(out.filter((r) => r.capped.includes('global')).length).toBeGreaterThanOrEqual(2);
    const global = await prisma.gameGlobalDaily.findUniqueOrThrow({ where: { dayKey: vnDateKey(day(4)) } });
    expect(global.pointsMinted).toBe(5);
  });

  it('5a. Bình gần đầy: 💧 chỉ cộng tới sức chứa, ghi trần tank', async () => {
    const svc = await makeSvc();
    const u = await realUser();
    await ensureGameProfile(prisma, new SystemConfigService(prisma), u.id);
    await prisma.gameProfile.update({ where: { userId: u.id }, data: { totalSeeds: 997 } });
    const r = await play(svc, u.id, 'sort', day(5));
    expect(r).toMatchObject({ water: 3, points: 10, totalSeeds: 1000 });
    expect(r.capped).toContain('tank');
    const t = await ledgerOf(u.id);
    expect(t.water.map((w) => w.delta)).toEqual([3]);
    expect(t.profile?.totalSeeds).toBe(1000);
  });

  it('6. Ván hết hạn, ván người khác, nộp dưới 5 giây, bài sai dạng: mã lỗi đúng, không ghi sổ', async () => {
    const svc = await makeSvc();
    const [u, other] = await Promise.all([realUser(), realUser()]);
    const now = day(6);
    const start = await svc.start(u.id, 'sort', now);
    const answers = await correctAnswers(start);
    const roundId = start.roundId;
    await expectError(svc.submit(u.id, 'sort', { roundId, answers }, after(now, 11 * 60_000)), 400, 'ROUND_EXPIRED');
    await expectError(svc.submit(other.id, 'sort', { roundId, answers }, after(now, 6_000)), 404, 'ROUND_NOT_FOUND');
    await expectError(svc.submit(u.id, 'sort', { roundId, answers }, after(now, 2_000)), 400, 'ROUND_TOO_FAST');
    await expectError(svc.submit(u.id, 'sort', { roundId, answers: ['nhựa'] }, after(now, 6_000)), 400, 'ANSWERS_INVALID');
    await expectError(svc.submit(u.id, 'origin', { roundId, answers }, after(now, 6_000)), 404, 'ROUND_NOT_FOUND');
    await expectError(svc.submit(u.id, 'sort', { answers }, after(now, 6_000)), 400, 'ROUND_TOKEN_INVALID');
    await expectError(svc.submit(null, 'sort', { roundId, answers }, after(now, 6_000)), 401, 'LOGIN_REQUIRED');
    const t = await ledgerOf(u.id);
    expect(t.rounds).toEqual([expect.objectContaining({ id: roundId, submittedAt: null })]);
    expect(t.ledger).toEqual([]);
    expect(t.water).toEqual([]);
    expect(t.points).toEqual([]);
  });

  it('6b. Cờ tắt: 404 GAME_DISABLED cho today/start/submit; game lạ cũng 404', async () => {
    const off = await makeSvc({ 'game.mini.enabled': false });
    const u = await realUser();
    await expectError(off.today(u.id, day(7)), 404, 'GAME_DISABLED');
    await expectError(off.start(u.id, 'sort', day(7)), 404, 'GAME_DISABLED');
    await expectError(off.submit(u.id, 'sort', { roundId: 'x', answers: [] }, day(7)), 404, 'GAME_DISABLED');
    const sortOff = await makeSvc({ 'game.mini.sort.enabled': false });
    await expectError(sortOff.start(u.id, 'sort', day(7)), 404, 'GAME_DISABLED');
    await expectError(sortOff.start(u.id, 'arcade', day(7)), 404, 'GAME_DISABLED');
    expect((await sortOff.today(u.id, day(7))).games.map((g) => g.game)).not.toContain('sort');
  });

  it('9. Đố Xanh nộp 2 lần trong ngày: điểm danh thưởng đúng 1 lần, chuỗi ngày tăng đúng 1', async () => {
    const svc = await makeSvc();
    const u = await realUser();
    const first = await play(svc, u.id, 'daily_quiz', new Date());
    const second = await play(svc, u.id, 'daily_quiz', new Date());
    expect(first.rewarded).toBe(true);
    expect(second.rewarded).toBe(false);
    expect(second.noRewardReason).toBe('NO_REWARDED_ROUNDS_LEFT');
    expect(first.checkIn).toMatchObject({ done: true, newlyCheckedIn: true, streakDays: 1 });
    expect(second.checkIn).toMatchObject({ done: true, newlyCheckedIn: false, streakDays: 1 });
    const checkins = await prisma.pointsTransaction.count({ where: { userId: u.id, refType: 'CHECKIN' } });
    expect(checkins).toBe(1);
    const t = await ledgerOf(u.id);
    expect(t.profile?.streakDays).toBe(1);
    const today = await svc.today(u.id);
    expect(today.dailyQuizDoneToday).toBe(true);
    expect(today.games.find((g) => g.game === 'daily_quiz')).toMatchObject({ rewardedRoundsLeft: 0, playedToday: 2 });
  });

  it('10. Tài khoản không phải người dùng thật: ván không thưởng, 0 💧 0 điểm, không dòng sổ', async () => {
    const svc = await makeSvc();
    const g = await createUser(prisma, { zaloId: `guest_${randCode(10)}`, pointsBalance: 0 });
    touchedUsers.push(g.id);
    const now = day(8);
    const start = await svc.start(g.id, 'sort', now);
    expect(start).toMatchObject({ rewarded: false, noRewardReason: 'NOT_REAL_USER' });
    const r = await svc.submit(g.id, 'sort', { roundId: start.roundId, answers: await correctAnswers(start) }, after(now, 6_000));
    expect(r).toMatchObject({ correct: 10, water: 0, points: 0, rewarded: false, noRewardReason: 'NOT_REAL_USER' });
    const t = await ledgerOf(g.id);
    expect(t.water).toEqual([]);
    expect(t.points).toEqual([]);
    expect(t.ledger).toEqual([]);
  });

  it('Khách chưa đăng nhập: chơi bằng mã ván ký, chấm được, không ghi DB', async () => {
    const svc = await makeSvc();
    const now = day(9);
    const before = await prisma.gamePlayRound.count();
    const start = await svc.start(null, 'sort', now);
    expect(start).toMatchObject({ roundId: null, rewarded: false, noRewardReason: 'NOT_LOGGED_IN' });
    expect(typeof start.token).toBe('string');
    const r = await svc.submit(null, 'sort', { token: start.token, answers: await correctAnswers(start) }, after(now, 6_000));
    expect(r).toMatchObject({ correct: 10, total: 10, water: 0, points: 0, rewarded: false });
    expect(await prisma.gamePlayRound.count()).toBe(before);
  });

  it('5. Sau mọi ca: pointsBalance = SUM(points_transactions.delta), bình không vượt sức chứa', async () => {
    const rows = await prisma.$queryRaw<Array<{ id: string; balance: number; sum: bigint | null; seeds: number | null }>>`
      SELECT u."id", u."pointsBalance" AS balance,
             (SELECT SUM(p."delta") FROM "points_transactions" p WHERE p."userId" = u."id") AS sum,
             g."totalSeeds" AS seeds
        FROM "users" u LEFT JOIN "game_profiles" g ON g."userId" = u."id"
       WHERE u."id" = ANY(${touchedUsers})`;
    expect(rows).toHaveLength(touchedUsers.length);
    for (const r of rows) {
      expect({ id: r.id, balance: r.balance }).toEqual({ id: r.id, balance: Number(r.sum ?? 0) });
      expect(r.seeds ?? 0).toBeLessThanOrEqual(1000);
    }
  });
});
