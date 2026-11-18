import { randomInt } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { ALBUM_BADGE_IDS, type DailyMissionId } from '@tubutree/shared-types';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameEconomyService } from '../../src/modules/game/game-economy.service';
import type { SeasonPassService } from '../../src/modules/game/season-pass.service';
import { DailyCheckInService } from '../../src/modules/daily-check-in/daily-check-in.service';
import { GameMiniService } from '../../src/modules/game/mini/game-mini.service';
import { GameMiniContentService } from '../../src/modules/game/mini/game-mini-content.service';
import { GameMiniRewardService } from '../../src/modules/game/mini/game-mini-reward.service';
import { DailyMissionsService } from '../../src/modules/game/missions/daily-missions.service';
import { BadgesService } from '../../src/modules/game/missions/badges.service';
import { dailyMissionPool, pickDailyMissions } from '../../src/modules/game/missions/daily-missions';
import { GameAlbumService } from '../../src/modules/game/album/album.service';
import { ALBUM_BADGE_RULES, albumUserFilter } from '../../src/modules/game/album/album-badges';
import { vnDateKey } from '../../src/common/vn-time';
import { createRealUser, randCode, setConfig, warmPool } from './helpers';

/**
 * Sổ tay Xanh trên Postgres thật: bậc thuộc bài tính lúc đọc, ván "Ôn 5 thẻ" không ghi `game_play_rounds` và không chạm thưởng, nhiệm vụ, chuỗi hay
 * trần, trần 20 ván ôn/ngày, hai lần bắt đầu và hai lần nộp song song, huy hiệu SQL khớp cách tính của service, cờ tắt, và đo p95 với 400 ván.
 * Ngày giả riêng mỗi lần chạy để sổ ngày không dính spec khác trên cùng DB.
 */
describe('Sổ tay Xanh (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;
  let analytics: AnalyticsEventsService;
  const env = { get: (k: string) => (k === 'JWT_ACCESS_SECRET' ? 'race-secret-album' : undefined) } as unknown as ConfigService;

  const BASE: Record<string, Prisma.InputJsonValue> = {
    'game.album_enabled': true,
    'engagement.daily_missions_enabled': true,
    'engagement.badges_enabled': true,
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

  async function makeServices(over: Record<string, Prisma.InputJsonValue> = {}) {
    for (const [k, v] of Object.entries({ ...BASE, ...over })) await setConfig(prisma, k, v);
    const config = new SystemConfigService(prisma);
    const reward = new GameMiniRewardService(prisma);
    const seasonPass = { addXp: async () => undefined } as unknown as SeasonPassService;
    const economy = new GameEconomyService(prisma, config, seasonPass, analytics);
    const checkIn = new DailyCheckInService(prisma, config, loyalty, economy);
    const content = new GameMiniContentService(prisma);
    return {
      album: new GameAlbumService(prisma, config, content),
      mini: new GameMiniService(prisma, config, loyalty, env, content, reward, analytics, checkIn),
      daily: new DailyMissionsService(prisma, config, loyalty, env, reward),
      badges: new BadgesService(prisma, config),
    };
  }

  const BASE_DAY = Date.UTC(2033, 0, 1, 3, 0, 0) + randomInt(0, 20_000) * 86_400_000;
  const day = (n: number) => new Date(BASE_DAY + n * 86_400_000);
  const after = (d: Date, ms: number) => new Date(d.getTime() + ms);

  const tag = randCode(6);
  const sortIds: string[] = [];
  const originIds: string[] = [];
  let unverifiedId = '';
  const users: string[] = [];

  async function user() {
    const u = await createRealUser(prisma, { pointsBalance: 0 });
    users.push(u.id);
    return u.id;
  }

  async function round(userId: string, game: string, contentIds: string[], correctIds: string[], at: Date) {
    return prisma.gamePlayRound.create({
      data: { userId, game, dayKey: vnDateKey(at), contentIds, correctIds, issuedAt: after(at, -30_000), expiresAt: after(at, 600_000), submittedAt: at, correct: correctIds.length, total: contentIds.length },
    });
  }

  function httpOf(r: PromiseSettledResult<unknown>): { status: number; code: unknown } | null {
    if (r.status !== 'rejected' || !(r.reason instanceof HttpException)) return null;
    return { status: r.reason.getStatus(), code: (r.reason.getResponse() as { code?: unknown })?.code };
  }

  const counts = async (userId: string) => {
    const [rounds, reviews, water, points, ledger, profile, claims] = await Promise.all([
      prisma.gamePlayRound.count({ where: { userId } }),
      prisma.gameAlbumReview.count({ where: { userId } }),
      prisma.gameWaterEvent.count({ where: { userId } }),
      prisma.pointsTransaction.count({ where: { userId } }),
      prisma.gameDailyLedger.count({ where: { userId } }),
      prisma.gameProfile.findUnique({ where: { userId }, select: { streakDays: true, longestStreak: true, lastCheckInAt: true } }),
      prisma.missionProgress.count({ where: { userId } }),
    ]);
    return { rounds, reviews, water, points, ledger, profile, claims };
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    loyalty = moduleRef.get(LoyaltyService);
    analytics = moduleRef.get(AnalyticsEventsService);
    await warmPool(prisma);
    const checked = { explanation: `Giải thích ${tag}.`, sourceUrl: 'https://example.org/nguon', sourceCheckedAt: new Date('2032-11-17T00:00:00Z'), active: true };
    const bins = ['recycle', 'food', 'other'];
    for (let i = 0; i < 12; i++) {
      const r = await prisma.gameContentItem.create({ data: { game: 'sort', kind: 'sort_item', payload: { label: `Vật sổ ${tag} ${i}`, bin: bins[i % 3]! }, ...checked } });
      sortIds.push(r.id);
    }
    for (let i = 0; i < 12; i++) {
      const r = await prisma.gameContentItem.create({
        data: { game: 'origin', kind: 'origin_question', payload: { prompt: `Câu sổ ${tag} ${i}?`, options: ['Một', 'Hai', 'Ba'], answer: i % 3 }, ...checked },
      });
      originIds.push(r.id);
    }
    const u = await prisma.gameContentItem.create({
      data: { game: 'sort', kind: 'sort_item', payload: { label: `Chưa kiểm nguồn ${tag}`, bin: 'food' }, explanation: 'x', sourceUrl: 'https://example.org/x', active: true },
    });
    unverifiedId = u.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.gameContentItem.deleteMany({ where: { id: { in: [...sortIds, ...originIds, unverifiedId] } } });
    }
    await moduleRef?.close();
  });

  it('1. bậc thuộc bài: đúng hai lần cùng ngày vẫn bậc 2, hai ngày là bậc 3; thẻ chưa gặp và mục chưa kiểm nguồn không lộ; mục tắt giữ thẻ, rời mẫu số', async () => {
    const { album } = await makeServices();
    const uid = await user();
    const [s0, s1, s2] = sortIds;
    await round(uid, 'sort', [s0!, s1!, s2!, unverifiedId], [s0!, s1!, unverifiedId], day(1));
    await round(uid, 'sort', [s0!], [s0!], after(day(1), 3_600_000));
    await round(uid, 'sort', [s1!], [s1!], day(2));
    const r = await album.album(uid, {}, day(2));
    const level = Object.fromEntries(r.cards.map((c) => [c.id, c.level]));
    expect(level).toEqual({ [s0!]: 2, [s1!]: 3, [s2!]: 1 });
    expect(r.cards.find((c) => c.id === s1)).toMatchObject({ topic: 'waste', seen: 2, correct: 2, lastSeenDay: vnDateKey(day(2)), retired: false, product: null });
    const body = JSON.stringify(r);
    expect(body).not.toContain(`Vật sổ ${tag} 3`);
    expect(body).not.toContain(`Câu sổ ${tag} 0`);
    expect(body).not.toContain(`Chưa kiểm nguồn ${tag}`);
    const waste = r.topics.find((t) => t.id === 'waste')!;
    expect(waste.seen).toBeGreaterThanOrEqual(3);

    await prisma.gameContentItem.update({ where: { id: s2! }, data: { active: false } });
    try {
      const again = await (await makeServices()).album.album(uid, {}, day(2));
      expect(again.cards.find((c) => c.id === s2)).toMatchObject({ retired: true, level: 1 });
      const w2 = again.topics.find((t) => t.id === 'waste')!;
      expect(w2.total).toBe(waste.total - 1);
      expect(w2.seen).toBe(waste.seen - 1);
    } finally {
      await prisma.gameContentItem.update({ where: { id: s2! }, data: { active: true } });
    }
  });

  it('2. ván ôn: không ghi game_play_rounds, 0 💧 và 0 điểm, DAILY_PLAY/DAILY_QUIZ vẫn chưa xong, today và chuỗi không đổi', async () => {
    const { album, mini, daily } = await makeServices();
    const uid = await user();
    // Ngày có DAILY_PLAY trong 3 nhiệm vụ của khách này, để kiểm được "chưa xong".
    let n = 10;
    while (!pickDailyMissions(uid, vnDateKey(day(n)), dailyMissionPool(true)).includes('DAILY_PLAY' as DailyMissionId)) n += 1;
    const now = day(n);
    await round(uid, 'origin', originIds.slice(0, 5), [], day(n - 5));
    const before = await counts(uid);
    const todayBefore = await mini.today(uid, now);
    const dailyBefore = await daily.today(uid, now);
    expect(dailyBefore.quizPending).toBe(true);
    expect(dailyBefore.missions.find((m) => m.id === 'DAILY_PLAY')?.done).toBe(false);

    const start = await album.startReview(uid, now);
    expect(start).toMatchObject({ game: 'daily_quiz', token: null, rewarded: false, noRewardReason: null });
    expect(start.content.items).toHaveLength(5);
    expect(start.content.items.every((i) => i.product === null && !('answer' in i))).toBe(true);
    const res = await album.submitReview(uid, { roundId: start.roundId!, answers: start.content.items.map(() => 0) }, after(now, 8_000));
    expect(res).toMatchObject({ water: 0, points: 0, baseWater: 0, basePoints: 0, rewarded: false, capped: [], checkIn: null, total: 5 });

    const afterCounts = await counts(uid);
    expect(afterCounts).toEqual({ ...before, reviews: before.reviews + 1 });
    expect(await prisma.gamePlayRound.count({ where: { userId: uid, dayKey: vnDateKey(now) } })).toBe(0);
    expect(await mini.today(uid, after(now, 9_000))).toEqual(todayBefore);
    const dailyAfter = await daily.today(uid, after(now, 9_000));
    expect(dailyAfter.quizPending).toBe(true);
    expect(dailyAfter.missions.find((m) => m.id === 'DAILY_PLAY')?.done).toBe(false);
    const claim = await Promise.allSettled([daily.claim(uid, 'DAILY_PLAY', `dev-${uid}`, after(now, 9_000))]);
    expect(httpOf(claim[0]!)).toMatchObject({ code: 'DAILY_NOT_DONE' });
    expect(await counts(uid)).toEqual(afterCounts);

    // Kết quả ván ôn cập nhật bậc như ván thường; mục vừa ôn hôm nay không vào ván ôn kế.
    const r = await album.album(uid, {}, after(now, 10_000));
    expect(r.cards.filter((c) => originIds.slice(0, 5).includes(c.id)).every((c) => c.seen === 2)).toBe(true);
    const next = await Promise.allSettled([album.startReview(uid, after(now, 11_000))]);
    expect(httpOf(next[0]!)).toEqual({ status: 404, code: 'GAME_NO_CONTENT' });
  });

  it('3. trần 20 ván ôn mỗi ngày: ván thứ 21 trả 429 ROUND_LIMIT', async () => {
    const { album } = await makeServices();
    const uid = await user();
    const now = day(40);
    await round(uid, 'origin', originIds, [], day(30));
    for (let i = 0; i < 20; i++) {
      await prisma.gameAlbumReview.create({
        data: { userId: uid, dayKey: vnDateKey(now), contentIds: [], questions: [], issuedAt: after(now, -60_000), expiresAt: after(now, -1_000), submittedAt: after(now, -30_000) },
      });
    }
    expect((await album.album(uid, { summary: true }, now)).review.leftToday).toBe(0);
    const r = await Promise.allSettled([album.startReview(uid, now)]);
    expect(httpOf(r[0]!)).toEqual({ status: 429, code: 'ROUND_LIMIT' });
  });

  it('4. hai lần bắt đầu song song: một ván, cả hai nhận cùng mã ván; hai lần nộp song song: một lần chấm, lần kia 409', async () => {
    const { album } = await makeServices();
    const uid = await user();
    const now = day(60);
    await round(uid, 'sort', sortIds.slice(0, 6), [], day(50));
    const starts = await Promise.allSettled(Array.from({ length: 6 }, () => album.startReview(uid, now)));
    const ok = starts.filter((s): s is PromiseFulfilledResult<Awaited<ReturnType<GameAlbumService['startReview']>>> => s.status === 'fulfilled');
    expect(ok).toHaveLength(6);
    expect(new Set(ok.map((s) => s.value.roundId)).size).toBe(1);
    expect(await prisma.gameAlbumReview.count({ where: { userId: uid } })).toBe(1);
    expect((await album.album(uid, { summary: true }, now)).review).toEqual({ due: 5, leftToday: 19 });
    const reviewId = ok[0]!.value.roundId!;
    const answers = ok[0]!.value.content.items.map(() => 1);
    const submits = await Promise.allSettled(Array.from({ length: 4 }, () => album.submitReview(uid, { roundId: reviewId, answers }, after(now, 7_000))));
    expect(submits.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    expect(submits.map(httpOf).filter((h) => h?.status === 409 && h.code === 'ROUND_SUBMITTED')).toHaveLength(3);
    const row = await prisma.gameAlbumReview.findUniqueOrThrow({ where: { id: reviewId } });
    expect(row.submittedAt).not.toBeNull();
    expect(row.total).toBe(5);
  });

  it('5. huy hiệu: cờ huy hiệu chung tắt thì không cấp; SQL cấp khớp cách tính của service; thuộc cả sổ thì có đủ 3; API huy hiệu chung không đổi dù cờ sổ bật hay tắt', async () => {
    const uid = await user();
    const ten = [...sortIds.slice(0, 5), ...originIds.slice(0, 5)];
    await round(uid, 'sort', ten.slice(0, 5), ten.slice(0, 5), day(70));
    await round(uid, 'origin', ten.slice(5), ten.slice(5), day(70));
    await round(uid, 'sort', ten.slice(0, 5), ten.slice(0, 5), day(71));
    await round(uid, 'origin', ten.slice(5), ten.slice(5), day(71));
    const quiet = await makeServices({ 'engagement.badges_enabled': false });
    expect((await quiet.album.album(uid, {}, day(71))).badges.every((b) => !b.earned)).toBe(true);
    expect(await prisma.userBadge.count({ where: { userId: uid } })).toBe(0);
    // Cờ nằm trong system_configs: dựng lại để ghi lại cờ gốc (huy hiệu bật).
    const { album, badges } = await makeServices();
    const r = await album.album(uid, {}, day(71));
    expect(r.badges.find((b) => b.id === 'ALBUM_MASTER_10')).toMatchObject({ earned: true });
    for (const id of ALBUM_BADGE_IDS) {
      const sqlHit = (await prisma.$queryRaw<{ userId: string }[]>(ALBUM_BADGE_RULES[id](albumUserFilter(uid)))).length > 0;
      expect([id, sqlHit]).toEqual([id, r.badges.find((b) => b.id === id)!.earned]);
    }

    // Thuộc mọi mục đang bật có vào sổ trên DB lúc này (kể cả của spec khác): đủ "trọn chủ đề" và "cả sổ".
    const all = await prisma.gameContentItem.findMany({
      where: { active: true, sourceCheckedAt: { not: null }, game: { in: ['sort', 'daily_quiz', 'match', 'origin', 'kitchen_swap'] } },
      select: { id: true },
    });
    const uid2 = await user();
    const ids = all.map((x) => x.id);
    await prisma.gameAlbumReview.create({ data: { userId: uid2, dayKey: vnDateKey(day(80)), contentIds: ids, correctIds: ids, questions: [], expiresAt: day(80), submittedAt: day(80) } });
    await prisma.gameAlbumReview.create({ data: { userId: uid2, dayKey: vnDateKey(day(81)), contentIds: ids, correctIds: ids, questions: [], expiresAt: day(81), submittedAt: day(81) } });
    const full = await album.album(uid2, { summary: true }, day(81));
    expect(full.mastered).toBe(full.total);
    expect(full.badges.map((b) => [b.id, b.earned])).toEqual(ALBUM_BADGE_IDS.map((id) => [id, true]));
    expect(await prisma.userBadge.count({ where: { userId: uid2, badge: { in: [...ALBUM_BADGE_IDS] } } })).toBe(3);

    const listOn = await badges.list(uid2, day(81));
    const off = await makeServices({ 'game.album_enabled': false });
    const listOff = await off.badges.list(uid2, day(81));
    expect(listOn).toEqual(listOff);
    expect(listOn.badges.some((b) => (ALBUM_BADGE_IDS as readonly string[]).includes(b.id))).toBe(false);
  });

  it('6. cờ tắt: cả ba route 404, không ghi ván ôn; today của game mini không đọc cờ sổ (bật hay tắt như nhau)', async () => {
    const uid = await user();
    const now = day(90);
    await round(uid, 'sort', sortIds.slice(0, 3), [], day(85));
    const on = await makeServices();
    const todayOn = await on.mini.today(uid, now);
    const off = await makeServices({ 'game.album_enabled': false });
    for (const p of [off.album.album(uid, {}, now), off.album.startReview(uid, now), off.album.submitReview(uid, { roundId: 'x', answers: [] }, now)]) {
      expect(httpOf((await Promise.allSettled([p]))[0]!)).toEqual({ status: 404, code: 'GAME_DISABLED' });
    }
    expect(await off.mini.today(uid, now)).toEqual(todayOn);
    expect(await prisma.gameAlbumReview.count({ where: { userId: uid } })).toBe(0);
  });

  it('7. hiệu năng: tài khoản 400 ván, đọc sổ khi đệm nguội p95 < 60 ms', async () => {
    const { album } = await makeServices();
    const uid = await user();
    const rows: Prisma.GamePlayRoundCreateManyInput[] = [];
    for (let i = 0; i < 400; i++) {
      const at = after(day(100), i * 3 * 3_600_000);
      const pool = i % 2 === 0 ? sortIds : originIds;
      const ids = Array.from({ length: i % 2 === 0 ? 10 : 5 }, (_, k) => pool[(i + k) % pool.length]!);
      rows.push({ userId: uid, game: i % 2 === 0 ? 'sort' : 'origin', dayKey: vnDateKey(at), contentIds: ids, correctIds: ids.filter((_, k) => k % 3 !== 0), issuedAt: after(at, -30_000), expiresAt: after(at, 600_000), submittedAt: at, correct: 1, total: ids.length });
    }
    await prisma.gamePlayRound.createMany({ data: rows });
    const now = after(day(100), 400 * 3 * 3_600_000);
    await album.album(uid, {}, now);
    const cold: number[] = [];
    const warm: number[] = [];
    for (let i = 0; i < 40; i++) {
      album.invalidate(uid);
      let t = process.hrtime.bigint();
      await album.album(uid, {}, now);
      cold.push(Number(process.hrtime.bigint() - t) / 1e6);
      t = process.hrtime.bigint();
      await album.album(uid, {}, now);
      warm.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * q) - 1]!;
    console.log(
      `[album bench] 400 ván: nguội p50=${pct(cold, 0.5).toFixed(1)} p95=${pct(cold, 0.95).toFixed(1)} ms; ấm p50=${pct(warm, 0.5).toFixed(1)} p95=${pct(warm, 0.95).toFixed(1)} ms`,
    );
    expect(pct(cold, 0.95)).toBeLessThan(60);
    expect(pct(warm, 0.95)).toBeLessThan(60);
  });
});
