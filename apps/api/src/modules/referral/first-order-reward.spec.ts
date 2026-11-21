import {
  FIRST_ORDER_DEBT_PREFIX,
  FIRST_ORDER_REFEREE_PREFIX,
  FIRST_ORDER_REFERRER_PREFIX,
  FIRST_ORDER_REVOKE_PREFIX,
  FirstOrderRetryableError,
  grantFirstOrderReferralReward,
  revokeFirstOrderRewardOnMerge,
  type FirstOrderDeps,
} from './first-order-reward';
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
  /** Số cặp trong `monthCount` đã có dòng thu hồi phía người mời (gộp phiên khách tự mời). */
  revokedCount?: number;
  grant?: jest.Mock;
}

function setup(w: World = {}) {
  const users: Record<string, Record<string, unknown> | null> = {
    f1: { id: 'f1', referredById: 'r1', mergedIntoId: null, phone: '0902222222', zaloId: 'zalo-f', metadata: null },
    r1: { id: 'r1', role: 'CUSTOMER', metadata: null, phone: '0901111111', zaloId: 'zalo-r', isBlocked: false, mergedIntoId: null },
    ...w.users,
  };
  const order = { id: 'o1', userId: 'f1', type: 'RETAIL', status: 'DELIVERED', subtotal: 250_000, total: 250_000, placedForCustomer: false, createdAt: at, shippingAddress: shipTo, guestPhone: null, guestIpHash: null, placedIpHash: 'ip-f', ...w.order };
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
      // Trần tháng: các dòng thưởng phía người mời trong tháng, rồi đếm dòng thu hồi khớp các dòng đó.
      findMany: jest.fn(async () => Array.from({ length: w.monthCount ?? 0 }, (_, i) => ({ reason: `${FIRST_ORDER_REFERRER_PREFIX}f${i}` }))),
      count: jest.fn(async () => w.revokedCount ?? 0),
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
    ['tiền hàng dưới 199.000đ', { subtotal: 198_999, total: 198_999 }],
    ['tiền hàng dưới 199.000đ dù cộng phí giao thì tổng trả vượt mốc', { subtotal: 198_999, total: 214_999 }],
    ['chưa giao', { status: 'SHIPPING' }],
    ['đơn CTV đặt hộ', { placedForCustomer: true }],
    ['đơn đại lý', { type: 'DEALER' }],
  ])('đơn không đủ điều kiện: %s', async (_name, order) => {
    const s = setup({ order });
    expect(await s.run()).toEqual({ status: 'SKIPPED', reason: 'NOT_ELIGIBLE' });
    expect(s.grant).not.toHaveBeenCalled();
  });

  it('mốc 199.000đ tính trên tiền hàng như dòng chữ "mua đơn đầu từ 199k": mã giảm giá kéo tổng trả xuống dưới mốc vẫn thưởng', async () => {
    const s = setup({ order: { subtotal: 199_000, total: 169_000 } });
    expect(await s.run()).toEqual({ status: 'GRANTED', referrerId: 'r1', refereeId: 'f1', points: 100 });
    const firstQuery = (s.db.order.findMany.mock.calls as unknown as [{ where: Record<string, unknown> }][]).find(([a]) => a.where.userId === 'f1')![0];
    expect(firstQuery.where).toMatchObject({ subtotal: { gte: 199_000 } });
    expect(firstQuery.where).not.toHaveProperty('total');
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
    const where = (capped.db.pointsTransaction.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ userId: 'r1', refType: 'REFERRAL', reason: { startsWith: FIRST_ORDER_REFERRER_PREFIX }, createdAt: { gte: new Date('2026-10-31T17:00:00.000Z') } });
    const zero = setup({ cfg: { [REFERRAL_MONTHLY_CAP_KEY]: 0 } });
    expect(await zero.run()).toEqual({ status: 'SKIPPED', reason: 'CAPPED' });
  });

  it('w10-03 M3: cặp đã bị thu hồi khi gộp phiên khách tự mời trả lại chỗ trong trần tháng, đếm khớp số "đã thưởng" của Trung tâm tăng trưởng', async () => {
    const s = setup({ monthCount: 10, revokedCount: 1 });
    expect(await s.run()).toEqual({ status: 'GRANTED', referrerId: 'r1', refereeId: 'f1', points: 100 });
    // Cùng cách ghép với firstOrderGuardStats: dòng thu hồi phía người mời của đúng từng bạn đã thưởng trong tháng, ghi kỳ nào cũng tính.
    expect(s.db.pointsTransaction.count).toHaveBeenCalledWith({
      where: { refType: 'REFERRAL', reason: { in: Array.from({ length: 10 }, (_, i) => `${FIRST_ORDER_REVOKE_PREFIX}REFERRER:f${i}`) } },
    });
    expect(await setup({ monthCount: 11, revokedCount: 1 }).run()).toEqual({ status: 'SKIPPED', reason: 'CAPPED' });
    // Tháng chưa thưởng ai: không cần đếm dòng thu hồi.
    const fresh = setup({ monthCount: 0 });
    expect((await fresh.run()).status).toBe('GRANTED');
    expect(fresh.db.pointsTransaction.count).not.toHaveBeenCalled();
  });

  it('chỉ một trong hai dòng ghi được: ném để rollback cả hai', async () => {
    const grant = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(setup({ grant }).run()).rejects.toThrow('chỉ một trong hai dòng');
  });

  it('cả hai dòng đã có (lần chạy song song thắng trước): ALREADY', async () => {
    const grant = jest.fn(async () => false);
    expect(await setup({ grant }).run()).toEqual({ status: 'SKIPPED', reason: 'ALREADY' });
  });

  it('tự mời: đơn đầu bị chặn SELF trong tx; đơn sau của cùng người là NOT_FIRST, không thêm một lần chặn để đếm', async () => {
    const self = { id: 'f1', referredById: 'f1', mergedIntoId: null, phone: '0902222222', zaloId: 'zalo-f', metadata: null, role: 'CUSTOMER', isBlocked: false };
    const first = setup({ users: { f1: self } });
    expect(await first.run()).toEqual({ status: 'BLOCKED', reason: 'SELF' });
    expect(first.db.$transaction).toHaveBeenCalledTimes(1);
    expect(first.grant).not.toHaveBeenCalled();
    const later = setup({ users: { f1: self }, refereeOrders: [{ id: 'o0', createdAt: new Date('2026-11-01T00:00:00Z') }, { id: 'o1', createdAt: at }] });
    expect(await later.run()).toEqual({ status: 'SKIPPED', reason: 'NOT_FIRST' });
  });

  it('bạn được mời bị khoá tài khoản: không ai nhận', async () => {
    const s = setup({ users: { f1: { id: 'f1', referredById: 'r1', mergedIntoId: null, phone: '0902222222', zaloId: 'zalo-f', metadata: null, isBlocked: true } } });
    expect(await s.run()).toEqual({ status: 'SKIPPED', reason: 'REFEREE_INELIGIBLE' });
    expect(s.grant).not.toHaveBeenCalled();
    expect(s.db.$transaction).not.toHaveBeenCalled();
  });

  it('bạn được mời bị khoá giữa lúc đọc và lúc khoá dòng: không ai nhận', async () => {
    const s = setup();
    let reads = 0;
    s.db.user.findUnique.mockImplementation(async (args: { where: { id: string } }) => {
      if (args.where.id === 'f1') {
        reads += 1;
        return { id: 'f1', referredById: 'r1', mergedIntoId: null, phone: '0902222222', zaloId: 'zalo-f', metadata: null, isBlocked: reads > 1 };
      }
      return { id: 'r1', role: 'CUSTOMER', metadata: null, phone: '0901111111', zaloId: 'zalo-r', isBlocked: false, mergedIntoId: null };
    });
    expect(await s.run()).toEqual({ status: 'SKIPPED', reason: 'REFEREE_INELIGIBLE' });
    expect(s.grant).not.toHaveBeenCalled();
  });

  it('người mời đổi giữa lúc đọc và lúc khoá (người mời vừa gộp): xét lại ngay theo người mời mới', async () => {
    const s = setup({ users: { r2: { id: 'r2', role: 'CUSTOMER', metadata: null, phone: '0903333333', zaloId: 'zalo-r2', isBlocked: false, mergedIntoId: null } } });
    let calls = 0;
    const base = s.db.user.findUnique.getMockImplementation()!;
    s.db.user.findUnique.mockImplementation(async (args: { where: { id: string } }) => {
      if (args.where.id === 'f1') {
        calls += 1;
        return { id: 'f1', referredById: calls === 1 ? 'r1' : 'r2', mergedIntoId: null, phone: '0902222222', zaloId: 'zalo-f', metadata: null, isBlocked: false };
      }
      return base(args);
    });
    expect(await s.run()).toEqual({ status: 'GRANTED', referrerId: 'r2', refereeId: 'f1', points: 100 });
    expect(s.grant).toHaveBeenCalledWith('r2', 100, `${FIRST_ORDER_REFERRER_PREFIX}f1`, 'REFERRAL', 'o1', expect.anything(), expiresAt);
  });
});

/**
 * Gộp tài khoản chạy chen đúng lúc đơn đầu sang DELIVERED: lúc đọc đơn còn thuộc f1, tới lúc khoá dòng thì f1 đã gộp vào T và đơn đã
 * chuyển sang T (auth.service gộp chuyển đơn cùng transaction với mergedIntoId). Trước đây trả SKIPPED/STALE nên việc sau giao ghi mốc
 * xong, lần sau xét thì đơn này thành đơn đầu của T mà không phải đơn đang xét (NOT_FIRST): cặp mất hẳn 100 + 100 Điểm Xanh.
 */
describe('grantFirstOrderReferralReward — gộp tài khoản chạy chen', () => {
  const T = { id: 'T', referredById: 'r1', mergedIntoId: null, phone: '0902222222', zaloId: 'zalo-t', metadata: null, isBlocked: false };

  /** `merges` = số lần dòng người được mời đổi chủ ngay trước khi tx khoá được dòng (mỗi lần một tài khoản đích mới). */
  function racing(merges: number) {
    const s = setup();
    const owners = ['f1', 'T', 'T2', 'T3'];
    let merged = 0;
    let order = { id: 'o1', userId: 'f1', type: 'RETAIL', status: 'DELIVERED', subtotal: 250_000, total: 250_000, placedForCustomer: false, createdAt: at, shippingAddress: shipTo, guestPhone: null, guestIpHash: null, placedIpHash: 'ip-f' };
    const fresh = (id: string) => ({ ...T, id, zaloId: `zalo-${id}`, mergedIntoId: null as string | null });
    s.db.order.findUnique.mockImplementation(async () => order);
    s.db.order.findMany.mockImplementation(async (args: { where: { userId?: string } }) => (args.where.userId === order.userId ? [{ id: 'o1', createdAt: at }] : []));
    s.db.user.findUnique.mockImplementation(async (args: { where: { id: string } }) => {
      if (args.where.id === 'r1') return { id: 'r1', role: 'CUSTOMER', metadata: null, phone: '0901111111', zaloId: 'zalo-r', isBlocked: false, mergedIntoId: null };
      return fresh(args.where.id);
    });
    // lockReferee là câu khoá đầu tiên trong tx: lần gộp commit đúng lúc đó, dòng cũ mang mergedIntoId và đơn sang chủ mới.
    const tx = s.db.$transaction.getMockImplementation()!;
    s.db.$transaction.mockImplementation(async (cb: (db: typeof s.db) => unknown) => {
      if (merged < merges) {
        const from = owners[merged]!;
        const to = owners[merged + 1]!;
        merged += 1;
        const inner = s.db.user.findUnique.getMockImplementation()!;
        s.db.user.findUnique.mockImplementation(async (args: { where: { id: string } }) => (args.where.id === from ? { ...fresh(from), mergedIntoId: to } : inner(args)));
        order = { ...order, userId: to };
      }
      return tx(cb);
    });
    return s;
  }

  it('gộp xong lúc khoá dòng: xét lại ngay theo tài khoản đích, cả hai nhận thưởng (đơn là đơn đầu của T)', async () => {
    const s = racing(1);
    expect(await s.run()).toEqual({ status: 'GRANTED', referrerId: 'r1', refereeId: 'T', points: 100 });
    expect(s.grant).toHaveBeenCalledTimes(2);
    expect(s.grant).toHaveBeenCalledWith('T', 100, `${FIRST_ORDER_REFEREE_PREFIX}T`, 'REFERRAL', 'o1', expect.anything(), expiresAt);
  });

  it('gộp chạy chen hai lần liền: ném lỗi thử lại (việc sau giao để đơn chưa có mốc), lượt cron sau cấp được thưởng', async () => {
    const s = racing(2);
    await expect(s.run()).rejects.toBeInstanceOf(FirstOrderRetryableError);
    expect(s.grant).not.toHaveBeenCalled();
    // Lượt chạy lại của DeliveredEffectsResyncCron: các lần gộp đã xong, đơn thuộc T2.
    expect(await s.run()).toEqual({ status: 'GRANTED', referrerId: 'r1', refereeId: 'T2', points: 100 });
  });

  it('đơn còn nằm ở dòng đã gộp sau khi đọc lại (không phải chạy chen): bỏ qua hẳn, không ném', async () => {
    const s = setup({ users: { f1: { id: 'f1', referredById: 'r1', mergedIntoId: 'T', phone: '0902222222', zaloId: 'zalo-f', metadata: null, isBlocked: false } } });
    expect(await s.run()).toEqual({ status: 'SKIPPED', reason: 'NOT_ELIGIBLE' });
    expect(s.db.order.findUnique).toHaveBeenCalledTimes(2);
    expect(s.grant).not.toHaveBeenCalled();
  });
});

/**
 * MINOR 3 của w8-02: gộp phiên khách vào chính người mời (auth.service mergeGuestInto bước 10 cắt liên kết tự mời / tạo vòng) trước đây chỉ
 * thu hồi thưởng đơn thứ 2. Hai dòng thưởng đơn đầu (người mời + phiên khách, đã cùng sang tài khoản đích ở bước 5) ở lại: tự mời giữ 200 điểm.
 */
describe('revokeFirstOrderRewardOnMerge', () => {
  const REFERRER_ROW = { reason: `${FIRST_ORDER_REFERRER_PREFIX}G`, delta: 100 };
  const REFEREE_ROW = { reason: `${FIRST_ORDER_REFEREE_PREFIX}G`, delta: 100 };

  type ExpiryTxn = { id: string; delta: number; expiresAt: Date | null; createdAt: Date; reason: string; refType: string | null; refId: string | null };
  const grantTxn = (reason: string, i: number, expiresAt: Date | null = null): ExpiryTxn => ({
    id: `g${i}`,
    delta: 100,
    expiresAt,
    createdAt: new Date(2026, 0, 1 + i),
    reason,
    refType: 'REFERRAL',
    refId: 'O1',
  });

  function ledger(opts: { rows?: { reason: string; delta: number }[]; balance?: number; existing?: string[]; txns?: ExpiryTxn[] } = {}) {
    let balance = opts.balance ?? 500;
    const written: { userId: string; delta: number; lot: string; reason: string; refType: string; refId: string }[] = [];
    const existing = new Set(opts.existing ?? []);
    const tx = {
      $queryRaw: jest.fn(async () => [{ pointsBalance: balance, pointsConvertedBalance: 0 }]),
      coinTransaction: { findFirst: jest.fn(async () => null) },
      pointsTransaction: {
        // Hai loại truy vấn: dòng thưởng đang giữ (lọc refType REFERRAL) và sổ lô STANDARD cho lotRecoverable (lọc lot).
        findMany: jest.fn(async (args: { where: { lot?: string } }) => {
          const rows = opts.rows ?? [REFERRER_ROW, REFEREE_ROW];
          if (args.where.lot !== 'STANDARD') return rows;
          return opts.txns ?? rows.map((r, i) => grantTxn(r.reason, i));
        }),
        findFirst: jest.fn(async (args: { where: { reason: { in: string[] } } }) => (args.where.reason.in.some((r) => existing.has(r)) ? { id: 'x' } : null)),
        createMany: jest.fn(async (args: { data: (typeof written)[number][] }) => {
          const fresh = args.data.filter((d) => !existing.has(d.reason));
          for (const d of fresh) {
            existing.add(d.reason);
            written.push(d);
          }
          return { count: fresh.length };
        }),
        create: jest.fn(async (args: { data: (typeof written)[number] }) => {
          written.push(args.data);
          return args.data;
        }),
      },
      user: {
        updateMany: jest.fn(async (args: { data: { pointsBalance: { decrement: number } } }) => {
          balance -= args.data.pointsBalance.decrement;
          return { count: 1 };
        }),
      },
    };
    return { tx, written, balance: () => balance };
  }

  it('tự mời: thu cả hai dòng thưởng đơn đầu tài khoản đích đang giữ, mỗi dòng một dòng đối ứng lô thường, một tin báo', async () => {
    const l = ledger();
    const res = await revokeFirstOrderRewardOnMerge(l.tx as never, { refereeId: 'G', targetId: 'T', refId: 'MERGE:G' });
    expect(res).toEqual({
      revoked: 200,
      shortfall: 0,
      notices: [{ kind: 'REVOKED', referrerId: 'T', refereeId: 'G', taken: 200, debt: 0, cause: 'MERGE', key: `${FIRST_ORDER_REVOKE_PREFIX}REFERRER:G` }],
    });
    expect(l.written).toEqual([
      { userId: 'T', delta: -100, lot: 'STANDARD', reason: `${FIRST_ORDER_REVOKE_PREFIX}REFERRER:G`, refType: 'REFERRAL', refId: 'MERGE:G' },
      { userId: 'T', delta: -100, lot: 'STANDARD', reason: `${FIRST_ORDER_REVOKE_PREFIX}REFEREE:G`, refType: 'REFERRAL', refId: 'MERGE:G' },
    ]);
    expect(l.balance()).toBe(300);
    // Chỉ dòng thưởng dương mà tài khoản đích đang giữ: bạn thật (người được mời trong vòng) giữ phần của mình.
    expect(l.tx.pointsTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'T', refType: 'REFERRAL', delta: { gt: 0 }, reason: { in: [`${FIRST_ORDER_REFERRER_PREFIX}G`, `${FIRST_ORDER_REFEREE_PREFIX}G`] } },
      }),
    );
  });

  it('lô thưởng đã hết hạn (cron đã trừ POINTS_EXPIRED): không thu lại phần đó từ điểm khác của tài khoản đích', async () => {
    const past = new Date(2026, 3, 1);
    const l = ledger({
      txns: [
        grantTxn(REFERRER_ROW.reason, 0, past),
        grantTxn(REFEREE_ROW.reason, 1, past),
        { id: 'e1', delta: -200, expiresAt: null, createdAt: new Date(2026, 3, 2), reason: 'POINTS_EXPIRED', refType: null, refId: null },
        { id: 'k1', delta: 500, expiresAt: null, createdAt: new Date(2026, 4, 1), reason: 'DAILY_CHECKIN:DAY_1', refType: null, refId: null },
      ],
    });
    const res = await revokeFirstOrderRewardOnMerge(l.tx as never, { refereeId: 'G', targetId: 'T', refId: 'MERGE:G' });
    expect(l.balance()).toBe(500);
    expect(res).toMatchObject({ revoked: 0, shortfall: 0, notices: [] });
    // Vẫn ghi dòng đối ứng 0 điểm: gộp chạy lại không xét lại, sổ cho thấy liên kết đã bị cắt.
    expect(l.written).toEqual([
      { userId: 'T', delta: 0, lot: 'STANDARD', reason: `${FIRST_ORDER_REVOKE_PREFIX}REFERRER:G`, refType: 'REFERRAL', refId: 'MERGE:G' },
      { userId: 'T', delta: 0, lot: 'STANDARD', reason: `${FIRST_ORDER_REVOKE_PREFIX}REFEREE:G`, refType: 'REFERRAL', refId: 'MERGE:G' },
    ]);
  });

  it('một phía hết hạn, phía kia còn: chỉ thu phía còn', async () => {
    const l = ledger({
      txns: [
        grantTxn(REFERRER_ROW.reason, 0, new Date(2026, 3, 1)),
        grantTxn(REFEREE_ROW.reason, 1, new Date(2027, 3, 1)),
        { id: 'e1', delta: -100, expiresAt: null, createdAt: new Date(2026, 3, 2), reason: 'POINTS_EXPIRED', refType: null, refId: null },
        { id: 'k1', delta: 500, expiresAt: null, createdAt: new Date(2026, 4, 1), reason: 'DAILY_CHECKIN:DAY_1', refType: null, refId: null },
      ],
      balance: 600,
    });
    const res = await revokeFirstOrderRewardOnMerge(l.tx as never, { refereeId: 'G', targetId: 'T', refId: 'MERGE:G' });
    expect(res).toMatchObject({ revoked: 100, shortfall: 0 });
    expect(l.balance()).toBe(500);
  });

  it('số dư không đủ: trừ phần có, phần thiếu ghi nợ REFERRAL_DEBT theo từng phía, không để số dư âm', async () => {
    const l = ledger({ balance: 150 });
    const res = await revokeFirstOrderRewardOnMerge(l.tx as never, { refereeId: 'G', targetId: 'T', refId: 'MERGE:G' });
    expect(res).toMatchObject({ revoked: 150, shortfall: 50 });
    expect(l.balance()).toBe(0);
    expect(l.written.find((w) => w.refType === 'REFERRAL_DEBT')).toEqual({
      userId: 'T',
      delta: 0,
      lot: 'STANDARD',
      reason: `${FIRST_ORDER_DEBT_PREFIX}REFEREE:G:50`,
      refType: 'REFERRAL_DEBT',
      refId: 'MERGE:G',
    });
  });

  it('chỉ một phía đang ở tài khoản đích (người được mời trong vòng là bạn thật): chỉ thu phía đó, tin mang khoá của phía đó', async () => {
    const l = ledger({ rows: [REFERRER_ROW] });
    const res = await revokeFirstOrderRewardOnMerge(l.tx as never, { refereeId: 'G', targetId: 'T', refId: 'MERGE:G' });
    expect(res?.revoked).toBe(100);
    expect(l.written.map((w) => w.reason)).toEqual([`${FIRST_ORDER_REVOKE_PREFIX}REFERRER:G`]);
  });

  it('chạy lại (dòng thu hồi đã có) hoặc không có thưởng đơn đầu: không ghi gì, trả null', async () => {
    const again = ledger({ existing: [`${FIRST_ORDER_REVOKE_PREFIX}REFERRER:G`, `${FIRST_ORDER_REVOKE_PREFIX}REFEREE:G`] });
    expect(await revokeFirstOrderRewardOnMerge(again.tx as never, { refereeId: 'G', targetId: 'T', refId: 'MERGE:G' })).toBeNull();
    expect(again.written).toEqual([]);
    expect(again.balance()).toBe(500);
    const none = ledger({ rows: [] });
    expect(await revokeFirstOrderRewardOnMerge(none.tx as never, { refereeId: 'G', targetId: 'T', refId: 'MERGE:G' })).toBeNull();
    expect(none.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('dòng thu hồi không mang tiền tố đếm thưởng (Trung tâm tăng trưởng, trần tháng): không bị đếm là một lần thưởng', () => {
    expect(`${FIRST_ORDER_REVOKE_PREFIX}REFERRER:G`.startsWith(FIRST_ORDER_REFERRER_PREFIX)).toBe(false);
    expect(`${FIRST_ORDER_REVOKE_PREFIX}REFEREE:G`.startsWith(FIRST_ORDER_REFEREE_PREFIX)).toBe(false);
  });
});
