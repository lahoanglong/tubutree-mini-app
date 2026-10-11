import { InternalServerErrorException } from '@nestjs/common';
import { POINTS_GRANT_HARD_MAX, RewardPointsService } from './reward-points.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

/** Config chỉ trả mặc định trong mã, trừ các khoá ghi đè. */
function cfg(overrides: Record<string, unknown> = {}) {
  return {
    get: jest.fn().mockImplementation(async (key: string, fb?: unknown) => (key in overrides ? overrides[key] : fb)),
  } as unknown as SystemConfigService;
}

/** count() theo tiền tố reason — mô phỏng số dòng thưởng/thu hồi giới thiệu ở MỘT sổ. */
function countByPrefix(byPrefix: Record<string, number>) {
  return jest
    .fn()
    .mockImplementation(async ({ where }: { where: { reason: { startsWith: string } } }) => byPrefix[where.reason.startsWith] ?? 0);
}

function makePrisma(opts: {
  referredById?: string | null;
  referrerRole?: string;
  orders?: { id: string; createdAt: Date }[];
  coinFindFirst?: unknown;
  pointsFindFirst?: unknown;
  inserted?: number;
  coinCount?: jest.Mock;
  pointsCount?: jest.Mock;
  coinMilestoneRows?: { reason: string; delta: number }[];
  pointsMilestoneRows?: { reason: string; delta: number }[];
} = {}) {
  const createManyAndReturn = jest
    .fn()
    .mockImplementation(async () => (opts.inserted ?? 1) > 0 ? [{ id: 'ptx1' }] : []);
  const userUpdate = jest.fn().mockResolvedValue({});
  const findUnique = jest
    .fn()
    .mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'referee1' ? { referredById: opts.referredById ?? null } : { role: opts.referrerRole ?? 'CUSTOMER' },
    );
  const prisma = {
    user: { findUnique, update: userUpdate, findUniqueOrThrow: jest.fn().mockResolvedValue({ referralCode: 'ABC123' }) },
    order: { findMany: jest.fn().mockResolvedValue(opts.orders ?? []) },
    coinTransaction: {
      findFirst: jest.fn().mockResolvedValue(opts.coinFindFirst ?? null),
      count: opts.coinCount ?? jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue(opts.coinMilestoneRows ?? []),
      aggregate: jest.fn().mockResolvedValue({ _sum: { delta: null } }),
    },
    pointsTransaction: {
      findFirst: jest.fn().mockResolvedValue(opts.pointsFindFirst ?? null),
      count: opts.pointsCount ?? jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue(opts.pointsMilestoneRows ?? []),
      aggregate: jest.fn().mockResolvedValue({ _sum: { delta: null } }),
      createManyAndReturn,
      create: jest.fn().mockResolvedValue({ id: 'ptx2' }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn().mockImplementation(async (cb: (t: unknown) => unknown) => cb(prisma)),
  };
  return { prisma: prisma as unknown as PrismaService, raw: prisma, createManyAndReturn, userUpdate };
}

describe('RewardPointsService.grant (PD-3: mọi thưởng mới là Điểm Xanh lô STANDARD có hạn)', () => {
  it('ghi 1 dòng lô STANDARD có hạn loyalty.point_expire_months, ON CONFLICT DO NOTHING, cộng pointsBalance', async () => {
    const { prisma, createManyAndReturn, userUpdate } = makePrisma();
    const before = Date.now();
    const ok = await new RewardPointsService(prisma, cfg({ 'loyalty.point_expire_months': 12 })).grant(
      'u1',
      5,
      'COMMUNITY_POST:p1',
      'COMMUNITY',
      'p1',
    );
    expect(ok).toBe(true);
    const arg = createManyAndReturn.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data[0]).toMatchObject({ userId: 'u1', delta: 5, lot: 'STANDARD', reason: 'COMMUNITY_POST:p1', refType: 'COMMUNITY', refId: 'p1' });
    const exp = (arg.data[0].expiresAt as Date).getTime();
    expect(exp).toBeGreaterThan(before + 360 * 864e5);
    expect(exp).toBeLessThan(before + 370 * 864e5);
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { pointsBalance: { increment: 5 } } });
  });

  it('trùng khoá (INSERT bỏ qua) → false, không cộng số dư', async () => {
    const { prisma, userUpdate } = makePrisma({ inserted: 0 });
    expect(await new RewardPointsService(prisma, cfg()).grant('u1', 5, 'REFERRAL_ORDER2:r1', 'REFERRAL', 'o1:o2')).toBe(false);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['COMMUNITY', 'COMMUNITY_BEST:p1', { reason: 'COMMUNITY_BEST:p1', refType: 'COMMUNITY' }],
    ['REFERRAL', 'REFERRAL_MILESTONE:u1:3', { reason: 'REFERRAL_MILESTONE:u1:3', refType: 'REFERRAL' }],
    ['QUEST', 'STOREFRONT_QUEST:publish', { userId: 'u1', reason: 'STOREFRONT_QUEST:publish', refType: 'QUEST' }],
  ])('đã nhận bằng xu trước gộp (%s) → không cấp lại; tra coin đúng phạm vi khoá cũ', async (refType, reason, where) => {
    const { prisma, raw, createManyAndReturn } = makePrisma({ coinFindFirst: { id: 'c1' } });
    expect(await new RewardPointsService(prisma, cfg()).grant('u1', 2, reason, refType, 'x')).toBe(false);
    expect(raw.coinTransaction.findFirst).toHaveBeenCalledWith({ where, select: { id: true } });
    expect(createManyAndReturn).not.toHaveBeenCalled();
  });

  it('refType không có khoá cũ ở coin (AFFILIATE_MILESTONE, SEASONPASS) → không tra coin', async () => {
    const { prisma, raw } = makePrisma({ coinFindFirst: { id: 'c1' } });
    expect(await new RewardPointsService(prisma, cfg()).grant('u1', 50, 'CTV_MILESTONE:m:2026-10', 'AFFILIATE_MILESTONE', 'cl1')).toBe(true);
    expect(raw.coinTransaction.findFirst).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN, POINTS_GRANT_HARD_MAX + 1, 20000])('số điểm %p → lỗi 500, không ghi gì', async (points) => {
    const { prisma, raw, createManyAndReturn } = makePrisma();
    await expect(new RewardPointsService(prisma, cfg()).grant('u1', points, 'X', 'COMMUNITY')).rejects.toThrow(InternalServerErrorException);
    expect(createManyAndReturn).not.toHaveBeenCalled();
    expect(raw.$transaction).not.toHaveBeenCalled();
  });

  it('đúng trần 2.000 (mốc CTV 80 triệu) vẫn cấp', async () => {
    const { prisma } = makePrisma();
    expect(await new RewardPointsService(prisma, cfg()).grant('u1', POINTS_GRANT_HARD_MAX, 'X', 'AFFILIATE_MILESTONE')).toBe(true);
  });

  it('truyền tx → chạy trong tx của caller, không mở $transaction mới', async () => {
    const { prisma, raw } = makePrisma();
    const tx = makePrisma().raw;
    await new RewardPointsService(prisma, cfg()).grant('u1', 1, 'X', 'COMMUNITY', 'p', tx as never);
    expect(raw.$transaction).not.toHaveBeenCalled();
    expect(tx.pointsTransaction.createManyAndReturn).toHaveBeenCalled();
  });
});

describe('RewardPointsService.grantReferralOrderReward (Q-05 + PD-3: thưởng người mời bằng Điểm Xanh)', () => {
  const DAY = 864e5;
  const twoOrders = (gapDays: number) => [
    { id: 'o1', createdAt: new Date(Date.now() - (gapDays + 1) * DAY) },
    { id: 'o2', createdAt: new Date(Date.now() - DAY) },
  ];

  it('referee không có người giới thiệu → không thưởng', async () => {
    const { prisma, createManyAndReturn } = makePrisma({ referredById: null, orders: twoOrders(5) });
    expect(await new RewardPointsService(prisma, cfg()).grantReferralOrderReward('referee1')).toBe(false);
    expect(createManyAndReturn).not.toHaveBeenCalled();
  });

  it('referredById trỏ chính mình → bỏ qua', async () => {
    const { prisma, createManyAndReturn } = makePrisma({ referredById: 'referee1', orders: twoOrders(5) });
    expect(await new RewardPointsService(prisma, cfg()).grantReferralOrderReward('referee1')).toBe(false);
    expect(createManyAndReturn).not.toHaveBeenCalled();
  });

  it('người mời là CTV → không thưởng (CTV chỉ hưởng hoa hồng)', async () => {
    const { prisma, createManyAndReturn } = makePrisma({ referredById: 'referrer1', referrerRole: 'AFFILIATE', orders: twoOrders(5) });
    expect(await new RewardPointsService(prisma, cfg()).grantReferralOrderReward('referee1')).toBe(false);
    expect(createManyAndReturn).not.toHaveBeenCalled();
  });

  it('mới 1 đơn giao xong → chưa thưởng', async () => {
    const { prisma, createManyAndReturn } = makePrisma({ referredById: 'referrer1', orders: twoOrders(5).slice(0, 1) });
    expect(await new RewardPointsService(prisma, cfg()).grantReferralOrderReward('referee1')).toBe(false);
    expect(createManyAndReturn).not.toHaveBeenCalled();
  });

  it('đơn thứ 2 cách đơn đầu > 30 ngày → không thưởng', async () => {
    const { prisma, createManyAndReturn } = makePrisma({ referredById: 'referrer1', orders: twoOrders(31) });
    expect(await new RewardPointsService(prisma, cfg()).grantReferralOrderReward('referee1')).toBe(false);
    expect(createManyAndReturn).not.toHaveBeenCalled();
  });

  it('đã thưởng bằng XU trước gộp (sổ coin) → không thưởng lại bằng điểm', async () => {
    const { prisma, createManyAndReturn } = makePrisma({ referredById: 'referrer1', orders: twoOrders(5), coinFindFirst: { id: 'c' } });
    expect(await new RewardPointsService(prisma, cfg()).grantReferralOrderReward('referee1')).toBe(false);
    expect(createManyAndReturn).not.toHaveBeenCalled();
  });

  it('đã thưởng bằng điểm (sổ points) → không thưởng lại', async () => {
    const { prisma, createManyAndReturn } = makePrisma({ referredById: 'referrer1', orders: twoOrders(5), pointsFindFirst: { id: 'p' } });
    expect(await new RewardPointsService(prisma, cfg()).grantReferralOrderReward('referee1')).toBe(false);
    expect(createManyAndReturn).not.toHaveBeenCalled();
  });

  it('đơn thứ 2 trong 30 ngày → người mời +5 Điểm Xanh lô STANDARD (mặc định referral.referrer_reward_points)', async () => {
    const { prisma, createManyAndReturn, userUpdate } = makePrisma({ referredById: 'referrer1', orders: twoOrders(10) });
    expect(await new RewardPointsService(prisma, cfg()).grantReferralOrderReward('referee1')).toBe(true);
    expect(createManyAndReturn.mock.calls[0][0].data[0]).toMatchObject({
      userId: 'referrer1',
      delta: 5,
      lot: 'STANDARD',
      reason: 'REFERRAL_ORDER2:referee1',
      refType: 'REFERRAL',
      refId: 'o1:o2',
    });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'referrer1' }, data: { pointsBalance: { increment: 5 } } });
  });

  it('không đọc khoá xu cũ coins.referrer_reward (khoá chết) dù DB còn 5000', async () => {
    const config = cfg({ 'coins.referrer_reward': 5000 });
    const { prisma, createManyAndReturn } = makePrisma({ referredById: 'referrer1', orders: twoOrders(10) });
    await new RewardPointsService(prisma, config).grantReferralOrderReward('referee1');
    expect(createManyAndReturn.mock.calls[0][0].data[0].delta).toBe(5);
    expect((config.get as jest.Mock).mock.calls.map((c) => c[0])).not.toContain('coins.referrer_reward');
  });

  it('khoá thưởng còn giá trị xu (5000) → lỗi 500, không cấp', async () => {
    const { prisma, createManyAndReturn } = makePrisma({ referredById: 'referrer1', orders: twoOrders(10) });
    await expect(
      new RewardPointsService(prisma, cfg({ 'referral.referrer_reward_points': 5000 })).grantReferralOrderReward('referee1'),
    ).rejects.toThrow(InternalServerErrorException);
    expect(createManyAndReturn).not.toHaveBeenCalled();
  });

  it('thua race (ON CONFLICT không ghi) → false, không cộng số dư', async () => {
    const { prisma, userUpdate } = makePrisma({ referredById: 'referrer1', orders: twoOrders(10), inserted: 0 });
    expect(await new RewardPointsService(prisma, cfg()).grantReferralOrderReward('referee1')).toBe(false);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  describe('mốc thưởng thêm (referral.milestones_points)', () => {
    const milestones = [
      { count: 3, bonusPoints: 20 },
      { count: 5, bonusPoints: 40 },
    ];
    const reasonsOf = (m: jest.Mock) => m.mock.calls.map((c) => c[0].data[0].reason as string);

    it('3 thưởng còn hiệu lực gộp HAI sổ (1 xu kiểu cũ + 1 xu + 1 điểm) → thưởng mốc 3 bằng 20 điểm', async () => {
      const { prisma, createManyAndReturn } = makePrisma({
        referredById: 'referrer1',
        orders: twoOrders(10),
        coinCount: countByPrefix({ 'REFERRAL_CASHBACK:': 1, 'REFERRAL_ORDER2:': 1 }),
        pointsCount: countByPrefix({ 'REFERRAL_ORDER2:': 1 }),
      });
      await new RewardPointsService(prisma, cfg({ 'referral.milestones_points': milestones })).grantReferralOrderReward('referee1');
      const call = createManyAndReturn.mock.calls.find((c) => c[0].data[0].reason === 'REFERRAL_MILESTONE:referrer1:3');
      expect(call?.[0].data[0]).toMatchObject({ delta: 20, lot: 'STANDARD', refType: 'REFERRAL' });
      expect(reasonsOf(createManyAndReturn)).not.toContain('REFERRAL_MILESTONE:referrer1:5');
    });

    it('lượt đã thu hồi (ở sổ nào cũng vậy) không được tính vào mốc', async () => {
      const { prisma, createManyAndReturn } = makePrisma({
        referredById: 'referrer1',
        orders: twoOrders(10),
        coinCount: countByPrefix({ 'REFERRAL_ORDER2:': 2 }),
        pointsCount: countByPrefix({ 'REFERRAL_ORDER2:': 1, 'REFERRAL_ORDER2_REVOKE:': 1 }),
      });
      await new RewardPointsService(prisma, cfg({ 'referral.milestones_points': milestones })).grantReferralOrderReward('referee1');
      expect(reasonsOf(createManyAndReturn).some((r) => r.startsWith('REFERRAL_MILESTONE:'))).toBe(false);
    });

    it('mốc đã cấp bằng XU trước gộp còn giữ → không cấp lại bằng điểm', async () => {
      const { prisma, createManyAndReturn } = makePrisma({
        referredById: 'referrer1',
        orders: twoOrders(10),
        pointsCount: countByPrefix({ 'REFERRAL_ORDER2:': 3 }),
        coinMilestoneRows: [{ reason: 'REFERRAL_MILESTONE:referrer1:3', delta: 20000 }],
      });
      await new RewardPointsService(prisma, cfg({ 'referral.milestones_points': milestones })).grantReferralOrderReward('referee1');
      expect(reasonsOf(createManyAndReturn).some((r) => r.startsWith('REFERRAL_MILESTONE:'))).toBe(false);
    });

    it('mốc xu đã thu hồi (sổ coin), đạt lại sau gộp → cấp đời mới #1 bằng điểm', async () => {
      const { prisma, createManyAndReturn } = makePrisma({
        referredById: 'referrer1',
        orders: twoOrders(10),
        coinCount: countByPrefix({ 'REFERRAL_ORDER2:': 3, 'REFERRAL_ORDER2_REVOKE:': 1 }),
        pointsCount: countByPrefix({ 'REFERRAL_ORDER2:': 1 }),
        coinMilestoneRows: [
          { reason: 'REFERRAL_MILESTONE:referrer1:3', delta: 20000 },
          { reason: 'REFERRAL_MILESTONE_REVOKE:referrer1:3#0', delta: -20000 },
        ],
      });
      await new RewardPointsService(prisma, cfg({ 'referral.milestones_points': milestones })).grantReferralOrderReward('referee1');
      expect(reasonsOf(createManyAndReturn)).toContain('REFERRAL_MILESTONE:referrer1:3#1');
      expect(reasonsOf(createManyAndReturn)).not.toContain('REFERRAL_MILESTONE:referrer1:3');
    });

    it('mốc dạng cũ {count, bonus: 20000} (đọc nhầm khoá xu) → không cấp gì', async () => {
      const { prisma, createManyAndReturn } = makePrisma({
        referredById: 'referrer1',
        orders: twoOrders(10),
        pointsCount: countByPrefix({ 'REFERRAL_ORDER2:': 3 }),
      });
      const legacyShape = [{ count: 3, bonus: 20000 }];
      await new RewardPointsService(prisma, cfg({ 'referral.milestones_points': legacyShape })).grantReferralOrderReward('referee1');
      expect(reasonsOf(createManyAndReturn).some((r) => r.startsWith('REFERRAL_MILESTONE:'))).toBe(false);
    });
  });
});

describe('RewardPointsService.getReferralOverview (GET /me/referral)', () => {
  const milestones = [
    { count: 10, bonusPoints: 100 },
    { count: 3, bonusPoints: 20 },
    { count: 5, bonusPoints: 40 },
  ];

  function overview(successCount: number, sums: { points?: number | null; coins?: number | null } = {}) {
    const { prisma, raw } = makePrisma({ pointsCount: countByPrefix({ 'REFERRAL_ORDER2:': successCount }) });
    raw.pointsTransaction.aggregate.mockResolvedValue({ _sum: { delta: sums.points ?? null } });
    raw.coinTransaction.aggregate.mockResolvedValue({ _sum: { delta: sums.coins ?? null } });
    return prisma;
  }

  it('mốc sắp theo count, nextMilestone là mốc đầu chưa đạt', async () => {
    const r = await new RewardPointsService(overview(3), cfg({ 'referral.milestones_points': milestones })).getReferralOverview('u1');
    expect(r.milestones).toEqual([
      { count: 3, bonusPoints: 20 },
      { count: 5, bonusPoints: 40 },
      { count: 10, bonusPoints: 100 },
    ]);
    expect(r.nextMilestone).toEqual({ count: 5, bonusPoints: 40 });
    expect(r.successCount).toBe(3);
    expect(r.referralCode).toBe('ABC123');
  });

  it('earnedPoints = điểm giới thiệu + ceil(xu giới thiệu cũ / 1000)', async () => {
    const r = await new RewardPointsService(overview(1, { points: 25, coins: 5001 }), cfg()).getReferralOverview('u1');
    expect(r.earnedPoints).toBe(31);
  });

  it('không cấu hình mốc → mảng rỗng, nextMilestone null, chưa có thưởng → 0', async () => {
    const r = await new RewardPointsService(overview(0), cfg()).getReferralOverview('u1');
    expect(r).toMatchObject({ milestones: [], nextMilestone: null, earnedPoints: 0 });
  });
});
