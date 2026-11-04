import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { ATTENTION_PAYMENT_UNLINKED_CLOSED } from '../../src/modules/integrations/pancake/pancake-attention';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { createOrder, createUser, warmPool } from './helpers';

/**
 * Webhook Pancake báo "đã thanh toán" cho đơn Tubu chưa gắn đơn Pancake: hai worker xử lý cùng cặp (đơn, đơn Pancake) cùng lúc
 * chỉ được ghi một dòng lịch sử và gửi một báo động (real Postgres).
 */
describe('Giữ khoản thanh toán chưa gắn Pancake: hai worker đua cùng cặp (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let proc: { holdUnattachedPayment(order: unknown, data: Record<string, unknown>, reported: number): Promise<void> };
  const alerts = { alert: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        OrderStatusService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } },
      ],
    })
      .useMocker(() => ({}))
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    proc = new PancakeProcessor(prisma, moduleRef.get(NotificationsService), moduleRef.get(OrderStatusService), alerts as never) as unknown as typeof proc;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => alerts.alert.mockClear());

  it('hai lần ghi đồng thời cùng cặp (đơn, đơn Pancake) → 1 dòng lịch sử, 1 báo động; cặp khác vẫn ghi', async () => {
    for (let round = 0; round < 10; round++) {
      alerts.alert.mockClear();
      const user = await createUser(prisma);
      const order = await createOrder(prisma, { userId: user.id, status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100_000, pancakeOrderId: null });
      await Promise.all([proc.holdUnattachedPayment(order, { id: 'PK-A' }, 100_000), proc.holdUnattachedPayment(order, { id: 'PK-A' }, 100_000)]);
      const rows = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id, actorType: 'PANCAKE' } });
      expect(rows).toHaveLength(1);
      expect(alerts.alert).toHaveBeenCalledTimes(1);
      await proc.holdUnattachedPayment(order, { id: 'PK-B' }, 100_000);
      expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, actorType: 'PANCAKE' } })).toBe(2);
      expect(alerts.alert).toHaveBeenCalledTimes(2);
    }
  });
  it('đơn bị huỷ chen vào giữa lúc đọc đơn và lúc khoá → quyết định theo trạng thái SAU khoá: lý do "đã huỷ/trả", lịch sử fromStatus CANCELLED', async () => {
    const user = await createUser(prisma);
    const order = await createOrder(prisma, { userId: user.id, status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100_000, pancakeOrderId: null });
    const stale = { ...order };
    await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    await proc.holdUnattachedPayment(stale, { id: 'PK-C' }, 100_000);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { pancakeAttention: true } });
    expect(after.pancakeAttention).toContain(ATTENTION_PAYMENT_UNLINKED_CLOSED);
    const row = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: order.id, actorType: 'PANCAKE' } });
    expect([row.fromStatus, row.toStatus]).toEqual(['CANCELLED', 'CANCELLED']);
    expect(alerts.alert.mock.calls[0][1]).toContain('Đơn đã huỷ/trả');
  });
  it('markPaid commit trước khi khoá: bản đơn cũ báo UNPAID nhưng DB đã PAID → không ghi lịch sử, không báo động, không ghim lý do', async () => {
    const user = await createUser(prisma);
    const order = await createOrder(prisma, { userId: user.id, status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 100_000, pancakeOrderId: null });
    const stale = { ...order };
    await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID' } });
    await proc.holdUnattachedPayment(stale, { id: 'PK-D' }, 100_000);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, actorType: 'PANCAKE' } })).toBe(0);
    expect(alerts.alert).not.toHaveBeenCalled();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { pancakeAttention: true } })).pancakeAttention).toBeNull();
  });
});
