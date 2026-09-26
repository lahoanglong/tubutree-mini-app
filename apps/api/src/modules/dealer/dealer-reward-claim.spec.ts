import 'reflect-metadata';
import { BadRequestException, NotFoundException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DealerService } from './dealer.service';
import { ClaimRewardDto, DealerController } from './dealer.controller';
import { DealerAdminController, ListRewardClaimsQuery, RejectRewardClaimDto } from './dealer-admin.controller';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

/**
 * Yêu cầu nhận thưởng mốc đại lý (DealerRewardClaim) + doanh số "đã chốt" dùng chung cho
 * thưởng quý / mốc thưởng. Bản WIP trước đây: claimReward chỉ ghi 1 dòng log rồi báo "đã ghi
 * nhận" (không lưu gì, không ai được báo, bấm lại vô hạn), doanh số tính cả đơn chưa thanh toán
 * mà đại lý tự huỷ được, và hết quý là mất quyền yêu cầu.
 */

function makeConfig(values: Record<string, unknown> = {}): SystemConfigService {
  return {
    get: async <T>(key: string, fb?: T): Promise<T> => (key in values ? values[key] : fb) as T,
  } as unknown as SystemConfigService;
}

type FakeOrder = {
  id: string;
  total: number;
  status: string;
  paymentStatus: string;
  createdAt: Date;
  userId?: string;
};

interface OrderWhere {
  userId?: string;
  type?: string;
  status?: { notIn?: string[]; in?: string[] };
  createdAt?: { gte: Date; lt: Date };
}

/** Fake order.findMany lọc đúng theo where (userId/type/status/createdAt) — test sát hành vi DB. */
function fakeOrderFindMany(rows: FakeOrder[]) {
  return jest.fn(async ({ where }: { where: OrderWhere }) =>
    rows.filter(
      (o) =>
        (!where.userId || (o.userId ?? 'd1') === where.userId) &&
        (!where.createdAt || (o.createdAt >= where.createdAt.gte && o.createdAt < where.createdAt.lt)) &&
        (!where.status?.notIn || !where.status.notIn.includes(o.status)) &&
        (!where.status?.in || where.status.in.includes(o.status)),
    ),
  );
}

/** Fake dealerCreditLedger.findMany: trả dòng ORDER (ghi công nợ) cho các đơn nằm trong `creditOrderIds`. */
function fakeLedgerFindMany(creditOrderIds: string[]) {
  return jest.fn(async ({ where }: { where: { refType?: string; refId?: { in?: string[] } } }) =>
    where.refType === 'ORDER'
      ? (where.refId?.in ?? []).filter((id) => creditOrderIds.includes(id)).map((refId) => ({ refId }))
      : [],
  );
}

type FakeClaim = {
  id: string;
  userId: string;
  rewardId: string | null;
  periodKey: string;
  rewardTitle: string;
  rewardType: string;
  rewardPeriod: string;
  threshold: number;
  volumeAtClaim: number;
  note: string | null;
  status: string;
  rejectionReason: string | null;
  createdAt: Date;
};

function p2002() {
  const { Prisma } = jest.requireActual('@prisma/client');
  return new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
}

/** Fake bảng dealer_reward_claims có unique (userId, periodKey, rewardId) như DB thật. */
function fakeClaims(initial: Partial<FakeClaim>[] = []) {
  const rows: FakeClaim[] = initial.map((c, i) => ({
    id: `c${i + 1}`,
    userId: 'd1',
    rewardId: 'r1',
    periodKey: 'Q3/2026',
    rewardTitle: 'Tour Đà Lạt',
    rewardType: 'TOUR',
    rewardPeriod: 'QUARTER',
    threshold: 50_000_000,
    volumeAtClaim: 60_000_000,
    note: null,
    status: 'PENDING',
    rejectionReason: null,
    createdAt: new Date('2026-08-20T00:00:00Z'),
    ...c,
  }));
  const match = (c: FakeClaim, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in (v as object)) return ((v as { in: unknown[] }).in).includes(c[k as keyof FakeClaim]);
      return c[k as keyof FakeClaim] === v;
    });
  return {
    rows,
    findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((c) => match(c, where ?? {}))),
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((c) => match(c, where)) ?? null),
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => rows.find((c) => c.id === where.id) ?? null),
    findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
      const r = rows.find((c) => c.id === where.id);
      if (!r) throw new Error('not found');
      return r;
    }),
    count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((c) => match(c, where ?? {})).length),
    create: jest.fn(async ({ data }: { data: Partial<FakeClaim> }) => {
      if (rows.some((c) => c.userId === data.userId && c.periodKey === data.periodKey && c.rewardId === data.rewardId)) {
        throw p2002();
      }
      const row = {
        id: `c${rows.length + 1}`,
        status: 'PENDING',
        rejectionReason: null,
        note: null,
        createdAt: new Date(),
        ...data,
      } as FakeClaim;
      rows.push(row);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<FakeClaim> }) => {
      const hit = rows.filter((c) => match(c, where));
      hit.forEach((c) => Object.assign(c, data));
      return { count: hit.length };
    }),
  };
}

type RewardFixture = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  threshold: number;
  period: string;
  isActive: boolean;
  sortOrder: number;
  updatedAt?: Date;
};
const REWARD_Q: RewardFixture = { id: 'r1', type: 'TOUR', title: 'Tour Đà Lạt', description: null, threshold: 50_000_000, period: 'QUARTER', isActive: true, sortOrder: 0 };
const REWARD_Y: RewardFixture = { id: 'r2', type: 'GIFT', title: 'Quà năm', description: null, threshold: 100_000_000, period: 'YEAR', isActive: true, sortOrder: 1 };

type RewardWhere = { OR?: RewardWhere[]; isActive?: boolean; updatedAt?: { gte?: Date } };
/** Lọc dealerReward.findMany theo where như DB (isActive / updatedAt.gte / OR). */
function matchReward(r: RewardFixture, w: RewardWhere): boolean {
  if (w.OR) return w.OR.some((x) => matchReward(r, x));
  if (w.isActive !== undefined && r.isActive !== w.isActive) return false;
  if (w.updatedAt?.gte && !(r.updatedAt && r.updatedAt >= w.updatedAt.gte)) return false;
  return true;
}

// Mốc thời gian (UTC) — kỳ tính theo giờ VN (UTC+7).
const NOW_Q3 = new Date('2026-08-15T00:00:00Z'); // giữa Q3/2026
const IN_GRACE = new Date('2026-10-05T00:00:00Z'); // Q4/2026, Q3 vừa hết 5 ngày (< 30 ngày gia hạn)
const PAST_GRACE = new Date('2026-11-15T00:00:00Z'); // Q4/2026, Q3 đã hết > 30 ngày
const IN_Q3 = new Date('2026-08-01T03:00:00Z');

function buildPrisma(opts: {
  orders?: FakeOrder[];
  creditOrderIds?: string[];
  rewards?: (typeof REWARD_Q)[];
  claims?: ReturnType<typeof fakeClaims>;
  role?: string;
  admins?: { id: string }[];
}) {
  const claims = opts.claims ?? fakeClaims();
  const rewards = opts.rewards ?? [REWARD_Q];
  const prisma: Record<string, unknown> = {
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'd1', role: opts.role ?? 'DEALER', metadata: null }),
      findUnique: jest.fn().mockResolvedValue({ id: 'd1', fullName: 'Đại lý A', phone: '0900000001' }),
      findMany: jest.fn(async ({ where }: { where: { role?: string; id?: { in: string[] } } }) =>
        where.role === 'ADMIN'
          ? (opts.admins ?? [{ id: 'admin1' }])
          : (where.id?.in ?? []).map((id) => ({ id, fullName: `Tên ${id}`, phone: '0900000001' })),
      ),
    },
    dealerTier: { findUnique: jest.fn().mockResolvedValue(null) },
    dealerReward: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => rewards.find((r) => r.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: { where?: RewardWhere }) => rewards.filter((r) => matchReward(r, where ?? {}))),
    },
    order: { findMany: fakeOrderFindMany(opts.orders ?? []) },
    dealerCreditLedger: {
      findMany: fakeLedgerFindMany(opts.creditOrderIds ?? []),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    dealerApplication: { findMany: jest.fn().mockResolvedValue([{ userId: 'd1', businessName: 'Cty Đại lý A' }]) },
    dealerRewardClaim: claims,
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  prisma.$transaction = jest.fn(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg as Promise<unknown>[]) : (arg as (tx: unknown) => unknown)(prisma),
  );
  return { prisma: prisma as unknown as PrismaService, claims };
}

const settled = (id: string, total: number, extra: Partial<FakeOrder> = {}): FakeOrder => ({
  id,
  total,
  status: 'DELIVERED',
  paymentStatus: 'PAID',
  createdAt: IN_Q3,
  ...extra,
});

describe('Doanh số đại lý "đã chốt" (nền thưởng quý + mốc thưởng)', () => {
  // o1 đã thanh toán + đã giao, o2 ghi công nợ + đang giao → TÍNH.
  // o3 chưa thanh toán (PENDING_PAYMENT), o4 đã trả nhưng còn CONFIRMED (đại lý vẫn tự huỷ được
  // và được hoàn tiền về ví), o5 trả trước nhưng chưa thanh toán dù đã đóng gói → CHƯA tính.
  // o6 đã huỷ → loại hẳn.
  const MIXED: FakeOrder[] = [
    settled('o1', 30_000_000),
    settled('o2', 20_000_000, { status: 'SHIPPING', paymentStatus: 'UNPAID' }),
    settled('o3', 200_000_000, { status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' }),
    settled('o4', 10_000_000, { status: 'CONFIRMED', paymentStatus: 'PAID' }),
    settled('o5', 5_000_000, { status: 'PACKED', paymentStatus: 'UNPAID' }),
    settled('o6', 100_000_000, { status: 'CANCELLED', paymentStatus: 'UNPAID' }),
  ];

  it('quarterlyReport chỉ tính đơn đã thanh toán/ghi công nợ VÀ không còn tự huỷ được; phần còn lại báo là "chờ"', async () => {
    const { prisma } = buildPrisma({ orders: MIXED, creditOrderIds: ['o2'] });
    const r = await new DealerService(prisma, makeConfig()).quarterlyReport('d1', NOW_Q3);
    expect(r.revenue).toBe(50_000_000);
    expect(r.orderCount).toBe(2);
    expect(r.pendingRevenue).toBe(215_000_000);
    expect(r.pendingOrderCount).toBe(3);
    expect(r.bonusPct).toBe(2); // 50tr → 2%, KHÔNG phải 4% như khi cộng cả 200tr chưa trả
    const where = (prisma.order.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 'd1', type: 'DEALER', status: { notIn: ['CANCELLED', 'RETURNED'] } });
  });

  it('payoutQuarterlyBonuses: đơn 200tr chưa thanh toán (đại lý tự huỷ được) KHÔNG sinh thưởng quý', async () => {
    const { prisma } = buildPrisma({
      orders: [settled('big', 200_000_000, { status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', createdAt: new Date('2026-03-30T10:00:00Z') })],
    });
    (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'd1' }]);
    const r = await new DealerService(prisma, makeConfig()).payoutQuarterlyBonuses(new Date('2026-04-15T00:00:00Z'));
    expect(r.paid).toBe(0);
    expect(prisma.dealerCreditLedger.create).not.toHaveBeenCalled();
  });

  it('payoutQuarterlyBonuses: đơn đã chốt vẫn được thưởng đúng bậc', async () => {
    const { prisma } = buildPrisma({
      orders: [settled('ok', 120_000_000, { createdAt: new Date('2026-03-30T10:00:00Z') })],
    });
    (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'd1' }]);
    const r = await new DealerService(prisma, makeConfig()).payoutQuarterlyBonuses(new Date('2026-04-15T00:00:00Z'));
    expect(r).toEqual({ paid: 1, quarter: 'Q1/2026' });
    const led = (prisma.dealerCreditLedger.create as jest.Mock).mock.calls[0][0].data;
    expect(led).toMatchObject({ userId: 'd1', delta: -3_600_000, refType: 'QUARTER_BONUS', refId: 'Q1/2026' });
  });
});

describe('DealerService.claimReward (lưu yêu cầu thật, idempotent)', () => {
  it('reward không tồn tại / đã ngừng → NotFoundException', async () => {
    const { prisma } = buildPrisma({ rewards: [{ ...REWARD_Q, isActive: false }] });
    const svc = new DealerService(prisma, makeConfig());
    await expect(svc.claimReward('d1', 'r-none', {}, NOW_Q3)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.claimReward('d1', 'r1', {}, NOW_Q3)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('không phải đại lý → chặn, không tạo claim', async () => {
    const { prisma, claims } = buildPrisma({ role: 'CUSTOMER' });
    await expect(new DealerService(prisma, makeConfig()).claimReward('d1', 'r1', {}, NOW_Q3)).rejects.toThrow();
    expect(claims.create).not.toHaveBeenCalled();
  });

  it('doanh số ĐÃ CHỐT dưới mốc (dù cộng cả đơn chưa trả thì vượt) → BadRequestException, không tạo claim', async () => {
    const { prisma, claims } = buildPrisma({
      orders: [
        settled('o1', 20_000_000),
        settled('o2', 200_000_000, { status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' }),
      ],
    });
    await expect(new DealerService(prisma, makeConfig()).claimReward('d1', 'r1', {}, NOW_Q3)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(claims.create).not.toHaveBeenCalled();
  });

  it('đạt mốc → tạo DealerRewardClaim PENDING (kỳ hiện tại), trả claimStatus, báo admin', async () => {
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const { prisma, claims } = buildPrisma({ orders: [settled('o1', 60_000_000)], admins: [{ id: 'a1' }, { id: 'a2' }] });
    const res = await new DealerService(prisma, makeConfig(), notifications as never).claimReward(
      'd1',
      'r1',
      { note: '  Muốn nhận quà tương đương  ' },
      NOW_Q3,
    );
    expect(claims.create).toHaveBeenCalledTimes(1);
    expect(claims.create.mock.calls[0]![0].data).toMatchObject({
      userId: 'd1',
      rewardId: 'r1',
      periodKey: 'Q3/2026',
      rewardTitle: 'Tour Đà Lạt',
      rewardType: 'TOUR',
      rewardPeriod: 'QUARTER',
      threshold: 50_000_000,
      volumeAtClaim: 60_000_000,
      note: 'Muốn nhận quà tương đương',
    });
    expect(res.success).toBe(true);
    expect(res.alreadyClaimed).toBe(false);
    expect(res.claimStatus).toBe('PENDING');
    expect(res.periodKey).toBe('Q3/2026');
    expect(res.reward.id).toBe('r1');
    expect(res.currentVolume).toBe(60_000_000);
    // Không hứa SLA mà backend không đảm bảo.
    expect(res.message).not.toMatch(/24h/);
    expect(notifications.notify).toHaveBeenCalledWith('a1', 'DEALER_REWARD_CLAIM_NEW', expect.objectContaining({ reward: 'Tour Đà Lạt', period: 'Quý 3/2026' }));
    expect(notifications.notify).toHaveBeenCalledWith('a2', 'DEALER_REWARD_CLAIM_NEW', expect.anything());
  });

  it('bấm lại cùng kỳ → trả claim cũ (alreadyClaimed), KHÔNG tạo thêm, KHÔNG báo admin lần 2', async () => {
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const claims = fakeClaims([{ status: 'APPROVED' }]);
    const { prisma } = buildPrisma({ orders: [settled('o1', 60_000_000)], claims });
    const res = await new DealerService(prisma, makeConfig(), notifications as never).claimReward('d1', 'r1', {}, NOW_Q3);
    expect(res.alreadyClaimed).toBe(true);
    expect(res.claimStatus).toBe('APPROVED');
    expect(claims.create).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(claims.rows).toHaveLength(1);
  });

  it('race 2 request đồng thời (create ăn P2002) → trả claim thắng race, không throw, không báo admin', async () => {
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const claims = fakeClaims();
    const winner = { id: 'cw', userId: 'd1', rewardId: 'r1', periodKey: 'Q3/2026', status: 'PENDING', rewardTitle: 'Tour Đà Lạt', rewardType: 'TOUR', threshold: 50_000_000, volumeAtClaim: 60_000_000 };
    claims.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(winner as never);
    claims.create.mockRejectedValueOnce(p2002());
    const { prisma } = buildPrisma({ orders: [settled('o1', 60_000_000)], claims });
    const res = await new DealerService(prisma, makeConfig(), notifications as never).claimReward('d1', 'r1', {}, NOW_Q3);
    expect(res.alreadyClaimed).toBe(true);
    expect(res.claim.id).toBe('cw');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('kỳ vừa kết thúc, còn trong thời gian gia hạn (mặc định 30 ngày) → vẫn yêu cầu được cho kỳ đó', async () => {
    const { prisma, claims } = buildPrisma({ orders: [settled('o1', 60_000_000)] });
    const res = await new DealerService(prisma, makeConfig()).claimReward('d1', 'r1', { periodKey: 'Q3/2026' }, IN_GRACE);
    expect(res.claimStatus).toBe('PENDING');
    expect(claims.create.mock.calls[0]![0].data).toMatchObject({ periodKey: 'Q3/2026', volumeAtClaim: 60_000_000 });
    // Doanh số tính theo ĐÚNG khung Q3 (theo giờ VN), không theo quý hiện tại.
    const where = (prisma.order.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.createdAt).toEqual({ gte: new Date('2026-06-30T17:00:00Z'), lt: new Date('2026-09-30T17:00:00Z') });
  });

  it('quá hạn gia hạn → BadRequestException', async () => {
    const { prisma, claims } = buildPrisma({ orders: [settled('o1', 60_000_000)] });
    await expect(
      new DealerService(prisma, makeConfig()).claimReward('d1', 'r1', { periodKey: 'Q3/2026' }, PAST_GRACE),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(claims.create).not.toHaveBeenCalled();
  });

  it('số ngày gia hạn đọc từ system-config dealer.reward_claim_grace_days', async () => {
    const { prisma } = buildPrisma({ orders: [settled('o1', 60_000_000)] });
    // Gia hạn 60 ngày → 15/11 vẫn trong hạn cho Q3.
    const res = await new DealerService(prisma, makeConfig({ 'dealer.reward_claim_grace_days': 60 })).claimReward(
      'd1',
      'r1',
      { periodKey: 'Q3/2026' },
      PAST_GRACE,
    );
    expect(res.claimStatus).toBe('PENDING');
  });

  it('periodKey sai định dạng so với loại kỳ / kỳ chưa bắt đầu → BadRequestException', async () => {
    const { prisma } = buildPrisma({ rewards: [REWARD_Q, REWARD_Y], orders: [settled('o1', 200_000_000)] });
    const svc = new DealerService(prisma, makeConfig());
    await expect(svc.claimReward('d1', 'r2', { periodKey: 'Q3/2026' }, NOW_Q3)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.claimReward('d1', 'r1', { periodKey: '2026' }, NOW_Q3)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.claimReward('d1', 'r1', { periodKey: 'Q4/2026' }, NOW_Q3)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('claim đã có mà gửi lại sau hạn → vẫn trả claim cũ (idempotent), không báo lỗi hết hạn', async () => {
    const claims = fakeClaims([{ status: 'PENDING' }]);
    const { prisma } = buildPrisma({ claims });
    const res = await new DealerService(prisma, makeConfig()).claimReward('d1', 'r1', { periodKey: 'Q3/2026' }, PAST_GRACE);
    expect(res.alreadyClaimed).toBe(true);
  });

  // Admin tắt chương trình ĐẦU quý mới (sau khi quý cũ đã kết thúc) — đại lý đã đạt mốc quý cũ vẫn
  // phải yêu cầu được trong thời gian gia hạn; trước đây mọi claim của reward inactive đều 404.
  it('reward bị TẮT SAU khi kỳ kết thúc, còn trong gia hạn → vẫn yêu cầu được cho kỳ đó (mốc = threshold hiện tại)', async () => {
    const off = { ...REWARD_Q, isActive: false, updatedAt: new Date('2026-10-02T03:00:00Z') };
    const { prisma, claims } = buildPrisma({ rewards: [off], orders: [settled('o1', 60_000_000)] });
    const res = await new DealerService(prisma, makeConfig()).claimReward('d1', 'r1', { periodKey: 'Q3/2026' }, IN_GRACE);
    expect(res.claimStatus).toBe('PENDING');
    expect(claims.create.mock.calls[0]![0].data).toMatchObject({ periodKey: 'Q3/2026', threshold: 50_000_000 });
  });

  it('reward bị tắt SAU kỳ nhưng doanh số kỳ đó chưa đạt mốc → BadRequest như bình thường', async () => {
    const off = { ...REWARD_Q, isActive: false, updatedAt: new Date('2026-10-02T03:00:00Z') };
    const { prisma, claims } = buildPrisma({ rewards: [off], orders: [settled('o1', 20_000_000)] });
    await expect(
      new DealerService(prisma, makeConfig()).claimReward('d1', 'r1', { periodKey: 'Q3/2026' }, IN_GRACE),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(claims.create).not.toHaveBeenCalled();
  });

  it('reward bị tắt TRONG kỳ (trước khi kỳ kết thúc) → không yêu cầu được (NotFound)', async () => {
    const off = { ...REWARD_Q, isActive: false, updatedAt: new Date('2026-09-10T03:00:00Z') };
    const { prisma, claims } = buildPrisma({ rewards: [off], orders: [settled('o1', 60_000_000)] });
    await expect(
      new DealerService(prisma, makeConfig()).claimReward('d1', 'r1', { periodKey: 'Q3/2026' }, IN_GRACE),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(claims.create).not.toHaveBeenCalled();
  });

  it('reward bị tắt → kỳ HIỆN TẠI không yêu cầu được, kể cả truyền periodKey', async () => {
    const off = { ...REWARD_Q, isActive: false, updatedAt: new Date('2026-10-02T03:00:00Z') };
    const { prisma } = buildPrisma({ rewards: [off], orders: [settled('o1', 60_000_000, { createdAt: new Date('2026-10-03T03:00:00Z') })] });
    await expect(
      new DealerService(prisma, makeConfig()).claimReward('d1', 'r1', { periodKey: 'Q4/2026' }, IN_GRACE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reward bị tắt sau kỳ nhưng đã QUÁ hạn gia hạn → BadRequest hết hạn', async () => {
    const off = { ...REWARD_Q, isActive: false, updatedAt: new Date('2026-10-02T03:00:00Z') };
    const { prisma } = buildPrisma({ rewards: [off], orders: [settled('o1', 60_000_000)] });
    await expect(
      new DealerService(prisma, makeConfig()).claimReward('d1', 'r1', { periodKey: 'Q3/2026' }, PAST_GRACE),
    ).rejects.toThrow(/hết hạn/);
  });

  it('lỗi gửi thông báo admin KHÔNG làm hỏng claim đã lưu', async () => {
    const notifications = { notify: jest.fn().mockRejectedValue(new Error('zns down')) };
    const { prisma, claims } = buildPrisma({ orders: [settled('o1', 60_000_000)] });
    const res = await new DealerService(prisma, makeConfig(), notifications as never).claimReward('d1', 'r1', {}, NOW_Q3);
    expect(res.claimStatus).toBe('PENDING');
    expect(claims.rows).toHaveLength(1);
  });
});

describe('DealerService.rewardsProgress (claimStatus + kỳ trước trong thời gian gia hạn)', () => {
  it('trả claimStatus theo claim của kỳ hiện tại; đã yêu cầu → canClaim=false', async () => {
    const claims = fakeClaims([{ rewardId: 'r1', periodKey: 'Q3/2026', status: 'PENDING' }]);
    const { prisma } = buildPrisma({ rewards: [REWARD_Q, REWARD_Y], orders: [settled('o1', 120_000_000)], claims });
    const out = await new DealerService(prisma, makeConfig()).rewardsProgress('d1', NOW_Q3);
    const q = out.rewards.find((r) => r.id === 'r1' && r.isCurrentPeriod)!;
    const y = out.rewards.find((r) => r.id === 'r2' && r.isCurrentPeriod)!;
    expect(q).toMatchObject({ periodKey: 'Q3/2026', achieved: true, claimStatus: 'PENDING', canClaim: false });
    expect(y).toMatchObject({ periodKey: '2026', achieved: true, claimStatus: null, canClaim: true });
    expect(out.claimGraceDays).toBe(30);
  });

  it('volume/achieved chỉ theo doanh số đã chốt; pendingVolume hiển thị phần chưa chốt', async () => {
    const { prisma } = buildPrisma({
      orders: [settled('o1', 30_000_000), settled('o2', 40_000_000, { status: 'CONFIRMED', paymentStatus: 'UNPAID' })],
    });
    const out = await new DealerService(prisma, makeConfig()).rewardsProgress('d1', NOW_Q3);
    const q = out.rewards.find((r) => r.id === 'r1')!;
    expect(q).toMatchObject({ volume: 30_000_000, pendingVolume: 40_000_000, achieved: false, toGo: 20_000_000, canClaim: false });
    expect(out.quarterVolume).toBe(30_000_000);
    expect(out.quarterPendingVolume).toBe(40_000_000);
  });

  it('đầu quý mới, trong hạn gia hạn: hiện dòng kỳ trước đã đạt để đại lý còn yêu cầu được', async () => {
    const { prisma } = buildPrisma({ orders: [settled('o1', 60_000_000)] });
    const out = await new DealerService(prisma, makeConfig()).rewardsProgress('d1', IN_GRACE);
    const prev = out.rewards.find((r) => r.id === 'r1' && !r.isCurrentPeriod);
    const cur = out.rewards.find((r) => r.id === 'r1' && r.isCurrentPeriod)!;
    expect(cur).toMatchObject({ periodKey: 'Q4/2026', achieved: false });
    expect(prev).toMatchObject({ periodKey: 'Q3/2026', periodLabel: 'Quý 3/2026', achieved: true, canClaim: true });
    expect(prev!.claimDeadline).toBe(new Date('2026-10-30T17:00:00Z').toISOString());
  });

  it('quá hạn gia hạn: không hiện dòng kỳ trước chưa yêu cầu; nhưng claim đã gửi thì vẫn hiện trạng thái', async () => {
    const a = buildPrisma({ orders: [settled('o1', 60_000_000)] });
    const out1 = await new DealerService(a.prisma, makeConfig()).rewardsProgress('d1', PAST_GRACE);
    expect(out1.rewards.filter((r) => !r.isCurrentPeriod)).toHaveLength(0);

    const b = buildPrisma({
      orders: [settled('o1', 60_000_000)],
      claims: fakeClaims([{ periodKey: 'Q3/2026', status: 'REJECTED', rejectionReason: 'Đơn đã trả hàng' }]),
    });
    const out2 = await new DealerService(b.prisma, makeConfig()).rewardsProgress('d1', PAST_GRACE);
    const prev = out2.rewards.find((r) => !r.isCurrentPeriod)!;
    expect(prev).toMatchObject({ periodKey: 'Q3/2026', claimStatus: 'REJECTED', rejectionReason: 'Đơn đã trả hàng', canClaim: false });
  });

  it('reward bị TẮT sau khi kỳ trước kết thúc: vẫn hiện dòng kỳ trước đã đạt (canClaim), KHÔNG hiện ở kỳ hiện tại', async () => {
    const off = { ...REWARD_Q, isActive: false, updatedAt: new Date('2026-10-02T03:00:00Z') };
    const { prisma } = buildPrisma({ rewards: [off], orders: [settled('o1', 60_000_000)] });
    const out = await new DealerService(prisma, makeConfig()).rewardsProgress('d1', IN_GRACE);
    expect(out.rewards.filter((r) => r.isCurrentPeriod)).toHaveLength(0);
    const prev = out.rewards.find((r) => r.id === 'r1' && !r.isCurrentPeriod);
    expect(prev).toMatchObject({ periodKey: 'Q3/2026', achieved: true, canClaim: true });
    // Truy vấn lấy cả reward inactive nhưng CHỈ loại được cập nhật từ đầu kỳ liền trước sớm nhất trở đi.
    const where = (prisma.dealerReward.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where).toEqual({
      OR: [{ isActive: true }, { isActive: false, updatedAt: { gte: new Date('2025-12-31T17:00:00Z') } }],
    });
  });

  it('reward bị tắt TRONG kỳ trước: không hiện dòng "có thể yêu cầu"; claim đã gửi trước đó vẫn hiện trạng thái', async () => {
    const off = { ...REWARD_Q, isActive: false, updatedAt: new Date('2026-09-10T03:00:00Z') };
    const a = buildPrisma({ rewards: [off], orders: [settled('o1', 60_000_000)] });
    const out1 = await new DealerService(a.prisma, makeConfig()).rewardsProgress('d1', IN_GRACE);
    expect(out1.rewards).toHaveLength(0);

    const b = buildPrisma({
      rewards: [off],
      orders: [settled('o1', 60_000_000)],
      claims: fakeClaims([{ periodKey: 'Q3/2026', status: 'APPROVED' }]),
    });
    const out2 = await new DealerService(b.prisma, makeConfig()).rewardsProgress('d1', IN_GRACE);
    expect(out2.rewards).toEqual([expect.objectContaining({ periodKey: 'Q3/2026', claimStatus: 'APPROVED', canClaim: false })]);
  });
});

describe('Admin xử lý yêu cầu nhận thưởng (PENDING → APPROVED/REJECTED → PAID)', () => {
  it('duyệt: chuyển PENDING→APPROVED bằng updateMany có guard status, báo đại lý', async () => {
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const claims = fakeClaims([{ id: 'c1', status: 'PENDING' }]);
    const { prisma } = buildPrisma({ orders: [settled('o1', 60_000_000)], claims });
    const out = await new DealerService(prisma, makeConfig(), notifications as never).approveRewardClaim('admin1', 'c1', 'ok');
    expect(claims.updateMany.mock.calls[0]![0].where).toEqual({ id: 'c1', status: 'PENDING' });
    expect(out.status).toBe('APPROVED');
    expect(claims.rows[0]).toMatchObject({ status: 'APPROVED', reviewedBy: 'admin1' });
    expect(notifications.notify).toHaveBeenCalledWith('d1', 'DEALER_REWARD_CLAIM_APPROVED', expect.objectContaining({ reward: 'Tour Đà Lạt' }));
  });

  it('duyệt khi doanh số đã chốt giờ tụt dưới mốc (đơn bị huỷ/trả sau khi yêu cầu) → chặn, giữ PENDING', async () => {
    const claims = fakeClaims([{ id: 'c1', status: 'PENDING' }]);
    const { prisma } = buildPrisma({
      orders: [settled('o1', 60_000_000, { status: 'RETURNED' })],
      claims,
    });
    await expect(new DealerService(prisma, makeConfig()).approveRewardClaim('admin1', 'c1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(claims.rows[0]!.status).toBe('PENDING');
  });

  it('duyệt claim đã xử lý / không tồn tại → BadRequest / NotFound', async () => {
    const claims = fakeClaims([{ id: 'c1', status: 'REJECTED' }]);
    const { prisma } = buildPrisma({ orders: [settled('o1', 60_000_000)], claims });
    const svc = new DealerService(prisma, makeConfig());
    await expect(svc.approveRewardClaim('admin1', 'c1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.approveRewardClaim('admin1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('race 2 admin cùng duyệt: updateMany count=0 → BadRequest, không báo đại lý lần 2', async () => {
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const claims = fakeClaims([{ id: 'c1', status: 'PENDING' }]);
    claims.updateMany.mockResolvedValueOnce({ count: 0 });
    const { prisma } = buildPrisma({ orders: [settled('o1', 60_000_000)], claims });
    await expect(
      new DealerService(prisma, makeConfig(), notifications as never).approveRewardClaim('admin1', 'c1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('từ chối: bắt buộc lý do, PENDING→REJECTED, báo đại lý kèm lý do', async () => {
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const claims = fakeClaims([{ id: 'c1', status: 'PENDING' }]);
    const { prisma } = buildPrisma({ claims });
    const svc = new DealerService(prisma, makeConfig(), notifications as never);
    await expect(svc.rejectRewardClaim('admin1', 'c1', '   ')).rejects.toBeInstanceOf(BadRequestException);
    const out = await svc.rejectRewardClaim('admin1', 'c1', 'Đơn Q3 đã trả hàng');
    expect(out).toMatchObject({ status: 'REJECTED', rejectionReason: 'Đơn Q3 đã trả hàng' });
    expect(claims.updateMany.mock.calls[0]![0].where).toEqual({ id: 'c1', status: 'PENDING' });
    expect(notifications.notify).toHaveBeenCalledWith('d1', 'DEALER_REWARD_CLAIM_REJECTED', expect.objectContaining({ reason: 'Đơn Q3 đã trả hàng' }));
  });

  it('đánh dấu đã trao: chỉ từ APPROVED; PENDING → BadRequest', async () => {
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const claims = fakeClaims([
      { id: 'c1', status: 'APPROVED' },
      { id: 'c2', status: 'PENDING', periodKey: 'Q2/2026' },
    ]);
    const { prisma } = buildPrisma({ claims });
    const svc = new DealerService(prisma, makeConfig(), notifications as never);
    const out = await svc.markRewardClaimPaid('admin1', 'c1');
    expect(out).toMatchObject({ status: 'PAID', paidBy: 'admin1' });
    expect(claims.updateMany.mock.calls[0]![0].where).toEqual({ id: 'c1', status: 'APPROVED' });
    expect(notifications.notify).toHaveBeenCalledWith('d1', 'DEALER_REWARD_CLAIM_PAID', expect.anything());
    await expect(svc.markRewardClaimPaid('admin1', 'c2')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('danh sách: lọc theo status + kèm thông tin đại lý, phân trang', async () => {
    const claims = fakeClaims([
      { id: 'c1', status: 'PENDING' },
      { id: 'c2', status: 'PAID', periodKey: 'Q2/2026' },
    ]);
    const { prisma } = buildPrisma({ claims });
    const out = await new DealerService(prisma, makeConfig()).listRewardClaims('PENDING', 1, 20);
    expect(out.meta).toEqual({ page: 1, limit: 20, total: 1 });
    expect(out.data).toHaveLength(1);
    expect(out.data[0]).toMatchObject({ id: 'c1', dealer: { id: 'd1', businessName: 'Cty Đại lý A' } });
  });
});

describe('DTO + phân quyền route', () => {
  it('DealerAdminController chỉ cho ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, DealerAdminController)).toEqual(['ADMIN']);
  });

  it('route admin đúng đường dẫn/method (web-admin gọi theo đây)', () => {
    const proto = DealerAdminController.prototype as unknown as Record<string, object>;
    const route = (m: string) => [
      Reflect.getMetadata(METHOD_METADATA, proto[m]!),
      Reflect.getMetadata(PATH_METADATA, proto[m]!),
    ];
    expect(Reflect.getMetadata(PATH_METADATA, DealerAdminController)).toBe('admin/dealer-reward-claims');
    expect(route('list')).toEqual([RequestMethod.GET, '/']);
    expect(route('approve')).toEqual([RequestMethod.POST, ':id/approve']);
    expect(route('reject')).toEqual([RequestMethod.POST, ':id/reject']);
    expect(route('markPaid')).toEqual([RequestMethod.POST, ':id/mark-paid']);
  });

  it('controller chuyển đúng tham số xuống service (đại lý + admin)', async () => {
    const svc = {
      claimReward: jest.fn().mockResolvedValue({ ok: 1 }),
      listRewardClaims: jest.fn().mockResolvedValue({ data: [] }),
      approveRewardClaim: jest.fn().mockResolvedValue({}),
      rejectRewardClaim: jest.fn().mockResolvedValue({}),
      markRewardClaimPaid: jest.fn().mockResolvedValue({}),
    };
    const dealerCtl = new DealerController(svc as never);
    await dealerCtl.claimReward('d1', 'r1', { periodKey: 'Q3/2026', note: 'x' });
    expect(svc.claimReward).toHaveBeenCalledWith('d1', 'r1', { periodKey: 'Q3/2026', note: 'x' });
    expect(
      Reflect.getMetadata(PATH_METADATA, (DealerController.prototype as unknown as Record<string, object>).claimReward!),
    ).toBe('rewards/:id/claim');

    const adminCtl = new DealerAdminController(svc as never);
    await adminCtl.list(Object.assign(new ListRewardClaimsQuery(), { status: 'PENDING', page: 2, limit: 10 }));
    expect(svc.listRewardClaims).toHaveBeenCalledWith('PENDING', 2, 10);
    await adminCtl.approve('admin1', 'c1', { note: 'ok' });
    expect(svc.approveRewardClaim).toHaveBeenCalledWith('admin1', 'c1', 'ok');
    await adminCtl.reject('admin1', 'c1', { reason: 'Sai doanh số' });
    expect(svc.rejectRewardClaim).toHaveBeenCalledWith('admin1', 'c1', 'Sai doanh số');
    await adminCtl.markPaid('admin1', 'c1', {});
    expect(svc.markRewardClaimPaid).toHaveBeenCalledWith('admin1', 'c1', undefined);
  });

  it('ClaimRewardDto: periodKey đúng định dạng quý/năm, note giới hạn độ dài', async () => {
    const ok = await validate(plainToInstance(ClaimRewardDto, { periodKey: 'Q3/2026', note: 'x' }));
    expect(ok).toHaveLength(0);
    const okYear = await validate(plainToInstance(ClaimRewardDto, { periodKey: '2026' }));
    expect(okYear).toHaveLength(0);
    const bad = await validate(plainToInstance(ClaimRewardDto, { periodKey: 'Q5/2026' }));
    expect(bad.some((e) => e.property === 'periodKey')).toBe(true);
    const long = await validate(plainToInstance(ClaimRewardDto, { note: 'a'.repeat(501) }));
    expect(long.some((e) => e.property === 'note')).toBe(true);
  });

  it('RejectRewardClaimDto bắt buộc lý do; ListRewardClaimsQuery chỉ nhận status hợp lệ', async () => {
    expect((await validate(plainToInstance(RejectRewardClaimDto, {}))).some((e) => e.property === 'reason')).toBe(true);
    expect(await validate(plainToInstance(RejectRewardClaimDto, { reason: 'Sai doanh số' }))).toHaveLength(0);
    expect((await validate(plainToInstance(ListRewardClaimsQuery, { status: 'HACKED' }))).some((e) => e.property === 'status')).toBe(true);
    expect(await validate(plainToInstance(ListRewardClaimsQuery, { status: 'PENDING', page: '2' }))).toHaveLength(0);
  });
});
