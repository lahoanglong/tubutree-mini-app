import { randomInt } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { GameMiniRewardService } from '../../src/modules/game/mini/game-mini-reward.service';
import { MatcherService } from '../../src/modules/game/mini/matcher/matcher.service';
import { MATCHER_GAME, MATCHER_REWARD } from '../../src/modules/game/mini/matcher/matcher.rules';
import { loadGameMiniPack } from '../../prisma/seed-game-mini';
import { createRealUser, setConfig, warmPool } from './helpers';

/**
 * Thưởng 💧 của Chọn Chuẩn Xanh trên Postgres thật: bấm đúp và nhiều yêu cầu song song chỉ thưởng một lần mỗi ngày, ngày sau thưởng
 * lại, game mini tắt hay khách chưa đăng nhập thì không ghi ván nào. Nội dung là gói thật (`matcher.json`) bật trong spec; DB thử
 * không có sản phẩm của gói nên kết quả rơi vào bộ dự phòng rỗng, phần thưởng không phụ thuộc món.
 */
describe('Chọn Chuẩn Xanh race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const env = { get: (k: string) => (k === 'JWT_ACCESS_SECRET' ? 'race-secret-matcher' : undefined) } as unknown as ConfigService;
  const pack = loadGameMiniPack();
  const ANSWERS = [
    { code: 'need', value: 'kitchen' },
    { code: 'kitchen_how', value: 'machine' },
    { code: 'size_home', value: 'large' },
  ];
  const BASE_DAY = Date.UTC(2032, 0, 1, 3, 0, 0) + randomInt(0, 20_000) * 86_400_000;
  const day = (n: number) => new Date(BASE_DAY + n * 86_400_000);

  async function makeSvc(over: Record<string, Prisma.InputJsonValue> = {}) {
    const base: Record<string, Prisma.InputJsonValue> = {
      'game.matcher_enabled': true,
      'game.mini.enabled': true,
      'game.mini.water_daily_cap': 40,
      'game.mini.points_daily_cap': 100,
      'game.mini.accounts_per_device_per_day': 2,
      'game.mini.min_account_age_hours': 0,
      'game.tank_capacity': 1000,
    };
    for (const [k, v] of Object.entries({ ...base, ...over })) await setConfig(prisma, k, v);
    return new MatcherService(prisma, new SystemConfigService(prisma), env, new GameMiniRewardService(prisma));
  }

  async function rowsOf(userId: string) {
    const [rounds, water, points] = await Promise.all([
      prisma.gamePlayRound.findMany({ where: { userId, game: MATCHER_GAME } }),
      prisma.gameWaterEvent.findMany({ where: { userId, reason: 'MINI_MATCHER' } }),
      prisma.pointsTransaction.findMany({ where: { userId, refType: 'GAME_MINI' } }),
    ]);
    return { rounds, water, points };
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    await prisma.gameContentItem.deleteMany({ where: { game: MATCHER_GAME } });
    await prisma.gameContentItem.createMany({
      data: pack.matcher.map((i) => ({
        id: i.id,
        game: MATCHER_GAME,
        kind: i.kind,
        payload: i.payload as Prisma.InputJsonValue,
        explanation: i.explanation,
        sourceUrl: i.sourceUrl,
        active: true,
      })),
    });
  });

  afterAll(async () => {
    await prisma?.gameContentItem.deleteMany({ where: { game: MATCHER_GAME } });
    await setConfig(prisma, 'game.matcher_enabled', false);
    await moduleRef?.close();
  });

  it('20 yêu cầu song song cùng tài khoản cùng ngày: đúng 1 lần 💧, 1 ván có ô thưởng, 0 Điểm Xanh', async () => {
    const svc = await makeSvc();
    const u = await createRealUser(prisma, { pointsBalance: 0 });
    const results = await Promise.all(Array.from({ length: 20 }, () => svc.result(u.id, { answers: ANSWERS, deviceId: `race-dev-${u.id}` }, day(1))));
    const paid = results.filter((r) => r.water > 0);
    console.log('[matcher] song song: có thưởng=%d / %d', paid.length, results.length);
    expect(paid).toHaveLength(1);
    expect(paid[0]!.water).toBe(MATCHER_REWARD.water);
    expect(results.every((r) => r.code === 'kitchen_machine')).toBe(true);
    const rows = await rowsOf(u.id);
    expect(rows.rounds).toHaveLength(1);
    expect(rows.rounds[0]).toMatchObject({ slot: 1, waterAwarded: MATCHER_REWARD.water, pointsAwarded: 0, contentIds: ['gm-matcher-o-kitchen-machine'] });
    expect(rows.water).toHaveLength(1);
    expect(rows.points).toHaveLength(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { pointsBalance: true } })).pointsBalance).toBe(0);
    expect(rows.rounds[0]!.submittedAt).toBeNull();
    const dailyPlayProbe = await prisma.gamePlayRound.findFirst({ where: { userId: u.id, dayKey: rows.rounds[0]!.dayKey, submittedAt: { not: null } }, select: { id: true } });
    expect(dailyPlayProbe).toBeNull();
  });

  it('thiếu mã thiết bị không đốt lượt; bấm đúp tuần tự: lượt hai trong ngày 0 💧; ngày sau thưởng lại', async () => {
    const svc = await makeSvc();
    const u = await createRealUser(prisma, { pointsBalance: 0 });
    const deviceId = `race-dev-${u.id}`;
    expect((await svc.result(u.id, { answers: ANSWERS }, day(2))).water).toBe(0);
    expect((await rowsOf(u.id)).rounds).toHaveLength(0);
    expect((await svc.result(u.id, { answers: ANSWERS, deviceId }, day(2))).water).toBe(MATCHER_REWARD.water);
    expect((await svc.result(u.id, { answers: ANSWERS, deviceId }, day(2))).water).toBe(0);
    expect((await svc.result(u.id, { answers: ANSWERS, deviceId }, day(3))).water).toBe(MATCHER_REWARD.water);
    const rows = await rowsOf(u.id);
    expect(rows.rounds.map((r) => r.dayKey).sort()).toHaveLength(2);
    expect(rows.water).toHaveLength(2);
  });

  it('game mini tắt: vẫn ra bộ nhưng không ghi ván, không 💧', async () => {
    const svc = await makeSvc({ 'game.mini.enabled': false });
    const u = await createRealUser(prisma, { pointsBalance: 0 });
    const r = await svc.result(u.id, { answers: ANSWERS, deviceId: `race-dev-${u.id}` }, day(4));
    expect(r.water).toBe(0);
    expect(r.code).toBe('kitchen_machine');
    expect((await rowsOf(u.id)).rounds).toHaveLength(0);
  });

  it('khách chưa đăng nhập: không ghi ván nào', async () => {
    const svc = await makeSvc();
    const before = await prisma.gamePlayRound.count({ where: { game: MATCHER_GAME } });
    const r = await svc.result(null, { answers: ANSWERS }, day(5));
    expect(r.water).toBe(0);
    expect(await prisma.gamePlayRound.count({ where: { game: MATCHER_GAME } })).toBe(before);
  });

  it('cờ Chọn Chuẩn Xanh tắt: 404, không ghi gì', async () => {
    const svc = await makeSvc({ 'game.matcher_enabled': false });
    const u = await createRealUser(prisma, { pointsBalance: 0 });
    await expect(svc.result(u.id, { answers: ANSWERS, deviceId: `race-dev-${u.id}` }, day(6))).rejects.toMatchObject({ status: 404 });
    expect((await rowsOf(u.id)).rounds).toHaveLength(0);
  });
});
