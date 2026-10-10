import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { CoinsService } from '../../src/modules/wallet/coins.service';
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
  let coins: CoinsService;
  let coupons: CouponsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, CoinsService, CouponsService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    coins = moduleRef.get(CoinsService);
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

  describe('CoinsService.grantCoins', () => {
    it('grant trùng reason trong tx của caller → tx vẫn dùng được, chỉ cộng 1 lần', async () => {
      const user = await createUser(prisma);
      const reason = `COMMUNITY_POST:${randCode(8)}`;
      await coins.grantCoins(user.id, 200, reason, 'COMMUNITY', 'p1');

      await prisma.$transaction(async (tx) => {
        await coins.grantCoins(user.id, 200, reason, 'COMMUNITY', 'p1', tx);
        await tx.user.update({ where: { id: user.id }, data: { pointsBalance: { increment: 1 } } });
      });

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const rows = await prisma.coinTransaction.count({ where: { userId: user.id, reason } });
      expect(rows).toBe(1);
      expect(after.coinsBalance).toBe(200);
      expect(after.pointsBalance).toBe(1);
    });

    it('10 grant trùng song song trong tx Serializable của caller → không 500, cộng đúng 1 lần', async () => {
      const user = await createUser(prisma);
      const reason = `COMMUNITY_ANSWER:${randCode(8)}`;

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          prisma
            .$transaction(
              async (tx) => {
                await coins.grantCoins(user.id, 150, reason, 'COMMUNITY', 'a1', tx);
                await tx.user.update({ where: { id: user.id }, data: { pointsBalance: { increment: 1 } } });
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
      const rows = await prisma.coinTransaction.count({ where: { userId: user.id, reason } });
      console.log('[grant-tx] fulfilled=%d errors=%j', s.fulfilled.length, [...new Set(s.errors)]);

      expect(s.rejected).toHaveLength(0);
      expect(rows).toBe(1);
      expect(after.coinsBalance).toBe(150);
    });

    it('10 grant trùng song song không truyền tx → không lỗi, cộng đúng 1 lần', async () => {
      const user = await createUser(prisma);
      const reason = `REFERRAL_CASHBACK:${randCode(8)}`;
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => coins.grantCoins(user.id, 5000, reason, 'REFERRAL', 'r1')),
      );
      const s = summarize(results);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const rows = await prisma.coinTransaction.count({ where: { userId: user.id, reason } });
      console.log('[grant] fulfilled=%d errors=%j', s.fulfilled.length, [...new Set(s.errors)]);

      expect(s.rejected).toHaveLength(0);
      expect(rows).toBe(1);
      expect(after.coinsBalance).toBe(5000);
    });

    it('reason ngoài các index idempotent vẫn cộng mỗi lần gọi', async () => {
      const user = await createUser(prisma);
      await coins.grantCoins(user.id, 100, 'ADMIN_ADJUST', 'ADMIN');
      await coins.grantCoins(user.id, 100, 'ADMIN_ADJUST', 'ADMIN');
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const rows = await prisma.coinTransaction.count({ where: { userId: user.id } });
      expect(rows).toBe(2);
      expect(after.coinsBalance).toBe(200);
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
