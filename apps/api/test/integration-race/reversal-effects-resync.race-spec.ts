import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { ReversalEffectsResyncCron } from '../../src/modules/orders/reversal-effects-resync.cron';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, markReversalEffectsDone, randCode, summarize, warmPool } from './helpers';

const EARNED = 50;
const USED = 10;
const COMMISSION = 12_500;
const MIN = 60_000;
const DAY = 864e5;

/**
 * Q19: huỷ/trả đơn commit xong rồi tiến trình chết (SIGTERM lúc deploy, mất kết nối) trước khi đảo điểm tích, thu hồi hoa hồng và
 * báo khách thì không ai gọi lại setStatus. Đơn chỉ có mốc reversalEffectsAt khi mọi việc xong; cron quét đơn CANCELLED/RETURNED
 * thiếu mốc quá 5 phút và chạy lại — mỗi việc idempotent nên chạy song song (hai cron, hai lần gọi) vẫn chỉ đảo một lần.
 */
describe('Phần đảo sau commit của đơn huỷ/trả: cron chạy lại, đúng một lần (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let loyalty: LoyaltyService;
  let affiliate: AffiliateService;
  let cron: ReversalEffectsResyncCron;
  const hooks = { afterLocalCancel: jest.fn().mockResolvedValue(undefined), precheckCancel: jest.fn().mockResolvedValue({ kind: 'NONE' }) };
  // Ghi NotificationLog như NotificationsService thật: tin đã đi thì cron nhận ra qua log, không gửi lại.
  const notify = jest.fn(async (userId: string, templateCode: string, data: Record<string, string>) => {
    await prisma.notificationLog.create({ data: { userId, templateCode, channel: 'INAPP', payload: { body: '', data }, status: 'SENT' } });
  });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        RewardPointsService,
        AnalyticsEventsService,
        AffiliateService,
        OrderReversalService,
        OrderStatusService,
        ReversalEffectsResyncCron,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notify } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    orderStatus = moduleRef.get(OrderStatusService);
    (orderStatus as unknown as { pancakeHooks: unknown }).pancakeHooks = hooks;
    loyalty = moduleRef.get(LoyaltyService);
    affiliate = moduleRef.get(AffiliateService);
    cron = moduleRef.get(ReversalEffectsResyncCron);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    // DB dùng chung: đơn đã huỷ/trả chưa xong phần đảo của spec khác không phải việc của spec này.
    await markReversalEffectsDone(prisma);
    notify.mockClear();
    hooks.afterLocalCancel.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const dbDown = () => new Error('SIGTERM giữa chừng: kết nối đứt');
  const balanceOf = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } })).pointsBalance;
  const ledger = (orderId: string, prefix: string) => prisma.pointsTransaction.findMany({ where: { refId: orderId, reason: { startsWith: prefix } } });
  const markerOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { reversalEffectsAt: true } })).reversalEffectsAt;
  /** Lùi mốc cập nhật cuối: quá thời gian chờ, và không tạo ghi chú nào khác (updatedAt do @updatedAt tự đặt). */
  const age = (orderId: string, ms: number) =>
    prisma.$executeRaw`UPDATE "orders" SET "updatedAt" = now() - (${ms}::int * interval '1 millisecond') WHERE "id" = ${orderId}`;
  const mineScanned = (spy: jest.SpyInstance, ids: string[]) => spy.mock.calls.map(([id]) => id as string).filter((id) => ids.includes(id));

  /** Đơn đã giao, tích EARNED điểm, dùng USED điểm thường, CTV có hoa hồng LOCKED — trả hàng sẽ đảo cả ba. */
  async function deliveredOrder() {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0, pointsBalance: EARNED });
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
      total: 100_000,
      subtotal: 110_000,
      pointsUsed: USED,
      pointsUsedConverted: 0,
      pointsEarned: EARNED,
      referrerUserId: ctv.id,
      pancakeOrderId: `pk-it-${randCode(8)}`,
    });
    await prisma.pointsTransaction.create({
      data: { userId: user.id, delta: EARNED, reason: `ORDER_DELIVERED:${order.code}`, refType: 'ORDER', refId: order.id, expiresAt: new Date(Date.now() + DAY * 300) },
    });
    await prisma.commission.create({
      data: { affiliateUserId: ctv.id, orderId: order.id, orderTotal: order.total, commissionableTotal: order.total, rate: 5, amount: COMMISSION, status: 'LOCKED' },
    });
    return { user, ctv, order };
  }

  /** Trả hàng mà "tiến trình chết" ngay sau commit: hai việc đảo sau commit đều ném, đơn đã RETURNED và chưa có mốc. */
  async function returnedButProcessDied() {
    const s = await deliveredOrder();
    jest.spyOn(loyalty, 'reverseOrderPoints').mockRejectedValueOnce(dbDown());
    jest.spyOn(affiliate, 'reverseCommissionsForOrder').mockRejectedValueOnce(dbDown());
    await expect(orderStatus.setStatus(s.order.id, 'RETURNED', { actorType: 'ADMIN' })).rejects.toThrow('SIGTERM');
    jest.restoreAllMocks();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } })).status).toBe('RETURNED');
    expect(await markerOf(s.order.id)).toBeNull();
    expect(await balanceOf(s.user.id)).toBe(EARNED + USED);
    expect(await ledger(s.order.id, 'ORDER_REVERSED:')).toHaveLength(0);
    expect(await prisma.commission.findMany({ where: { orderId: s.order.id }, select: { status: true } })).toEqual([{ status: 'LOCKED' }]);
    return s;
  }

  async function expectReversedOnce(s: Awaited<ReturnType<typeof deliveredOrder>>) {
    expect(await balanceOf(s.user.id)).toBe(USED);
    expect(await ledger(s.order.id, 'ORDER_REVERSED:')).toHaveLength(1);
    expect(await ledger(s.order.id, 'ORDER_REFUND_POINTS:')).toHaveLength(1);
    expect(await prisma.commission.findMany({ where: { orderId: s.order.id }, select: { status: true } })).toEqual([{ status: 'REJECTED' }]);
  }

  it('lần huỷ/trả trọn vẹn ghi mốc ngay: cron không còn thấy đơn', async () => {
    const s = await deliveredOrder();
    await orderStatus.setStatus(s.order.id, 'RETURNED', { actorType: 'ADMIN' });
    await expectReversedOnce(s);
    expect(await markerOf(s.order.id)).not.toBeNull();

    await age(s.order.id, 20 * MIN);
    const spy = jest.spyOn(orderStatus, 'resyncReversalEffects');
    await cron.resyncPending();
    expect(mineScanned(spy, [s.order.id])).toEqual([]);
  });

  it('tiến trình chết sau commit: cron chạy lại → điểm tích và hoa hồng đảo đúng một lần, báo khách một lần, ghi mốc; lượt sau không làm gì', async () => {
    const s = await returnedButProcessDied();
    expect(notify.mock.calls.filter(([u, t]) => u === s.user.id && t === 'ORDER_RETURNED')).toHaveLength(1);
    await age(s.order.id, 20 * MIN);

    const res = await cron.resyncPending();

    expect(res).toMatchObject({ scanned: expect.any(Number), failed: 0 });
    await expectReversedOnce(s);
    expect(await markerOf(s.order.id)).not.toBeNull();
    expect(notify.mock.calls.filter(([u, t]) => u === s.user.id && t === 'ORDER_RETURNED')).toHaveLength(1);

    const spy = jest.spyOn(orderStatus, 'resyncReversalEffects');
    await cron.resyncPending();
    expect(mineScanned(spy, [s.order.id])).toEqual([]);
    await expectReversedOnce(s);
  });

  it('huỷ đơn WALLET đã lên Pancake mà chết sau commit (chưa kịp xếp lệnh huỷ, chưa báo): cron xếp lệnh huỷ Pancake và báo khách đúng một lần', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'CONFIRMED',
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
      pancakeOrderId: `pk-it-${randCode(8)}`,
    });
    // Chết đúng giữa commit và các bước sau: không bước nào của setStatus sau commit chạy được. Mô phỏng bằng đơn đã commit CANCELLED.
    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
      await tx.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: 'CONFIRMED', toStatus: 'CANCELLED', actorType: 'ADMIN' } });
    });
    await age(order.id, 20 * MIN);

    await cron.resyncPending();

    expect(hooks.afterLocalCancel.mock.calls.filter(([id]) => id === order.id)).toEqual([[order.id, undefined]]);
    expect(notify.mock.calls.filter(([u, t]) => u === user.id && t === 'ORDER_CANCELLED')).toHaveLength(1);
    expect(await markerOf(order.id)).not.toBeNull();

    await cron.resyncPending();
    expect(hooks.afterLocalCancel.mock.calls.filter(([id]) => id === order.id)).toHaveLength(1);
  });

  it('hai cron chạy song song (hai replica): chỉ một bên quét, đảo đúng một lần', async () => {
    const s = await returnedButProcessDied();
    await age(s.order.id, 20 * MIN);
    const other = new ReversalEffectsResyncCron(prisma, orderStatus);

    const r = summarize(await Promise.allSettled([cron.resyncPending(), other.resyncPending()]));

    expect(r.rejected).toHaveLength(0);
    await expectReversedOnce(s);
    expect(await markerOf(s.order.id)).not.toBeNull();
    expect(notify.mock.calls.filter(([u, t]) => u === s.user.id && t === 'ORDER_RETURNED')).toHaveLength(1);
  });

  it('cron và lần gọi tay cùng lúc trên một đơn (không qua khoá cron): điểm và hoa hồng vẫn đảo đúng một lần', async () => {
    const s = await returnedButProcessDied();

    const r = summarize(
      await Promise.allSettled([
        orderStatus.resyncReversalEffects(s.order.id),
        orderStatus.resyncReversalEffects(s.order.id),
        orderStatus.setStatus(s.order.id, 'RETURNED', { actorType: 'ADMIN' }),
      ]),
    );

    expect(r.rejected).toHaveLength(0);
    await expectReversedOnce(s);
    expect(await markerOf(s.order.id)).not.toBeNull();
  });

  it('chỉ quét đơn chưa có mốc, quá 5 phút và trong 14 ngày: đơn huỷ trước migration (có mốc), đơn vừa huỷ, đơn quá cũ không bị quét', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    const mk = (reversalEffectsAt: Date | null) => createOrder(prisma, { userId: user.id, status: 'CANCELLED', paymentMethod: 'COD', reversalEffectsAt });
    const due = await mk(null);
    const withMarker = await mk(new Date(Date.now() - 30 * DAY));
    const justNow = await mk(null);
    const tooOld = await mk(null);
    await age(due.id, 20 * MIN);
    await age(withMarker.id, 20 * MIN);
    await age(justNow.id, 1 * MIN);
    await age(tooOld.id, 20 * DAY);
    const spy = jest.spyOn(orderStatus, 'resyncReversalEffects');

    await cron.resyncPending();

    expect(mineScanned(spy, [due.id, withMarker.id, justNow.id, tooOld.id])).toEqual([due.id]);
  });
});
