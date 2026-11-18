import { randomBytes, randomInt } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { BADGE_IDS, type DailyMissionClaimResponse, type MiniSubmitResponse } from '@tubutree/shared-types';
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
import { DAILY_TEMPLATE_IDS, dailyMissionPool, pickDailyMissions } from '../../src/modules/game/missions/daily-missions';
import { REFERRAL_ORDER2_PREFIX, REFERRAL_ORDER2_REVOKE_PREFIX } from '../../src/modules/wallet/referral-reward';
import { vnDateKey } from '../../src/common/vn-time';
import { createOrder, createRealUser, createUser, randCode, setConfig, warmPool } from './helpers';
import { createWarehouse } from './fixtures/waste-fixtures';

/**
 * Nhiệm vụ hằng ngày và huy hiệu trên Postgres thật. Mỗi ca dùng một ngày giả riêng (`now` truyền vào service), ngẫu nhiên mỗi lần
 * chạy, để sổ ngày, trần thiết bị và ngân sách toàn hệ thống không dính ca khác hay lần chạy trước trên cùng DB.
 */
describe('engagement daily missions + badges race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;
  let analytics: AnalyticsEventsService;
  const touchedUsers: string[] = [];
  const env = { get: (k: string) => (k === 'JWT_ACCESS_SECRET' ? 'race-secret-engagement' : undefined) } as unknown as ConfigService;

  const BASE: Record<string, Prisma.InputJsonValue> = {
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
    const mini = new GameMiniService(prisma, config, loyalty, env, new GameMiniContentService(prisma), reward, analytics, checkIn);
    return {
      daily: new DailyMissionsService(prisma, config, loyalty, env, reward),
      badges: new BadgesService(prisma, config),
      mini,
    };
  }

  const BASE_DAY = Date.UTC(2032, 0, 1, 3, 0, 0) + randomInt(0, 20_000) * 86_400_000;
  const day = (n: number) => new Date(BASE_DAY + n * 86_400_000);
  const after = (d: Date, ms: number) => new Date(d.getTime() + ms);

  async function realUser() {
    const u = await createRealUser(prisma, { pointsBalance: 0 });
    touchedUsers.push(u.id);
    return u;
  }

  let productId = '';

  /** Làm đủ cả 5 việc của ngày `now` (ghi thẳng dữ liệu nguồn mà service đọc), để mọi nhiệm vụ được chọn đều nhận được. */
  async function doEverything(userId: string, now: Date) {
    const dayKey = vnDateKey(now);
    await prisma.gamePlayRound.create({
      data: { userId, game: 'daily_quiz', dayKey, contentIds: [], issuedAt: now, expiresAt: after(now, 600_000), submittedAt: now, correct: 3, total: 3 },
    });
    await prisma.analyticsEvent.create({
      data: { eventId: `it-eng-${randomBytes(8).toString('hex')}`, eventName: 'product_viewed', occurredAt: now, receivedAt: now, userId, platform: 'web', props: {} },
    });
    await prisma.wishlist.create({ data: { userId, productId, createdAt: now } });
    await prisma.gameProfile.upsert({
      where: { userId },
      create: { userId, lastWateredAt: now },
      update: { lastWateredAt: now },
    });
  }

  function httpOf(r: PromiseSettledResult<unknown>): { status: number; code: unknown } | null {
    if (r.status !== 'rejected' || !(r.reason instanceof HttpException)) return null;
    const body = r.reason.getResponse() as { code?: unknown };
    return { status: r.reason.getStatus(), code: body?.code };
  }

  async function ledgerOf(userId: string) {
    const [water, points, ledger, user, claims] = await Promise.all([
      prisma.gameWaterEvent.findMany({ where: { userId, reason: { startsWith: 'MINI_' } } }),
      prisma.pointsTransaction.findMany({ where: { userId, refType: 'GAME_MINI' } }),
      prisma.gameDailyLedger.findMany({ where: { userId } }),
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } }),
      prisma.missionProgress.findMany({ where: { userId, missionId: { startsWith: 'daily-' } } }),
    ]);
    return { water, points, ledger, user, claims };
  }

  const sum = (xs: Array<{ delta: number }>) => xs.reduce((s, x) => s + x.delta, 0);

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

    const tag = randCode(6);
    const p = await prisma.product.create({
      data: { pancakeId: `it-eng-p-${tag}`, brand: 'IT', slug: `it-eng-${tag.toLowerCase()}`, name: `SP nhiệm vụ ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    productId = p.id;

    const bins = ['recycle', 'food', 'other'];
    const source = { explanation: 'Giải thích ngắn có nguồn.', sourceUrl: 'https://example.org/nguon', active: true };
    await prisma.gameContentItem.createMany({
      data: [
        ...Array.from({ length: 12 }, (_, i) => ({ game: 'sort', kind: 'sort_item', payload: { label: `Vật ${tag} ${i}`, bin: bins[i % 3]! }, ...source })),
        ...Array.from({ length: 12 }, (_, i) => ({
          game: 'origin',
          kind: 'origin_question',
          payload: { prompt: `Câu origin ${tag} ${i}?`, options: ['Một', 'Hai', 'Ba'], answer: i % 3 },
          ...source,
        })),
      ],
    });

    const templates = await prisma.mission.findMany({ where: { id: { in: Object.values(DAILY_TEMPLATE_IDS) } }, select: { id: true, disabledAt: true } });
    expect(templates).toHaveLength(6);
    for (const t of templates) expect(t.disabledAt).not.toBeNull();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  describe('nhiệm vụ hằng ngày', () => {
    it('1. 20 lần nhận song song cùng một nhiệm vụ: đúng 1 lần thưởng 💧5, 19 lần 409 DAILY_CLAIMED', async () => {
      const { daily } = await makeServices();
      const u = await realUser();
      const now = day(1);
      await doEverything(u.id, now);
      const [first] = pickDailyMissions(u.id, vnDateKey(now), dailyMissionPool(true));
      const results = await Promise.allSettled(Array.from({ length: 20 }, () => daily.claim(u.id, first!, `race-dev-${u.id}`, now)));
      const ok = results.filter((r): r is PromiseFulfilledResult<DailyMissionClaimResponse> => r.status === 'fulfilled');
      const conflicts = results.map(httpOf).filter((h) => h?.status === 409 && h.code === 'DAILY_CLAIMED');
      const other = results.filter((r) => r.status === 'rejected' && !(r.reason instanceof HttpException)).map((r) => String((r as PromiseRejectedResult).reason).slice(0, 300));
      console.log('[engagement] nhận trùng ok=%d conflict=%d', ok.length, conflicts.length);
      expect(other).toEqual([]);
      expect(ok).toHaveLength(1);
      expect(conflicts).toHaveLength(19);
      expect(ok[0]!.value).toMatchObject({ id: first, water: 5, points: 0, bonus: false, capped: [] });

      const t = await ledgerOf(u.id);
      expect(t.water.map((w) => [w.reason, w.delta])).toEqual([['MINI_DAILY_MISSION', 5]]);
      expect(t.points).toEqual([]);
      expect(t.claims).toHaveLength(1);
      expect(t.ledger).toEqual([expect.objectContaining({ waterFromGames: 5, pointsFromGames: 0, rewardedRounds: 0 })]);
    });

    it('2. Ba nhiệm vụ nhận song song (mỗi cái 5 lần): mỗi cái 💧5 một lần, thưởng cả ngày +10 điểm đúng một lần', async () => {
      const { daily } = await makeServices();
      const u = await realUser();
      const now = day(2);
      await doEverything(u.id, now);
      const ids = pickDailyMissions(u.id, vnDateKey(now), dailyMissionPool(true));
      const results = await Promise.allSettled(ids.flatMap((id) => Array.from({ length: 5 }, () => daily.claim(u.id, id, `race-dev-${u.id}`, now))));
      const ok = results.filter((r): r is PromiseFulfilledResult<DailyMissionClaimResponse> => r.status === 'fulfilled').map((r) => r.value);
      expect(ok.map((r) => r.id).sort()).toEqual([...ids].sort());
      expect(ok.reduce((s, r) => s + r.water, 0)).toBe(15);
      expect(ok.filter((r) => r.bonus)).toHaveLength(1);
      expect(ok.reduce((s, r) => s + r.points, 0)).toBe(10);

      const t = await ledgerOf(u.id);
      expect(sum(t.water)).toBe(15);
      expect(t.points.map((p) => p.delta)).toEqual([10]);
      expect(t.user.pointsBalance).toBe(10);
      expect(t.claims.map((c) => c.missionId).sort()).toEqual([...ids.map((x) => DAILY_TEMPLATE_IDS[x]), 'daily-bonus'].sort());
      expect(t.ledger).toEqual([expect.objectContaining({ waterFromGames: 15, pointsFromGames: 10, rewardedRounds: 0 })]);

      const today = await daily.today(u.id, now);
      expect(today.missions.every((m) => m.done && m.claimed)).toBe(true);
      expect(today.bonusClaimed).toBe(true);
    });

    it('3. Ván game mini và nhiệm vụ cùng ngày, chạy song song: tổng 💧 ≤ trần 40, tổng điểm ≤ trần 45, sổ ngày khớp từng dòng', async () => {
      const { daily, mini } = await makeServices({ 'game.mini.points_daily_cap': 45 });
      const u = await realUser();
      const now = day(3);
      await doEverything(u.id, now);
      const device = `race-dev-${u.id}`;
      const starts = await Promise.all(
        (['sort', 'origin'] as const).flatMap((game) =>
          [1, 2].map(async (slot) => {
            const size = game === 'sort' ? 10 : 5;
            const items = await prisma.gameContentItem.findMany({ where: { game, active: true }, take: size, orderBy: { id: 'asc' } });
            const round = await prisma.gamePlayRound.create({
              data: { userId: u.id, game, dayKey: vnDateKey(now), slot, contentIds: items.map((i) => i.id), issuedAt: now, expiresAt: after(now, 600_000) },
            });
            const answers = items.map((i) => (i.payload as Record<string, unknown>)[game === 'sort' ? 'bin' : 'answer']);
            return { game, roundId: round.id, answers };
          }),
        ),
      );
      const ids = pickDailyMissions(u.id, vnDateKey(now), dailyMissionPool(true));
      const results = await Promise.allSettled([
        ...starts.map((s) => mini.submit(u.id, s.game, { roundId: s.roundId, answers: s.answers, deviceId: device }, after(now, 6_000))),
        ...ids.map((id) => daily.claim(u.id, id, device, after(now, 6_000))),
      ]);
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => String(r.reason).slice(0, 300));
      expect(failed).toEqual([]);
      const values = results.map((r) => (r as PromiseFulfilledResult<MiniSubmitResponse | DailyMissionClaimResponse>).value);
      const water = values.reduce((s, v) => s + v.water, 0);
      const points = values.reduce((s, v) => s + v.points, 0);
      console.log('[engagement] ván + nhiệm vụ song song water=%d points=%d', water, points);
      expect(water).toBe(40);
      expect(points).toBe(45);

      const t = await ledgerOf(u.id);
      expect(sum(t.water)).toBe(40);
      expect(sum(t.points)).toBe(45);
      expect(t.user.pointsBalance).toBe(45);
      expect(t.ledger).toEqual([expect.objectContaining({ waterFromGames: 40, pointsFromGames: 45, rewardedRounds: 4 })]);
      expect(t.claims).toHaveLength(4);
    });

    it('4. Trần thiết bị dùng chung: máy đã thưởng cho 1 tài khoản (trần 1) thì nhiệm vụ của tài khoản thứ hai trên máy đó không thưởng', async () => {
      const { daily } = await makeServices({ 'game.mini.accounts_per_device_per_day': 1 });
      const a = await realUser();
      const b = await realUser();
      const now = day(4);
      await doEverything(a.id, now);
      await doEverything(b.id, now);
      const shared = `race-shared-${randCode(8)}`;
      const [aFirst] = pickDailyMissions(a.id, vnDateKey(now), dailyMissionPool(true));
      const [bFirst] = pickDailyMissions(b.id, vnDateKey(now), dailyMissionPool(true));
      expect(await daily.claim(a.id, aFirst!, shared, now)).toMatchObject({ water: 5, capped: [] });
      const rb = await daily.claim(b.id, bFirst!, shared, now);
      expect(rb).toMatchObject({ water: 0, points: 0 });
      expect(rb.capped).toContain('device');
      expect((await ledgerOf(b.id)).water).toEqual([]);
    });

    it('5. Khách vãng lai: 403 DAILY_GUEST, không ghi dòng nào', async () => {
      const { daily } = await makeServices();
      const g = await createUser(prisma, { zaloId: `guest_${randCode(10)}`, pointsBalance: 0 });
      touchedUsers.push(g.id);
      const now = day(5);
      await doEverything(g.id, now);
      const [first] = pickDailyMissions(g.id, vnDateKey(now), dailyMissionPool(true));
      const [r] = await Promise.allSettled([daily.claim(g.id, first!, `race-dev-${g.id}`, now)]);
      expect(httpOf(r!)).toEqual({ status: 403, code: 'DAILY_GUEST' });
      const t = await ledgerOf(g.id);
      expect([t.water, t.points, t.claims, t.ledger]).toEqual([[], [], [], []]);
    });

    it('6. Chưa làm: 400 DAILY_NOT_DONE; việc làm hôm qua không tính cho hôm nay', async () => {
      const { daily } = await makeServices();
      const u = await realUser();
      const yesterday = day(6);
      const now = day(7);
      await doEverything(u.id, yesterday);
      const [first] = pickDailyMissions(u.id, vnDateKey(now), dailyMissionPool(true));
      const [r] = await Promise.allSettled([daily.claim(u.id, first!, `race-dev-${u.id}`, now)]);
      expect(httpOf(r!)).toEqual({ status: 400, code: 'DAILY_NOT_DONE' });
      expect((await ledgerOf(u.id)).claims).toEqual([]);
      const today = await daily.today(u.id, now);
      expect(today.missions.some((m) => m.done)).toBe(false);
    });

    it('7. Cờ tắt: GET trả enabled false, nhận trả 404 DAILY_DISABLED, không ghi', async () => {
      const { daily } = await makeServices({ 'engagement.daily_missions_enabled': false });
      const u = await realUser();
      const now = day(8);
      await doEverything(u.id, now);
      expect(await daily.today(u.id, now)).toMatchObject({ enabled: false, missions: [] });
      const [r] = await Promise.allSettled([daily.claim(u.id, 'DAILY_WATER', `race-dev-${u.id}`, now)]);
      expect(httpOf(r!)).toEqual({ status: 404, code: 'DAILY_DISABLED' });
      expect((await ledgerOf(u.id)).claims).toEqual([]);
    });
  });

  describe('huy hiệu', () => {
    let wasteSeq = 0;
    async function completedRecycle(userId: string, status: 'COMPLETED' | 'OPEN' = 'COMPLETED') {
      const point = await createWarehouse(prisma);
      wasteSeq += 1;
      await prisma.wasteRequest.create({
        data: {
          code: `TR-ENG${randomBytes(4).toString('hex').toUpperCase()}${wasteSeq}`,
          userId,
          method: 'DROP_OFF',
          status,
          pointId: point.id,
          estimatedPoints: 0,
          capDayKey: '2036-06-15',
          capMonthKey: '2036-06',
          idempotencyKey: `eng-${randomBytes(8).toString('hex')}`,
          consentAt: new Date(),
          consentVersion: '2026-10-17.1',
        },
      });
    }

    async function delivered(userId: string, over: Partial<Prisma.OrderUncheckedCreateInput> = {}, item?: { slug: string; name: string }) {
      const o = await createOrder(prisma, { userId, status: 'DELIVERED', deliveredAt: new Date(), ...over });
      if (item) {
        const v = await prisma.variation.findFirst({ where: { productId }, select: { id: true } });
        const variationId =
          v?.id ??
          (
            await prisma.variation.create({
              data: { pancakeId: `it-eng-v-${randCode(8)}`, productId, sku: `ENG-${randCode(6)}`, name: 'Túi 1L', attributes: {}, retailPrice: 50_000, stock: 5 },
            })
          ).id;
        await prisma.orderItem.create({
          data: { orderId: o.id, variationId, productName: item.name, productSlug: item.slug, variationName: 'Túi 1L', unitPrice: 50_000, quantity: 1, total: 50_000 },
        });
      }
      return o;
    }

    async function quizDays(userId: string, perfectDays: number, offset: number) {
      for (let i = 0; i < perfectDays; i++) {
        const d = day(100 + offset + i);
        await prisma.gamePlayRound.create({
          data: { userId, game: 'daily_quiz', dayKey: vnDateKey(d), contentIds: [], issuedAt: d, expiresAt: after(d, 600_000), submittedAt: d, correct: 3, total: 3 },
        });
      }
    }

    async function referral(userId: string, refereeId: string, revoked: boolean) {
      await prisma.pointsTransaction.create({ data: { userId, delta: 10_000, reason: `${REFERRAL_ORDER2_PREFIX}${refereeId}`, refType: 'REFERRAL', refId: refereeId } });
      if (revoked) {
        await prisma.pointsTransaction.create({ data: { userId, delta: 0, reason: `${REFERRAL_ORDER2_REVOKE_PREFIX}${refereeId}`, refType: 'REFERRAL', refId: refereeId } });
      }
      await prisma.$executeRaw`UPDATE users SET "pointsBalance" = (SELECT COALESCE(SUM(delta), 0) FROM points_transactions WHERE "userId" = ${userId}) WHERE id = ${userId}`;
    }

    async function badgesOf(userId: string) {
      return prisma.userBadge.findMany({ where: { userId }, orderBy: { badge: 'asc' } });
    }

    it('8. Khách đạt đủ 8 điều kiện: cấp đủ 8; cấp lại, chạy cả hệ thống, và 10 lần song song đều không thêm dòng nào', async () => {
      const { badges } = await makeServices();
      const u = await realUser();
      const friend = await realUser();
      await delivered(u.id);
      for (let i = 0; i < 3; i++) await completedRecycle(u.id);
      for (let i = 0; i < 5; i++) await delivered(u.id, {}, { slug: `refill-nuoc-giat-${randCode(4).toLowerCase()}`, name: 'Refill nước giặt 1L' });
      await prisma.gameProfile.upsert({ where: { userId: u.id }, create: { userId: u.id, streakDays: 3, longestStreak: 31 }, update: { streakDays: 3, longestStreak: 31 } });
      await quizDays(u.id, 10, 0);
      const reviewOrder = await delivered(u.id);
      await prisma.review.create({ data: { userId: u.id, productId, orderId: reviewOrder.id, rating: 5, images: ['https://example.org/anh.jpg'] } });
      await referral(u.id, friend.id, false);

      const first = await badges.award(u.id, new Date());
      expect(Object.values(first).reduce((a, b) => a + b, 0)).toBe(8);
      const rows = await badgesOf(u.id);
      expect(rows.map((r) => r.badge).sort()).toEqual([...BADGE_IDS].sort());

      expect(Object.values(await badges.award(u.id)).reduce((a, b) => a + b, 0)).toBe(0);
      await Promise.all(Array.from({ length: 10 }, () => badges.award(u.id)));
      await badges.award(null);
      const again = await badgesOf(u.id);
      expect(again).toEqual(rows);

      const listed = await badges.list(u.id);
      expect(listed.enabled).toBe(true);
      expect(listed.badges.every((b) => b.earned && b.earnedAt)).toBe(true);
    });

    it('9. Khách suýt đạt từng điều kiện: không cấp huy hiệu nào', async () => {
      const { badges } = await makeServices();
      const u = await realUser();
      const friend = await realUser();
      await delivered(u.id, { placedForCustomer: true });
      await createOrder(prisma, { userId: u.id, status: 'CONFIRMED' });
      for (let i = 0; i < 2; i++) await completedRecycle(u.id);
      await completedRecycle(u.id, 'OPEN');
      await prisma.gameProfile.upsert({ where: { userId: u.id }, create: { userId: u.id, streakDays: 6, longestStreak: 6 }, update: { streakDays: 6, longestStreak: 6 } });
      await quizDays(u.id, 9, 20);
      const wrong = day(140);
      await prisma.gamePlayRound.create({
        data: { userId: u.id, game: 'daily_quiz', dayKey: vnDateKey(wrong), contentIds: [], issuedAt: wrong, expiresAt: after(wrong, 600_000), submittedAt: wrong, correct: 2, total: 3 },
      });
      const reviewOrder = await createOrder(prisma, { userId: u.id, status: 'CONFIRMED' });
      await prisma.review.create({ data: { userId: u.id, productId, orderId: reviewOrder.id, rating: 4, images: [] } });
      await referral(u.id, friend.id, true);

      await badges.award(u.id);
      await badges.award(null);
      expect(await badgesOf(u.id)).toEqual([]);
      const listed = await badges.list(u.id);
      expect(listed.badges.map((b) => b.earned)).toEqual(BADGE_IDS.map(() => false));
    });

    it('10. Chuỗi 7 ngày đang chạy (chưa có kỷ lục) vẫn đạt STREAK_7, chưa đạt STREAK_30', async () => {
      const { badges } = await makeServices();
      const u = await realUser();
      await prisma.gameProfile.upsert({ where: { userId: u.id }, create: { userId: u.id, streakDays: 7, longestStreak: 0 }, update: { streakDays: 7, longestStreak: 0 } });
      await badges.award(u.id);
      expect((await badgesOf(u.id)).map((r) => r.badge)).toEqual(['STREAK_7']);
    });

    it('11. Cờ tắt: list trả enabled false và không cấp gì', async () => {
      const { badges } = await makeServices({ 'engagement.badges_enabled': false });
      const u = await realUser();
      await delivered(u.id);
      expect(await badges.list(u.id)).toEqual({ enabled: false, badges: [] });
      expect(await badgesOf(u.id)).toEqual([]);
    });
  });

  it('12. Sau mọi ca: pointsBalance = SUM(points_transactions.delta) và bình không vượt sức chứa', async () => {
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
