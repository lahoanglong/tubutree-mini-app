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
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { createOrder, createUser, markReversalEffectsDone, warmPool } from './helpers';

/**
 * "Đã xử lý" việc Pancake/thu gom ghi một dòng lịch sử đơn cùng trạng thái. Với đơn huỷ/trả mà phần đảo sau commit chưa xong, cron
 * chạy lại (resyncReversalEffects) lấy dòng lịch sử mới nhất có toStatus = trạng thái đơn làm "dòng đóng đơn": dòng của admin chen vào
 * sẽ đổi người đóng đơn và mốc "tin đã gửi từ lúc nào", khiến khách nhận tin huỷ lần hai.
 */
describe('Đã xử lý việc Pancake khi đơn huỷ chưa xong phần đảo: cron chạy lại không nhầm dòng đóng đơn (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let admin: AdminService;
  const hooks = { afterLocalCancel: jest.fn().mockResolvedValue(undefined), precheckCancel: jest.fn().mockResolvedValue({ kind: 'NONE' }) };
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
    const none = {} as never;
    admin = new AdminService(prisma, none, none, none, none, none, none, none, none, none);
    jest.spyOn((admin as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await markReversalEffectsDone(prisma);
    notify.mockClear();
    hooks.afterLocalCancel.mockClear();
  });

  /** Đơn khách tự huỷ đã commit (CANCELLED, tin huỷ đã đi) nhưng phần đảo sau commit chưa có mốc; Pancake đang báo cần xử lý. */
  async function cancelledByCustomerNotDone() {
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'CANCELLED',
      reversalEffectsAt: null,
      pancakeCancelStatus: 'DONE',
      pancakeAttention: 'Pancake báo đơn bị xoá',
      pancakeAttentionAt: new Date(),
    });
    await prisma.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: 'CONFIRMED', toStatus: 'CANCELLED', actorType: 'CUSTOMER', actorId: user.id } });
    await notify(user.id, 'ORDER_CANCELLED', { order_code: order.code });
    return { user, order };
  }

  it('kho bấm "Đã xử lý" giữa lúc cron chưa chạy: đơn rời hàng đợi, không có dòng lịch sử của admin, cron không gửi tin huỷ lần hai và không huỷ Pancake lại', async () => {
    const { user, order } = await cancelledByCustomerNotDone();
    const admin1 = await createUser(prisma, { role: 'ADMIN' });

    await admin.resolvePancakeAttention(admin1.id, order.code, 'đã gọi hãng');

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { pancakeAttentionAt: true, reversalEffectsAt: true } });
    expect(after.pancakeAttentionAt).toBeNull();
    expect(after.reversalEffectsAt).toBeNull();
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, actorType: 'ADMIN' } })).toBe(0);

    notify.mockClear();
    await expect(orderStatus.resyncReversalEffects(order.id)).resolves.toEqual({ outcome: 'DONE' });
    expect(notify.mock.calls.filter(([u, t]) => u === user.id && t === 'ORDER_CANCELLED')).toHaveLength(0);
    expect(hooks.afterLocalCancel).not.toHaveBeenCalled();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { reversalEffectsAt: true } })).reversalEffectsAt).not.toBeNull();
  });

  it('đơn đã xong phần đảo (có mốc) thì "Đã xử lý" vẫn ghi dòng lịch sử của admin như thường', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'CANCELLED',
      pancakeCancelStatus: 'DONE',
      pancakeAttention: 'Pancake báo đơn bị xoá',
      pancakeAttentionAt: new Date(),
    });
    const admin1 = await createUser(prisma, { role: 'ADMIN' });

    await admin.resolvePancakeAttention(admin1.id, order.code);

    const rows = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id, actorType: 'ADMIN' }, select: { fromStatus: true, toStatus: true, note: true } });
    expect(rows).toEqual([{ fromStatus: 'CANCELLED', toStatus: 'CANCELLED', note: 'Đã xử lý việc Pancake: Pancake báo đơn bị xoá' }]);
  });
});
