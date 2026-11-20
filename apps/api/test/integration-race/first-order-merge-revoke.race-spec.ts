import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import type { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import type { Env } from '../../src/config/env.validation';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { REFERRAL_VIRAL_ENABLED_KEY } from '../../src/modules/referral/viral-config';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

const POINTS = 100;

/**
 * MINOR 3 của w8-02: phiên khách G do chính tài khoản T mời (T tạo phiên khách bằng mã của mình, khách xác thực SĐT khác) nhận thưởng đơn
 * đầu, rồi G gộp vào T. Bước 10 của mergeGuestInto cắt liên kết tự mời; trước đây chỉ thu thưởng đơn thứ 2, nên T giữ cả 100 điểm phần người
 * mời lẫn 100 điểm phần phiên khách (sổ của G đã sang T ở bước 5). Chạy trên Postgres thật: đường cấp và đường gộp thật, số dư khớp sổ.
 */
describe('Gộp phiên khách tự mời thu hồi thưởng đơn đầu (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let rewards: RewardPointsService;
  let auth: AuthService;
  let zaloIdForNextCall = '';
  let savedFlag: { key: string; value: unknown } | null = null;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService, RewardPointsService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    rewards = moduleRef.get(RewardPointsService);
    savedFlag = await prisma.systemConfig.findUnique({ where: { key: REFERRAL_VIRAL_ENABLED_KEY } });
    await setConfig(prisma, REFERRAL_VIRAL_ENABLED_KEY, true);
    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-w10-02', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30 };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const zalo = {
      getUserInfo: async () => ({ zaloId: zaloIdForNextCall, name: 'Zalo IT' }),
      resolvePhoneNumber: async () => null,
    } as unknown as ZaloService;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    auth = new AuthService(prisma, new JwtService(), config, zalo, rbac);
  });

  afterAll(async () => {
    if (prisma) {
      if (savedFlag) await setConfig(prisma, savedFlag.key, savedFlag.value as never);
      else await prisma.systemConfig.deleteMany({ where: { key: REFERRAL_VIRAL_ENABLED_KEY } });
    }
    await moduleRef?.close();
  });

  const phone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

  async function balanceOf(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } });
    const sum = await prisma.pointsTransaction.aggregate({ where: { userId, lot: 'STANDARD' }, _sum: { delta: true } });
    expect(u.pointsBalance).toBe(sum._sum.delta ?? 0);
    return u.pointsBalance;
  }

  /** Phiên khách đã xác thực SĐT (người dùng thật), người mời `referrerId`, có đơn đầu 250.000đ đã giao và đã được thưởng đơn đầu. */
  async function rewardedGuest(referrerId: string) {
    const guest = await createUser(prisma, { zaloId: `guest_dev_${randCode(10)}`, phone: phone(), referredById: referrerId });
    const order = await createOrder(prisma, { userId: guest.id, status: 'DELIVERED', subtotal: 250_000, total: 250_000, deliveredAt: new Date() });
    expect(await rewards.grantReferralFirstOrderReward(order.id)).toEqual({ status: 'GRANTED', referrerId, refereeId: guest.id, points: POINTS });
    return { guest, order };
  }

  async function merge(guestId: string, target: { zaloId: string | null }) {
    zaloIdForNextCall = target.zaloId!;
    await auth.ensurePhoneForCurrentUser(guestId, 'code', 'access');
  }

  const firstOrderRows = (userId: string) =>
    prisma.pointsTransaction.findMany({
      where: { userId, reason: { startsWith: 'REFERRAL_FIRST_ORDER_' } },
      select: { reason: true, delta: true, refType: true, refId: true },
      orderBy: { reason: 'asc' },
    });

  it('tự mời: gộp thu cả hai phần (200 điểm) về 0, mỗi phần một dòng đối ứng; gộp không cấp lại; xét lại đơn cũng không cấp lại', async () => {
    const target = await createUser(prisma, { zaloId: `zalo_it_${randCode(10)}` });
    const { guest, order } = await rewardedGuest(target.id);
    expect(await balanceOf(target.id)).toBe(POINTS);
    expect(await balanceOf(guest.id)).toBe(POINTS);

    await merge(guest.id, target);

    expect(await balanceOf(target.id)).toBe(0);
    expect(await firstOrderRows(target.id)).toEqual([
      { reason: `REFERRAL_FIRST_ORDER_REFEREE:${guest.id}`, delta: POINTS, refType: 'REFERRAL', refId: order.id },
      { reason: `REFERRAL_FIRST_ORDER_REFERRER:${guest.id}`, delta: POINTS, refType: 'REFERRAL', refId: order.id },
      { reason: `REFERRAL_FIRST_ORDER_REVOKE:REFEREE:${guest.id}`, delta: -POINTS, refType: 'REFERRAL', refId: `MERGE:${guest.id}` },
      { reason: `REFERRAL_FIRST_ORDER_REVOKE:REFERRER:${guest.id}`, delta: -POINTS, refType: 'REFERRAL', refId: `MERGE:${guest.id}` },
    ]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: guest.id } })).referredById).toBeNull();

    // Việc sau giao chạy lại cho đơn (nay thuộc T, T không có người mời): không có dòng thưởng mới.
    expect((await rewards.grantReferralFirstOrderReward(order.id)).status).toBe('SKIPPED');
    expect(await balanceOf(target.id)).toBe(0);
    expect(await prisma.pointsTransaction.count({ where: { refType: 'REFERRAL', reason: { contains: guest.id }, delta: { gt: 0 } } })).toBe(2);
  });

  it('phiên khách đã tiêu bớt điểm trước khi gộp: trừ phần còn, phần thiếu ghi nợ REFERRAL_DEBT, số dư không âm', async () => {
    const target = await createUser(prisma, { zaloId: `zalo_it_${randCode(10)}` });
    const { guest } = await rewardedGuest(target.id);
    await prisma.$transaction([
      prisma.pointsTransaction.create({ data: { userId: guest.id, delta: -60, lot: 'STANDARD', reason: `ORDER_REDEEM:IT${randCode(6)}`, refType: 'ORDER' } }),
      prisma.user.update({ where: { id: guest.id }, data: { pointsBalance: { decrement: 60 } } }),
    ]);

    await merge(guest.id, target);

    expect(await balanceOf(target.id)).toBe(0);
    const debt = await prisma.pointsTransaction.findMany({ where: { userId: target.id, refType: 'REFERRAL_DEBT' }, select: { reason: true, delta: true } });
    expect(debt).toEqual([{ reason: `REFERRAL_FIRST_ORDER_DEBT:REFEREE:${guest.id}:60`, delta: 0 }]);
  });

  it('hai phiên khách của T trên một vòng (G mời r, r mời T): gộp G cắt r và thu phần người mời; gộp r sau đó thu nốt phần r giữ', async () => {
    const g = await createUser(prisma, { zaloId: `guest_dev_${randCode(10)}`, phone: phone() });
    const { guest: r } = await rewardedGuest(g.id);
    const target = await createUser(prisma, { zaloId: `zalo_it_${randCode(10)}`, referredById: r.id });

    await merge(g.id, target);
    // r nằm trên vòng T -> r -> (G = T): liên kết của r bị cắt, phần người mời (đã theo sổ G sang T) bị thu; r còn là phiên riêng nên giữ phần mình.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: r.id } })).referredById).toBeNull();
    expect(await balanceOf(target.id)).toBe(0);
    expect(await balanceOf(r.id)).toBe(POINTS);

    await merge(r.id, target);

    expect(await balanceOf(target.id)).toBe(0);
    expect(
      (await firstOrderRows(target.id)).filter((x) => x.reason.startsWith('REFERRAL_FIRST_ORDER_REVOKE:')).map((x) => [x.reason, x.delta, x.refId]),
    ).toEqual([
      [`REFERRAL_FIRST_ORDER_REVOKE:REFEREE:${r.id}`, -POINTS, `MERGE:${r.id}`],
      [`REFERRAL_FIRST_ORDER_REVOKE:REFERRER:${r.id}`, -POINTS, `MERGE:${g.id}`],
    ]);
  });

  it('phiên khách do người khác (R) mời gộp vào T: không cắt liên kết, R và T giữ thưởng đơn đầu', async () => {
    const referrer = await createUser(prisma, { zaloId: `zalo_it_${randCode(10)}` });
    const target = await createUser(prisma, { zaloId: `zalo_it_${randCode(10)}` });
    const { guest } = await rewardedGuest(referrer.id);

    await merge(guest.id, target);

    expect(await balanceOf(referrer.id)).toBe(POINTS);
    expect(await balanceOf(target.id)).toBe(POINTS);
    expect(await prisma.pointsTransaction.count({ where: { reason: { startsWith: 'REFERRAL_FIRST_ORDER_REVOKE:' }, refId: `MERGE:${guest.id}` } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: guest.id } })).referredById).toBe(referrer.id);
  });
});
