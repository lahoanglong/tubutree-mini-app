import { VouchersService } from './vouchers.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { REAL_USER_WHERE } from '../../common/real-user';
import { priorOrderWhere } from '../../common/first-order';
import { startOfVnMonth } from '../../common/vn-time';
import { runExclusive } from '../../common/cron-leader/run-exclusive';
import { holdsLease } from '../../common/cron-leader/run-exclusive.fixtures';

jest.mock('../../common/cron-leader/run-exclusive');

/** Service gửi tin qua notifySafe; hai tên dùng chung một mock để kiểm theo mã tin. */
function mockNotifier(): NotificationsService {
  const fn = jest.fn().mockResolvedValue(true);
  return { notify: fn, notifySafe: fn } as unknown as NotificationsService;
}

/**
 * milestoneVouchers quét tháng này và 3 tháng trước, mỗi kỳ một vòng keyset. Mock SQL chỉ trả dòng cho kỳ THÁNG NÀY và
 * rỗng cho các kỳ trước để các ca đếm số coupon/cursor không nhân đôi; kỳ trước có test riêng. Tham số Date đầu tiên là đầu kỳ.
 */
function isCurrentPeriodCall(a: unknown[]): boolean {
  const start = a.find((x): x is Date => x instanceof Date);
  return start?.getTime() === startOfVnMonth().getTime();
}

function makeConfig(values: Record<string, unknown> = {}): SystemConfigService {
  return {
    get: async <T>(key: string, fallback?: T): Promise<T> =>
      (key in values ? values[key] : fallback) as T,
  } as unknown as SystemConfigService;
}

interface GrantOpts {
  userId: string;
  reason: string;
  type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  value: number;
  minOrder?: number;
  validDays: number;
  templateCode: string;
}

describe('VouchersService.grant', () => {
  const baseOpts: GrantOpts = {
    userId: 'user123456789',
    reason: 'WELCOME',
    type: 'AMOUNT',
    value: 30000,
    minOrder: 199000,
    validDays: 30,
    templateCode: 'WELCOME_VOUCHER',
  };

  it('không cấp lại khi đã có coupon cùng reason cho user (findUnique theo code)', async () => {
    const prisma = {
      coupon: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue({ id: 'existing' }), create: jest.fn() },
    } as unknown as PrismaService;
    const notify = mockNotifier();
    const svc = new VouchersService(prisma, makeConfig(), notify);

    const result = await (svc as unknown as { grant(o: GrantOpts): Promise<boolean> }).grant(baseOpts);

    expect(result).toBe(false);
    expect((prisma.coupon.create as jest.Mock)).not.toHaveBeenCalled();
    expect((notify.notify as jest.Mock)).not.toHaveBeenCalled();
  });

  it('cấp coupon cá nhân (USER_GROUP, usageLimit 1) + code deterministic + notify', async () => {
    const prisma = {
      coupon: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const notify = mockNotifier();
    const svc = new VouchersService(prisma, makeConfig(), notify);

    const result = await (svc as unknown as { grant(o: GrantOpts): Promise<boolean> }).grant(baseOpts);

    expect(result).toBe(true);
    expect((prisma.coupon.create as jest.Mock)).toHaveBeenCalledTimes(1);
    const data = (prisma.coupon.create as jest.Mock).mock.calls[0][0].data;
    expect(data.scope).toBe('USER_GROUP');
    expect(data.usageLimit).toBe(1);
    expect(data.perUserLimit).toBe(1);
    expect(data.type).toBe('AMOUNT');
    expect(data.value).toBe(30000);
    // code deterministic theo reason + full userId (chốt idempotency qua @unique)
    expect(data.code).toBe(`WELCOME-${baseOpts.userId}`.toUpperCase());
    expect(data.scopeMeta).toMatchObject({ userId: baseOpts.userId, reason: 'WELCOME' });
    expect((notify.notify as jest.Mock)).toHaveBeenCalledWith(
      baseOpts.userId,
      'WELCOME_VOUCHER',
      // Mã giảm tiền: số tiền định dạng vi-VN như min_order_note ("giảm 30.000đ", không "giảm 30000đ").
      expect.objectContaining({ value: '30.000' }),
    );
  });

  it('endAt cố định (mã đơn thứ 2 hết hạn cùng cửa sổ 30 ngày) thay cho now + validDays', async () => {
    const prisma = {
      coupon: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const notify = mockNotifier();
    const svc = new VouchersService(prisma, makeConfig(), notify);
    const endAt = new Date('2026-11-09T03:00:00.000Z');

    await (svc as unknown as { grant(o: GrantOpts & { endAt?: Date }): Promise<boolean> }).grant({
      ...baseOpts,
      reason: 'SECOND-ORDER',
      templateCode: 'SECOND_ORDER_VOUCHER',
      endAt,
    });

    const data = (prisma.coupon.create as jest.Mock).mock.calls[0][0].data;
    expect(data.code).toBe(`SECOND-ORDER-${baseOpts.userId}`.toUpperCase());
    expect(data.endAt).toEqual(endAt);
  });

  // C-053 (A1-019): tin WELCOME_VOUCHER không nói đơn tối thiểu 199.000đ → khách mở app thấy mã không dùng được.
  it('notify kèm min_order_note có đơn tối thiểu (định dạng vi-VN) để mẫu tin nói rõ điều kiện dùng', async () => {
    const prisma = {
      coupon: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const notify = mockNotifier();
    const svc = new VouchersService(prisma, makeConfig(), notify);

    await (svc as unknown as { grant(o: GrantOpts): Promise<boolean> }).grant(baseOpts);

    expect((notify.notify as jest.Mock)).toHaveBeenCalledWith(
      baseOpts.userId,
      'WELCOME_VOUCHER',
      expect.objectContaining({ min_order_note: ' cho đơn từ 199.000đ' }),
    );
  });

  it.each([undefined, 0])('mã không có đơn tối thiểu (%p) → min_order_note rỗng, không in "đơn từ 0đ"', async (minOrder) => {
    const prisma = {
      coupon: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const notify = mockNotifier();
    const svc = new VouchersService(prisma, makeConfig(), notify);

    await (svc as unknown as { grant(o: GrantOpts): Promise<boolean> }).grant({ ...baseOpts, minOrder });

    expect((notify.notify as jest.Mock)).toHaveBeenCalledWith(
      baseOpts.userId,
      'WELCOME_VOUCHER',
      expect.objectContaining({ min_order_note: '' }),
    );
  });

  it('race multi-instance: create ném P2002 → coi như đã cấp (false), không notify', async () => {
    const prisma = {
      coupon: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' })),
      },
    } as unknown as PrismaService;
    const notify = mockNotifier();
    const svc = new VouchersService(prisma, makeConfig(), notify);

    const result = await (svc as unknown as { grant(o: GrantOpts): Promise<boolean> }).grant(baseOpts);

    expect(result).toBe(false);
    expect((notify.notify as jest.Mock)).not.toHaveBeenCalled();
  });
});

// P0 A3-05 (phần voucher sinh nhật): seed hứa Lộc Biếc 50k, Đại Thụ 150k, Cổ Thụ 300k
// (`prisma/seed.ts` TIERS[].perks) nhưng cron trước đây cấp DUY NHẤT 1 mức cho mọi hạng.
describe('VouchersService.birthdayVouchers (P0 A3-05 — theo hạng thành viên)', () => {
  function setup(rows: { id: string; tierId: string | null }[], tierAmounts: Record<string, number | null> = {}) {
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(rows),
      coupon: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), create },
      membershipTier: {
        findMany: jest.fn().mockResolvedValue(
          Object.entries(tierAmounts).map(([id, birthdayVoucherAmount]) => ({ id, birthdayVoucherAmount })),
        ),
      },
    } as unknown as PrismaService;
    const notify = mockNotifier();
    return { svc: new VouchersService(prisma, makeConfig(), notify), create, prisma };
  }

  it('hạng có mức riêng (Cổ Thụ 300k) → cấp ĐÚNG mức của hạng, không phải mức chung', async () => {
    const { svc, create } = setup([{ id: 'u1', tierId: 'CO_THU' }], { CO_THU: 300000, DAI_THU: 150000, LOC_BIEC: 50000 });
    await svc.birthdayVouchers();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.value).toBe(300000);
  });

  it('hạng Đại Thụ → 150k (khác Cổ Thụ, khác mặc định)', async () => {
    const { svc, create } = setup([{ id: 'u1', tierId: 'DAI_THU' }], { CO_THU: 300000, DAI_THU: 150000, LOC_BIEC: 50000 });
    await svc.birthdayVouchers();
    expect(create.mock.calls[0][0].data.value).toBe(150000);
  });

  it('không có hạng (tierId null) → dùng mức mặc định chung (voucher.birthday_amount, 50k)', async () => {
    const { svc, create } = setup([{ id: 'u1', tierId: null }], { CO_THU: 300000 });
    await svc.birthdayVouchers();
    expect(create.mock.calls[0][0].data.value).toBe(50000);
  });

  it('hạng chưa cấu hình mức riêng (birthdayVoucherAmount null, vd Mầm Xanh) → dùng mức mặc định chung', async () => {
    const { svc, create } = setup([{ id: 'u1', tierId: 'MAM_XANH' }], { MAM_XANH: null, CO_THU: 300000 });
    await svc.birthdayVouchers();
    expect(create.mock.calls[0][0].data.value).toBe(50000);
  });

  it('nhiều user nhiều hạng cùng ngày → mỗi người đúng mức của hạng mình', async () => {
    const { svc, create } = setup(
      [
        { id: 'u1', tierId: 'CO_THU' },
        { id: 'u2', tierId: 'LOC_BIEC' },
      ],
      { CO_THU: 300000, DAI_THU: 150000, LOC_BIEC: 50000 },
    );
    await svc.birthdayVouchers();
    expect(create).toHaveBeenCalledTimes(2);
    const byUser = Object.fromEntries(create.mock.calls.map((c) => [c[0].data.scopeMeta.userId, c[0].data.value]));
    expect(byUser['u1']).toBe(300000);
    expect(byUser['u2']).toBe(50000);
  });
});

describe('VouchersService.birthdayVouchers — xử lý từng lô song song có giới hạn', () => {
  const tierAmounts = { CO_THU: 300000, DAI_THU: 150000 };
  const tierOf = (i: number) => (i % 3 === 0 ? 'CO_THU' : i % 3 === 1 ? 'DAI_THU' : null);
  const users = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `u${String(i).padStart(3, '0')}`, tierId: tierOf(i) }));
  const expectedValue = (i: number) => (i % 3 === 0 ? 300000 : i % 3 === 1 ? 150000 : 50000);

  /** Kho coupon trong bộ nhớ: findUnique/create theo code như unique thật; đo số create đang chạy cùng lúc. */
  function setup(rows: { id: string; tierId: string | null }[], opts: { failOn?: string; alsoFailOn?: string } = {}) {
    const store = new Map<string, { code: string; value: number }>();
    let inFlight = 0;
    let maxInFlight = 0;
    const create = jest.fn(async ({ data }: { data: { code: string; value: number; scopeMeta: { userId: string } } }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (opts.failOn && data.scopeMeta.userId === opts.failOn) throw new Error('db down');
      if (opts.alsoFailOn && data.scopeMeta.userId === opts.alsoFailOn) throw new Error('db down 2');
      store.set(data.code, { code: data.code, value: data.value });
      return {};
    });
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(rows),
      coupon: { findUnique: jest.fn(async ({ where }: { where: { code: string } }) => store.get(where.code) ?? null), create },
      membershipTier: {
        findMany: jest.fn().mockResolvedValue(Object.entries(tierAmounts).map(([id, birthdayVoucherAmount]) => ({ id, birthdayVoucherAmount }))),
      },
    } as unknown as PrismaService;
    const notify = mockNotifier();
    const svc = new VouchersService(prisma, makeConfig(), notify);
    const logger = jest.spyOn((svc as unknown as { logger: { log: () => void; error: () => void } }).logger, 'log').mockImplementation(() => undefined);
    const errLogger = jest.spyOn((svc as unknown as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => undefined);
    return { svc, create, store, logger, errLogger, maxInFlight: () => maxInFlight };
  }

  it('25 user: cùng tập coupon và mức theo hạng như xử lý tuần tự, số "granted" đúng, đồng thời tối đa 10', async () => {
    const { svc, store, logger, maxInFlight } = setup(users(25));
    await svc.birthdayVouchers();
    expect(store.size).toBe(25);
    const reason = /^BIRTHDAY-\d{4}-\d{2}-/;
    users(25).forEach((u, i) => {
      const c = [...store.values()].find((x) => x.code.endsWith(u.id.toUpperCase()));
      expect(c?.code).toMatch(reason);
      expect(c?.value).toBe(expectedValue(i));
    });
    expect(logger).toHaveBeenCalledWith('Birthday vouchers granted: 25');
    expect(maxInFlight()).toBeGreaterThan(1);
    expect(maxInFlight()).toBeLessThanOrEqual(10);
  });

  it('chạy lại: không tạo thêm coupon, không log granted', async () => {
    const { svc, create, store, logger } = setup(users(25));
    await svc.birthdayVouchers();
    create.mockClear();
    logger.mockClear();
    await svc.birthdayVouchers();
    expect(create).not.toHaveBeenCalled();
    expect(store.size).toBe(25);
    expect(logger).not.toHaveBeenCalled();
  });

  it('một grant lỗi ở lô đầu: các lô sau vẫn được cấp, số granted đúng, log user lỗi + một dòng tổng kết', async () => {
    const { svc, store, logger, errLogger } = setup(users(35), { failOn: 'u002' });
    await svc.birthdayVouchers();
    expect(store.size).toBe(34);
    expect([...store.keys()].some((k) => k.endsWith('U034'))).toBe(true);
    expect([...store.keys()].some((k) => k.endsWith('U002'))).toBe(false);
    expect(logger).toHaveBeenCalledWith('Birthday vouchers granted: 34');
    expect(errLogger).toHaveBeenCalledWith('birthdayVouchers lỗi cấp cho user u002: db down');
    const summaries = errLogger.mock.calls.filter((c) => String((c as unknown[])[0]).startsWith('birthdayVouchers lỗi: '));
    expect(summaries).toHaveLength(1);
    expect(String((summaries[0] as unknown[])[0])).toContain('1 lượt cấp thất bại, 34 đã cấp');
  });

  it('nhiều grant lỗi: log từng user tối đa 20 dòng, tổng kết đếm đủ, phần còn lại vẫn cấp', async () => {
    const rows = users(60);
    const { svc, store, errLogger } = setup(rows, { failOn: 'u001', alsoFailOn: 'u015' });
    await svc.birthdayVouchers();
    expect(store.size).toBe(58);
    expect(errLogger.mock.calls.some((c) => String((c as unknown[])[0]).includes('user u015: db down 2'))).toBe(true);
    expect(errLogger.mock.calls.filter((c) => String((c as unknown[])[0]).includes('lỗi cấp cho user'))).toHaveLength(2);
  });
});

/** Welcome/winback dùng cùng mẫu lô song song có giới hạn như birthday. */
describe.each([
  ['welcomeVouchers', 'WELCOME', 'Welcome vouchers granted'],
  ['winbackVouchers', 'WINBACK', 'Win-back vouchers granted'],
] as const)('VouchersService.%s — xử lý từng lô song song có giới hạn', (method, prefix, logPrefix) => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${String(i).padStart(3, '0')}`);

  function setup(rows: string[], opts: { failOn?: string; alsoFailOn?: string; failAll?: boolean } = {}) {
    const store = new Map<string, { code: string; value: number }>();
    let inFlight = 0;
    let maxInFlight = 0;
    const create = jest.fn(async ({ data }: { data: { code: string; value: number; scopeMeta: { userId: string } } }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (opts.failAll || (opts.failOn && data.scopeMeta.userId === opts.failOn)) throw new Error('db down');
      if (opts.alsoFailOn && data.scopeMeta.userId === opts.alsoFailOn) throw new Error('db down 2');
      store.set(data.code, { code: data.code, value: data.value });
      return {};
    });
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValueOnce(rows.map((id) => ({ id }))).mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValueOnce(rows.map((userId) => ({ userId }))).mockResolvedValue([]),
      coupon: { findUnique: jest.fn(async ({ where }: { where: { code: string } }) => store.get(where.code) ?? null), create },
    } as unknown as PrismaService;
    const notify = mockNotifier();
    const svc = new VouchersService(prisma, makeConfig(), notify);
    const log = jest.spyOn((svc as unknown as { logger: { log: () => void } }).logger, 'log').mockImplementation(() => undefined);
    const err = jest.spyOn((svc as unknown as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => undefined);
    return { svc, store, log, err, maxInFlight: () => maxInFlight };
  }

  it('25 user: cùng tập coupon, số granted đúng, đồng thời tối đa 10', async () => {
    const { svc, store, log, maxInFlight } = setup(ids(25));
    await svc[method]();
    expect(store.size).toBe(25);
    for (const id of ids(25)) expect([...store.keys()].some((k) => k.startsWith(`${prefix}-`) && k.endsWith(id.toUpperCase()))).toBe(true);
    expect(log).toHaveBeenCalledWith(`${logPrefix}: 25${method === 'welcomeVouchers' ? '/25 user trong cửa sổ 24h.' : ''}`);
    expect(maxInFlight()).toBeGreaterThan(1);
    expect(maxInFlight()).toBeLessThanOrEqual(10);
  });

  it('một grant lỗi ở lô đầu: các lô sau vẫn được cấp, một dòng tổng kết, số granted đúng', async () => {
    const { svc, store, log, err } = setup(ids(35), { failOn: 'u002' });
    await svc[method]();
    expect(store.size).toBe(34);
    expect([...store.keys()].some((k) => k.endsWith('U034'))).toBe(true);
    expect(log).toHaveBeenCalledWith(`${logPrefix}: 34${method === 'welcomeVouchers' ? '/35 user trong cửa sổ 24h.' : ''}`);
    expect(err).toHaveBeenCalledWith(`${method} lỗi cấp cho user u002: db down`);
    const summaries = err.mock.calls.filter((c) => String((c as unknown[])[0]).startsWith(`${method} lỗi: `));
    expect(summaries).toHaveLength(1);
    expect(String((summaries[0] as unknown[])[0])).toContain('1 lượt cấp thất bại, 34 đã cấp');
  });

  it('trên 20 lỗi: chỉ log 20 dòng từng user, tổng kết đếm đủ', async () => {
    const { svc, err } = setup(ids(40), { failOn: 'u000', failAll: true });
    await svc[method]();
    expect(err.mock.calls.filter((c) => String((c as unknown[])[0]).includes('lỗi cấp cho user'))).toHaveLength(20);
    const summary = err.mock.calls.map((c) => String((c as unknown[])[0])).find((m) => m.startsWith(`${method} lỗi: `));
    expect(summary).toContain('40 lượt cấp thất bại, 0 đã cấp');
  });
});

/** Kho coupon trong bộ nhớ: findUnique/create theo code như unique thật; đo số create đang chạy cùng lúc. */
function makeCouponStore(opts: { failOn?: string[]; failAll?: boolean } = {}) {
  const store = new Map<string, { code: string; value: number; endAt: Date; scopeMeta: { userId: string; reason?: string } }>();
  let inFlight = 0;
  let maxInFlight = 0;
  const create = jest.fn(async ({ data }: { data: { code: string; value: number; endAt: Date; scopeMeta: { userId: string } } }) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    if (opts.failAll || opts.failOn?.includes(data.scopeMeta.userId)) throw new Error(`db down ${data.scopeMeta.userId}`);
    store.set(data.code, { code: data.code, value: data.value, endAt: data.endAt, scopeMeta: (data as { scopeMeta: { userId: string; reason?: string } }).scopeMeta });
    return {};
  });
  const coupon = {
    findUnique: jest.fn(async ({ where }: { where: { code: string } }) => store.get(where.code) ?? null),
    create,
  };
  // Mô phỏng câu raw của milestoneReceived: tham số là [hậu tố kỳ, id đã đọc tới, cỡ trang], như SQL thật lọc theo hậu tố reason.
  const receivedRows = ([suffix, after, take]: unknown[]) =>
    [...store.values()]
      .filter((c) => c.code.startsWith('MILESTONE') && String(c.scopeMeta.reason ?? '').endsWith(String(suffix)))
      .map((c, i) => ({ id: `id${String(i).padStart(6, '0')}`, code: c.code, value: c.value, scopeMeta: c.scopeMeta }))
      .filter((r) => r.id > String(after))
      .slice(0, Number(take));
  return { store, create, coupon, receivedRows, maxInFlight: () => maxInFlight };
}

const isReceivedSql = (s: TemplateStringsArray) => s.join('?').includes("LIKE 'MILESTONE%'");
type RawMock = (s: TemplateStringsArray, ...a: unknown[]) => Promise<unknown>;
/** Câu đọc voucher mốc đã cấp đi qua $queryRaw cùng câu chi tiêu; tách theo nội dung SQL. */
function withMilestoneReceived(k: { receivedRows: (a: unknown[]) => unknown[] }, base: RawMock): RawMock {
  return async (s, ...a) => (isReceivedSql(s) ? k.receivedRows(a) : base(s, ...a));
}

function spyLoggers(svc: VouchersService) {
  const logger = (svc as unknown as { logger: { log: () => void; error: () => void } }).logger;
  return {
    log: jest.spyOn(logger, 'log').mockImplementation(() => undefined),
    err: jest.spyOn(logger, 'error').mockImplementation(() => undefined),
  };
}

describe('VouchersService.milestoneVouchers — xử lý từng lô song song có giới hạn', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${String(i).padStart(3, '0')}`);

  function setup(rows: { userId: string; spent: bigint }[], opts: { failOn?: string[]; failAll?: boolean } = {}) {
    const k = makeCouponStore(opts);
    const queryRaw = jest.fn(async (_s: TemplateStringsArray, ...a: unknown[]) => (isCurrentPeriodCall(a) ? rows : []));
    const prisma = { $queryRaw: withMilestoneReceived(k, queryRaw), coupon: k.coupon } as unknown as PrismaService;
    const notify = mockNotifier();
    const svc = new VouchersService(prisma, makeConfig(), notify);
    return { svc, ...k, ...spyLoggers(svc) };
  }
  // u%3==0 → 5tr (200k), ==1 → 3tr (100k), ==2 → 1tr (30k); cứ 7 người có 1 người dưới mốc thấp nhất.
  const spentOf = (i: number) => BigInt(i % 7 === 6 ? 500_000 : i % 3 === 0 ? 6_000_000 : i % 3 === 1 ? 3_500_000 : 1_200_000);
  const valueOf = (i: number) => (i % 7 === 6 ? null : i % 3 === 0 ? 200_000 : i % 3 === 1 ? 100_000 : 30_000);
  const rowsOf = (n: number) => ids(n).map((userId, i) => ({ userId, spent: spentOf(i) }));

  it('25 user: mỗi người đạt mốc nhận đúng một coupon đúng mức, người dưới mốc không nhận, số granted đúng, đồng thời tối đa 10', async () => {
    const { svc, store, log, maxInFlight } = setup(rowsOf(25));
    await svc.milestoneVouchers();
    const expected = ids(25).map((id, i) => ({ id, v: valueOf(i) })).filter((x) => x.v !== null);
    expect(store.size).toBe(expected.length);
    for (const { id, v } of expected) {
      const c = [...store.values()].find((x) => x.code.endsWith(id.toUpperCase()));
      expect(c?.code).toMatch(/^MILESTONE\d+-\d{4}-\d{2}-/);
      expect(c?.value).toBe(v);
    }
    expect(log).toHaveBeenCalledWith(`Milestone vouchers granted: ${expected.length}`);
    expect(maxInFlight()).toBeGreaterThan(1);
    expect(maxInFlight()).toBeLessThanOrEqual(10);
  });

  it('một grant lỗi ở lô đầu: các lô sau vẫn được cấp, số granted đúng, log user lỗi + một dòng tổng kết', async () => {
    const rows = ids(35).map((userId) => ({ userId, spent: BigInt(3_500_000) }));
    const { svc, store, log, err } = setup(rows, { failOn: ['u002'] });
    await svc.milestoneVouchers();
    expect(store.size).toBe(34);
    expect([...store.keys()].some((k) => k.endsWith('U034'))).toBe(true);
    expect([...store.keys()].some((k) => k.endsWith('U002'))).toBe(false);
    expect(log).toHaveBeenCalledWith('Milestone vouchers granted: 34');
    expect(err).toHaveBeenCalledWith('milestoneVouchers lỗi cấp cho user u002: db down u002');
    const summaries = err.mock.calls.filter((c) => String((c as unknown[])[0]).startsWith('milestoneVouchers lỗi: '));
    expect(summaries).toHaveLength(1);
    expect(String((summaries[0] as unknown[])[0])).toContain('1 lượt cấp thất bại, 34 đã cấp');
  });

  it('trên 20 lỗi: chỉ log 20 dòng từng user, tổng kết đếm đủ', async () => {
    const rows = ids(40).map((userId) => ({ userId, spent: BigInt(3_500_000) }));
    const { svc, err } = setup(rows, { failAll: true });
    await svc.milestoneVouchers();
    expect(err.mock.calls.filter((c) => String((c as unknown[])[0]).includes('lỗi cấp cho user'))).toHaveLength(20);
    const summary = err.mock.calls.map((c) => String((c as unknown[])[0])).find((m) => m.startsWith('milestoneVouchers lỗi: '));
    expect(summary).toContain('40 lượt cấp thất bại, 0 đã cấp');
  });
});

describe('VouchersService.secondOrderVouchers — xử lý từng lô song song có giới hạn', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${String(i).padStart(3, '0')}`);
  const FIRST_AT = new Date('2026-10-01T03:00:00Z');
  const statics = VouchersService as unknown as { SECOND_ORDER_PAGE: number };
  const originalPage = statics.SECOND_ORDER_PAGE;
  afterEach(() => {
    statics.SECOND_ORDER_PAGE = originalPage;
  });

  /** Mỗi lần gọi $queryRaw trả một trang theo cursor (giống keyset thật: userId > cursor, tối đa SECOND_ORDER_PAGE dòng). */
  function setup(userIds: string[], opts: { failOn?: string[]; failAll?: boolean } = {}) {
    const k = makeCouponStore(opts);
    const cursors: string[] = [];
    const pageQuery = jest.fn(async (_s: TemplateStringsArray, ...args: unknown[]) => {
      const cursor = args.find((a): a is string => typeof a === 'string') ?? '';
      cursors.push(cursor);
      return userIds.filter((id) => id > cursor).slice(0, statics.SECOND_ORDER_PAGE).map((userId) => ({ userId, firstAt: FIRST_AT }));
    });
    (runExclusive as jest.Mock).mockImplementation(holdsLease(true));
    const prisma = {
      $queryRaw: pageQuery,
      coupon: k.coupon,
    } as unknown as PrismaService;
    const notify = mockNotifier();
    const svc = new VouchersService(prisma, makeConfig(), notify);
    return { svc, cursors, pageQuery, ...k, ...spyLoggers(svc) };
  }

  it('25 khách: mọi người nhận đúng một mã SECOND-ORDER hạn theo đơn đầu, granted/scanned đúng, đồng thời tối đa 10', async () => {
    const { svc, store, log, maxInFlight } = setup(ids(25));
    const result = await svc.secondOrderVouchers();
    expect(result).toEqual({ granted: 25, scanned: 25 });
    expect(store.size).toBe(25);
    for (const id of ids(25)) {
      const c = store.get(`SECOND-ORDER-${id}`.toUpperCase());
      expect(c?.value).toBe(30000);
      expect(c?.endAt.toISOString()).toBe(new Date(FIRST_AT.getTime() + 30 * 864e5).toISOString());
    }
    expect(log).toHaveBeenCalledWith('Second-order vouchers granted: 25/25');
    expect(maxInFlight()).toBeGreaterThan(1);
    expect(maxInFlight()).toBeLessThanOrEqual(10);
  });

  it('phân trang keyset vẫn chạy hết các trang, mỗi trang xử lý trọn trước khi sang trang sau', async () => {
    statics.SECOND_ORDER_PAGE = 12;
    const { svc, store, cursors } = setup(ids(29));
    const result = await svc.secondOrderVouchers();
    expect(result).toEqual({ granted: 29, scanned: 29 });
    expect(store.size).toBe(29);
    expect(cursors).toEqual(['', 'u011', 'u023']);
  });

  it('một grant lỗi: các lô và trang sau vẫn được cấp, không ném, granted đếm đúng, log user lỗi + một dòng tổng kết', async () => {
    statics.SECOND_ORDER_PAGE = 20;
    const { svc, store, log, err } = setup(ids(35), { failOn: ['u002'] });
    const result = await svc.secondOrderVouchers();
    expect(result).toEqual({ granted: 34, scanned: 35 });
    expect(store.size).toBe(34);
    expect([...store.keys()].some((k) => k.endsWith('U034'))).toBe(true);
    expect(log).toHaveBeenCalledWith('Second-order vouchers granted: 34/35');
    expect(err).toHaveBeenCalledWith('secondOrderVouchers lỗi cấp cho user u002: db down u002');
    const summaries = err.mock.calls.filter((c) => String((c as unknown[])[0]).startsWith('secondOrderVouchers lỗi: '));
    expect(summaries).toHaveLength(1);
    expect(String((summaries[0] as unknown[])[0])).toContain('1 lượt cấp thất bại, 34 đã cấp');
  });

  it('trên 20 lỗi: chỉ log 20 dòng từng user, tổng kết đếm đủ, kết quả vẫn là số liệu (không skipped)', async () => {
    const { svc, err } = setup(ids(40), { failAll: true });
    const result = await svc.secondOrderVouchers();
    expect(result).toEqual({ granted: 0, scanned: 40 });
    expect(err.mock.calls.filter((c) => String((c as unknown[])[0]).includes('lỗi cấp cho user'))).toHaveLength(20);
    const summary = err.mock.calls.map((c) => String((c as unknown[])[0])).find((m) => m.startsWith('secondOrderVouchers lỗi: '));
    expect(summary).toContain('40 lượt cấp thất bại, 0 đã cấp');
  });
});

describe('VouchersService.milestoneVouchers (§6.6)', () => {
  function setup(rows: { userId: string; spent: bigint }[]) {
    const create = jest.fn().mockResolvedValue({});
    const queryRaw = jest.fn(async (_s: TemplateStringsArray, ...a: unknown[]) => (isCurrentPeriodCall(a) ? rows : []));
    const prisma = {
      $queryRaw: queryRaw,
      coupon: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), create },
    } as unknown as PrismaService;
    const notify = mockNotifier();
    return { svc: new VouchersService(prisma, makeConfig(), notify), create, prisma };
  }

  it('cấp voucher mốc CAO NHẤT đạt được (3tr → 100k)', async () => {
    const { svc, create } = setup([{ userId: 'u1', spent: BigInt(3_500_000) }]);
    await svc.milestoneVouchers();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.value).toBe(100000); // mốc 3tr
  });

  it('chi tiêu dưới mốc thấp nhất (1tr) → không cấp', async () => {
    const { svc, create } = setup([{ userId: 'u1', spent: BigInt(500_000) }]);
    await svc.milestoneVouchers();
    expect(create).not.toHaveBeenCalled();
  });

  it('đạt mốc cao nhất (5tr → 200k)', async () => {
    const { svc, create } = setup([{ userId: 'u1', spent: BigInt(6_000_000) }]);
    await svc.milestoneVouchers();
    expect(create.mock.calls[0][0].data.value).toBe(200000);
  });

  // P2 (docs/2026-09-08-review-progress.md): cửa sổ tính là 30 ngày TRƯỢT nhưng khoá
  // idempotency lại theo THÁNG DƯƠNG LỊCH (`MILESTONE<spend>-yyyy-mm`). Cùng một lần chi tiêu
  // nằm trong 30 ngày trượt sẽ sinh khoá khác khi sang tháng mới → cấp voucher LẦN 2 cho đúng
  // số tiền đó. Phải cho 2 thứ dùng CHUNG một mốc thời gian: gom theo tháng dương lịch.
  it('gom chi tiêu theo THÁNG DƯƠNG LỊCH (giờ VN), không phải 30 ngày trượt: 3 kỳ tháng trước rồi kỳ tháng này', async () => {
    const { svc, prisma } = setup([{ userId: 'u1', spent: BigInt(3_500_000) }]);
    jest.useFakeTimers().setSystemTime(new Date('2026-10-05T03:00:00Z')); // 10:00 ngày 5/10 giờ VN
    try {
      await svc.milestoneVouchers();
    } finally {
      jest.useRealTimers();
    }
    // Mốc đầu tháng theo giờ VN: 1/9 = 2026-08-31T17:00:00Z, 1/10 = 2026-09-30T17:00:00Z, 1/11 = 2026-10-31T17:00:00Z.
    const dates = queryDates(prisma);
    expect(dates.map((d) => d.slice(0, 2).map((x) => x.toISOString()))).toEqual([
      ['2026-06-30T17:00:00.000Z', '2026-07-31T17:00:00.000Z'],
      ['2026-07-31T17:00:00.000Z', '2026-08-31T17:00:00.000Z'],
      ['2026-08-31T17:00:00.000Z', '2026-09-30T17:00:00.000Z'],
      ['2026-09-30T17:00:00.000Z', '2026-10-31T17:00:00.000Z'],
    ]);
  });

  it('chỉ tính đơn đã giao quá hạn đổi/trả: mốc deliveredBefore = now - returns.window_days (mặc định 7)', async () => {
    const { svc, prisma } = setup([]);
    jest.useFakeTimers().setSystemTime(new Date('2026-10-20T03:00:00Z'));
    try {
      await svc.milestoneVouchers();
    } finally {
      jest.useRealTimers();
    }
    expect(queryDates(prisma)[3]![2]!.toISOString()).toBe('2026-10-13T03:00:00.000Z');
  });

  it('quét kỳ cách 2 tháng: đơn tạo 28/9 đủ điều kiện sau 4/11 vẫn được cấp, mã mang khoá 2026-09', async () => {
    const create = jest.fn().mockResolvedValue({});
    const queryRaw = jest.fn(async (s: TemplateStringsArray, ...a: unknown[]) => {
      if (isReceivedSql(s)) return [];
      const start = a.find((x): x is Date => x instanceof Date)!;
      return start.toISOString() === '2026-08-31T17:00:00.000Z' ? [{ userId: 'u1', spent: BigInt(1_200_000) }] : [];
    });
    const prisma = { $queryRaw: queryRaw, coupon: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), create } } as unknown as PrismaService;
    const notify = mockNotifier();
    jest.useFakeTimers().setSystemTime(new Date('2026-11-05T03:00:00Z'));
    try {
      await new VouchersService(prisma, makeConfig(), notify).milestoneVouchers();
    } finally {
      jest.useRealTimers();
    }
    expect(create).toHaveBeenCalledTimes(1);
    expect(String(create.mock.calls[0][0].data.code)).toContain('MILESTONE1000000-2026-09-');
  });

  it('đơn của kỳ tháng trước cấp mã mang khoá tháng trước (không dán nhãn tháng này)', async () => {
    const create = jest.fn().mockResolvedValue({});
    const queryRaw = jest.fn(async (s: TemplateStringsArray, ...a: unknown[]) => {
      if (isReceivedSql(s)) return [];
      const start = a.find((x): x is Date => x instanceof Date)!;
      return start.toISOString() === '2026-08-31T17:00:00.000Z' ? [{ userId: 'u1', spent: BigInt(5_500_000) }] : [];
    });
    const prisma = { $queryRaw: queryRaw, coupon: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), create } } as unknown as PrismaService;
    const notify = mockNotifier();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-08T03:00:00Z'));
    try {
      await new VouchersService(prisma, makeConfig(), notify).milestoneVouchers();
    } finally {
      jest.useRealTimers();
    }
    expect(create).toHaveBeenCalledTimes(1);
    expect(String(create.mock.calls[0][0].data.code)).toContain('MILESTONE5000000-2026-09-');
  });

  it('khoá idempotency vẫn theo tháng → cùng tháng chỉ cấp 1 lần (grant trả false lần 2)', async () => {
    const { svc, create, prisma } = setup([{ userId: 'u1', spent: BigInt(3_500_000) }]);
    // Ghim giữa tháng: đồng hồ thật lúc 17:00–24:00 UTC ngày cuối tháng đã sang tháng sau theo giờ VN mà ISO UTC chưa.
    jest.useFakeTimers().setSystemTime(new Date('2026-10-15T03:00:00Z'));
    try {
      await svc.milestoneVouchers();
      const reason = create.mock.calls[0][0].data.scopeMeta?.reason ?? create.mock.calls[0][0].data.code;
      expect(String(reason)).toContain('2026-10');
      // Lần 2 trong cùng tháng: coupon đã tồn tại → grant() bail, không tạo thêm.
      (prisma.coupon.findUnique as jest.Mock).mockResolvedValue({ id: 'c1' });
      create.mockClear();
      await svc.milestoneVouchers();
      expect(create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('VouchersService.milestoneVouchers — bù chênh lệch bậc trong cùng tháng (L2-05)', () => {
  function setup(spent: { value: bigint }) {
    const k = makeCouponStore();
    const queryRaw = jest.fn(async (s: TemplateStringsArray, ...a: unknown[]) => {
      if (isReceivedSql(s)) return [];
      const start = a.find((x): x is Date => x instanceof Date)!;
      return start.getTime() === startOfVnMonth(new Date(Date.now())).getTime() ? [{ userId: 'u1', spent: spent.value }] : [];
    });
    const prisma = { $queryRaw: withMilestoneReceived(k, queryRaw), coupon: k.coupon } as unknown as PrismaService;
    const svc = new VouchersService(prisma, makeConfig(), mockNotifier());
    spyLoggers(svc);
    const values = () => [...k.store.values()].map((c) => c.value).sort((a, b) => a - b);
    return { svc, values, store: k.store };
  }

  // Chỉ giả Date: coupon store giả dùng setTimeout thật để mô phỏng độ trễ.
  const pinTime = (iso: string) => jest.useFakeTimers({ now: new Date(iso), doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });
  afterEach(() => jest.useRealTimers());

  it('1tr rồi 3tr trong cùng tháng: 30k rồi thêm 70k (tổng 100k), chạy lại không cấp thêm', async () => {
    pinTime('2026-10-15T03:00:00Z');
    const spent = { value: BigInt(1_200_000) };
    const { svc, values } = setup(spent);
    await svc.milestoneVouchers();
    expect(values()).toEqual([30_000]);
    spent.value = BigInt(3_500_000);
    await svc.milestoneVouchers();
    expect(values()).toEqual([30_000, 70_000]);
    await svc.milestoneVouchers();
    expect(values()).toEqual([30_000, 70_000]);
  });

  it('đạt 3tr ngay từ đầu: một voucher 100k', async () => {
    pinTime('2026-10-15T03:00:00Z');
    const { svc, values } = setup({ value: BigInt(3_500_000) });
    await svc.milestoneVouchers();
    expect(values()).toEqual([100_000]);
  });

  it('1tr, 3tr rồi 5tr: 30k + 70k + 100k = 200k; mã vẫn duy nhất theo (bậc, tháng)', async () => {
    pinTime('2026-10-15T03:00:00Z');
    const spent = { value: BigInt(1_200_000) };
    const { svc, values, store } = setup(spent);
    for (const v of [1_200_000, 3_500_000, 6_000_000]) {
      spent.value = BigInt(v);
      await svc.milestoneVouchers();
    }
    expect(values()).toEqual([30_000, 70_000, 100_000]);
    expect(store.size).toBe(3);
    expect([...store.keys()].every((c) => /^MILESTONE\d+-2026-10-U1$/.test(c))).toBe(true);
  });

  it('chi tiêu rớt về bậc thấp sau khi đã nhận bậc cao (trả hàng): không cấp thêm bậc thấp', async () => {
    pinTime('2026-10-15T03:00:00Z');
    const spent = { value: BigInt(3_500_000) };
    const { svc, values } = setup(spent);
    await svc.milestoneVouchers();
    spent.value = BigInt(1_200_000);
    await svc.milestoneVouchers();
    expect(values()).toEqual([100_000]);
  });

  it('m2: admin đổi bậc 3tr thành 2,5tr sau khi đã cấp 100k → không cấp thêm (đã nhận tính theo coupon đã cấp, không theo cấu hình)', async () => {
    pinTime('2026-10-15T03:00:00Z');
    const k = makeCouponStore();
    const queryRaw = jest.fn(async (s: TemplateStringsArray, ...a: unknown[]) => {
      if (isReceivedSql(s)) return [];
      const start = a.find((x): x is Date => x instanceof Date)!;
      return start.getTime() === startOfVnMonth(new Date(Date.now())).getTime() ? [{ userId: 'u1', spent: BigInt(3_500_000) }] : [];
    });
    const prisma = { $queryRaw: withMilestoneReceived(k, queryRaw), coupon: k.coupon } as unknown as PrismaService;
    const oldCfg = makeConfig();
    await new VouchersService(prisma, oldCfg, mockNotifier()).milestoneVouchers();
    expect([...k.store.values()].map((c) => c.value)).toEqual([100_000]);
    const newCfg = makeConfig({ 'voucher.milestones': [{ spend: 1_000_000, reward: 30_000 }, { spend: 2_500_000, reward: 100_000 }, { spend: 5_000_000, reward: 200_000 }] });
    await new VouchersService(prisma, newCfg, mockNotifier()).milestoneVouchers();
    expect([...k.store.values()].map((c) => c.value)).toEqual([100_000]);
  });

  it('sang tháng sau tính lại từ đầu: đạt 1tr tháng mới vẫn nhận đủ 30k', async () => {
    pinTime('2026-10-15T03:00:00Z');
    const spent = { value: BigInt(3_500_000) };
    const { svc, values } = setup(spent);
    await svc.milestoneVouchers();
    jest.setSystemTime(new Date('2026-11-15T03:00:00Z'));
    spent.value = BigInt(1_200_000);
    await svc.milestoneVouchers();
    expect(values()).toEqual([30_000, 100_000]);
  });
});

describe('VouchersService.milestoneVouchers — phân trang keyset, không bỏ sót khách ngoài trang đầu', () => {
  const statics = VouchersService as unknown as { MILESTONE_PAGE: number };
  const originalPage = statics.MILESTONE_PAGE;
  afterEach(() => {
    statics.MILESTONE_PAGE = originalPage;
  });
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${String(i).padStart(3, '0')}`);

  /** Mỗi lần gọi $queryRaw trả một trang theo cursor (userId > cursor, tối đa MILESTONE_PAGE dòng), như SQL thật. */
  function setup(userIds: string[], config: Record<string, unknown> = {}, createImpl?: jest.Mock) {
    const create = createImpl ?? jest.fn().mockResolvedValue({});
    const args: unknown[][] = [];
    const queryRaw = jest.fn(async (s: TemplateStringsArray, ...a: unknown[]) => {
      if (isReceivedSql(s)) return [];
      if (!isCurrentPeriodCall(a)) return [];
      args.push(a);
      const cursor = a.find((x): x is string => typeof x === 'string') ?? '';
      return userIds.filter((id) => id > cursor).slice(0, statics.MILESTONE_PAGE).map((userId) => ({ userId, spent: BigInt(3_500_000) }));
    });
    const prisma = { $queryRaw: queryRaw, coupon: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), create } } as unknown as PrismaService;
    const notify = mockNotifier();
    const svc = new VouchersService(prisma, makeConfig(config), notify);
    return { svc, create, queryRaw, args, ...spyLoggers(svc) };
  }
  const cursorsOf = (args: unknown[][]) => args.map((a) => a.find((x) => typeof x === 'string'));

  it('29 khách, trang 12: quét đủ 3 trang theo cursor, mọi người nhận đúng một coupon', async () => {
    statics.MILESTONE_PAGE = 12;
    const { svc, create, args, log } = setup(ids(29));
    await svc.milestoneVouchers();
    expect(create).toHaveBeenCalledTimes(29);
    expect(cursorsOf(args)).toEqual(['', 'u011', 'u023']);
    expect(log).toHaveBeenCalledWith('Milestone vouchers granted: 29');
  });

  it('đúng bằng một trang đầy: gọi thêm một lượt, trang rỗng thì dừng', async () => {
    statics.MILESTONE_PAGE = 12;
    const { svc, create, args } = setup(ids(12));
    await svc.milestoneVouchers();
    expect(create).toHaveBeenCalledTimes(12);
    expect(cursorsOf(args)).toEqual(['', 'u011']);
  });

  it('mốc thấp nhất trong cấu hình được đẩy xuống SQL (HAVING) để trang không bị người dưới mốc chiếm', async () => {
    const { svc, args } = setup(ids(3), { 'voucher.milestones': [{ spend: 4_000_000, reward: 80_000 }, { spend: 2_000_000, reward: 40_000 }] });
    await svc.milestoneVouchers();
    expect(args[0]).toContain(2_000_000);
    expect(args[0]).not.toContain(4_000_000);
  });

  it('không cấu hình mốc nào: không truy vấn, không cấp', async () => {
    const { svc, create, queryRaw } = setup(ids(3), { 'voucher.milestones': [] });
    await svc.milestoneVouchers();
    expect(queryRaw).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('trùng mã giữa hai instance (P2002) tính là đã cấp: không ghi log lỗi, không đếm là thất bại', async () => {
    const create = jest.fn().mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    const { svc, err, log } = setup(ids(3), {}, create);
    await svc.milestoneVouchers();
    expect(create).toHaveBeenCalledTimes(3);
    expect(err).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});

/** Các tham số Date của từng lần gọi $queryRaw (template tag → args nằm sau mảng strings), theo thứ tự gọi. */
function queryDates(prisma: PrismaService): Date[][] {
  return ((prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw).mock.calls.filter((call: unknown[]) => !isReceivedSql(call[0] as TemplateStringsArray)).map((call: unknown[]) =>
    call.slice(1).filter((a): a is Date => a instanceof Date),
  );
}

/**
 * `grant()` trả false ngay với user đã cấp (code coupon tất định theo userId), nên một lô 200 cố
 * định phần lớn là người đã cấp từ lượt trước. Chiến dịch kéo 1.000 đăng ký trong một giờ khiến
 * 800 người mới chỉ leo lên top-200 khi lứa cũ rời cửa sổ 24h — mà cả nhóm rời gần như cùng lúc.
 * Hàng trăm khách mới không bao giờ nhận voucher, không lỗi nào được ghi.
 */
describe('VouchersService.welcomeVouchers — quét hết cửa sổ 24h', () => {
  it('1000 user mới → quét qua nhiều trang bằng cursor, không dừng ở 200', async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => ({ id: `u${String(i).padStart(4, '0')}` }));
    const findMany = jest.fn().mockImplementation(({ cursor, take }: { cursor?: { id: string }; take: number }) => {
      const start = cursor ? ids.findIndex((u) => u.id === cursor.id) + 1 : 0;
      return Promise.resolve(ids.slice(start, start + take));
    });
    const created: string[] = [];
    const prisma = {
      user: { findMany },
      coupon: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: { data: { code: string } }) => {
          created.push(data.code);
          return Promise.resolve({});
        }),
      },
      notificationLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;

    const notify = mockNotifier();
    await new VouchersService(prisma, makeConfig(), notify).welcomeVouchers();

    expect(created).toHaveLength(1000);
    expect(findMany.mock.calls.length).toBeGreaterThan(1);
  });

  it('trang cuối ngắn hơn kích thước trang → dừng, không quét vô hạn', async () => {
    const findMany = jest.fn().mockResolvedValueOnce([{ id: 'u1' }]).mockResolvedValue([]);
    const prisma = {
      user: { findMany },
      coupon: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      notificationLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;

    const notify = mockNotifier();
    await new VouchersService(prisma, makeConfig(), notify).welcomeVouchers();

    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

// C-026: cron 01:00 giờ VN = 18:00 UTC của ngày TRƯỚC. Tính "hôm nay" bằng Date local khi host chạy
// UTC thì tặng voucher sinh nhật lệch một ngày (và khoá chu kỳ sai tháng ở ranh giới tháng).
describe('VouchersService — lịch giờ VN, độc lập TZ host (C-026)', () => {
  function setup() {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      coupon: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      membershipTier: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const notify = mockNotifier();
    return { svc: new VouchersService(prisma, makeConfig(), notify), prisma };
  }

  it('birthdayVouchers lúc 01:00 ngày 10/3 giờ VN → lọc đúng tháng 3 ngày 10, không phải ngày 9', async () => {
    const { svc, prisma } = setup();
    jest.useFakeTimers().setSystemTime(new Date('2026-03-09T18:00:00Z'));
    try {
      await svc.birthdayVouchers();
    } finally {
      jest.useRealTimers();
    }
    const args = ((prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw).mock.calls[0].slice(1);
    expect(args).toContain(3);
    expect(args).toContain(10);
    expect(args).not.toContain(9);
  });

  it('birthdayVouchers lúc 01:00 ngày 1/1 giờ VN (UTC còn 31/12 năm trước) → khoá chu kỳ theo năm/tháng VN', async () => {
    const { svc, prisma } = setup();
    (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw.mockResolvedValueOnce([{ id: 'u1', tierId: null }]);
    jest.useFakeTimers().setSystemTime(new Date('2025-12-31T18:00:00Z'));
    try {
      await svc.birthdayVouchers();
    } finally {
      jest.useRealTimers();
    }
    const data = ((prisma as unknown as { coupon: { create: jest.Mock } }).coupon.create).mock.calls[0][0].data;
    expect(data.scopeMeta.reason).toBe('BIRTHDAY-2026-1');
  });

  it('winbackVouchers lúc 02:00 ngày 1/10 giờ VN → khoá theo tháng VN (2026-10), không phải 2026-09', async () => {
    const { svc, prisma } = setup();
    (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw.mockResolvedValueOnce([{ userId: 'u1' }]);
    jest.useFakeTimers().setSystemTime(new Date('2026-09-30T19:00:00Z'));
    try {
      await svc.winbackVouchers();
    } finally {
      jest.useRealTimers();
    }
    const data = ((prisma as unknown as { coupon: { create: jest.Mock } }).coupon.create).mock.calls[0][0].data;
    expect(data.scopeMeta.reason).toBe('WINBACK-2026-10');
  });
});

// D2-07a: voucher chào mừng cấp ngay khi tài khoản thật xuất hiện, cron mỗi giờ vẫn là lưới. Cả hai đi qua cùng
// grant() (code tất định WELCOME-<userId>) nên gọi trùng không tạo thêm mã.
describe('VouchersService.grantWelcomeNow', () => {
  function setup(eligible: boolean, config: Record<string, unknown> = {}) {
    const findFirst = jest.fn().mockResolvedValue(eligible ? { id: 'u1' } : null);
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      user: { findFirst },
      coupon: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), create },
    } as unknown as PrismaService;
    const notify = mockNotifier();
    return { svc: new VouchersService(prisma, makeConfig(config), notify), findFirst, create, notify };
  }

  it('user đủ điều kiện → cấp đúng mã WELCOME-<userId> với giá trị/đơn tối thiểu đọc từ cấu hình, hạn 30 ngày', async () => {
    const { svc, create, notify } = setup(true, { 'voucher.welcome_amount': 25000, 'voucher.welcome_min_order': 150000 });

    await expect(svc.grantWelcomeNow('u1')).resolves.toBe(true);

    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ code: 'WELCOME-U1', type: 'AMOUNT', value: 25000, minOrder: 150000, usageLimit: 1, perUserLimit: 1 });
    expect(data.scopeMeta).toEqual({ userId: 'u1', reason: 'WELCOME' });
    expect(Math.round((data.endAt.getTime() - data.startAt.getTime()) / 864e5)).toBe(30);
    expect(notify.notify).toHaveBeenCalledWith('u1', 'WELCOME_VOUCHER', expect.objectContaining({ value: '25.000' }));
  });

  it('giá trị mặc định khi chưa có cấu hình giống cron (30.000đ cho đơn từ 199.000đ)', async () => {
    const { svc, create } = setup(true);
    await svc.grantWelcomeNow('u1');
    expect(create.mock.calls[0][0].data).toMatchObject({ value: 30000, minOrder: 199000 });
  });

  it('điều kiện đúng như cron: khách thật, role CUSTOMER, chưa có đơn, tạo trong 24h', async () => {
    const { svc, findFirst } = setup(true);
    const before = Date.now();

    await svc.grantWelcomeNow('u1');

    const where = findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 'u1', role: 'CUSTOMER', orders: { none: {} }, OR: REAL_USER_WHERE.OR });
    const since = (where.createdAt.gte as Date).getTime();
    expect(before - since).toBeGreaterThanOrEqual(24 * 3600 * 1000 - 1000);
    expect(before - since).toBeLessThanOrEqual(24 * 3600 * 1000 + 5000);
  });

  // "Chưa có đơn" của voucher chào mừng là cùng định nghĩa với freeship đơn đầu và mã newCustomerOnly: đơn đã huỷ không tính.
  it('"chưa có đơn" dùng chung định nghĩa với hasPriorOrder: đơn huỷ không chặn voucher', async () => {
    const { svc, findFirst } = setup(true);

    await svc.grantWelcomeNow('u1');

    const where = findFirst.mock.calls[0][0].where;
    expect(where.orders).toEqual({ none: { status: { not: 'CANCELLED' } } });
    expect(priorOrderWhere('u1')).toMatchObject(where.orders.none);
  });

  it('dòng đã gộp vào tài khoản khác (mergedIntoId) không được cấp: cả đường ngay lẫn khi becameRealNow', async () => {
    const { svc, findFirst } = setup(true);

    await svc.grantWelcomeNow('u1');
    await svc.grantWelcomeNow('u1', { becameRealNow: true });

    for (const [call] of findFirst.mock.calls) expect(call.where).toMatchObject({ mergedIntoId: null });
  });

  // Khách vãng lai dùng app quá 24h rồi mới đăng nhập Zalo: createdAt là của dòng vãng lai nên cửa sổ 24h loại họ sai.
  it('becameRealNow: bỏ điều kiện createdAt, giữ nguyên mọi điều kiện còn lại', async () => {
    const { svc, findFirst, create } = setup(true);

    await expect(svc.grantWelcomeNow('u1', { becameRealNow: true })).resolves.toBe(true);

    const where = findFirst.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('createdAt');
    expect(where).toMatchObject({ id: 'u1', role: 'CUSTOMER', orders: { none: {} }, OR: REAL_USER_WHERE.OR });
    expect(create.mock.calls[0][0].data.code).toBe('WELCOME-U1');
  });

  it.each([[undefined], [{}], [{ becameRealNow: false }]])('không truyền becameRealNow (%j): vẫn giữ cửa sổ 24h như cron', async (opts) => {
    const { svc, findFirst } = setup(true);
    await svc.grantWelcomeNow('u1', opts);
    expect(findFirst.mock.calls[0][0].where.createdAt.gte).toBeInstanceOf(Date);
  });

  it('khách vãng lai / đã có đơn / quá 24h (findFirst rỗng) → không cấp, không thông báo', async () => {
    const { svc, create, notify } = setup(false);
    await expect(svc.grantWelcomeNow('u1')).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it('đã có mã (cron cấp trước) → false, không tạo thêm', async () => {
    const { svc, create } = setup(true);
    const prismaInternal = (svc as unknown as { prisma: { coupon: { findUnique: jest.Mock } } }).prisma;
    prismaInternal.coupon.findUnique.mockResolvedValue({ id: 'c1' });
    await expect(svc.grantWelcomeNow('u1')).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('VouchersService.milestoneVouchers — đọc voucher mốc đã cấp bằng biểu thức khớp index', () => {
  it('lọc right(scopeMeta->>reason, 8) và code LIKE literal, keyset theo id, không dùng ends-with', async () => {
    const calls: { sql: string; args: unknown[] }[] = [];
    const queryRaw = jest.fn(async (s: TemplateStringsArray, ...a: unknown[]) => {
      calls.push({ sql: s.join('?'), args: a });
      return [];
    });
    const svc = new VouchersService({ $queryRaw: queryRaw } as unknown as PrismaService, makeConfig(), mockNotifier());
    await (svc as unknown as { milestoneReceived(p: string): Promise<unknown> }).milestoneReceived('2026-10');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain(`code LIKE 'MILESTONE%'`);
    expect(calls[0]!.sql).toContain(`right("scopeMeta" ->> 'reason', 8) = ?`);
    expect(calls[0]!.sql).toContain('ORDER BY id');
    expect(calls[0]!.args).toEqual(['-2026-10', '', 5000]);
  });
});
