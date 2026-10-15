import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, summarize, warmPool } from './helpers';

/**
 * C-061: một câu lệnh lỗi unique (P2002) bên trong interactive transaction làm Postgres huỷ cả tx
 * ("current transaction is aborted"), nên catch P2002 rồi đi tiếp là không đủ: mọi lệnh sau đó
 * của caller trong cùng tx đều nổ. Các case dưới chạy grant/redeem trùng TRONG tx của caller rồi
 * ghi thêm 1 lệnh, và gọi trùng song song.
 */
describe('P2002 inside interactive transactions (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let rewards: RewardPointsService;
  let coupons: CouponsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, RewardPointsService, CouponsService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    rewards = moduleRef.get(RewardPointsService);
    coupons = moduleRef.get(CouponsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function newCoupon(data: { usageLimit?: number | null; perUserLimit?: number } = {}) {
    return prisma.coupon.create({
      data: {
        code: `IT${randCode(8)}`,
        type: 'AMOUNT',
        value: 10_000,
        startAt: new Date(Date.now() - 3600_000),
        endAt: new Date(Date.now() + 3600_000),
        scope: 'PUBLIC',
        usageLimit: data.usageLimit === undefined ? 100 : data.usageLimit,
        perUserLimit: data.perUserLimit ?? 1,
      },
    });
  }

  describe('RewardPointsService.grant (PD-3, thay CoinsService.grantCoins)', () => {
    const pointsRows = (userId: string, reason: string) => prisma.pointsTransaction.count({ where: { userId, reason } });

    it('grant trùng reason trong tx của caller → tx vẫn dùng được, chỉ cộng 1 lần', async () => {
      const user = await createUser(prisma);
      const reason = `COMMUNITY_POST:${randCode(8)}`;
      await rewards.grant(user.id, 2, reason, 'COMMUNITY', 'p1');

      const expiresAt = await rewards.expiresAt();
      await prisma.$transaction(async (tx) => {
        expect(await rewards.grant(user.id, 2, reason, 'COMMUNITY', 'p1', tx, expiresAt)).toBe(false);
        await tx.user.update({ where: { id: user.id }, data: { walletBalance: { increment: 1 } } });
      });

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(await pointsRows(user.id, reason)).toBe(1);
      expect(after.pointsBalance).toBe(2);
      expect(after.walletBalance).toBe(1);
    });

    it('10 grant trùng song song trong tx Serializable của caller → không 500, cộng đúng 1 lần', async () => {
      const user = await createUser(prisma);
      const reason = `COMMUNITY_ANSWER:${randCode(8)}`;
      const expiresAt = await rewards.expiresAt();

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          prisma
            .$transaction(
              async (tx) => {
                await rewards.grant(user.id, 1, reason, 'COMMUNITY', 'a1', tx, expiresAt);
                await tx.user.update({ where: { id: user.id }, data: { walletBalance: { increment: 1 } } });
              },
              { isolationLevel: 'Serializable' },
            )
            // Serializable cho phép Postgres huỷ kẻ thua bằng 40001 (P2034); caller thật
            // (CommunityRewardService.rewardWithDailyCap) nuốt đúng mã này.
            .catch((e: { code?: string }) => {
              if (e?.code === 'P2034') return 'serialization';
              throw e;
            }),
        ),
      );
      const s = summarize(results);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      console.log('[grant-tx] fulfilled=%d errors=%j', s.fulfilled.length, [...new Set(s.errors)]);

      expect(s.rejected).toHaveLength(0);
      expect(await pointsRows(user.id, reason)).toBe(1);
      expect(after.pointsBalance).toBe(1);
    });

    it('10 grant trùng song song không truyền tx → không lỗi, cộng đúng 1 lần', async () => {
      const user = await createUser(prisma);
      const reason = `REFERRAL_ORDER2:${randCode(8)}`;
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => rewards.grant(user.id, 5, reason, 'REFERRAL', 'o1:o2')),
      );
      const s = summarize(results);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      console.log('[grant] fulfilled=%d errors=%j', s.fulfilled.length, [...new Set(s.errors)]);

      expect(s.rejected).toHaveLength(0);
      expect(s.fulfilled.filter((r) => r.value === true)).toHaveLength(1);
      expect(await pointsRows(user.id, reason)).toBe(1);
      expect(after.pointsBalance).toBe(5);
    });

    it('reason ngoài các index idempotent vẫn cộng mỗi lần gọi', async () => {
      const user = await createUser(prisma);
      await rewards.grant(user.id, 1, 'ADMIN_ADJUST', 'ADMIN');
      await rewards.grant(user.id, 1, 'ADMIN_ADJUST', 'ADMIN');
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(await prisma.pointsTransaction.count({ where: { userId: user.id } })).toBe(2);
      expect(after.pointsBalance).toBe(2);
    });
  });

  describe('CouponsService.redeem', () => {
    it('redeem trùng cùng đơn trong tx của caller → tx vẫn dùng được, usedCount chỉ +1', async () => {
      const user = await createUser(prisma);
      const order = await createOrder(prisma, { userId: user.id });
      const coupon = await newCoupon({ perUserLimit: 0 });
      await coupons.redeem(coupon.code, user.id, order.id);

      await prisma.$transaction(async (tx) => {
        await coupons.redeem(coupon.code, user.id, order.id, tx);
        await tx.user.update({ where: { id: user.id }, data: { pointsBalance: { increment: 1 } } });
      });

      const c = await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      const rows = await prisma.couponRedemption.count({ where: { couponId: coupon.id } });
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(rows).toBe(1);
      expect(c.usedCount).toBe(1);
      expect(after.pointsBalance).toBe(1);
    });

    it('retry cùng đơn khi perUserLimit=1 → no-op idempotent, không báo "hết lượt"', async () => {
      const user = await createUser(prisma);
      const order = await createOrder(prisma, { userId: user.id });
      const coupon = await newCoupon({ perUserLimit: 1 });
      await coupons.redeem(coupon.code, user.id, order.id);
      await expect(coupons.redeem(coupon.code, user.id, order.id)).resolves.toBeUndefined();
      const c = await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      expect(c.usedCount).toBe(1);
    });

    it('10 redeem trùng cùng đơn song song (tx của caller + ghi tiếp) → không 500, 1 redemption, usedCount=1', async () => {
      const user = await createUser(prisma);
      const order = await createOrder(prisma, { userId: user.id });
      const coupon = await newCoupon({ perUserLimit: 0 });

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          prisma.$transaction(async (tx) => {
            await coupons.redeem(coupon.code, user.id, order.id, tx);
            await tx.user.update({ where: { id: user.id }, data: { pointsBalance: { increment: 1 } } });
          }),
        ),
      );
      const s = summarize(results);
      const c = await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      const rows = await prisma.couponRedemption.count({ where: { couponId: coupon.id } });
      console.log('[redeem-tx] fulfilled=%d errors=%j', s.fulfilled.length, [...new Set(s.errors)]);

      expect(s.rejected).toHaveLength(0);
      expect(rows).toBe(1);
      expect(c.usedCount).toBe(1);
    });

    it('10 redeem trùng cùng đơn song song, perUserLimit=1, không tx → không lỗi, usedCount=1', async () => {
      const user = await createUser(prisma);
      const order = await createOrder(prisma, { userId: user.id });
      const coupon = await newCoupon({ perUserLimit: 1 });

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => coupons.redeem(coupon.code, user.id, order.id)),
      );
      const s = summarize(results);
      const c = await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      const rows = await prisma.couponRedemption.count({ where: { couponId: coupon.id } });
      console.log('[redeem] fulfilled=%d errors=%j', s.fulfilled.length, [...new Set(s.errors)]);

      expect(s.rejected).toHaveLength(0);
      expect(rows).toBe(1);
      expect(c.usedCount).toBe(1);
    });

    it('perUserLimit vẫn chặn đơn KHÁC của cùng user', async () => {
      const user = await createUser(prisma);
      const o1 = await createOrder(prisma, { userId: user.id });
      const o2 = await createOrder(prisma, { userId: user.id });
      const coupon = await newCoupon({ perUserLimit: 1 });
      await coupons.redeem(coupon.code, user.id, o1.id);
      await expect(coupons.redeem(coupon.code, user.id, o2.id)).rejects.toThrow('hết lượt');
      const c = await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      expect(c.usedCount).toBe(1);
    });

    it('usageLimit vẫn chặn khi hết lượt toàn cục', async () => {
      const coupon = await newCoupon({ usageLimit: 1, perUserLimit: 0 });
      const u1 = await createUser(prisma);
      const u2 = await createUser(prisma);
      const o1 = await createOrder(prisma, { userId: u1.id });
      const o2 = await createOrder(prisma, { userId: u2.id });
      await coupons.redeem(coupon.code, u1.id, o1.id);
      await expect(coupons.redeem(coupon.code, u2.id, o2.id)).rejects.toThrow('hết lượt');
      const rows = await prisma.couponRedemption.count({ where: { couponId: coupon.id } });
      expect(rows).toBe(1);
    });
  });
});
