import { FIRST_ORDER_REFEREE_PREFIX, FIRST_ORDER_REFERRER_PREFIX, grantFirstOrderReferralReward, type FirstOrderDeps } from './first-order-reward';
import { REFERRAL_FIRST_ORDER_POINTS_KEY, REFERRAL_MONTHLY_CAP_KEY, REFERRAL_VIRAL_ENABLED_KEY } from './viral-config';

const at = new Date('2026-11-19T10:00:00.000Z');
const expiresAt = new Date('2027-11-19T00:00:00.000Z');
const shipTo = { recipient: 'Bạn', phone: '0902222222', street: '99 Hai Bà Trưng', ward: 'Bến Nghé', wardCode: '26737', district: 'Quận 1', province: 'TP.HCM' };

interface World {
  cfg?: Record<string, unknown>;
  users?: Record<string, Record<string, unknown> | null>;
  order?: Record<string, unknown>;
  refereeOrders?: { id: string; createdAt: Date; status?: string }[];
  referrerOrders?: Record<string, unknown>[];
  addresses?: Record<string, unknown>[];
  entries?: { reason: string; refId: string }[];
  monthCount?: number;
  grant?: jest.Mock;
}

function setup(w: World = {}) {
  const users: Record<string, Record<string, unknown> | null> = {
    f1: { id: 'f1', referredById: 'r1', mergedIntoId: null, phone: '0902222222', zaloId: 'zalo-f', metadata: null },
    r1: { id: 'r1', role: 'CUSTOMER', metadata: null, phone: '0901111111', zaloId: 'zalo-r', isBlocked: false, mergedIntoId: null },
    ...w.users,
  };
  const order = { id: 'o1', userId: 'f1', type: 'RETAIL', status: 'DELIVERED', total: 250_000, placedForCustomer: false, createdAt: at, shippingAddress: shipTo, guestPhone: null, guestIpHash: null, placedIpHash: 'ip-f', ...w.order };
  const entries = w.entries ?? [];
  const db = {
    order: {
      findUnique: jest.fn(async () => order),
      findMany: jest.fn(async (args: { where: { userId?: string } }) => (args.where.userId === 'f1' ? (w.refereeOrders ?? [{ id: 'o1', createdAt: at }]) : (w.referrerOrders ?? []))),
    },
    user: {
      findUnique: jest.fn(async (args: { where: { id: string } }) => users[args.where.id] ?? null),
      findMany: jest.fn(async () => []),
    },
    $queryRaw: jest.fn(async () => [{ pointsBalance: 0, pointsConvertedBalance: 0 }]),
    coinTransaction: { findFirst: jest.fn(async () => null) },
    pointsTransaction: {
      findFirst: jest.fn(async (args: { where: { reason?: { in?: string[] }; refId?: { in: string[] } } }) => {
        const { where } = args;
        if (where.reason?.in) return entries.find((e) => where.reason!.in!.includes(e.reason)) ?? null;
        if (where.refId) return entries.find((e) => where.refId!.in.includes(e.refId) && e.reason.startsWith('REFERRAL_FIRST_ORDER_')) ?? null;
        return null;
      }),
      count: jest.fn(async () => w.monthCount ?? 0),
    },
    returnRequest: { findMany: jest.fn(async () => []) },
    address: { findMany: jest.fn(async () => w.addresses ?? []) },
    $transaction: jest.fn(),
  };
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => unknown) => cb(db));
  const cfg: Record<string, unknown> = { [REFERRAL_VIRAL_ENABLED_KEY]: true, ...w.cfg };
  const grant = w.grant ?? jest.fn(async () => true);
  const deps: FirstOrderDeps = {
    prisma: db as never,
    config: { get: async <T,>(k: string, fb?: T) => (k in cfg ? (cfg[k] as T) : (fb as T)) },
    grant,
    expiresAt: async () => expiresAt,
    now: () => at,
  };
  return { db, grant, run: () => grantFirstOrderReferralReward(deps, 'o1') };
}

describe('grantFirstOrderReferralReward', () => {
  it('cờ tắt (hoặc không phải boolean true): không đọc đơn, không cấp', async () => {
    for (const flag of [false, 'true', undefined]) {
      const s = setup({ cfg: { [REFERRAL_VIRAL_ENABLED_KEY]: flag } });
      expect(await s.run()).toEqual({ status: 'SKIPPED', reason: 'OFF' });
      expect(s.db.order.findUnique).not.toHaveBeenCalled();
      expect(s.grant).not.toHaveBeenCalled();
    }
  });

  it('đơn đầu đạt mốc: cả hai bên nhận 100 Điểm Xanh lô thường, khoá theo người được mời, refId là đơn', async () => {
    const s = setup();
    expect(await s.run()).toEqual({ status: 'GRANTED', referrerId: 'r1', refereeId: 'f1', points: 100 });
    expect(s.grant).toHaveBeenCalledTimes(2);
    expect(s.grant).toHaveBeenCalledWith('r1', 100, `${FIRST_ORDER_REFERRER_PREFIX}f1`, 'REFERRAL', 'o1', expect.anything(), expiresAt);
    expect(s.grant).toHaveBeenCalledWith('f1', 100, `${FIRST_ORDER_REFEREE_PREFIX}f1`, 'REFERRAL', 'o1', expect.anything(), expiresAt);
    // Khoá người được mời rồi người mời (cùng thứ tự với thưởng đơn thứ 2).
    expect(s.db.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('số điểm cấu hình hỏng thì về mặc định 100; 0 thì tắt thưởng', async () => {
    const bad = setup({ cfg: { [REFERRAL_FIRST_ORDER_POINTS_KEY]: '500' } });
    expect(await bad.run()).toMatchObject({ status: 'GRANTED', points: 100 });
    const zero = setup({ cfg: { [REFERRAL_FIRST_ORDER_POINTS_KEY]: 0 } });
    expect(await zero.run()).toEqual({ status: 'SKIPPED', reason: 'OFF' });
  });

  it.each([
    ['dưới 199.000đ', { total: 198_999 }],
    ['chưa giao', { status: 'SHIPPING' }],
    ['đơn CTV đặt hộ', { placedForCustomer: true }],
    ['đơn đại lý', { type: 'DEALER' }],
  ])('đơn không đủ điều kiện: %s', async (_name, order) => {
    const s = setup({ order });
    expect(await s.run()).toEqual({ status: 'SKIPPED', reason: 'NOT_ELIGIBLE' });
    expect(s.grant).not.toHaveBeenCalled();
  });

  it('bạn được mời là khách vãng lai (chưa xác thực) thì không thưởng', async () => {
    const s = setup({ users: { f1: { id: 'f1', referredById: 'r1', mergedIntoId: null, phone: null, zaloId: 'guest_dev1', metadata: null } } });
    expect(await s.run()).toEqual({ status: 'SKIPPED', reason: 'GUEST' });
  });

  it('không có người mời', async () => {
    const s = setup({ users: { f1: { id: 'f1', referredById: null, mergedIntoId: null, phone: '0902222222', zaloId: 'z', metadata: null } } });
    expect(await s.run()).toEqual({ status: 'SKIPPED', reason: 'NO_REFERRER' });
  });

  it.each([
    ['CTV', { role: 'AFFILIATE' }],
    ['bị khoá', { isBlocked: true }],
    ['chủ gian hàng mẫu', { metadata: { sampleStorefront: true } }],
    ['đã xoá tài khoản', { metadata: { anonymizedAt: '2026-11-01' } }],
    ['chưa xác thực', { phone: null, zaloId: 'guest_x' }],
  ])('người mời không được nhận: %s', async (_name, over) => {
    const s = setup({ users: { r1: { id: 'r1', role: 'CUSTOMER', metadata: null, phone: '0901111111', zaloId: 'zalo-r', isBlocked: false, mergedIntoId: null, ...over } } });
    expect(await s.run()).toEqual({ status: 'SKIPPED', reason: 'REFERRER_INELIGIBLE' });
    expect(s.grant).not.toHaveBeenCalled();
  });

  it('không phải đơn đầu đạt mốc (đơn trước đã giao) thì không thưởng', async () => {
    const s = setup({ refereeOrders: [{ id: 'o0', createdAt: new Date('2026-11-01T00:00:00Z') }, { id: 'o1', createdAt: at }] });
    expect(await s.run()).toEqual({ status: 'SKIPPED', reason: 'NOT_FIRST' });
  });

  it('đơn đầu đã giao rồi bị trả (cặp bị chặn/chạm trần ở đơn đó): đơn sau không thành đơn đầu', async () => {
    const s = setup({ refereeOrders: [{ id: 'o0', createdAt: new Date('2026-11-01T00:00:00Z'), status: 'RETURNED' }, { id: 'o1', createdAt: at }] });
    expect(await s.run()).toEqual({ status: 'SKIPPED', reason: 'NOT_FIRST' });
    expect(s.grant).not.toHaveBeenCalled();
  });

  it('chính đơn đầu đã trả hết trước lúc xét: không thưởng', async () => {
    const s = setup({ refereeOrders: [{ id: 'o1', createdAt: at, status: 'RETURNED' }] });
    expect(await s.run()).toEqual({ status: 'SKIPPED', reason: 'NOT_ELIGIBLE' });
    expect(s.grant).not.toHaveBeenCalled();
  });

  it('một đơn khác của tài khoản đã được thưởng đơn đầu dưới id phiên khách đã gộp: không thưởng lần hai', async () => {
    const s = setup({
      refereeOrders: [{ id: 'o1', createdAt: at }, { id: 'oG', createdAt: new Date('2026-11-20T00:00:00Z') }],
      entries: [{ reason: `${FIRST_ORDER_REFEREE_PREFIX}guest9`, refId: 'oG' }],
    });
    expect(await s.run()).toEqual({ status: 'SKIPPED', reason: 'ALREADY' });
    expect(s.grant).not.toHaveBeenCalled();
  });

  it('đã thưởng người được mời này (đơn chạy lại trạng thái, cron chạy lại): không cấp lần hai', async () => {
    const s = setup({ entries: [{ reason: `${FIRST_ORDER_REFEREE_PREFIX}f1`, refId: 'o1' }] });
    expect(await s.run()).toEqual({ status: 'SKIPPED', reason: 'ALREADY' });
    expect(s.grant).not.toHaveBeenCalled();
  });

  it('đơn đã thưởng dưới id phiên khách trước khi gộp: không thưởng lần hai cho tài khoản đích', async () => {
    const s = setup({ entries: [{ reason: `${FIRST_ORDER_REFERRER_PREFIX}guest1`, refId: 'o1' }] });
    expect(await s.run()).toEqual({ status: 'SKIPPED', reason: 'ALREADY' });
  });

  it('chặn trùng SĐT: đơn đầu giao tới SĐT trong sổ địa chỉ người mời', async () => {
    const s = setup({ addresses: [{ phone: '0902222222', street: '1 Khác', ward: 'A', wardCode: '1', district: 'B', province: 'C' }] });
    expect(await s.run()).toEqual({ status: 'BLOCKED', reason: 'PHONE' });
    expect(s.grant).not.toHaveBeenCalled();
  });

  it('chặn trùng địa chỉ giao với đơn của người mời', async () => {
    const s = setup({ referrerOrders: [{ createdAt: new Date('2026-06-01T00:00:00Z'), shippingAddress: { ...shipTo, phone: '0909999999' }, placedIpHash: null, guestIpHash: null }] });
    expect(await s.run()).toEqual({ status: 'BLOCKED', reason: 'ADDRESS' });
  });

  it('chặn cùng IP trong 24 giờ', async () => {
    const s = setup({ referrerOrders: [{ createdAt: new Date(at.getTime() - 3600_000), shippingAddress: null, placedIpHash: 'ip-f', guestIpHash: null }] });
    expect(await s.run()).toEqual({ status: 'BLOCKED', reason: 'IP' });
  });

  it('đủ trần tháng của người mời: không ai nhận; trần 0 = không thưởng', async () => {
    const capped = setup({ monthCount: 10 });
    expect(await capped.run()).toEqual({ status: 'SKIPPED', reason: 'CAPPED' });
    expect(capped.grant).not.toHaveBeenCalled();
    const where = (capped.db.pointsTransaction.count.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ userId: 'r1', refType: 'REFERRAL', reason: { startsWith: FIRST_ORDER_REFERRER_PREFIX }, createdAt: { gte: new Date('2026-10-31T17:00:00.000Z') } });
    const zero = setup({ cfg: { [REFERRAL_MONTHLY_CAP_KEY]: 0 } });
    expect(await zero.run()).toEqual({ status: 'SKIPPED', reason: 'CAPPED' });
  });

  it('chỉ một trong hai dòng ghi được: ném để rollback cả hai', async () => {
    const grant = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(setup({ grant }).run()).rejects.toThrow('chỉ một trong hai dòng');
  });

  it('cả hai dòng đã có (lần chạy song song thắng trước): ALREADY', async () => {
    const grant = jest.fn(async () => false);
    expect(await setup({ grant }).run()).toEqual({ status: 'SKIPPED', reason: 'ALREADY' });
  });

  it('người mời đổi giữa lúc đọc và lúc khoá (gộp khách): bỏ qua', async () => {
    const s = setup();
    let calls = 0;
    s.db.user.findUnique.mockImplementation(async (args: { where: { id: string } }) => {
      if (args.where.id === 'f1') {
        calls += 1;
        return { id: 'f1', referredById: calls === 1 ? 'r1' : 'r2', mergedIntoId: null, phone: '0902222222', zaloId: 'zalo-f', metadata: null };
      }
      if (args.where.id === 'r1') return { id: 'r1', role: 'CUSTOMER', metadata: null, phone: '0901111111', zaloId: 'zalo-r', isBlocked: false, mergedIntoId: null };
      return { id: args.where.id, mergedIntoId: null, metadata: null };
    });
    expect(await s.run()).toEqual({ status: 'SKIPPED', reason: 'STALE' });
  });
});
