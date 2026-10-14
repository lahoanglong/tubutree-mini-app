import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { PancakeSyncHooks } from '../../src/modules/integrations/pancake/pancake-sync-hooks';
import { PancakeApiError } from '../../src/modules/integrations/pancake/pancake-outbound';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import { createOrder, createUser, randCode, summarize, warmPool } from './helpers';

const UNREACHABLE = 'Kho chưa phản hồi, vui lòng thử lại sau ít phút';
const timeout = () => new PancakeApiError('timeout of 5000ms exceeded', true);

/**
 * D1 khi kho Pancake chậm/vừa lỗi (R3-CANCEL-1, R2-PANCAKE-1, PANCAKE-2) trên Postgres THẬT. Lỗi cũ: Pancake đã "Đã gửi
 * hàng" (2) nhưng webhook chưa về (Tubu còn CONFIRMED); GET Pancake quá 5s, hay một lần timeout ở đơn KHÁC trong 60s
 * trước, là khách/CSKH huỷ được và Ví được cộng lại ngay — khách nhận cả tiền lẫn hàng. Stub: PancakeClient (HTTP),
 * hàng đợi BullMQ, thông báo, hoa hồng.
 */
describe('Huỷ đơn đã lên Pancake khi không hỏi được Pancake (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orders: OrdersService;
  let status: OrderStatusService;
  let hooks: PancakeSyncHooks;

  const queue = { name: 'pancake-push', getJob: jest.fn().mockResolvedValue(null), add: jest.fn().mockResolvedValue({}) };
  const client = {
    isConfigured: jest.fn().mockReturnValue(true),
    searchOrders: jest.fn().mockResolvedValue([]),
    getOrder: jest.fn(),
    updateOrder: jest.fn(),
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    hooks = new PancakeSyncHooks(prisma, client as unknown as PancakeClient, queue as never);
    const app = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        OrdersService,
        { provide: PancakeSyncHooks, useValue: hooks },
        { provide: CartService, useValue: {} },
        {
          provide: AffiliateService,
          useValue: { reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined), lockCommissionsForOrder: jest.fn() },
        },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await app.init();
    orders = app.get(OrdersService);
    status = app.get(OrderStatusService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    client.isConfigured.mockReturnValue(true);
  });

  async function paidOnPancake(overrides: Record<string, unknown> = {}, total = 114_000) {
    const user = await createUser(prisma, { walletBalance: 3_005_000 });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'CONFIRMED',
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
      total,
      subtotal: total,
      pancakeOrderId: `pk-${randCode(8)}`,
      ...overrides,
    });
    return { user, order };
  }

  const walletOf = async (userId: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } })).walletBalance;

  it('(a) khách huỷ, GET Pancake quá hạn → 409 "Kho chưa phản hồi…", đơn vẫn CONFIRMED + PAID, Ví không đổi', async () => {
    const { user, order } = await paidOnPancake();
    client.getOrder.mockRejectedValue(timeout());

    const err = (await orders.cancel(user.id, order.code, { method: 'WALLET' } as never).catch((e: unknown) => e)) as {
      getStatus(): number;
      message: string;
    };
    expect(err.getStatus()).toBe(409);
    expect(err.message).toBe(UNREACHABLE);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID', pancakeCancelStatus: null });
    expect(await walletOf(user.id)).toBe(3_005_000);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id } })).toBe(0);
    expect(client.updateOrder).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('(b) trong 60s sau một lần timeout ở đơn KHÁC, Pancake đã khoẻ và đang "Đã gửi hàng" → vẫn hỏi Pancake, từ chối, đồng bộ về Đang giao', async () => {
    const other = await paidOnPancake();
    client.getOrder.mockRejectedValueOnce(timeout());
    await expect(orders.cancel(other.user.id, other.order.code)).rejects.toThrow(UNREACHABLE);

    const { user, order } = await paidOnPancake();
    client.getOrder.mockResolvedValue({ id: order.pancakeOrderId, status: 2 });
    await expect(orders.cancel(user.id, order.code)).rejects.toThrow('Đơn đã bàn giao cho đơn vị vận chuyển');

    expect(client.getOrder).toHaveBeenLastCalledWith(order.pancakeOrderId, expect.anything());
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'SHIPPING', paymentStatus: 'PAID' });
    expect(await walletOf(user.id)).toBe(3_005_000);
  });

  it('(c) CSKH huỷ (PUT trạng thái) khi Pancake chậm → 409, không hoàn Ví, không cộng kho, không xếp job huỷ', async () => {
    const { user, order } = await paidOnPancake({}, 285_000);
    const staff = await createUser(prisma, { role: 'ADMIN' });
    client.getOrder.mockRejectedValue(timeout());

    await expect(status.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN', actorId: staff.id })).rejects.toThrow(
      /^Kho chưa phản hồi, vui lòng thử lại sau ít phút — đơn /,
    );
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
    expect(await walletOf(user.id)).toBe(3_005_000);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('(d) 8 đơn, khách bấm huỷ 2 lần song song, Pancake lúc trả lời lúc timeout → không đơn nào được hoàn tiền khi Pancake chưa xác nhận huỷ', async () => {
    const fixtures = await Promise.all(
      Array.from({ length: 8 }, (_, i) => paidOnPancake({ pancakeOrderId: `pk-${i % 2 ? 'up' : 'down'}-${randCode(8)}` })),
    );
    const confirmed = new Set<string>();
    client.getOrder.mockImplementation(async (id: string) => {
      if (id.startsWith('pk-down-')) throw timeout();
      return { id, status: 1 };
    });
    client.updateOrder.mockImplementation(async (id: string) => {
      confirmed.add(id);
      return { id, status: 6 };
    });

    const results = await Promise.allSettled(fixtures.flatMap(({ user, order }) => [orders.cancel(user.id, order.code), orders.cancel(user.id, order.code)]));
    for (const e of summarize(results).errors) expect(e).toContain(UNREACHABLE);

    for (const { user, order } of fixtures) {
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      const wallet = await walletOf(user.id);
      if (after.status === 'CANCELLED') {
        expect(confirmed.has(order.pancakeOrderId!)).toBe(true);
        expect(after.paymentStatus).toBe('REFUNDED');
        expect(wallet).toBe(3_005_000 + order.total);
      } else {
        expect(after).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
        expect(wallet).toBe(3_005_000);
      }
    }
  });

  it('(e) đơn CHƯA lên Pancake vẫn huỷ + hoàn Ví bình thường dù Pancake đang lỗi/chưa cấu hình', async () => {
    const { user, order } = await paidOnPancake({ pancakeOrderId: null });
    client.isConfigured.mockReturnValue(false);
    client.getOrder.mockRejectedValue(timeout());

    await orders.cancel(user.id, order.code);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED' });
    expect(await walletOf(user.id)).toBe(3_005_000 + order.total);
    expect(client.getOrder).not.toHaveBeenCalled();
  });
});
