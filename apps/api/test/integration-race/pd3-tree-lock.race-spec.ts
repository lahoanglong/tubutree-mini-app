import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameService } from '../../src/modules/game/game.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { createOrder, createUser, setConfig, summarize, warmPool } from './helpers';

/**
 * PD-3 (review C1): góp quỹ trồng cây là chỗ tiêu Điểm Xanh thường mới. Điểm của đơn vừa giao còn trong hạn
 * đổi/trả (lockedOrderPoints) KHÔNG được tiêu ở đây, giống checkout và đổi voucher: nếu không, khách nhận
 * điểm đơn A, góp quỹ, rồi trả đơn A thì reverseOrderPoints trừ điểm không guard và pointsBalance âm.
 */
describe('PD-3 góp quỹ cây không tiêu điểm đơn còn trong hạn đổi/trả (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let game: GameService;
  let loyalty: LoyaltyService;
  const touched: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService, GameService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    game = moduleRef.get(GameService);
    loyalty = moduleRef.get(LoyaltyService);
    await setConfig(prisma, 'game.tree_points_price', 50);
    await setConfig(prisma, 'returns.window_days', 7);
  });

  afterEach(async () => {
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /**
   * Người dùng có: `lockedPts` điểm thường từ đơn giao 2 ngày trước (còn khoá), `freePts` điểm thường tự do,
   * `converted` điểm quy đổi. Số dư từng lô khớp sổ.
   */
  async function holder(opts: { lockedPts: number; freePts: number; converted: number }) {
    const u = await createUser(prisma, {
      pointsBalance: opts.lockedPts + opts.freePts,
      pointsConvertedBalance: opts.converted,
    });
    touched.push(u.id);
    const deliveredAt = new Date(Date.now() - 2 * 864e5);
    const order = await createOrder(prisma, {
      userId: u.id,
      status: 'DELIVERED',
      deliveredAt,
      pointsEarned: opts.lockedPts,
      paymentStatus: 'PAID',
    });
    const rows = [
      { delta: opts.lockedPts, lot: 'STANDARD' as const, reason: `ORDER_DELIVERED:${order.code}`, refType: 'ORDER', refId: order.id, createdAt: deliveredAt },
      { delta: opts.freePts, lot: 'STANDARD' as const, reason: 'IT_SEED_STANDARD', refType: 'IT', refId: null, createdAt: deliveredAt },
      { delta: opts.converted, lot: 'CONVERTED' as const, reason: 'IT_SEED_CONVERTED', refType: 'IT', refId: null, createdAt: deliveredAt },
    ].filter((r) => r.delta !== 0);
    await prisma.pointsTransaction.createMany({ data: rows.map((r) => ({ userId: u.id, ...r })) });
    return { u, order };
  }

  const lots = (userId: string) =>
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true, pointsConvertedBalance: true } });

  it('chỉ có điểm thường đang khoá (60) → góp 50 bị từ chối, không trừ gì, không tạo PlantedTree', async () => {
    const { u } = await holder({ lockedPts: 60, freePts: 0, converted: 0 });
    await expect(game.buyTree(u.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(await lots(u.id)).toEqual({ pointsBalance: 60, pointsConvertedBalance: 0 });
    expect(await prisma.plantedTree.count({ where: { userId: u.id } })).toBe(0);
  });

  it('điểm khoá không tính vào phần thường: 40 khoá + 30 tự do + 100 quy đổi → trừ 30 thường + 20 quy đổi', async () => {
    const { u } = await holder({ lockedPts: 40, freePts: 30, converted: 100 });
    const r = await game.buyTree(u.id);
    expect(r).toMatchObject({ cost: 50, pointsUsed: 50, pointsUsedConverted: 20 });
    expect(await lots(u.id)).toEqual({ pointsBalance: 40, pointsConvertedBalance: 80 });
  });

  it('4 lượt góp song song (100 tự do + 60 khoá, không điểm quy đổi) → đúng 2 lượt, phần khoá còn nguyên', async () => {
    const { u } = await holder({ lockedPts: 60, freePts: 100, converted: 0 });
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => game.buyTree(u.id)));
    const s = summarize(results);
    expect(s.fulfilled).toHaveLength(2);
    for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
    expect(await lots(u.id)).toEqual({ pointsBalance: 60, pointsConvertedBalance: 0 });
  });

  it('khách trả đơn vừa giao sau khi cố góp quỹ: không có số dư âm vì phần khoá chưa từng bị tiêu', async () => {
    const { u, order } = await holder({ lockedPts: 60, freePts: 0, converted: 0 });
    await expect(game.buyTree(u.id)).rejects.toBeInstanceOf(BadRequestException);
    await prisma.order.update({ where: { id: order.id }, data: { status: 'RETURNED' } });
    await loyalty.reverseOrderPoints(order.id);
    const after = await lots(u.id);
    expect(after.pointsBalance).toBeGreaterThanOrEqual(0);
    expect(after).toEqual({ pointsBalance: 0, pointsConvertedBalance: 0 });
  });
});
