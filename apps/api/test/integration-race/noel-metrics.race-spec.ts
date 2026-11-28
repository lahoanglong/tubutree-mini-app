import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NoelMetricsService } from '../../src/modules/analytics/noel-metrics.service';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { createRealUser } from './helpers';

/**
 * Tab Noel của Admin trên Postgres THẬT: SQL thô (ngày VN bằng +7 giờ, ép kiểu tham số, ANY(text[]), set_config) chỉ chạy đúng hay sai được
 * kiểm ở đây, spec đơn vị giả `$queryRaw`. Mỗi ca dùng một ngày "hôm nay" giả (`now`) ở tháng riêng, xa ngày thật, nên không đụng dữ liệu
 * spec khác; mọi dòng tạo ra được dọn ở afterAll.
 */
const config = { get: async (_key: string, fallback: unknown) => fallback } as unknown as SystemConfigService;
const TAG = `noel-it-${randomUUID().slice(0, 8)}`;

describe('NoelMetricsService (real Postgres)', () => {
  let prisma: PrismaService;
  const userIds: string[] = [];
  const eventIds: string[] = [];
  const globalDays: string[] = [];

  const mkUser = async () => {
    const u = await createRealUser(prisma);
    userIds.push(u.id);
    return u;
  };
  const svc = () => new NoelMetricsService(prisma, config);
  const ev = async (eventName: string, occurredAt: string, userId: string | null, props: Record<string, unknown> = {}, extra: { anonymousId?: string; platform?: string } = {}) => {
    const eventId = `${TAG}-${eventIds.length}`;
    eventIds.push(eventId);
    await prisma.analyticsEvent.create({
      data: { eventId, eventName, occurredAt: new Date(occurredAt), userId, anonymousId: extra.anonymousId ?? null, platform: extra.platform ?? 'miniapp', props: props as object },
    });
  };
  const checkIn = (userId: string, dayKey: string, streakDays: number) =>
    prisma.loyaltyCheckIn.create({ data: { userId, dayKey, cycleDay: ((streakDays - 1) % 7) + 1, streakDays, points: 1 } });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { eventId: { startsWith: TAG } } });
    await prisma.gameGlobalDaily.deleteMany({ where: { dayKey: { in: globalDays } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('không có dữ liệu trong cửa sổ: mọi số 0, không lỗi SQL', async () => {
    // Tháng 8/2031: chưa có gì; cũng chạy hết các câu thật (ép kiểu tham số, ANY(text[]), set_config).
    const out = await svc().getSnapshot(14, new Date('2031-08-10T03:00:00Z'));
    expect(out.claims).toMatchObject({ users: 0, claims: 0, reachedStreak3: 0, reachedStreak7: 0 });
    expect(out.claims.perDay).toHaveLength(14);
    expect(out.advent).toMatchObject({ phase: 'before', daysElapsed: 0, completed: null, completionPct: null, openedAny: 0 });
    expect(out.share).toEqual({ users: 0, taps: 0 });
    expect(out.retention.noel.userDays).toBe(0);
    expect(out.retention.other.ratePct).toBeNull();
    expect(out.games.map((g) => [g.game, g.plays])).toEqual([
      ['dew_catcher', 0],
      ['refill_rush', 0],
      ['eco_merge', 0],
      ['green_conveyor', 0],
    ]);
    expect(out.economy.current.miniUsers).toBe(0);
  });

  it('nhận quà, lịch 12 ngày, món trang trí, tuyết, chia sẻ, game, thưởng (20/12/2026, 7 ngày)', async () => {
    const [a, b, f, g] = [await mkUser(), await mkUser(), await mkUser(), await mkUser()];
    // A: 14..17/12 chuỗi 1..4; B: 14/12 và 20/12; F: đủ 7 ngày 14..20/12 chuỗi 1..7; G: chỉ 13/12 (ngoài cửa sổ).
    for (const [i, d] of ['2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17'].entries()) await checkIn(a.id, d, i + 1);
    await checkIn(b.id, '2026-12-14', 1);
    await checkIn(b.id, '2026-12-20', 1);
    for (let i = 0; i < 7; i++) await checkIn(f.id, `2026-12-${14 + i}`, i + 1);
    await checkIn(g.id, '2026-12-13', 9);

    // Thao tác Noel (đều ở trong cửa sổ).
    await ev('noel_action', '2026-12-16T02:00:00Z', a.id, { action: 'ornament_unlock', slot: 'baubles' });
    await ev('noel_action', '2026-12-16T02:30:00Z', b.id, { action: 'ornament_unlock', slot: 'baubles' });
    await ev('noel_action', '2026-12-16T03:00:00Z', a.id, { action: 'ornament_on', slot: 'baubles' });
    await ev('noel_action', '2026-12-16T04:00:00Z', a.id, { action: 'ornament_on', slot: 'baubles' });
    await ev('noel_action', '2026-12-16T05:00:00Z', b.id, { action: 'ornament_on', slot: 'baubles' });
    await ev('noel_action', '2026-12-16T06:00:00Z', a.id, { action: 'ornament_off', slot: 'baubles' });
    await ev('noel_action', '2026-12-17T03:00:00Z', f.id, { action: 'ornament_on', slot: 'wreath' });
    await ev('noel_action', '2026-12-17T03:00:00Z', a.id, { action: 'snow_off' });
    await ev('noel_action', '2026-12-17T03:01:00Z', b.id, { action: 'snow_on' });
    await ev('noel_action', '2026-12-17T03:02:00Z', b.id, { action: 'snow_on' });
    await ev('noel_action', '2026-12-17T03:03:00Z', f.id, { action: 'snow_on' });
    await ev('noel_action', '2026-12-18T03:00:00Z', a.id, { action: 'share_tap' });
    await ev('noel_action', '2026-12-18T03:00:00Z', null, { action: 'share_tap' }, { anonymousId: `${TAG}-anon`, platform: 'web' });
    await ev('noel_action', '2026-12-18T03:05:00Z', null, { action: 'share_tap' }, { anonymousId: `${TAG}-anon`, platform: 'web' });

    // Arcade (sự kiện máy chủ arcade_run).
    await ev('arcade_run', '2026-12-18T03:00:00Z', a.id, { gameId: 'dew_catcher', score: 400, rewarded: true, water: 5, points: 1 }, { platform: 'system' });
    await ev('arcade_run', '2026-12-18T04:00:00Z', b.id, { gameId: 'dew_catcher', score: 200, rewarded: false, water: 0, points: 0 }, { platform: 'system' });

    // Game mini (eco_merge): 2 ván trong cửa sổ, 1 ván ngay trước 00:00 VN của ngày đầu (23:59:59.999 ngày 13/12) bị loại.
    const round = (userId: string, submittedAt: string, correct: number, total: number, waterAwarded: number, pointsAwarded: number) =>
      prisma.gamePlayRound.create({
        data: {
          userId,
          game: 'eco_merge',
          dayKey: submittedAt.slice(0, 10),
          contentIds: [],
          issuedAt: new Date(submittedAt),
          expiresAt: new Date(submittedAt),
          submittedAt: new Date(submittedAt),
          correct,
          total,
          waterAwarded,
          pointsAwarded,
        },
      });
    await round(a.id, '2026-12-18T05:00:00.000Z', 4, 8, 5, 1);
    await round(b.id, '2026-12-19T05:00:00.000Z', 6, 8, 0, 0);
    await round(g.id, '2026-12-13T16:59:59.999Z', 8, 8, 99, 99);

    // Thưởng: sổ mini, ngân sách toàn hệ thống, lượt arcade có thưởng; khoảng hiện tại 14..20/12 và trước đó 07..13/12.
    await prisma.gameDailyLedger.create({ data: { userId: a.id, dayKey: '2026-12-15', waterFromGames: 40, pointsFromGames: 100, rewardedRounds: 3 } });
    await prisma.gameDailyLedger.create({ data: { userId: b.id, dayKey: '2026-12-16', waterFromGames: 20, pointsFromGames: 30, rewardedRounds: 1 } });
    await prisma.gameDailyLedger.create({ data: { userId: f.id, dayKey: '2026-12-10', waterFromGames: 10, pointsFromGames: 10, rewardedRounds: 1 } });
    globalDays.push('2026-12-15', '2026-12-10');
    await prisma.gameGlobalDaily.createMany({ data: [{ dayKey: '2026-12-15', pointsMinted: 5000 }, { dayKey: '2026-12-10', pointsMinted: 700 }] });
    const water = (userId: string, createdAt: string, delta: number, refId: string) =>
      prisma.gameWaterEvent.create({ data: { userId, reason: 'ARCADE_DEW_CATCHER', refId: `${TAG}:${refId}`, delta, createdAt: new Date(createdAt) } });
    await water(a.id, '2026-12-18T03:00:00Z', 5, 'a');
    await water(b.id, '2026-12-19T03:00:00Z', 5, 'b');
    await water(a.id, '2026-12-13T16:59:59.999Z', 5, 'prev'); // 23:59:59 VN ngày 13/12: thuộc khoảng trước
    await water(a.id, '2026-12-20T17:00:00.000Z', 5, 'next'); // 00:00 VN ngày 21/12: ngoài cả hai khoảng

    const out = await svc().getSnapshot(7, new Date('2026-12-20T03:00:00Z'));

    // Nhận quà: A 4 + B 2 + F 7 = 13 lượt; khách trong cửa sổ A, B, F (G ở ngoài); chuỗi ≥3: A, F; chuỗi ≥7: F.
    expect(out.claims.users).toBe(3);
    expect(out.claims.claims).toBe(13);
    expect(Object.fromEntries(out.claims.perDay.map((d) => [d.dayKey, d.count]))).toEqual({
      '2026-12-14': 3,
      '2026-12-15': 2,
      '2026-12-16': 2,
      '2026-12-17': 2,
      '2026-12-18': 1,
      '2026-12-19': 1,
      '2026-12-20': 2,
    });
    expect(out.claims.reachedStreak3).toBe(2);
    expect(out.claims.reachedStreak7).toBe(1);

    // Lịch: 7 ô đã tới ngày; F mở đủ 7 ô, A và B mở ít hơn.
    expect(out.advent.daysElapsed).toBe(7);
    expect(out.advent.opensByDay[0]).toMatchObject({ day: 1, dayKey: '2026-12-14', users: 3 });
    expect(out.advent.opensByDay[6]).toMatchObject({ day: 7, dayKey: '2026-12-20', users: 2 });
    expect(out.advent.opensByDay[7]).toMatchObject({ day: 8, users: 0 });
    expect(out.advent.openedAny).toBe(3);
    expect(out.advent.completed).toBe(1);
    expect(out.advent.completionPct).toBe(33.3);

    const baubles = out.ornaments.find((o) => o.slot === 'baubles')!;
    expect(baubles.unlock).toEqual({ users: 2, taps: 2 });
    expect(baubles.hang).toEqual({ users: 2, taps: 3 });
    expect(baubles.remove).toEqual({ users: 1, taps: 1 });
    expect(out.ornaments.find((o) => o.slot === 'wreath')!.hang).toEqual({ users: 1, taps: 1 });
    expect(out.snow.on).toEqual({ users: 2, taps: 3 });
    expect(out.snow.off).toEqual({ users: 1, taps: 1 });
    expect(out.snow.offSharePct).toBe(25);
    // Chia sẻ: khách đăng nhập tính theo userId, khách ẩn danh theo mã ẩn danh (một mã bấm hai lần là một khách).
    expect(out.share).toEqual({ users: 2, taps: 3 });

    const dew = out.games.find((x) => x.game === 'dew_catcher')!;
    expect(dew).toMatchObject({ kind: 'arcade', plays: 2, users: 2, avgScore: 300, rewardedPlays: 1, water: 5, points: 1 });
    const merge = out.games.find((x) => x.game === 'eco_merge')!;
    expect(merge).toMatchObject({ kind: 'mini', plays: 2, users: 2, avgScore: 5, avgOutOf: 8, rewardedPlays: 1, water: 5, points: 1 });

    expect(out.economy.current).toMatchObject({
      fromDayKey: '2026-12-14',
      toDayKey: '2026-12-20',
      miniUsers: 2,
      miniRewardedRounds: 4,
      miniWater: 60,
      miniPoints: 130,
      maxUserWaterInDay: 40,
      maxUserPointsInDay: 100,
      maxGlobalPointsInDay: 5000,
      arcadeRewardedRuns: 2,
      arcadeWater: 10,
    });
    expect(out.economy.previous).toMatchObject({
      fromDayKey: '2026-12-07',
      toDayKey: '2026-12-13',
      miniUsers: 1,
      miniWater: 10,
      maxGlobalPointsInDay: 700,
      arcadeRewardedRuns: 1,
      arcadeWater: 5,
    });
  });

  it('lịch quà lúc 00:05 VN sáng 20/12/2032: khách đã mở đủ 14..19/12 vẫn là hoàn thành dù ô hôm nay chưa mở', async () => {
    const [full, gap] = [await mkUser(), await mkUser()];
    for (const [i, d] of ['2032-12-14', '2032-12-15', '2032-12-16', '2032-12-17', '2032-12-18', '2032-12-19'].entries()) await checkIn(full.id, d, i + 1);
    for (const [i, d] of ['2032-12-14', '2032-12-15', '2032-12-16', '2032-12-18', '2032-12-19'].entries()) await checkIn(gap.id, d, i + 1); // thiếu 17/12
    const out = await svc().getSnapshot(1, new Date('2032-12-19T17:05:00Z')); // 00:05 ngày 20/12 giờ VN
    expect(out.toDayKey).toBe('2032-12-20');
    expect(out.advent).toMatchObject({ phase: 'during', daysElapsed: 7, requiredDays: 6, openedAny: 2, completed: 1, completionPct: 50 });
  });

  it('ranh giới ngày VN của cửa sổ 1 ngày: 16:59:59.999Z ngày trước ngoài, 17:00:00Z trong, 16:59:59.999Z hôm nay trong, 17:00:00Z ngoài', async () => {
    const u = await mkUser();
    await ev('noel_action', '2027-03-09T16:59:59.999Z', u.id, { action: 'share_tap' }); // 23:59:59 ngày 9/3 VN
    await ev('noel_action', '2027-03-09T17:00:00.000Z', u.id, { action: 'share_tap' }); // 00:00:00 ngày 10/3 VN
    await ev('noel_action', '2027-03-10T16:59:59.999Z', u.id, { action: 'share_tap' }); // 23:59:59 ngày 10/3 VN
    await ev('noel_action', '2027-03-10T17:00:00.000Z', u.id, { action: 'share_tap' }); // 00:00:00 ngày 11/3 VN
    const out = await svc().getSnapshot(1, new Date('2027-03-10T03:00:00Z'));
    expect(out.fromDayKey).toBe('2027-03-10');
    expect(out.share).toEqual({ users: 1, taps: 2 });
  });

  it('quay lại D+1 (20/5/2027, 7 ngày): nhóm làm Noel và nhóm không; ngày tính theo giờ VN kể cả sát nửa đêm; ẩn danh và ngày chưa đủ ngày kế tiếp không tính', async () => {
    const [r1, r2, r3, r4, r5, r6, r7] = [await mkUser(), await mkUser(), await mkUser(), await mkUser(), await mkUser(), await mkUser(), await mkUser()];
    const sv = (userId: string | null, at: string, extra: { anonymousId?: string } = {}) => ev('screen_viewed', at, userId, { route: '/' }, extra);
    // Hôm nay 20/5/2027 10:00 VN. Nhóm là các ngày 12..18/5; ngày kế tiếp của 18/5 là 19/5, đã đủ 24 giờ.
    await sv(r1.id, '2027-05-15T03:00:00Z'); // 15/5 VN
    await sv(r1.id, '2027-05-16T03:00:00Z'); // 16/5: quay lại; bản thân 16/5 là một cặp ngày không quay lại tiếp
    await sv(r2.id, '2027-05-15T03:00:00Z'); // 15/5, không có 16/5
    await ev('noel_action', '2027-05-15T03:00:00Z', r3.id, { action: 'snow_off' }); // làm Noel 15/5
    await sv(r3.id, '2027-05-16T03:00:00Z'); // quay lại 16/5
    await checkIn(r4.id, '2027-05-15', 1); // nhận quà 15/5, không quay lại
    await sv(r5.id, '2027-05-18T03:00:00Z'); // 18/5 (ngày cuối của nhóm)
    await sv(r5.id, '2027-05-19T03:00:00Z'); // 19/5 là ngày kế tiếp: quay lại
    await sv(r6.id, '2027-05-15T16:59:59.999Z'); // 23:59:59 ngày 15/5 VN
    await sv(r6.id, '2027-05-15T17:00:00.000Z'); // 00:00:00 ngày 16/5 VN: nếu tính theo UTC sẽ cùng ngày 15 và không quay lại
    await sv(r7.id, '2027-05-19T03:00:00Z'); // 19/5: ngoài nhóm (ngày kế tiếp 20/5 chưa đủ ngày)
    await sv(null, '2027-05-15T03:00:00Z', { anonymousId: `${TAG}-anon` }); // ẩn danh: không có userId

    const out = await svc().getSnapshot(7, new Date('2027-05-20T03:00:00Z'));
    expect(out.retention.cohortFromDayKey).toBe('2027-05-12');
    expect(out.retention.cohortToDayKey).toBe('2027-05-18');
    // Làm Noel: r3 (15/5, quay lại 16/5) và r4 (15/5, không).
    expect(out.retention.noel).toEqual({ userDays: 2, returned: 1, ratePct: 50 });
    // Không làm Noel: r1 15/5 ✓ và 16/5 ✗; r2 15/5 ✗; r3 16/5 ✗; r5 18/5 ✓; r6 15/5 ✓ và 16/5 ✗ (7 cặp, 3 quay lại).
    expect(out.retention.other).toEqual({ userDays: 7, returned: 3, ratePct: 42.9 });
  });
});
