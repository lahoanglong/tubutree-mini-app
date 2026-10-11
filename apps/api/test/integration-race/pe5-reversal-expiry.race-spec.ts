import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { LoyaltyExpiryService } from '../../src/modules/loyalty/loyalty-expiry.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { milestoneGrantReason, revokeReferralRewardForOrder } from '../../src/modules/wallet/referral-reward';
import { createOrder, createUser, setConfig, warmPool } from './helpers';

const DAY = 864e5;

/**
 * PE-5: dòng âm ĐẢO NGƯỢC một khoản cộng cụ thể (huỷ/trả đơn thu hồi điểm đơn giao, thu hồi thưởng giới thiệu)
 * phải trừ vào lô của khoản cộng đó chứ không vào lô cũ nhất. Replay FIFO của cron hết hạn mà ăn sai lô thì lô gốc
 * (có hạn) vẫn còn nguyên trong sổ, tới hạn cron trừ lại đúng số điểm đã thu hồi và khách mất điểm hai lần.
 *
 * LoyaltyService, RewardPointsService, hàm thu hồi thưởng giới thiệu và cron hết hạn thật chạy trên Postgres thật.
 * "Thời gian trôi" dựng bằng cách lùi createdAt/expiresAt trong sổ (xem ageLedger), như pe3-reward-expiry.
 */
describe('dòng thu hồi ăn đúng lô gốc khi cron hết hạn chạy (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let config: SystemConfigService;
  let loyalty: LoyaltyService;
  let expiry: LoyaltyExpiryService;
  let rewards: RewardPointsService;
  const touched: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        LoyaltyExpiryService,
        RewardPointsService,
        { provide: NotificationsService, useValue: { notify: async () => undefined } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    config = moduleRef.get(SystemConfigService);
    loyalty = moduleRef.get(LoyaltyService);
    expiry = moduleRef.get(LoyaltyExpiryService);
    rewards = moduleRef.get(RewardPointsService);
    await warmPool(prisma);
    await setConfig(prisma, 'loyalty.point_expire_months', 12);
  });

  afterEach(async () => {
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function customer() {
    const user = await createUser(prisma);
    touched.push(user.id);
    return user;
  }

  /** Lô cũ (trước PE-3 hoặc hạn dài hơn): dòng sổ cộng số dư, khớp sổ. `expiresInDays` null = không hạn. */
  async function oldLot(userId: string, points: number, expiresInDays: number | null = null) {
    await prisma.$transaction([
      prisma.pointsTransaction.create({
        data: {
          userId,
          delta: points,
          lot: 'STANDARD',
          reason: 'IT_OLD_LOT',
          refType: 'GAME',
          createdAt: new Date(Date.now() - 400 * DAY),
          expiresAt: expiresInDays == null ? null : new Date(Date.now() + expiresInDays * DAY),
        },
      }),
      prisma.user.update({ where: { id: userId }, data: { pointsBalance: { increment: points } } }),
    ]);
  }

  /** Đơn DELIVERED đã tích `earned` điểm; `used` điểm thường đã tiêu lúc đặt (dòng ORDER_REDEEM như CheckoutService). */
  async function deliveredOrder(userId: string, earned: number, used = 0) {
    const order = await createOrder(prisma, { userId, status: 'DELIVERED', pointsEarned: earned, pointsUsed: used });
    if (used > 0) {
      await prisma.$transaction([
        prisma.pointsTransaction.create({
          data: {
            userId,
            delta: -used,
            lot: 'STANDARD',
            reason: `ORDER_REDEEM:${order.code}`,
            refType: 'ORDER',
            refId: order.id,
            createdAt: new Date(Date.now() - 20 * DAY),
          },
        }),
        prisma.user.update({ where: { id: userId }, data: { pointsBalance: { decrement: used } } }),
      ]);
    }
    await loyalty.creditOrderPoints(order.id);
    return order;
  }

  /** Thời gian trôi N tháng: lùi mọi mốc createdAt/expiresAt của user đi N tháng (NULL giữ NULL). */
  async function ageLedger(userId: string, months: number) {
    await prisma.$executeRaw`
      UPDATE "points_transactions"
         SET "createdAt" = "createdAt" - (${months}::int * interval '1 month'),
             "expiresAt" = "expiresAt" - (${months}::int * interval '1 month')
       WHERE "userId" = ${userId}`;
  }

  const balance = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pointsBalance;
  const standardSum = async (userId: string) =>
    (await prisma.pointsTransaction.aggregate({ where: { userId, lot: 'STANDARD' }, _sum: { delta: true } }))._sum.delta ?? 0;
  const expiredRows = (userId: string) =>
    prisma.pointsTransaction.findMany({ where: { userId, reason: 'POINTS_EXPIRED' }, orderBy: { createdAt: 'asc' } });

  /** Cron chạy nhiều đêm liên tiếp: chạy lại không được trừ lần hai. */
  async function runCron(nights = 2) {
    for (let night = 0; night < nights; night++) await expiry.expirePoints();
  }

  describe('huỷ/trả đơn đã giao: ORDER_REVERSED ăn lô ORDER_DELIVERED của chính đơn đó', () => {
    it('lô cũ không hạn 30, đơn giao +20 có hạn rồi huỷ (-20), qua hạn, cron hai lần → còn 30, không có POINTS_EXPIRED', async () => {
      const user = await customer();
      await oldLot(user.id, 30);
      const order = await deliveredOrder(user.id, 20);
      await loyalty.reverseOrderPoints(order.id);
      expect(await balance(user.id)).toBe(30);
      expect(await prisma.pointsTransaction.count({ where: { userId: user.id, reason: { startsWith: 'ORDER_REVERSED:' } } })).toBe(1);

      await ageLedger(user.id, 13);
      await runCron();

      expect(await expiredRows(user.id)).toHaveLength(0);
      expect(await balance(user.id)).toBe(30);
      expect(await standardSum(user.id)).toBe(30);
    });

    it('admin hạ loyalty.point_expire_months 12 → 3: lô cũ hạn 12 tháng nằm trước lô đơn hạn 3 tháng, trả đơn rồi qua 4 tháng → lô cũ còn nguyên', async () => {
      const user = await customer();
      await oldLot(user.id, 20, 300); // hạn còn 300 ngày: muộn hơn lô đơn
      await config.set('loyalty.point_expire_months', 3, 'it-pe5');
      let order;
      try {
        order = await deliveredOrder(user.id, 15); // hạn 3 tháng
      } finally {
        await config.set('loyalty.point_expire_months', 12, 'it-pe5');
      }
      await loyalty.reverseOrderPoints(order.id);
      expect(await balance(user.id)).toBe(20);

      await ageLedger(user.id, 4); // lô đơn quá hạn 1 tháng; lô cũ còn khoảng 5 tháng
      await runCron(3);

      expect(await expiredRows(user.id)).toHaveLength(0);
      expect(await balance(user.id)).toBe(20);
    });

    it('đơn tiêu 40 điểm rồi bị trả: dòng hoàn ORDER_REFUND_POINTS (cùng refId) là lô riêng, hết hạn đúng một lần, dòng thu hồi không ăn nó', async () => {
      const user = await customer();
      await oldLot(user.id, 100);
      const order = await deliveredOrder(user.id, 20, 40);
      await loyalty.reverseOrderPoints(order.id);
      expect(await balance(user.id)).toBe(100);

      await ageLedger(user.id, 13); // lô hoàn 40 (hạn 12 tháng kể từ lúc hoàn) đã quá hạn; lô đơn giao đã được thu hồi hết
      await runCron();

      expect((await expiredRows(user.id)).map((r) => r.delta)).toEqual([-40]);
      expect(await balance(user.id)).toBe(60);
      expect(await standardSum(user.id)).toBe(60);
    });

    it('nhiều đơn: chỉ đơn bị trả được đảo, đơn còn lại hết hạn bình thường đúng một lần', async () => {
      const user = await customer();
      await oldLot(user.id, 30);
      const kept = await deliveredOrder(user.id, 20);
      const returned = await deliveredOrder(user.id, 10);
      await loyalty.reverseOrderPoints(returned.id);
      expect(await balance(user.id)).toBe(50);

      await ageLedger(user.id, 13);
      await runCron();

      expect(kept.id).not.toBe(returned.id);
      expect((await expiredRows(user.id)).map((r) => r.delta)).toEqual([-20]);
      expect(await balance(user.id)).toBe(30);
      expect(await standardSum(user.id)).toBe(30);
    });

    it('tiêu điểm vào việc khác sau khi nhận: dòng tiêu vẫn FIFO (ăn lô cũ), phần thu hồi vẫn ăn lô đơn', async () => {
      const user = await customer();
      await oldLot(user.id, 30);
      const order = await deliveredOrder(user.id, 20);
      await prisma.$transaction([
        prisma.pointsTransaction.create({ data: { userId: user.id, delta: -25, lot: 'STANDARD', reason: 'IT_SPEND', refType: 'IT' } }),
        prisma.user.update({ where: { id: user.id }, data: { pointsBalance: { decrement: 25 } } }),
      ]);
      await loyalty.reverseOrderPoints(order.id);
      expect(await balance(user.id)).toBe(5); // 30 + 20 - 25 - 20

      await ageLedger(user.id, 13);
      await runCron();

      expect(await expiredRows(user.id)).toHaveLength(0); // 5 điểm còn lại nằm ở lô cũ không hạn
      expect(await balance(user.id)).toBe(5);
    });

    it('không có dòng thu hồi: kết quả y hệt trước đây (đơn giao hết hạn đúng một lần, lô cũ còn nguyên)', async () => {
      const user = await customer();
      await oldLot(user.id, 30);
      await deliveredOrder(user.id, 20);

      await ageLedger(user.id, 13);
      await runCron(3);

      expect((await expiredRows(user.id)).map((r) => r.delta)).toEqual([-20]);
      expect(await balance(user.id)).toBe(30);
    });
  });

  describe('thu hồi thưởng giới thiệu: dòng REVOKE ăn đúng lô thưởng đã cấp', () => {
    /** Người mời có lô cũ 30 không hạn. */
    async function referrerWithOldLot() {
      const referrer = await customer();
      await oldLot(referrer.id, 30);
      return referrer;
    }

    /** Một người được mời có hai đơn giao; thưởng đơn thứ hai (và mốc nếu có) cấp bằng RewardPointsService thật. */
    async function grantReferral(referrerId: string, milestone?: { count: number; gen: number; bonus: number }) {
      const referee = await createUser(prisma, { referredById: referrerId });
      const first = await createOrder(prisma, { userId: referee.id, status: 'DELIVERED' });
      const second = await createOrder(prisma, { userId: referee.id, status: 'DELIVERED' });
      await rewards.grant(referrerId, 5, `REFERRAL_ORDER2:${referee.id}`, 'REFERRAL', `${first.id}:${second.id}`);
      if (milestone) {
        await rewards.grant(referrerId, milestone.bonus, milestoneGrantReason(referrerId, milestone.count, milestone.gen), 'REFERRAL', referrerId);
      }
      return { referee, first, second };
    }

    const revoke = (order: { id: string; userId: string }) => prisma.$transaction((tx) => revokeReferralRewardForOrder(tx, order));

    it('thưởng đơn thứ hai +5 bị thu hồi (-5), qua hạn, cron hai lần → lô cũ không hạn còn 30, không có POINTS_EXPIRED', async () => {
      const referrer = await referrerWithOldLot();
      const { second } = await grantReferral(referrer.id);
      expect(await revoke(second)).toEqual({ revoked: 5, shortfall: 0 });
      expect(await balance(referrer.id)).toBe(30);

      await ageLedger(referrer.id, 13);
      await runCron();

      expect(await expiredRows(referrer.id)).toHaveLength(0);
      expect(await balance(referrer.id)).toBe(30);
      expect(await standardSum(referrer.id)).toBe(30);
    });

    it('kèm mốc thưởng thêm +10: cả hai dòng REVOKE ăn lô của mình, không lô nào hết hạn lại', async () => {
      const referrer = await referrerWithOldLot();
      const { second } = await grantReferral(referrer.id, { count: 1, gen: 0, bonus: 10 });
      expect(await balance(referrer.id)).toBe(45);
      expect(await revoke(second)).toEqual({ revoked: 15, shortfall: 0 });
      expect(await balance(referrer.id)).toBe(30);

      await ageLedger(referrer.id, 13);
      await runCron();

      expect(await expiredRows(referrer.id)).toHaveLength(0);
      expect(await balance(referrer.id)).toBe(30);
      expect(await standardSum(referrer.id)).toBe(30);
    });

    it('mốc đạt lại ở đời 2 (#1) rồi bị thu hồi: REVOKE đời 2 ăn lô đời 2 (12), lô đời 1 đã thu hồi trước đó không bị trừ lại', async () => {
      const referrer = await referrerWithOldLot();
      const gen0 = await grantReferral(referrer.id, { count: 1, gen: 0, bonus: 10 });
      await revoke(gen0.second);
      expect(await balance(referrer.id)).toBe(30);
      const gen1 = await grantReferral(referrer.id, { count: 1, gen: 1, bonus: 12 });
      expect(await balance(referrer.id)).toBe(30 + 5 + 12);
      expect(await revoke(gen1.second)).toEqual({ revoked: 17, shortfall: 0 });
      expect(await balance(referrer.id)).toBe(30);
      expect(await prisma.pointsTransaction.count({ where: { userId: referrer.id, reason: { startsWith: 'REFERRAL_MILESTONE_REVOKE:' } } })).toBe(2);

      await ageLedger(referrer.id, 13);
      await runCron();

      expect(await expiredRows(referrer.id)).toHaveLength(0);
      expect(await balance(referrer.id)).toBe(30);
      expect(await standardSum(referrer.id)).toBe(30);
    });

    it('thưởng giới thiệu còn nguyên (không bị thu hồi) vẫn hết hạn đúng một lần', async () => {
      const referrer = await referrerWithOldLot();
      await grantReferral(referrer.id, { count: 1, gen: 0, bonus: 10 });

      await ageLedger(referrer.id, 13);
      await runCron(3);

      expect((await expiredRows(referrer.id)).map((r) => r.delta)).toEqual([-15]);
      expect(await balance(referrer.id)).toBe(30);
    });
  });
});
