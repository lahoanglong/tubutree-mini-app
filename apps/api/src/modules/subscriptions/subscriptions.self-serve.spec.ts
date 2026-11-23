import { BadRequestException } from '@nestjs/common';
import { SubscriptionsService, nextDiscountTier, RESCHEDULE_MAX_DAYS_AHEAD } from './subscriptions.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { PricingService } from '../pricing/pricing.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';
import type { WalletLedgerService } from '../wallet/wallet-ledger.service';

const DAY = 864e5;
const WEEK = 7 * DAY;
/** 12h trưa 20/10/2026 giờ VN. */
const NOW = new Date('2026-10-20T05:00:00.000Z');
const TODAY_VN = new Date('2026-10-19T17:00:00.000Z');

const analyticsMock = () =>
  ({ record: jest.fn().mockResolvedValue(undefined), recordBestEffort: jest.fn().mockResolvedValue(undefined) }) as unknown as AnalyticsEventsService & {
    record: jest.Mock;
    recordBestEffort: jest.Mock;
  };

const TIERS = [
  { minActive: 1, pct: 0.12 },
  { minActive: 3, pct: 0.14 },
  { minActive: 5, pct: 0.15 },
];
const cfgWith = (tiers: unknown = TIERS) =>
  ({ get: async <T>(k: string, fb?: T): Promise<T> => (k === 'subscribe.discount_tiers' ? (tiers as T) : (fb as T)) }) as unknown as SystemConfigService;

function service(prisma: unknown, opts: { cfg?: SystemConfigService; applyDelta?: jest.Mock } = {}) {
  const analytics = analyticsMock();
  const notify = jest.fn().mockResolvedValue(undefined);
  const enqueuePush = jest.fn().mockResolvedValue(undefined);
  const svc = new SubscriptionsService(
    prisma as PrismaService,
    opts.cfg ?? cfgWith(),
    { calcShippingFee: jest.fn().mockResolvedValue(0), calcPointsEarned: jest.fn().mockResolvedValue(0) } as unknown as PricingService,
    { getTierMultiplier: jest.fn().mockResolvedValue(1) } as unknown as LoyaltyService,
    { notifySafe: notify } as unknown as NotificationsService,
    { enqueuePush } as unknown as PancakeOrderService,
    analytics,
    { applyDelta: opts.applyDelta ?? jest.fn().mockResolvedValue({ applied: true }) } as unknown as WalletLedgerService,
  );
  return { svc, analytics, notify, enqueuePush };
}

beforeEach(() => jest.useFakeTimers({ now: NOW }));
afterEach(() => jest.useRealTimers());

describe('nextDiscountTier', () => {
  it('bậc có ngưỡng nhỏ nhất vượt số gói đang tính và % cao hơn % đang áp', () => {
    expect(nextDiscountTier(TIERS, 1, 0.12)).toEqual({ countNeeded: 2, discountPct: 0.14 });
    expect(nextDiscountTier(TIERS, 3, 0.14)).toEqual({ countNeeded: 2, discountPct: 0.15 });
    expect(nextDiscountTier(TIERS, 4, 0.14)).toEqual({ countNeeded: 1, discountPct: 0.15 });
  });

  it('đã ở bậc cao nhất, bậc trên không cao % hơn, hay cấu hình hỏng: null', () => {
    expect(nextDiscountTier(TIERS, 5, 0.15)).toBeNull();
    expect(nextDiscountTier([{ minActive: 1, pct: 0.12 }, { minActive: 3, pct: 0.12 }], 1, 0.12)).toBeNull();
    expect(nextDiscountTier('hỏng', 1, 0.12)).toBeNull();
    expect(nextDiscountTier([null, { minActive: 2.5, pct: 0.2 }, { minActive: 4, pct: 'x' }], 1, 0.12)).toBeNull();
  });

  it('thứ tự bậc trong cấu hình không quan trọng; hai bậc cùng ngưỡng lấy % cao hơn', () => {
    expect(nextDiscountTier([{ minActive: 5, pct: 0.15 }, { minActive: 3, pct: 0.13 }, { minActive: 3, pct: 0.14 }], 1, 0.12)).toEqual({ countNeeded: 2, discountPct: 0.14 });
  });
});

describe('SubscriptionsService.list: nextTier', () => {
  function listWith(rows: { status: string }[], counted: number, tiers: unknown = TIERS) {
    const prisma = {
      subscription: {
        findMany: jest.fn().mockResolvedValue(rows.map((r, i) => ({ id: `s${i}`, variationId: 'v1', quantity: 1, intervalWeeks: 4, nextRunAt: NOW, ...r }))),
        count: jest.fn().mockResolvedValue(counted),
      },
      variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', name: 'V', salePrice: null, retailPrice: 100000, product: { name: 'P', thumbnail: null, slug: 'p' } }]) },
    };
    return service(prisma, { cfg: cfgWith(tiers) }).svc.list('u1');
  }

  it('một gói đang chạy: mọi gói cùng nói thêm 2 gói nữa để được giảm 14%', async () => {
    const rows = await listWith([{ status: 'ACTIVE' }, { status: 'PAUSED' }], 1);
    expect(rows.map((r) => r.nextTier)).toEqual([
      { countNeeded: 2, discountPct: 0.14 },
      { countNeeded: 2, discountPct: 0.14 },
    ]);
    expect(rows[0]?.effectiveDiscountPct).toBe(0.12);
  });

  it('gói chạy hẹn xa chưa được đếm: sàn 1 gói như % đang hiện, bậc kế vẫn tính từ 1', async () => {
    const [row] = await listWith([{ status: 'ACTIVE' }], 0);
    expect(row).toMatchObject({ effectiveDiscountPct: 0.12, nextTier: { countNeeded: 2, discountPct: 0.14 } });
  });

  it('chỉ còn gói tạm dừng: không nói bậc kế (bật lại một gói là có bậc)', async () => {
    const [row] = await listWith([{ status: 'PAUSED' }], 0);
    expect(row?.nextTier).toBeNull();
  });

  it('đã ở bậc cao nhất: null', async () => {
    const [row] = await listWith([{ status: 'ACTIVE' }], 6);
    expect(row).toMatchObject({ effectiveDiscountPct: 0.15, nextTier: null });
  });
});

describe('SubscriptionsService.update: dời ngày giao kỳ tới (nextRunDate)', () => {
  /** `nextRunAt` của dòng mẫu, như màn hình khách đang hiện. */
  const SEEN = new Date(NOW.getTime() + 2 * WEEK).toISOString();
  function makeUpdate(row: Record<string, unknown> = {}, lastOrderCreatedAt: Date | null = null) {
    const update = jest.fn().mockImplementation((args) => Promise.resolve({ id: 's1', ...row, ...args.data }));
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        { id: 's1', userId: 'u1', variationId: 'v1', quantity: 2, addressId: 'a1', status: 'ACTIVE', paymentMethod: 'COD', intervalWeeks: 4, lastOrderId: 'o1', nextRunAt: new Date(NOW.getTime() + 2 * WEEK), ...row },
      ]),
      variation: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', isActive: true, product: { name: 'P', isActive: true, approvalStatus: 'APPROVED' } }) },
      order: { findUnique: jest.fn().mockResolvedValue(lastOrderCreatedAt ? { createdAt: lastOrderCreatedAt } : null) },
      subscription: { update },
    };
    const $transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx));
    const { svc, analytics } = service({ $transaction });
    return { svc, update, analytics, $transaction };
  }

  it('ghi nextRunAt = 0h VN ngày đã chọn, đếm lại lượt thử từ đầu, giữ chu kỳ', async () => {
    const { svc, update } = makeUpdate({ retryCount: 2 });
    await svc.update('u1', 's1', { nextRunDate: '2026-11-03', expectedNextRunAt: SEEN });
    const data = update.mock.calls[0][0].data;
    expect((data.nextRunAt as Date).toISOString()).toBe('2026-11-02T17:00:00.000Z');
    expect(data.retryCount).toBe(0);
    expect(data.intervalWeeks).toBeUndefined();
  });

  it('ngày chọn thắng ngày do đổi chu kỳ tính ra khi gửi cả hai', async () => {
    const { svc, update } = makeUpdate({}, new Date('2026-10-10T03:00:00.000Z'));
    await svc.update('u1', 's1', { intervalWeeks: 6, nextRunDate: '2026-12-01', expectedNextRunAt: SEEN });
    const data = update.mock.calls[0][0].data;
    expect(data.intervalWeeks).toBe(6);
    expect((data.nextRunAt as Date).toISOString()).toBe('2026-11-30T17:00:00.000Z');
  });

  it('gói tạm dừng cũng dời được (bật lại giữ ngày mới)', async () => {
    const { svc, update } = makeUpdate({ status: 'PAUSED' });
    await svc.update('u1', 's1', { nextRunDate: '2026-10-21', expectedNextRunAt: SEEN });
    expect((update.mock.calls[0][0].data.nextRunAt as Date).toISOString()).toBe('2026-10-20T17:00:00.000Z');
  });

  it('ngày mai và đúng ngày thứ 90 được; hôm nay, ngày đã qua, ngày 91 hay ngày không có thật → 400 trước khi mở transaction', async () => {
    const last = new Date(NOW.getTime() + 7 * 3600e3 + RESCHEDULE_MAX_DAYS_AHEAD * DAY).toISOString().slice(0, 10);
    const after = new Date(NOW.getTime() + 7 * 3600e3 + (RESCHEDULE_MAX_DAYS_AHEAD + 1) * DAY).toISOString().slice(0, 10);
    for (const ok of ['2026-10-21', last]) {
      const { svc, update } = makeUpdate();
      await svc.update('u1', 's1', { nextRunDate: ok, expectedNextRunAt: SEEN });
      expect(update).toHaveBeenCalled();
    }
    const cases: [string, string][] = [
      ['2026-10-20', 'Đặt kỳ này ngay'],
      ['2026-10-01', 'Đặt kỳ này ngay'],
      [after, `${RESCHEDULE_MAX_DAYS_AHEAD} ngày tới`],
      ['2026-02-30', 'không hợp lệ'],
      ['20-10-2026', 'không hợp lệ'],
    ];
    for (const [date, msg] of cases) {
      const { svc, $transaction } = makeUpdate();
      await expect(svc.update('u1', 's1', { nextRunDate: date, expectedNextRunAt: SEEN })).rejects.toMatchObject({ status: 400, message: expect.stringContaining(msg) });
      expect($transaction).not.toHaveBeenCalled();
    }
  });

  it('gói đã huỷ → 400, không ghi', async () => {
    const { svc, update } = makeUpdate({ status: 'CANCELLED' });
    await expect(svc.update('u1', 's1', { nextRunDate: '2026-10-25', expectedNextRunAt: SEEN })).rejects.toThrow('đã huỷ');
    expect(update).not.toHaveBeenCalled();
  });

  it('thiếu ngày đang hiện (expectedNextRunAt) khi dời ngày → 400 trước khi mở transaction; sửa trường khác thì không cần', async () => {
    const { svc, $transaction } = makeUpdate();
    await expect(svc.update('u1', 's1', { nextRunDate: '2026-10-25' })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('tải lại') });
    await expect(svc.update('u1', 's1', { nextRunDate: '2026-10-25', expectedNextRunAt: 'hôm qua' })).rejects.toMatchObject({ status: 400 });
    expect($transaction).not.toHaveBeenCalled();
    const ok = makeUpdate();
    await ok.svc.update('u1', 's1', { quantity: 3 });
    expect(ok.update.mock.calls[0][0].data).toEqual({ quantity: 3 });
  });

  it('cron đã ra đơn kỳ khách đang thấy (nextRunAt trong DB đã sang kỳ sau) → 409, không ghi ngày mới', async () => {
    // Màn hình còn "Lần kế" = SEEN; cron 3h đã ra đơn và dời nextRunAt thêm một chu kỳ. Ghi ngày mới lúc này = đơn kỳ đó vẫn giao + thêm một đơn.
    const { svc, update } = makeUpdate({ nextRunAt: new Date(NOW.getTime() + 6 * WEEK) });
    await expect(svc.update('u1', 's1', { nextRunDate: '2026-10-25', expectedNextRunAt: SEEN })).rejects.toMatchObject({
      status: 409,
      message: 'Lịch giao vừa thay đổi, hãy tải lại rồi thử lại.',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('sự kiện updated ghi rescheduled', async () => {
    const { svc, analytics } = makeUpdate();
    await svc.update('u1', 's1', { nextRunDate: '2026-10-25', expectedNextRunAt: SEEN });
    expect(analytics.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ props: expect.objectContaining({ action: 'updated', rescheduled: true }) }));
  });
});

describe('SubscriptionsService.runNow ("Đặt kỳ này ngay")', () => {
  function makeRunNow(
    opts: {
      status?: string;
      userId?: string;
      orderToday?: unknown;
      stockCount?: number;
      paymentMethod?: string;
      applyDelta?: jest.Mock;
      orderCreateError?: unknown;
      nextRunAt?: Date;
      retryCount?: number;
    } = {},
  ) {
    const state: Record<string, unknown> = {
      id: 's1',
      userId: opts.userId ?? 'u1',
      variationId: 'v1',
      quantity: 2,
      addressId: 'a1',
      status: opts.status ?? 'ACTIVE',
      paymentMethod: opts.paymentMethod ?? 'COD',
      intervalWeeks: 4,
      nextRunAt: opts.nextRunAt ?? new Date(NOW.getTime() + 20 * DAY),
      lastOrderId: 'o0',
      retryCount: opts.retryCount ?? 0,
    };
    const subUpdate = jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
      Object.assign(state, args.data);
      return Promise.resolve({ ...state });
    });
    const orderCreate = jest.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
      opts.orderCreateError
        ? Promise.reject(opts.orderCreateError)
        : Promise.resolve({ id: 'o1', code: args.data.code, status: args.data.status, paymentMethod: args.data.paymentMethod, total: args.data.total, createdAt: NOW }),
    );
    const orderFindFirst = jest.fn().mockResolvedValue(opts.orderToday ?? null);
    const tx = {
      $queryRaw: jest.fn().mockImplementation(() => Promise.resolve([{ ...state }])),
      $executeRaw: jest.fn().mockResolvedValue(opts.stockCount ?? 1),
      subscription: { update: subUpdate, count: jest.fn().mockResolvedValue(1) },
      variation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'v1',
          pancakeId: 'pv1',
          isActive: true,
          salePrice: null,
          retailPrice: 100000,
          name: 'V',
          product: { name: 'Nước giặt', slug: 'nuoc-giat', isActive: true, approvalStatus: 'APPROVED', storefrontId: null },
        }),
        findMany: jest.fn().mockResolvedValue([{ id: 'v1' }]),
      },
      address: {
        findUnique: jest.fn().mockResolvedValue({ id: 'a1', userId: 'u1', recipient: 'R', phone: '09', province: 'p', district: 'd', ward: 'w', street: 's', provinceCode: '1', districtCode: '2', wardCode: '3' }),
      },
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', tierId: null }) },
      order: { create: orderCreate, findFirst: orderFindFirst, findUnique: jest.fn().mockResolvedValue(null) },
    };
    const $transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx));
    const prisma = {
      $transaction,
      order: { findUnique: jest.fn().mockResolvedValue(null) },
      subscription: { findUniqueOrThrow: jest.fn().mockImplementation(() => Promise.resolve({ ...state })) },
    };
    const built = service(prisma, { applyDelta: opts.applyDelta });
    return { ...built, state, subUpdate, orderCreate, orderFindFirst, tx };
  }

  it('ra đơn ngay với khoá idempotency 0h VN hôm nay, kỳ sau = 0h VN hôm nay + chu kỳ, đẩy Pancake, báo khách', async () => {
    const { svc, state, orderCreate, orderFindFirst, enqueuePush, notify, analytics } = makeRunNow({ retryCount: 2 });
    const res = await svc.runNow('u1', 's1');
    expect(orderFindFirst).toHaveBeenCalledWith({ where: { subscriptionId: 's1', createdAt: { gte: TODAY_VN } }, select: { id: true } });
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.idempotencyKey).toBe(`subscription:s1:${TODAY_VN.toISOString()}`);
    expect(data).toMatchObject({ subscriptionId: 's1', source: 'subscription', status: 'CONFIRMED', subtotal: 200000, discount: 24000 });
    expect((state.nextRunAt as Date).toISOString()).toBe(new Date(TODAY_VN.getTime() + 4 * WEEK).toISOString());
    expect(state.retryCount).toBe(0);
    expect(enqueuePush).toHaveBeenCalledWith('o1');
    expect(notify).toHaveBeenCalledWith('u1', 'SUBSCRIPTION_ORDER', expect.anything(), undefined, expect.anything());
    expect(analytics.recordBestEffort).toHaveBeenCalledWith(expect.objectContaining({ props: expect.objectContaining({ action: 'run_now', orderId: 'o1' }) }));
    expect(res).toMatchObject({ id: 's1', order: { id: 'o1', status: 'CONFIRMED', total: 176000 } });
  });

  it('gói đến hạn hôm nay mà cron chưa chạy: vẫn ra đơn hôm nay, kỳ sau tính từ hôm nay', async () => {
    const { svc, state, orderCreate } = makeRunNow({ nextRunAt: TODAY_VN });
    await svc.runNow('u1', 's1');
    expect(orderCreate).toHaveBeenCalledTimes(1);
    expect((state.nextRunAt as Date).toISOString()).toBe(new Date(TODAY_VN.getTime() + 4 * WEEK).toISOString());
  });

  it('đã có đơn của gói hôm nay (chạm đúp, cron 3h đã giao) → 409, không ghi đơn, không dời lịch', async () => {
    const before = new Date(NOW.getTime() + 20 * DAY);
    const { svc, state, orderCreate, subUpdate } = makeRunNow({ orderToday: { id: 'o-today' }, nextRunAt: before });
    await expect(svc.runNow('u1', 's1')).rejects.toMatchObject({ status: 409, message: 'Gói này đã có đơn hôm nay, kỳ sau Tubu giao theo lịch nhé.' });
    expect(orderCreate).not.toHaveBeenCalled();
    expect(subUpdate).not.toHaveBeenCalled();
    expect(state.nextRunAt).toBe(before);
  });

  it('cron vừa ghi đơn cùng khoá trong lúc chờ khoá dòng (P2002 trên idempotencyKey) → 409', async () => {
    const err = Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['idempotencyKey'] } });
    const { svc } = makeRunNow({ orderCreateError: err });
    await expect(svc.runNow('u1', 's1')).rejects.toMatchObject({ status: 409 });
  });

  it('P2002 trên khoá khác (trùng mã đơn) không bị nói là "đã có đơn hôm nay"', async () => {
    const err = Object.assign(new Error('unique code'), { code: 'P2002', meta: { target: ['code'] } });
    const { svc } = makeRunNow({ orderCreateError: err });
    await expect(svc.runNow('u1', 's1')).rejects.toBe(err);
  });

  it('gói tạm dừng → 400; gói của người khác hay không còn → 404', async () => {
    await expect(makeRunNow({ status: 'PAUSED' }).svc.runNow('u1', 's1')).rejects.toMatchObject({ status: 400, message: 'Chỉ đặt kỳ này ngay khi lịch đang chạy.' });
    await expect(makeRunNow({ userId: 'other' }).svc.runNow('u1', 's1')).rejects.toMatchObject({ status: 404 });
  });

  it('hết hàng → 400 nói rõ, tx rollback (không đẩy Pancake, không báo)', async () => {
    const { svc, enqueuePush, notify } = makeRunNow({ stockCount: 0 });
    await expect(svc.runNow('u1', 's1')).rejects.toMatchObject({ status: 400, message: expect.stringContaining('không đủ tồn kho') });
    expect(enqueuePush).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('Ví Tubu không đủ → 400 câu ví thiếu cho "đơn kỳ này"', async () => {
    const applyDelta = jest.fn().mockRejectedValue(new BadRequestException('thiếu'));
    const { svc } = makeRunNow({ paymentMethod: 'WALLET', applyDelta });
    await expect(svc.runNow('u1', 's1')).rejects.toMatchObject({ status: 400, message: expect.stringContaining('thanh toán đơn kỳ này') });
  });
});
