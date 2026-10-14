import { BadRequestException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { PricingService } from '../pricing/pricing.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';
import type { WalletLedgerService } from '../wallet/wallet-ledger.service';
import { formatVnDate, vnDateKey } from '../../common/vn-time';

/** Stub tối thiểu cho các test không quan tâm việc đẩy Pancake. */
const pancakeStub = () => ({ enqueuePush: jest.fn().mockResolvedValue(undefined) }) as unknown as PancakeOrderService;
import type { NotificationsService } from '../notifications/notifications.service';

const config = {} as unknown as SystemConfigService;
const pricing = {} as unknown as PricingService;
const loyalty = {} as unknown as LoyaltyService;
const notifications = {} as unknown as NotificationsService;
const walletLedger = (applyDelta: jest.Mock = jest.fn()) => ({ applyDelta }) as unknown as WalletLedgerService;
/** Ngày bắt đầu sau hôm nay: create() không sinh đơn đầu ngay, các ca dưới chỉ xét phần tạo gói. */
const LATER = new Date(Date.now() + 7 * 3600e3 + 3 * 864e5).toISOString().slice(0, 10);

/** Mock mới cho mỗi test — record/recordBestEffort là jest.fn() để assert riêng từng test. */
function makeAnalytics() {
  return {
    record: jest.fn().mockResolvedValue(undefined),
    recordBestEffort: jest.fn().mockResolvedValue(undefined),
  } as unknown as AnalyticsEventsService;
}

function makeService(opts: { variation?: unknown; address?: unknown; create?: jest.Mock; open?: unknown } = {}) {
  const create = opts.create ?? jest.fn().mockImplementation((args) => Promise.resolve({ id: 's1', ...args.data }));
  const prisma = {
    variation: { findUnique: jest.fn().mockResolvedValue('variation' in opts ? opts.variation : { id: 'v1', pancakeId: 'pv1', isActive: true, product: { name: 'P', isActive: true, approvalStatus: 'APPROVED' } }) },
    address: { findUnique: jest.fn().mockResolvedValue(opts.address ?? { id: 'a1', userId: 'u1' }) },
    subscription: { create, findFirst: jest.fn().mockResolvedValue(opts.open ?? null) },
    // create() giờ chạy trong $transaction (subscription.create + event atomic) — mock chạy
    // callback với chính prisma mock (đủ subscription.create cho test).
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
  } as unknown as PrismaService;
  const analytics = makeAnalytics();
  return {
    svc: new SubscriptionsService(
      prisma,
      config,
      pricing,
      loyalty,
      notifications,
      { enqueuePush: jest.fn() } as unknown as PancakeOrderService,
      analytics,
      walletLedger(),
    ),
    create,
    analytics,
  };
}

const dto = (over = {}) => ({ variationId: 'v1', quantity: 2, intervalWeeks: 4, addressId: 'a1', startDate: LATER, ...over });

describe('SubscriptionsService.create', () => {
  it('từ chối chu kỳ không hợp lệ (5 tuần)', async () => {
    const { svc } = makeService();
    await expect(svc.create('u1', dto({ intervalWeeks: 5 }))).rejects.toThrow('4/6/8/10');
  });

  it('từ chối sản phẩm không tồn tại', async () => {
    const { svc } = makeService({ variation: null });
    await expect(svc.create('u1', dto())).rejects.toThrow('không khả dụng');
  });

  it('từ chối SP ngừng bán / SP cha ngừng bán / chưa duyệt / bị từ chối → PRODUCT_DISCONTINUED (C-007)', async () => {
    for (const variation of [
      { id: 'v1', isActive: false, product: { name: 'P', isActive: true, approvalStatus: 'APPROVED' } },
      { id: 'v1', isActive: true, product: { name: 'P', isActive: false, approvalStatus: 'APPROVED' } },
      { id: 'v1', isActive: true, product: { name: 'P', isActive: true, approvalStatus: 'PENDING_REVIEW' } },
      { id: 'v1', isActive: true, product: { name: 'P', isActive: true, approvalStatus: 'REJECTED' } },
    ]) {
      const { svc, create } = makeService({ variation });
      await expect(svc.create('u1', dto())).rejects.toMatchObject({ response: { code: 'PRODUCT_DISCONTINUED' } });
      expect(create).not.toHaveBeenCalled();
    }
  });

  it('từ chối địa chỉ của người khác', async () => {
    const { svc } = makeService({ address: { id: 'a1', userId: 'other' } });
    await expect(svc.create('u1', dto())).rejects.toThrow('Địa chỉ không hợp lệ');
  });

  it('hẹn ngày bắt đầu → lịch ACTIVE, kỳ đầu 0h ngày đó giờ Việt Nam, mặc định trả COD (C-015)', async () => {
    const { svc, create } = makeService();
    await svc.create('u1', dto({ intervalWeeks: 6 }));
    const data = create.mock.calls[0][0].data;
    expect(new Date(data.nextRunAt).toISOString()).toBe(new Date(`${LATER}T00:00:00+07:00`).toISOString());
    expect(data.quantity).toBe(2);
    expect(data.intervalWeeks).toBe(6);
    expect(data.paymentMethod).toBe('COD');
  });

  it('từ chối phương thức trả không hỗ trợ cho gói định kỳ (ZALOPAY) (C-015)', async () => {
    const { svc, create } = makeService();
    await expect(svc.create('u1', dto({ paymentMethod: 'ZALOPAY' as never }))).rejects.toThrow('Ví Tubu');
    expect(create).not.toHaveBeenCalled();
  });

  it('phát subscription_changed action=created trong cùng transaction', async () => {
    const { svc, analytics } = makeService();
    await svc.create('u1', dto({ intervalWeeks: 6 }));
    expect(analytics.record).toHaveBeenCalledTimes(1);
    expect(analytics.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'subscription_changed',
        userId: 'u1',
        platform: 'miniapp',
        props: expect.objectContaining({
          subscriptionId: 's1',
          action: 'created',
          variationId: 'v1',
          intervalWeeks: 6,
        }),
      }),
    );
  });

  it('gửi lại y hệt khi đã có gói ACTIVE cùng SP + địa chỉ → trả gói cũ, không tạo (C-057)', async () => {
    const open = { id: 's0', status: 'ACTIVE', quantity: 2, intervalWeeks: 6, paymentMethod: 'COD' };
    const { svc, create } = makeService({ open });
    await expect(svc.create('u1', dto({ intervalWeeks: 6 }))).resolves.toBe(open);
    expect(create).not.toHaveBeenCalled();
  });

  it('đã có gói ACTIVE y hệt nhưng khác cách trả → 409, không âm thầm bỏ cách trả khách chọn (review)', async () => {
    const open = { id: 's0', status: 'ACTIVE', quantity: 2, intervalWeeks: 6, paymentMethod: 'COD' };
    const { svc, create } = makeService({ open });
    await expect(svc.create('u1', dto({ intervalWeeks: 6, paymentMethod: 'WALLET' }))).rejects.toMatchObject({
      status: 409,
      response: { code: 'SUBSCRIPTION_DUPLICATE', subscriptionId: 's0' },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('đã có gói cùng SP + địa chỉ nhưng khác chu kỳ → 409 SUBSCRIPTION_DUPLICATE (C-057)', async () => {
    const { svc, create } = makeService({ open: { id: 's0', status: 'ACTIVE', quantity: 2, intervalWeeks: 4 } });
    await expect(svc.create('u1', dto({ intervalWeeks: 6 }))).rejects.toMatchObject({
      status: 409,
      response: { code: 'SUBSCRIPTION_DUPLICATE', subscriptionId: 's0' },
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('SubscriptionsService.processDue (claim chống double-order)', () => {
  type Tier = { minActive: number; pct: number };
  function makeProcess(
    claimCount: number,
    opts: {
      activeCount?: number;
      tiers?: Tier[];
      stockCount?: number;
      variationInactive?: boolean;
      discontinuedInTx?: boolean;
      addressInvalid?: boolean;
      paymentMethod?: 'COD' | 'WALLET' | 'BANK_TRANSFER';
      lockedStatus?: string;
      applyDelta?: jest.Mock;
      quantity?: number;
      retryCount?: number;
      orderCreateError?: Error;
      existingOrder?: unknown;
      retryDays?: number;
      dueRows?: unknown[];
    } = {},
  ) {
    const due = opts.dueRows ?? [
      { id: 's1', userId: 'u1', variationId: 'v1', quantity: 1, addressId: 'a1', intervalWeeks: 4, retryCount: opts.retryCount ?? 0, nextRunAt: new Date(Date.now() - 60_000) },
    ];
    const updateMany = jest.fn().mockResolvedValue({ count: claimCount });
    const orderCreate = jest.fn().mockImplementation((args) =>
      opts.orderCreateError
        ? Promise.reject(opts.orderCreateError)
        : Promise.resolve({ id: 'o1', code: args.data.code, total: args.data.total, status: args.data.status }),
    );
    const subUpdate = jest.fn().mockResolvedValue({ nextRunAt: new Date(Date.now() + 9e9), intervalWeeks: 4 });
    // Giữ chỗ tồn kho đi bằng SQL thô (catalog/variation-stock.ts) — trả SỐ DÒNG bị sửa.
    const stockExecuteRaw = jest.fn().mockResolvedValue(opts.stockCount ?? 1);
    const findMany = jest.fn().mockResolvedValue(due);
    const prisma = {
      subscription: {
        findMany,
        updateMany,
        update: subUpdate,
        count: jest.fn().mockResolvedValue(opts.activeCount ?? 1),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((args) => Promise.resolve({ id: 's1', ...args.data })),
      },
      variation: {
        findUnique: jest.fn().mockResolvedValue(
          opts.variationInactive
            ? { id: 'v1', pancakeId: 'pv1', isActive: false, salePrice: null, retailPrice: 100000, name: 'V', product: { name: 'P', isActive: true, approvalStatus: 'APPROVED' } }
            : { id: 'v1', pancakeId: 'pv1', isActive: true, salePrice: null, retailPrice: 100000, name: 'V', product: { name: 'P', isActive: true, approvalStatus: 'APPROVED' } },
        ),
        // Kiểm lại SP còn bán trong tx (cart/sellable.ts).
        findMany: jest.fn().mockResolvedValue(opts.discontinuedInTx ? [] : [{ id: 'v1' }]),
      },
      $executeRaw: stockExecuteRaw,
      // Khoá dòng gói (SELECT ... FOR UPDATE) trong tx sinh đơn: số lượng/địa chỉ/cách trả đọc từ đây.
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 's1',
          userId: 'u1',
          variationId: 'v1',
          quantity: opts.quantity ?? 1,
          addressId: 'a1',
          status: opts.lockedStatus ?? 'ACTIVE',
          paymentMethod: opts.paymentMethod ?? 'COD',
        },
      ]),
      address: {
        findUnique: jest.fn().mockResolvedValue(
          opts.addressInvalid
            ? null
            : { id: 'a1', userId: 'u1', recipient: 'R', phone: '09', province: 'p', district: 'd', ward: 'w', street: 's', provinceCode: '1', districtCode: '2', wardCode: '3' },
        ),
      },
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', tierId: null }) },
      order: { create: orderCreate, findUnique: jest.fn().mockResolvedValue(opts.existingOrder ?? null) },
      // Tạo đơn định kỳ giờ chạy trong $transaction (trừ stock atomic + order.create) — mock
      // chạy callback với chính prisma mock (đủ variation.updateMany + order.create cho test).
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    } as unknown as PrismaService;
    const cfg = {
      get: async <T>(k: string, fb?: T): Promise<T> =>
        k === 'subscribe.discount_tiers' && opts.tiers
          ? (opts.tiers as unknown as T)
          : k === 'subscribe.stock_retry_days' && opts.retryDays !== undefined
            ? (opts.retryDays as unknown as T)
            : (fb as T),
    } as unknown as SystemConfigService;
    const pr = {
      calcShippingFee: jest.fn().mockResolvedValue(0),
      calcPointsEarned: jest.fn().mockResolvedValue(0),
    } as unknown as PricingService;
    const ly = { getTierMultiplier: jest.fn().mockResolvedValue(1) } as unknown as LoyaltyService;
    const notify = jest.fn().mockResolvedValue(undefined);
    const nt = { notify } as unknown as NotificationsService;
    const enqueuePush = jest.fn().mockResolvedValue(undefined);
    const pancake = { enqueuePush } as unknown as PancakeOrderService;
    const analytics = makeAnalytics();
    const applyDelta = opts.applyDelta ?? jest.fn().mockResolvedValue({ applied: true, balanceAfter: 0, entryId: 'w1' });
    return {
      svc: new SubscriptionsService(prisma, cfg, pr, ly, nt, pancake, analytics, walletLedger(applyDelta)),
      applyDelta,
      updateMany,
      orderCreate,
      stockExecuteRaw,
      notify,
      enqueuePush,
      analytics,
      subUpdate,
      findMany,
    };
  }

  it('claim thành công (count=1) → tạo đơn định kỳ', async () => {
    const { svc, updateMany, orderCreate } = makeProcess(1);
    await svc.processDue();
    // claim advance nextRunAt với điều kiện status ACTIVE + đến hạn
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ id: 's1', status: 'ACTIVE' });
    expect(orderCreate).toHaveBeenCalledTimes(1);
  });

  it('tạo đơn thành công → phát order_placed + subscription_changed action=order_created (cùng tx)', async () => {
    const { svc, orderCreate, analytics } = makeProcess(1);
    await svc.processDue();
    expect(orderCreate).toHaveBeenCalledTimes(1);
    expect(analytics.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'order_placed',
        userId: 'u1',
        platform: 'system',
        props: expect.objectContaining({ orderId: 'o1', orderSource: 'subscription', subscriptionId: 's1' }),
      }),
    );
    expect(analytics.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'subscription_changed',
        userId: 'u1',
        platform: 'system',
        props: expect.objectContaining({ subscriptionId: 's1', action: 'order_created', orderId: 'o1' }),
      }),
    );
    // order.create() nhận đủ source/platform/subscriptionId để gắn đơn về đúng subscription.
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.source).toBe('subscription');
    expect(data.platform).toBe('system');
    expect(data.subscriptionId).toBe('s1');
    expect(data.code).toMatch(/^TUBUSUB\d{10}$/);
  });

  it('instance khác đã claim (count=0) → KHÔNG tạo đơn trùng', async () => {
    const { svc, orderCreate } = makeProcess(0);
    await svc.processDue();
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('trừ stock ATOMIC (gte) trước khi tạo đơn — chống oversell đơn định kỳ', async () => {
    const { svc, stockExecuteRaw, orderCreate } = makeProcess(1);
    await svc.processDue();
    // Tham số câu UPDATE giữ chỗ: (số lượng, số lượng, variationId, số lượng) — điều kiện
    // `stock >= số lượng` nằm TRONG câu lệnh nên không có khe hở đọc-rồi-ghi.
    expect(stockExecuteRaw.mock.calls[0]!.slice(1)).toEqual([1, 1, 'v1', 1]);
    // Order chỉ tạo SAU khi trừ stock thành công.
    expect(orderCreate).toHaveBeenCalledTimes(1);
  });

  it('hết stock (0 dòng bị sửa) → KHÔNG tạo đơn, chu kỳ bị bỏ qua (không double-charge)', async () => {
    const { svc, orderCreate } = makeProcess(1, { stockCount: 0 });
    // claim đã advance nextRunAt nên lỗi ở createOrderFor chỉ bị log, không throw ra ngoài.
    await expect(svc.processDue()).resolves.toBeUndefined();
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('hết stock → báo user (KHÔNG pause lịch, khác nhánh isActive=false/địa chỉ hỏng)', async () => {
    const { svc, notify } = makeProcess(1, { stockCount: 0 });
    await svc.processDue();
    expect(notify).toHaveBeenCalledWith('u1', 'SUBSCRIPTION_ORDER_FAILED', expect.any(Object));
  });

  it('hết stock → phát subscription_changed action=order_failed reason=out_of_stock (best-effort, ngoài tx đã rollback)', async () => {
    const { svc, analytics } = makeProcess(1, { stockCount: 0 });
    await svc.processDue();
    expect(analytics.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'subscription_changed',
        userId: 'u1',
        platform: 'system',
        props: expect.objectContaining({ subscriptionId: 's1', action: 'order_failed', reason: 'out_of_stock' }),
      }),
    );
  });

  // ENGAGE-14: hết hàng đúng đêm cron làm gói 4-10 tuần mất cả kỳ, lỗi tạm thời thì khách không được báo.
  describe('thử lại kỳ khi hết hàng/lỗi tạm thời (ENGAGE-14)', () => {
    const tomorrowVn = () => new Date(`${vnDateKey(new Date(Date.now() + 864e5))}T00:00:00+07:00`);
    const retryWrite = (updateMany: jest.Mock) =>
      updateMany.mock.calls.find(([a]) => a.data && 'retryCount' in a.data && a.data.nextRunAt)?.[0];

    it('hết hàng lần đầu → hẹn thử lại 0h ngày mai (giờ VN) thay vì bỏ cả chu kỳ, retryCount +1', async () => {
      const { svc, updateMany } = makeProcess(1, { stockCount: 0 });
      await svc.processDue();
      const write = retryWrite(updateMany);
      expect(write.where).toMatchObject({ id: 's1', status: 'ACTIVE' });
      expect(write.data.nextRunAt).toEqual(tomorrowVn());
      expect(write.data.retryCount).toEqual({ increment: 1 });
    });

    it('lần đầu báo khách "sẽ thử lại ngày mai", không nói "kỳ sau"', async () => {
      const { svc, notify } = makeProcess(1, { stockCount: 0 });
      await svc.processDue();
      const [, code, data] = notify.mock.calls.find((c) => c[1] === 'SUBSCRIPTION_ORDER_FAILED')!;
      expect(code).toBe('SUBSCRIPTION_ORDER_FAILED');
      expect(data.reason).toMatch(/Hết hàng tạm thời/);
      expect(data.retry).toMatch(/thử lại vào ngày mai/);
    });

    it('lần thử lại sau (retryCount>0) hết hàng tiếp nhưng còn lượt → tiếp tục hẹn ngày mai, không báo thêm', async () => {
      const { svc, updateMany, notify } = makeProcess(1, { stockCount: 0, retryCount: 1 });
      await svc.processDue();
      expect(retryWrite(updateMany).data.retryCount).toEqual({ increment: 1 });
      expect(notify).not.toHaveBeenCalledWith('u1', 'SUBSCRIPTION_ORDER_FAILED', expect.anything());
    });

    it('hết lượt thử lại (retryCount = trần) → bỏ kỳ: giữ nextRunAt của claim, reset retryCount, báo ngày kỳ kế tiếp', async () => {
      const { svc, updateMany, notify } = makeProcess(1, { stockCount: 0, retryCount: 3 });
      await svc.processDue();
      expect(retryWrite(updateMany)).toBeUndefined();
      expect(updateMany).toHaveBeenCalledWith({ where: { id: 's1', status: 'ACTIVE' }, data: { retryCount: 0 } });
      const [, , data] = notify.mock.calls.find((c) => c[1] === 'SUBSCRIPTION_ORDER_FAILED')!;
      expect(data.retry).toMatch(/kỳ kế tiếp ngày \d{2}\/\d{2}\/\d{4}/);
    });

    it('subscribe.stock_retry_days = 0 → tắt thử lại, bỏ kỳ ngay như cũ nhưng vẫn báo', async () => {
      const { svc, updateMany, notify } = makeProcess(1, { stockCount: 0, retryDays: 0 });
      await svc.processDue();
      expect(retryWrite(updateMany)).toBeUndefined();
      expect(notify).toHaveBeenCalledWith('u1', 'SUBSCRIPTION_ORDER_FAILED', expect.anything());
    });

    it('lỗi tạm thời khác (vd P2034) → trước đây chỉ log: giờ cũng hẹn thử lại ngày mai và báo khách', async () => {
      const { svc, updateMany, notify } = makeProcess(1, { orderCreateError: new Error('P2034 write conflict') });
      await svc.processDue();
      expect(retryWrite(updateMany).data.nextRunAt).toEqual(tomorrowVn());
      expect(notify).toHaveBeenCalledWith('u1', 'SUBSCRIPTION_ORDER_FAILED', expect.objectContaining({ reason: expect.any(String) }));
    });

    it('lỗi sau khi đơn kỳ ĐÃ ghi (idempotencyKey có đơn) → không thử lại, không báo hỏng', async () => {
      const { svc, updateMany, notify } = makeProcess(1, { orderCreateError: new Error('boom'), existingOrder: { id: 'o-existing' } });
      await svc.processDue();
      expect(retryWrite(updateMany)).toBeUndefined();
      expect(notify).not.toHaveBeenCalledWith('u1', 'SUBSCRIPTION_ORDER_FAILED', expect.anything());
    });

    it('ra đơn thành công → reset retryCount về 0 trong cùng tx', async () => {
      const { svc, subUpdate } = makeProcess(1, { retryCount: 2 });
      await svc.processDue();
      expect(subUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastOrderId: 'o1', retryCount: 0 }) }),
      );
    });
  });

  describe('quét gói đến hạn theo trang (ENGAGE-14)', () => {
    it('lấy theo thứ tự nextRunAt cũ nhất trước, trang 200', async () => {
      const { svc, findMany } = makeProcess(0);
      await svc.processDue();
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ nextRunAt: 'asc' }, { id: 'asc' }], take: 200 }),
      );
    });

    it('trang đầy 200 → quét tiếp trang sau đến khi hết (không dồn phần dư sang đêm sau)', async () => {
      const full = Array.from({ length: 200 }, (_, i) => ({
        id: `s${i}`, userId: 'u1', variationId: 'v1', quantity: 1, addressId: 'a1', intervalWeeks: 4, retryCount: 0,
        nextRunAt: new Date(Date.now() - 60_000),
      }));
      const { svc, findMany } = makeProcess(0);
      findMany.mockResolvedValueOnce(full).mockResolvedValueOnce(full.slice(0, 5)).mockResolvedValue([]);
      await svc.processDue();
      expect(findMany).toHaveBeenCalledTimes(2);
    });
  });

  it('SP ngừng bán → tạm dừng lịch + phát subscription_changed action=order_failed reason=inactive_product', async () => {
    const { svc, analytics, updateMany, orderCreate } = makeProcess(1, { variationInactive: true });
    await svc.processDue();
    expect(orderCreate).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 's1', status: 'ACTIVE' }, data: { status: 'PAUSED' } });
    expect(analytics.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'subscription_changed',
        userId: 'u1',
        platform: 'system',
        props: expect.objectContaining({ subscriptionId: 's1', action: 'order_failed', reason: 'inactive_product' }),
      }),
    );
  });

  it('SP bị gỡ sau khi tính giá kỳ (kiểm lại trong tx) → không giữ kho, không đơn, tạm dừng lịch + báo khách (C-007)', async () => {
    const { svc, updateMany, orderCreate, stockExecuteRaw, notify } = makeProcess(1, { discontinuedInTx: true });
    await svc.processDue();
    expect(stockExecuteRaw).not.toHaveBeenCalled();
    expect(orderCreate).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 's1', status: 'ACTIVE' }, data: { status: 'PAUSED' } });
    expect(notify).toHaveBeenCalledWith('u1', 'SUBSCRIPTION_PAUSED', expect.anything());
  });

  it('địa chỉ không hợp lệ → tạm dừng lịch + phát subscription_changed action=order_failed reason=invalid_address', async () => {
    const { svc, analytics, updateMany, orderCreate } = makeProcess(1, { addressInvalid: true });
    await svc.processDue();
    expect(orderCreate).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 's1', status: 'ACTIVE' }, data: { status: 'PAUSED' } });
    expect(analytics.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'subscription_changed',
        userId: 'u1',
        platform: 'system',
        props: expect.objectContaining({ subscriptionId: 's1', action: 'order_failed', reason: 'invalid_address' }),
      }),
    );
  });

  it('user chỉ có 1 subscription ACTIVE → giảm bậc cơ bản 12%', async () => {
    const { svc, orderCreate } = makeProcess(1, {
      activeCount: 1,
      tiers: [{ minActive: 1, pct: 0.12 }, { minActive: 3, pct: 0.14 }, { minActive: 5, pct: 0.15 }],
    });
    await svc.processDue();
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.discount).toBe(Math.floor(100000 * 0.12));
    expect(data.total).toBe(data.subtotal - data.discount + data.shippingFee);
  });

  it('user có 5 subscription ACTIVE → giảm bậc cao nhất 15% cho đơn định kỳ', async () => {
    const { svc, orderCreate } = makeProcess(1, {
      activeCount: 5,
      tiers: [{ minActive: 1, pct: 0.12 }, { minActive: 3, pct: 0.14 }, { minActive: 5, pct: 0.15 }],
    });
    await svc.processDue();
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.discount).toBe(Math.floor(100000 * 0.15));
    expect(data.total).toBe(data.subtotal - data.discount + data.shippingFee);
  });

  describe('thanh toán đơn kỳ (C-015, Q-13)', () => {
    it('COD → đơn CONFIRMED chưa trả, idempotencyKey theo (gói, kỳ), không đụng ví', async () => {
      const { svc, orderCreate, applyDelta } = makeProcess(1);
      await svc.processDue();
      const data = orderCreate.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({ status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID' }));
      expect(data.idempotencyKey).toMatch(/^subscription:s1:/);
      expect(applyDelta).not.toHaveBeenCalled();
    });

    it('Ví Tubu → đơn PAID, trừ ví qua sổ cái ORDER_PAY refId = id đơn trong cùng tx', async () => {
      const { svc, orderCreate, applyDelta } = makeProcess(1, { paymentMethod: 'WALLET' });
      await svc.processDue();
      const data = orderCreate.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({ status: 'CONFIRMED', paymentMethod: 'WALLET', paymentStatus: 'PAID' }));
      expect(data.paidAt).toBeInstanceOf(Date);
      expect(applyDelta).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ userId: 'u1', delta: -data.total, type: 'ORDER_PAY', refType: 'ORDER', refId: 'o1' }),
      );
    });

    it('Ví Tubu thiếu → tạm dừng gói + báo khách lý do Ví Tubu, không đẩy Pancake', async () => {
      const applyDelta = jest.fn().mockRejectedValue(new BadRequestException('Số dư ví không đủ.'));
      const { svc, updateMany, notify, enqueuePush, analytics } = makeProcess(1, { paymentMethod: 'WALLET', applyDelta });
      await svc.processDue();
      expect(updateMany).toHaveBeenCalledWith({ where: { id: 's1', status: 'ACTIVE' }, data: { status: 'PAUSED' } });
      expect(notify).toHaveBeenCalledWith('u1', 'SUBSCRIPTION_PAUSED', { reason: expect.stringContaining('Ví Tubu') });
      expect(enqueuePush).not.toHaveBeenCalled();
      expect(analytics.recordBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({ props: expect.objectContaining({ action: 'order_failed', reason: 'insufficient_wallet' }) }),
      );
    });

    // Bước claim đã dời nextRunAt sang kỳ kế; bật lại lịch (setStatus) giữ ngày đó, nên tin phải nói thật là kỳ này
    // không giao và ngày của kỳ kế tiếp, không để khách tưởng bật lại là có đơn ngay.
    it('tạm dừng vì Ví Tubu thiếu → tin nói rõ kỳ này không giao + ngày kỳ kế tiếp (review)', async () => {
      const applyDelta = jest.fn().mockRejectedValue(new BadRequestException('Số dư ví không đủ.'));
      const { svc, notify, updateMany } = makeProcess(1, { paymentMethod: 'WALLET', applyDelta });
      await svc.processDue();
      const claimedNext = updateMany.mock.calls[0][0].data.nextRunAt as Date;
      const vnDate = formatVnDate(claimedNext);
      const reason = notify.mock.calls.find((c) => c[1] === 'SUBSCRIPTION_PAUSED')![2].reason as string;
      expect(reason).toContain('kỳ này không giao');
      expect(reason).toContain(vnDate);
    });

    it('chuyển khoản → đơn PENDING_PAYMENT chưa trả + báo khách chuyển khoản trong hạn', async () => {
      const { svc, orderCreate, notify, applyDelta } = makeProcess(1, { paymentMethod: 'BANK_TRANSFER' });
      await svc.processDue();
      const data = orderCreate.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.objectContaining({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', paidAt: null }),
      );
      expect(applyDelta).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(
        'u1',
        'SUBSCRIPTION_ORDER_AWAITING_PAYMENT',
        expect.objectContaining({ order_code: data.code, hours: '24' }),
      );
    });

    // Checkout chặn COD > 5.000.000đ; đơn kỳ không qua checkout nên phải tự chặn, không thì tạo gói số lượng lớn
    // là lách được hạn mức COD (đơn đầu giao ngay giữ kho + đẩy Pancake).
    it('COD vượt hạn mức 5.000.000đ → không giữ kho, không đơn, tạm dừng gói + báo lý do (review)', async () => {
      const { svc, orderCreate, stockExecuteRaw, updateMany, notify, analytics } = makeProcess(1, { quantity: 60 });
      await svc.processDue();
      expect(stockExecuteRaw).not.toHaveBeenCalled();
      expect(orderCreate).not.toHaveBeenCalled();
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's1', status: 'ACTIVE' }, data: expect.objectContaining({ status: 'PAUSED' }) }),
      );
      expect(notify).toHaveBeenCalledWith('u1', 'SUBSCRIPTION_PAUSED', { reason: expect.stringContaining('5.000.000đ') });
      expect(analytics.recordBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({ props: expect.objectContaining({ action: 'order_failed', reason: 'cod_limit' }) }),
      );
    });

    it('COD vượt hạn mức ở đơn đầu giao ngay → 400, không tạo gói lẫn đơn (review)', async () => {
      const { svc, orderCreate, stockExecuteRaw } = makeProcess(1, { quantity: 60 });
      await expect(
        svc.create('u1', { variationId: 'v1', quantity: 60, intervalWeeks: 4, addressId: 'a1' }),
      ).rejects.toThrow('hạn mức');
      expect(stockExecuteRaw).not.toHaveBeenCalled();
      expect(orderCreate).not.toHaveBeenCalled();
    });

    it('Ví Tubu / chuyển khoản không bị hạn mức COD', async () => {
      for (const paymentMethod of ['WALLET', 'BANK_TRANSFER'] as const) {
        const { svc, orderCreate } = makeProcess(1, { quantity: 60, paymentMethod });
        await svc.processDue();
        expect(orderCreate).toHaveBeenCalledTimes(1);
      }
    });

    it('khách tạm dừng gói giữa lúc claim và lúc khoá dòng → không sinh đơn', async () => {
      const { svc, orderCreate, stockExecuteRaw } = makeProcess(1, { lockedStatus: 'PAUSED' });
      await svc.processDue();
      expect(stockExecuteRaw).not.toHaveBeenCalled();
      expect(orderCreate).not.toHaveBeenCalled();
    });
  });

  // P1-4 (docs/2026-09-08-review-progress.md): đơn Subscribe & Save do cron tạo KHÔNG được đẩy
  // sang Pancake ở bất kỳ đường nào — kho vật lý không bao giờ thấy đơn, không webhook nào khớp
  // được, đơn kẹt CONFIRMED vĩnh viễn dù đã trừ kho và đã báo khách "đơn định kỳ đang tới".
  describe('SubscriptionsService — đẩy đơn định kỳ sang Pancake', () => {
    it('tạo đơn thành công → enqueuePush(orderId)', async () => {
      const { svc, enqueuePush, orderCreate } = makeProcess(1);
      await svc.processDue();
      expect(orderCreate).toHaveBeenCalled();
      expect(enqueuePush).toHaveBeenCalledWith(expect.any(String));
    });

    it('enqueuePush lỗi → KHÔNG làm hỏng chu kỳ cron (non-fatal, cron reconcile quét lại)', async () => {
      const { svc, enqueuePush } = makeProcess(1);
      enqueuePush.mockRejectedValue(new Error('redis down'));
      // processDue() trả void — điều cần khẳng định là KHÔNG ném lỗi ra ngoài cron.
      await expect(svc.processDue()).resolves.toBeUndefined();
    });
  });

});

describe('SubscriptionsService — trần số lượng 999 như giỏ hàng (review)', () => {
  it('create số lượng 1000 → 400, không ghi gì', async () => {
    const { svc, create } = makeService();
    await expect(svc.create('u1', dto({ quantity: 1000 }))).rejects.toThrow('Số lượng');
    expect(create).not.toHaveBeenCalled();
  });

  it('update số lượng 1000 → 400 trước khi mở transaction', async () => {
    const $transaction = jest.fn();
    const svc = new SubscriptionsService(
      { $transaction } as unknown as PrismaService,
      config,
      pricing,
      loyalty,
      notifications,
      pancakeStub(),
      makeAnalytics(),
      walletLedger(),
    );
    await expect(svc.update('u1', 's1', { quantity: 1000 })).rejects.toThrow('Số lượng');
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe('SubscriptionsService.effectiveDiscountPct', () => {
  const tiers = [{ minActive: 1, pct: 0.12 }, { minActive: 3, pct: 0.14 }, { minActive: 5, pct: 0.15 }];

  function makeSvc(activeCount: number) {
    const prisma = {
      subscription: { count: jest.fn().mockResolvedValue(activeCount) },
    } as unknown as PrismaService;
    const cfg = {
      get: async <T>(k: string, fb?: T): Promise<T> =>
        k === 'subscribe.discount_tiers' ? (tiers as unknown as T) : (fb as T),
    } as unknown as SystemConfigService;
    return new SubscriptionsService(
      prisma,
      cfg,
      pricing,
      loyalty,
      notifications,
      { enqueuePush: jest.fn() } as unknown as PancakeOrderService,
      makeAnalytics(),
      walletLedger(),
    );
  }

  it.each([
    [1, 0.12],
    [2, 0.12],
    [3, 0.14],
    [4, 0.14],
    [5, 0.15],
    [10, 0.15],
  ])('activeCount=%i → pct=%f (bậc cao nhất đạt được)', async (activeCount, expected) => {
    const svc = makeSvc(activeCount);
    await expect(svc.effectiveDiscountPct('u1')).resolves.toBe(expected);
  });

  it('activeCount=0 (không có subscription ACTIVE nào) → 0%', async () => {
    const svc = makeSvc(0);
    await expect(svc.effectiveDiscountPct('u1')).resolves.toBe(0);
  });
});

describe('SubscriptionsService.skipCycle', () => {
  function makeSkip(sub: unknown, updateImpl?: jest.Mock) {
    const update = updateImpl ?? jest.fn().mockImplementation((args) => Promise.resolve({ id: 's1', ...args.data }));
    const prisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue(sub),
        update,
      },
    } as unknown as PrismaService;
    const svc = new SubscriptionsService(prisma, config, pricing, loyalty, notifications, pancakeStub(), makeAnalytics(), walletLedger());
    return { svc, update };
  }

  it('sub ACTIVE → dời nextRunAt thêm 1 chu kỳ, giữ nguyên status', async () => {
    const nextRunAt = new Date('2026-07-10T00:00:00.000Z');
    const { svc, update } = makeSkip({ id: 's1', userId: 'u1', status: 'ACTIVE', intervalWeeks: 4, nextRunAt });
    await svc.skipCycle('u1', 's1');
    const data = update.mock.calls[0][0].data;
    expect((data.nextRunAt as Date).getTime()).toBe(nextRunAt.getTime() + 4 * 7 * 864e5);
    expect(data.status).toBeUndefined();
  });

  it('bỏ kỳ giữa lúc đang thử lại vì hết hàng → xoá bộ đếm thử lại để kỳ sau đủ lượt (ENGAGE-14)', async () => {
    const { svc, update } = makeSkip({ id: 's1', userId: 'u1', status: 'ACTIVE', intervalWeeks: 4, retryCount: 2, nextRunAt: new Date('2026-07-10T00:00:00.000Z') });
    await svc.skipCycle('u1', 's1');
    expect(update.mock.calls[0][0].data.retryCount).toBe(0);
  });

  it('không tìm thấy lịch → NotFound', async () => {
    const { svc } = makeSkip(null);
    await expect(svc.skipCycle('u1', 's1')).rejects.toThrow('Không tìm thấy lịch đặt định kỳ.');
  });

  it('không phải chủ sở hữu → NotFound', async () => {
    const { svc } = makeSkip({ id: 's1', userId: 'other', status: 'ACTIVE', intervalWeeks: 4, nextRunAt: new Date() });
    await expect(svc.skipCycle('u1', 's1')).rejects.toThrow('Không tìm thấy lịch đặt định kỳ.');
  });

  it.each(['PAUSED', 'CANCELLED'])('lịch đang %s (không ACTIVE) → BadRequest', async (status) => {
    const { svc } = makeSkip({ id: 's1', userId: 'u1', status, intervalWeeks: 4, nextRunAt: new Date() });
    await expect(svc.skipCycle('u1', 's1')).rejects.toThrow('Chỉ bỏ qua kỳ khi lịch đang chạy.');
  });
});

describe('SubscriptionsService.setStatus', () => {
  function makeSetStatus(sub: unknown) {
    const update = jest.fn().mockImplementation((args) => Promise.resolve({ id: 's1', ...args.data }));
    const prisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue(sub),
        update,
      },
      // setStatus() giờ chạy trong $transaction (subscription.update + event atomic) — mock
      // chạy callback với chính prisma mock (đủ subscription.update cho test).
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    } as unknown as PrismaService;
    const analytics = makeAnalytics();
    const svc = new SubscriptionsService(prisma, config, pricing, loyalty, notifications, pancakeStub(), analytics, walletLedger());
    return { svc, update, analytics };
  }

  it('không tìm thấy lịch → NotFound', async () => {
    const { svc } = makeSetStatus(null);
    await expect(svc.setStatus('u1', 's1', 'PAUSED')).rejects.toThrow('Không tìm thấy lịch đặt định kỳ.');
  });

  it('không phải chủ sở hữu → NotFound', async () => {
    const { svc } = makeSetStatus({ id: 's1', userId: 'other', status: 'ACTIVE', intervalWeeks: 4, nextRunAt: new Date() });
    await expect(svc.setStatus('u1', 's1', 'PAUSED')).rejects.toThrow('Không tìm thấy lịch đặt định kỳ.');
  });

  it('PAUSED → cập nhật status + phát subscription_changed action=paused (cùng transaction)', async () => {
    const { svc, update, analytics } = makeSetStatus({ id: 's1', userId: 'u1', status: 'ACTIVE', intervalWeeks: 4, nextRunAt: new Date(Date.now() + 999_999_999) });
    await svc.setStatus('u1', 's1', 'PAUSED');
    expect(update.mock.calls[0][0].where).toEqual({ id: 's1' });
    expect(update.mock.calls[0][0].data.status).toBe('PAUSED');
    expect(analytics.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'subscription_changed',
        userId: 'u1',
        platform: 'miniapp',
        props: expect.objectContaining({ subscriptionId: 's1', action: 'paused' }),
      }),
    );
  });

  it('CANCELLED → phát subscription_changed action=cancelled', async () => {
    const { svc, analytics } = makeSetStatus({ id: 's1', userId: 'u1', status: 'ACTIVE', intervalWeeks: 4, nextRunAt: new Date(Date.now() + 999_999_999) });
    await svc.setStatus('u1', 's1', 'CANCELLED');
    expect(analytics.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        props: expect.objectContaining({ subscriptionId: 's1', action: 'cancelled' }),
      }),
    );
  });

  it('ACTIVE (bật lại từ PAUSED, đã quá hạn) → dời nextRunAt + phát subscription_changed action=resumed', async () => {
    const pastRunAt = new Date(Date.now() - 999_999_999);
    const { svc, update, analytics } = makeSetStatus({ id: 's1', userId: 'u1', status: 'PAUSED', intervalWeeks: 4, nextRunAt: pastRunAt });
    await svc.setStatus('u1', 's1', 'ACTIVE');
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('ACTIVE');
    expect((data.nextRunAt as Date).getTime()).toBeGreaterThan(pastRunAt.getTime());
    expect(analytics.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        props: expect.objectContaining({ subscriptionId: 's1', action: 'resumed' }),
      }),
    );
  });
});

describe('SubscriptionsService.list', () => {
  it('trả về effectiveDiscountPct theo số subscription ACTIVE của user', async () => {
    const tiers = [{ minActive: 1, pct: 0.12 }, { minActive: 3, pct: 0.14 }, { minActive: 5, pct: 0.15 }];
    const prisma = {
      subscription: {
        findMany: jest.fn().mockResolvedValue([
          { id: 's1', variationId: 'v1', quantity: 1, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: new Date() },
        ]),
        count: jest.fn().mockResolvedValue(3),
      },
      variation: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'v1', name: 'V', salePrice: null, retailPrice: 100000, product: { name: 'P', thumbnail: null, slug: 'p' } },
        ]),
      },
    } as unknown as PrismaService;
    const cfg = {
      get: async <T>(k: string, fb?: T): Promise<T> =>
        k === 'subscribe.discount_tiers' ? (tiers as unknown as T) : (fb as T),
    } as unknown as SystemConfigService;
    const svc = new SubscriptionsService(prisma, cfg, pricing, loyalty, notifications, pancakeStub(), makeAnalytics(), walletLedger());
    const result = await svc.list('u1');
    expect(result[0]?.effectiveDiscountPct).toBe(0.14);
  });

  it('giới hạn số gói trả về (mặc định 100, tối đa 200) và hỗ trợ cursor, C-100', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { subscription: { findMany } } as unknown as PrismaService;
    const svc = new SubscriptionsService(prisma, {} as SystemConfigService, pricing, loyalty, notifications, pancakeStub(), makeAnalytics(), walletLedger());
    await svc.list('u1');
    expect(findMany).toHaveBeenLastCalledWith({
      where: { userId: 'u1', status: { not: 'CANCELLED' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    await svc.list('u1', { take: 9999, cursor: 's7' });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 200, cursor: { id: 's7' }, skip: 1 }));
  });
});
