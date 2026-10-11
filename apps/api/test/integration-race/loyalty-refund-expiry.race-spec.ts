import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { LoyaltyExpiryService } from '../../src/modules/loyalty/loyalty-expiry.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { createOrder, createUser, summarize, warmPool } from './helpers';

const DAY = 864e5;

/**
 * OQ-15: dòng ORDER_REFUND_POINTS (điểm thường đã tiêu rồi được hoàn khi huỷ/trả đơn) có hạn theo
 * loyalty.point_expire_months, và vẫn nhất quán với cron hết hạn (FIFO) và đối soát số dư theo lô.
 * Dòng hoàn cũ có expiresAt NULL (nếu có) không được backfill: không kiểm ở đây.
 */
describe('điểm hoàn khi huỷ đơn có hạn (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;
  let expiry: LoyaltyExpiryService;
  const touched: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        LoyaltyExpiryService,
        { provide: NotificationsService, useValue: { notify: async () => undefined } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    loyalty = moduleRef.get(LoyaltyService);
    expiry = moduleRef.get(LoyaltyExpiryService);
    await warmPool(prisma);
  });

  afterEach(async () => {
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /** User có số dư thường 100 từ một dòng cũ còn hạn dài (khớp sổ) và một đơn đã tiêu `used` điểm thường. */
  async function userWithSpentOrder(used: number, opts: { standardSeed?: number; converted?: number } = {}) {
    const seed = opts.standardSeed ?? 100;
    const converted = opts.converted ?? 0;
    const user = await createUser(prisma, { pointsBalance: seed - used, pointsConvertedBalance: converted });
    touched.push(user.id);
    const old = new Date(Date.now() - 60 * DAY);
    const order = await createOrder(prisma, { userId: user.id, pointsUsed: used + converted, pointsUsedConverted: converted });
    await prisma.pointsTransaction.createMany({
      data: [
        { userId: user.id, delta: seed, lot: 'STANDARD', reason: 'IT_SEED', refType: 'IT', createdAt: old, expiresAt: new Date(Date.now() + 300 * DAY) },
        { userId: user.id, delta: -used, lot: 'STANDARD', reason: `ORDER_REDEEM:${order.code}`, refType: 'ORDER', refId: order.id, createdAt: new Date(Date.now() - 50 * DAY) },
        ...(converted > 0
          ? [{ userId: user.id, delta: converted, lot: 'CONVERTED' as const, reason: 'IT_SEED_CONVERTED', refType: 'IT', createdAt: old }]
          : []),
      ],
    });
    return { user, order };
  }

  const refundRow = (orderId: string) =>
    prisma.pointsTransaction.findFirstOrThrow({ where: { refId: orderId, reason: { startsWith: 'ORDER_REFUND_POINTS:' } } });
  const balance = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pointsBalance;

  it('hoàn 40 điểm: dòng ORDER_REFUND_POINTS lô STANDARD mang expiresAt ≈ bây giờ + 12 tháng', async () => {
    const { user, order } = await userWithSpentOrder(40);
    const before = new Date();
    await loyalty.reverseOrderPoints(order.id);
    const after = new Date();

    const row = await refundRow(order.id);
    expect(row).toMatchObject({ delta: 40, lot: 'STANDARD', refType: 'ORDER' });
    expect(row.expiresAt).toBeInstanceOf(Date);
    const lo = new Date(before);
    lo.setMonth(lo.getMonth() + 12);
    const hi = new Date(after);
    hi.setMonth(hi.getMonth() + 12);
    expect(row.expiresAt!.getTime()).toBeGreaterThanOrEqual(lo.getTime());
    expect(row.expiresAt!.getTime()).toBeLessThanOrEqual(hi.getTime());
    expect(await balance(user.id)).toBe(100);
  });

  it('5 lần reverseOrderPoints song song → đúng 1 dòng hoàn, dòng đó có hạn, hoàn đúng một lần', async () => {
    const { user, order } = await userWithSpentOrder(40);
    const s = summarize(await Promise.allSettled(Array.from({ length: 5 }, () => loyalty.reverseOrderPoints(order.id))));
    expect(s.errors).toEqual([]);
    const rows = await prisma.pointsTransaction.findMany({ where: { refId: order.id, reason: { startsWith: 'ORDER_REFUND_POINTS:' } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.expiresAt).toBeInstanceOf(Date);
    expect(await balance(user.id)).toBe(100);
  });

  it('đơn tiêu cả hai lô: phần STANDARD hoàn có hạn; lô CONVERTED vẫn không hạn (CHECK converted_no_expiry)', async () => {
    const { user, order } = await userWithSpentOrder(30, { converted: 120 });
    await loyalty.reverseOrderPoints(order.id);
    const row = await refundRow(order.id);
    expect(row.lot).toBe('STANDARD');
    expect(row.expiresAt).toBeInstanceOf(Date);
    expect(await prisma.pointsTransaction.count({ where: { userId: user.id, lot: 'CONVERTED', expiresAt: { not: null } } })).toBe(0);
    await expect(
      prisma.pointsTransaction.create({
        data: { userId: user.id, delta: 1, lot: 'CONVERTED', reason: 'IT_BAD', refType: 'IT', expiresAt: new Date(Date.now() + DAY) },
      }),
    ).rejects.toThrow();
  });

  it('cron hết hạn không đụng điểm hoàn còn hạn, kể cả chạy nhiều lần', async () => {
    const { user, order } = await userWithSpentOrder(40);
    await loyalty.reverseOrderPoints(order.id);
    await expiry.expirePoints();
    await expiry.expirePoints();
    expect(await prisma.pointsTransaction.count({ where: { userId: user.id, reason: 'POINTS_EXPIRED' } })).toBe(0);
    expect(await balance(user.id)).toBe(100);
  });

  it('hết hạn điểm hoàn (lùi expiresAt về quá khứ): cron trừ đúng 40 một lần, chạy lại không trừ đôi, số dư khớp sổ', async () => {
    const { user, order } = await userWithSpentOrder(40);
    await loyalty.reverseOrderPoints(order.id);
    const row = await refundRow(order.id);
    await prisma.pointsTransaction.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - DAY) } });

    await expiry.expirePoints();
    await expiry.expirePoints();

    const expired = await prisma.pointsTransaction.findMany({ where: { userId: user.id, reason: 'POINTS_EXPIRED' } });
    expect(expired.map((r) => [r.delta, r.lot])).toEqual([[-40, 'STANDARD']]);
    expect(await balance(user.id)).toBe(60);
  });

  it('dòng POINTS_EXPIRED có createdAt không sớm hơn lúc cron bắt đầu (replay dựa vào đó để biết lô nào đã hết hạn)', async () => {
    const { user, order } = await userWithSpentOrder(40);
    await loyalty.reverseOrderPoints(order.id);
    const row = await refundRow(order.id);
    const cronStart = new Date();
    await prisma.pointsTransaction.update({ where: { id: row.id }, data: { expiresAt: new Date(cronStart.getTime() - 1) } });

    await expiry.expirePoints();

    const expired = await prisma.pointsTransaction.findMany({ where: { userId: user.id, reason: 'POINTS_EXPIRED' } });
    expect(expired).toHaveLength(1);
    expect(expired[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(cronStart.getTime());
  });

  it('điểm hoàn đã bị tiêu một phần trước hạn: cron chỉ trừ phần còn lại của lô hoàn (FIFO), không trừ điểm còn hạn khác', async () => {
    // Seed 100 (còn hạn dài), đã tiêu 40 → hoàn 40 (có hạn, sau đó lùi về quá khứ). Dòng tiêu sau đó ăn lô CŨ NHẤT
    // (seed) nên lô hoàn còn nguyên 40 và là phần duy nhất bị trừ khi hết hạn.
    const { user, order } = await userWithSpentOrder(40);
    await loyalty.reverseOrderPoints(order.id);
    const row = await refundRow(order.id);
    await prisma.pointsTransaction.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - DAY) } });
    await prisma.$transaction([
      prisma.pointsTransaction.create({ data: { userId: user.id, delta: -30, lot: 'STANDARD', reason: 'IT_SPEND', refType: 'IT' } }),
      prisma.user.update({ where: { id: user.id }, data: { pointsBalance: { decrement: 30 } } }),
    ]);

    await expiry.expirePoints();
    await expiry.expirePoints();

    const expired = await prisma.pointsTransaction.findMany({ where: { userId: user.id, reason: 'POINTS_EXPIRED' } });
    expect(expired.map((r) => r.delta)).toEqual([-40]);
    expect(await balance(user.id)).toBe(100 - 30 - 40);
  });

  it('lô không hạn cũ hơn (thưởng game) + điểm hoàn hết hạn: cron trừ đúng phần hoàn một lần qua 3 lần chạy, lô không hạn còn nguyên', async () => {
    // Replay FIFO thuần ăn dòng POINTS_EXPIRED vào lô game không hạn (cũ nhất), lô hoàn trông còn nguyên và bị trừ lại mỗi đêm.
    const user = await createUser(prisma, { pointsBalance: 100 });
    touched.push(user.id);
    const order = await createOrder(prisma, { userId: user.id, pointsUsed: 40 });
    await prisma.pointsTransaction.createMany({
      data: [
        { userId: user.id, delta: 140, lot: 'STANDARD', reason: 'GAME_SPIN_REWARD', refType: 'GAME', createdAt: new Date(Date.now() - 60 * DAY), expiresAt: null },
        { userId: user.id, delta: -40, lot: 'STANDARD', reason: `ORDER_REDEEM:${order.code}`, refType: 'ORDER', refId: order.id, createdAt: new Date(Date.now() - 50 * DAY) },
      ],
    });
    await loyalty.reverseOrderPoints(order.id);
    const row = await refundRow(order.id);
    await prisma.pointsTransaction.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - DAY) } });

    await expiry.expirePoints();
    await expiry.expirePoints();
    await expiry.expirePoints();

    const expired = await prisma.pointsTransaction.findMany({ where: { userId: user.id, reason: 'POINTS_EXPIRED' } });
    expect(expired.map((r) => [r.delta, r.lot])).toEqual([[-40, 'STANDARD']]);
    expect(await balance(user.id)).toBe(100);
  });
});
