import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import type { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import type { Env } from '../../src/config/env.validation';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { LoyaltyExpiryService } from '../../src/modules/loyalty/loyalty-expiry.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { ReviewsService } from '../../src/modules/reviews/reviews.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { milestoneGrantReason, revokeReferralRewardForOrder } from '../../src/modules/wallet/referral-reward';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

const DAY = 864e5;

type ReversalKind = 'ORDER_REVERSED' | 'REVIEW_DELETE' | 'REFERRAL_ORDER2_REVOKE' | 'REFERRAL_MILESTONE_REVOKE';
const KINDS: ReversalKind[] = ['ORDER_REVERSED', 'REVIEW_DELETE', 'REFERRAL_ORDER2_REVOKE', 'REFERRAL_MILESTONE_REVOKE'];
/** Tiền tố `reason` của dòng thu hồi tương ứng; dùng để chắc dòng đó có thật trước và sau khi gộp. */
const REVOKE_PREFIX: Record<ReversalKind, string> = {
  ORDER_REVERSED: 'ORDER_REVERSED:',
  REVIEW_DELETE: 'REVIEW_DELETE:',
  REFERRAL_ORDER2_REVOKE: 'REFERRAL_ORDER2_REVOKE:',
  REFERRAL_MILESTONE_REVOKE: 'REFERRAL_MILESTONE_REVOKE:',
};

/**
 * PF-3 mục 5: gộp phiên khách (AuthService.mergeGuestInto) đổi userId của MỌI dòng sổ điểm sang tài khoản chính, kể cả
 * các dòng thu hồi ghép lô (ORDER_REVERSED, REVIEW_DELETE, REFERRAL_*_REVOKE). Cron hết hạn replay sổ đã gộp: dòng thu hồi
 * phải vẫn ăn đúng lô gốc, dòng POINTS_EXPIRED đã ghi trước khi gộp không được khiến cron trừ lần hai, số dư khớp sổ.
 *
 * "Thời gian trôi" dựng bằng lùi createdAt/expiresAt trong sổ như pe5-reversal-expiry.
 */
describe('gộp phiên khách với dòng thu hồi ghép lô, rồi cron hết hạn điểm (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let auth: AuthService;
  let loyalty: LoyaltyService;
  let expiry: LoyaltyExpiryService;
  let rewards: RewardPointsService;
  let reviews: ReviewsService;
  let zaloIdForNextCall = '';
  const touched: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        LoyaltyService,
        LoyaltyExpiryService,
        RewardPointsService,
        ReviewsService,
        { provide: NotificationsService, useValue: { notify: async () => undefined } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    loyalty = moduleRef.get(LoyaltyService);
    expiry = moduleRef.get(LoyaltyExpiryService);
    rewards = moduleRef.get(RewardPointsService);
    reviews = moduleRef.get(ReviewsService);
    await warmPool(prisma);
    await setConfig(prisma, 'loyalty.point_expire_months', 12);

    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-pf3-merge', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30 };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const zalo = {
      getUserInfo: async () => ({ zaloId: zaloIdForNextCall, name: 'Zalo IT' }),
      resolvePhoneNumber: async () => null,
    } as unknown as ZaloService;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    auth = new AuthService(prisma, new JwtService(), config, zalo, rbac);
  });

  afterEach(async () => {
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function guestAndTarget() {
    const guest = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, fullName: 'Khách' });
    const target = await createUser(prisma, { zaloId: `zalo_${randCode(10)}` });
    touched.push(guest.id, target.id);
    await prisma.refreshToken.create({ data: { userId: guest.id, tokenHash: `it-${randCode(16)}`, expiresAt: new Date(Date.now() + DAY) } });
    return { guest, target };
  }

  /** Lô cũ không hạn: dòng sổ cộng số dư, khớp sổ. */
  async function oldLot(userId: string, points: number) {
    await prisma.$transaction([
      prisma.pointsTransaction.create({
        data: { userId, delta: points, lot: 'STANDARD', reason: 'IT_OLD_LOT', refType: 'GAME', createdAt: new Date(Date.now() - 400 * DAY), expiresAt: null },
      }),
      prisma.user.update({ where: { id: userId }, data: { pointsBalance: { increment: points } } }),
    ]);
  }

  /** Lô có hạn (thưởng cộng đồng, 12 tháng). */
  const liveLot = (userId: string, points: number) =>
    rewards.grant(userId, points, `COMMUNITY_POST:it-pf3-${randCode(6)}`, 'COMMUNITY', null);

  async function deliveredOrderWithProduct(userId: string) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-pf3m-p-${tag}`, brand: 'IT', slug: `it-pf3m-${tag.toLowerCase()}`, name: `SP PF3M ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    const variation = await prisma.variation.create({
      data: { pancakeId: `it-pf3m-v-${tag}`, productId: product.id, sku: `PF3M-${tag}`, name: 'Chai', attributes: {}, retailPrice: 100_000, salePrice: 100_000, stock: 9 },
    });
    await createOrder(prisma, {
      userId,
      status: 'DELIVERED',
      items: { create: [{ variationId: variation.id, productName: 'SP IT', variationName: 'Chai', unitPrice: 100_000, quantity: 1, total: 100_000 }] },
    });
    return product;
  }

  /** Dựng cho `userId` một khoản cộng có hạn đã bị thu hồi bằng đúng dòng thu hồi của `kind` (tổng ròng 0 điểm). */
  async function accrueAndRevoke(userId: string, kind: ReversalKind) {
    switch (kind) {
      case 'ORDER_REVERSED': {
        const order = await createOrder(prisma, { userId, status: 'DELIVERED', pointsEarned: 20 });
        await loyalty.creditOrderPoints(order.id);
        await loyalty.reverseOrderPoints(order.id);
        return;
      }
      case 'REVIEW_DELETE': {
        const product = await deliveredOrderWithProduct(userId);
        const review = await reviews.create(userId, product.slug, { rating: 5 });
        await reviews.remove(userId, 'USER', review.id);
        return;
      }
      default: {
        const referee = await createUser(prisma, { referredById: userId });
        const first = await createOrder(prisma, { userId: referee.id, status: 'DELIVERED' });
        const second = await createOrder(prisma, { userId: referee.id, status: 'DELIVERED' });
        await rewards.grant(userId, 5, `REFERRAL_ORDER2:${referee.id}`, 'REFERRAL', `${first.id}:${second.id}`);
        if (kind === 'REFERRAL_MILESTONE_REVOKE') {
          await rewards.grant(userId, 10, milestoneGrantReason(userId, 1, 0), 'REFERRAL', userId);
        }
        await prisma.$transaction((tx) => revokeReferralRewardForOrder(tx, second));
      }
    }
  }

  /** Thời gian trôi N tháng cho mọi dòng sổ của các user. */
  async function ageLedger(userIds: string[], months: number) {
    await prisma.$executeRaw`
      UPDATE "points_transactions"
         SET "createdAt" = "createdAt" - (${months}::int * interval '1 month'),
             "expiresAt" = "expiresAt" - (${months}::int * interval '1 month')
       WHERE "userId" = ANY(${userIds}::text[])`;
  }

  async function merge(guestId: string, targetZaloId: string) {
    zaloIdForNextCall = targetZaloId;
    return auth.ensurePhoneForCurrentUser(guestId, 'code', 'access');
  }

  const balance = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pointsBalance;
  const standardSum = async (userId: string) =>
    (await prisma.pointsTransaction.aggregate({ where: { userId, lot: 'STANDARD' }, _sum: { delta: true } }))._sum.delta ?? 0;
  const rowsOf = (userId: string, prefix: string) => prisma.pointsTransaction.findMany({ where: { userId, reason: { startsWith: prefix } } });
  const expiredRows = (userId: string) => rowsOf(userId, 'POINTS_EXPIRED');

  describe.each(KINDS)('dòng thu hồi %s của khách sang tài khoản chính', (kind) => {
    it('gộp rồi qua hạn: dòng thu hồi vẫn ăn đúng lô gốc, cron hai đêm không trừ gì, số dư = hai lô cũ', async () => {
      const { guest, target } = await guestAndTarget();
      await oldLot(guest.id, 10);
      await oldLot(target.id, 30);
      await accrueAndRevoke(guest.id, kind);
      expect(await rowsOf(guest.id, REVOKE_PREFIX[kind])).not.toHaveLength(0);
      expect(await balance(guest.id)).toBe(10);

      const res = await merge(guest.id, target.zaloId!);

      expect(res.user.id).toBe(target.id);
      expect(await balance(target.id)).toBe(40);
      expect(await balance(guest.id)).toBe(0);
      expect(await rowsOf(target.id, REVOKE_PREFIX[kind])).not.toHaveLength(0);
      expect(await rowsOf(guest.id, REVOKE_PREFIX[kind])).toHaveLength(0);

      await ageLedger([target.id], 13);
      await expiry.expirePoints();
      await expiry.expirePoints();

      expect(await expiredRows(target.id)).toHaveLength(0);
      expect(await balance(target.id)).toBe(40);
      expect(await standardSum(target.id)).toBe(40);
    });

    it('cron đã chạy ở cả hai bên trước khi gộp (có POINTS_EXPIRED): gộp rồi cron nữa không trừ lần hai', async () => {
      const { guest, target } = await guestAndTarget();
      await oldLot(guest.id, 10);
      await oldLot(target.id, 30);
      await accrueAndRevoke(guest.id, kind);
      await accrueAndRevoke(target.id, kind);
      await liveLot(guest.id, 7);
      await liveLot(target.id, 9);
      expect(await balance(guest.id)).toBe(17);
      expect(await balance(target.id)).toBe(39);

      await ageLedger([guest.id, target.id], 13);
      await expiry.expirePoints();
      expect((await expiredRows(guest.id)).map((r) => r.delta)).toEqual([-7]);
      expect((await expiredRows(target.id)).map((r) => r.delta)).toEqual([-9]);
      expect(await balance(guest.id)).toBe(10);
      expect(await balance(target.id)).toBe(30);

      await merge(guest.id, target.zaloId!);

      expect(await balance(target.id)).toBe(40);
      expect(await expiredRows(target.id)).toHaveLength(2);
      await expiry.expirePoints();
      await expiry.expirePoints();
      expect(await expiredRows(target.id)).toHaveLength(2);
      expect(await balance(target.id)).toBe(40);
      expect(await standardSum(target.id)).toBe(40);
    });

    it('khách còn lô có hạn chưa hết hạn lúc gộp: sau gộp qua hạn, cron trừ đúng lô đó một lần, dòng thu hồi không bị trừ lại', async () => {
      const { guest, target } = await guestAndTarget();
      await oldLot(target.id, 30);
      await accrueAndRevoke(guest.id, kind);
      await liveLot(guest.id, 8);

      await merge(guest.id, target.zaloId!);
      expect(await balance(target.id)).toBe(38);

      await ageLedger([target.id], 13);
      await expiry.expirePoints();
      await expiry.expirePoints();

      expect((await expiredRows(target.id)).map((r) => r.delta)).toEqual([-8]);
      expect(await balance(target.id)).toBe(30);
      expect(await standardSum(target.id)).toBe(30);
    });

    it('gộp chạy song song với cron: dù ai trước, tổng điểm hết hạn đúng một lần (-16), số dư khớp sổ, cron lần nữa không thêm dòng', async () => {
      const { guest, target } = await guestAndTarget();
      await oldLot(guest.id, 10);
      await oldLot(target.id, 30);
      await accrueAndRevoke(guest.id, kind);
      await accrueAndRevoke(target.id, kind);
      await liveLot(guest.id, 7);
      await liveLot(target.id, 9);
      await ageLedger([guest.id, target.id], 13);

      await Promise.all([merge(guest.id, target.zaloId!), expiry.expirePoints()]);
      await expiry.expirePoints();
      const rowsAfter = (await expiredRows(target.id)).length;
      await expiry.expirePoints();

      const expiredTotal = (await expiredRows(target.id)).reduce((s, r) => s + r.delta, 0);
      expect(expiredTotal).toBe(-16);
      expect(await expiredRows(guest.id)).toHaveLength(0);
      expect((await expiredRows(target.id)).length).toBe(rowsAfter);
      expect(await balance(target.id)).toBe(40);
      expect(await balance(guest.id)).toBe(0);
      expect(await standardSum(target.id)).toBe(40);
    });
  });
});
