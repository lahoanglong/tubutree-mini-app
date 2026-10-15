import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PANCAKE_PUSH, PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { PancakeSyncHooks } from '../../src/modules/integrations/pancake/pancake-sync-hooks';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import { PancakeApiError } from '../../src/modules/integrations/pancake/pancake-outbound';
import { pancakeUnsyncedWhere } from '../../src/modules/admin/admin-order-filter';
import { createOrder, createUser, randCode, sleep, summarize, warmPool } from './helpers';

/**
 * Đẩy đơn sang Pancake trên Postgres thật (PANCAKE-4, BUYERMINI-5, ADMINOPS-5, PLATFORM-2, PANCAKE-3):
 * job push, job thanh toán, cron cứu hộ và nút "Đẩy lại" có thể chạm cùng một đơn cùng lúc — chỉ được MỘT lệnh tạo
 * đơn kho. Stub: PancakeClient (HTTP) và BullMQ queue.
 */
describe('Pancake push race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: PancakeOrderService;
  let hooks: PancakeSyncHooks;

  const queue = {
    name: 'pancake-push',
    getJob: jest.fn().mockResolvedValue(null),
    add: jest.fn().mockResolvedValue({}),
  };
  const client = {
    isConfigured: jest.fn().mockReturnValue(true),
    createOrder: jest.fn(),
    searchOrders: jest.fn().mockResolvedValue([]),
    getOrder: jest.fn(),
    updateOrder: jest.fn(),
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    service = new PancakeOrderService(prisma, client as unknown as PancakeClient, queue as never);
    hooks = new PancakeSyncHooks(prisma, client as unknown as PancakeClient, queue as never);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => {
    client.createOrder.mockReset();
    client.searchOrders.mockReset().mockResolvedValue([]);
    queue.add.mockClear();
  });

  /** Biến thể kho Tubu có mã Pancake thật: dòng không có mã Pancake (hàng gian hàng, biến thể đã xoá) không bao giờ được gửi. */
  const tubuVariationId = async () => {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itpp-p-${tag}`, fulfilment: 'TUBU', brand: 'IT', slug: `itpp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `itpp-v-${tag}`, productId: product.id, sku: `ITPP-${tag}`, name: '1kg', attributes: {}, retailPrice: 100_000, stock: 20 },
    });
    return v.id;
  };

  const order = async (data: Record<string, unknown> = {}) => {
    const buyer = await createUser(prisma);
    return createOrder(prisma, {
      userId: buyer.id,
      total: 130_000,
      subtotal: 100_000,
      shippingFee: 30_000,
      items: {
        create: [{ variationId: await tubuVariationId(), productName: 'SP IT', variationName: '1kg', unitPrice: 100_000, quantity: 1, total: 100_000 }],
      },
      ...data,
    });
  };

  it('8 lần đẩy đồng thời cùng một đơn → đúng MỘT lệnh tạo đơn Pancake, đơn lưu đúng id đó', async () => {
    const o = await order();
    const pkId = `pk-${randCode(8)}`;
    client.createOrder.mockImplementation(async () => {
      await sleep(150);
      return { success: true, data: { id: pkId } };
    });

    const results = await Promise.allSettled(Array.from({ length: 8 }, () => service.pushOrder(o.id)));
    const s = summarize(results);
    console.log('[push x8] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, [...new Set(s.errors)]);

    expect(client.createOrder).toHaveBeenCalledTimes(1);
    // Kẻ thua: hoặc thấy id đã lưu, hoặc lỗi tạm "đang được đẩy" (BullMQ thử lại → lần sau trả id có sẵn).
    for (const r of s.rejected) {
      expect(r.reason).toBeInstanceOf(PancakeApiError);
      expect((r.reason as PancakeApiError).transient).toBe(true);
    }
    for (const r of s.fulfilled) expect(r.value).toBe(pkId);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(saved).toMatchObject({ pancakeOrderId: pkId, pancakePushStatus: PANCAKE_PUSH.SYNCED, pancakePushClaimedAt: null, pancakePushAttempts: 1 });
    expect(await service.pushOrder(o.id)).toBe(pkId);
  });

  it('timeout khi tạo, rồi job lặp lại chạy song song → tra theo mã đơn và nhận đơn đã có, không tạo thêm', async () => {
    const o = await order();
    client.createOrder.mockRejectedValueOnce(new PancakeApiError('timeout of 15000ms exceeded', true));
    await expect(service.pushOrder(o.id)).rejects.toThrow('timeout');

    const pkId = `pk-${randCode(8)}`;
    client.searchOrders.mockImplementation(async () => {
      await sleep(100);
      return [{ id: pkId, status: 0, custom_id: o.code }];
    });
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => service.pushOrder(o.id)));
    expect(summarize(results).fulfilled.map((r) => r.value)).toContain(pkId);
    expect(client.createOrder).toHaveBeenCalledTimes(1);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(saved.pancakeOrderId).toBe(pkId);
  });

  it('đơn bị huỷ ở Tubu trong lúc lệnh tạo đang bay → id vẫn được lưu và job huỷ Pancake được xếp', async () => {
    const o = await order();
    const pkId = `pk-${randCode(8)}`;
    let release!: () => void;
    const created = new Promise<void>((r) => (release = r));
    client.createOrder.mockImplementation(async () => {
      await created;
      return { id: pkId };
    });

    const push = service.pushOrder(o.id);
    await sleep(100);
    // Khách huỷ: hỏi Pancake lúc này chưa có đơn → NONE; lật CANCELLED; ghi kết quả.
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    const decision = await hooks.precheckCancel(fresh, 'INTERACTIVE');
    await prisma.order.update({ where: { id: o.id }, data: { status: 'CANCELLED' } });
    await hooks.afterLocalCancel(o.id, decision);
    release();
    expect(await push).toBe(pkId);

    const saved = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(saved).toMatchObject({ status: 'CANCELLED', pancakeOrderId: pkId, pancakeCancelStatus: 'PENDING' });
    expect(queue.add).toHaveBeenCalledWith('cancel', { orderId: o.id }, { jobId: `cancel-${o.id}` });
  });

  it('đơn đại lý đã trả tiền nhưng còn hàng đặt trước → không lên kho, không vào "Chưa lên Pancake"; đủ hàng mới đẩy một lần (R1)', async () => {
    const buyer = await createUser(prisma);
    const o = await createOrder(prisma, {
      userId: buyer.id,
      type: 'DEALER',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'PAID',
      total: 100_000,
      subtotal: 100_000,
      shippingFee: 0,
      createdAt: new Date(Date.now() - 3_600_000),
      items: {
        create: [
          { variationId: await tubuVariationId(), productName: 'SP IT', variationName: '1kg', unitPrice: 50_000, quantity: 2, total: 100_000, backorderedQty: 1 },
        ],
      },
    });
    const pkId = `pk-${randCode(8)}`;
    client.createOrder.mockImplementation(async () => {
      await sleep(100);
      return { id: pkId };
    });

    await service.syncPayment(o.id);
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({
      pancakeOrderId: null,
      pancakePushStatus: PANCAKE_PUSH.WAITING_STOCK,
      pancakePushClaimedAt: null,
    });
    expect(await prisma.order.count({ where: { id: o.id, ...pancakeUnsyncedWhere() } })).toBe(0);
    await expect(service.retryPushByAdmin('admin-it', o.id)).rejects.toThrow('còn hàng đặt trước');

    await prisma.orderItem.updateMany({ where: { orderId: o.id }, data: { backorderedQty: 0 } });
    const results = await Promise.allSettled([service.pushOrder(o.id), service.syncPayment(o.id), service.pushOrder(o.id)]);
    console.log('[dealer filled x3] %j', summarize(results).errors);
    expect(client.createOrder).toHaveBeenCalledTimes(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).pancakeOrderId).toBe(pkId);
  });

  it('job push chạy lại sau khi đơn đã huỷ → không tạo đơn kho (PANCAKE-3)', async () => {
    const o = await order({ status: 'CANCELLED' });
    expect(await service.pushOrder(o.id)).toBeNull();
    expect(client.createOrder).not.toHaveBeenCalled();
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(saved.pancakePushStatus).toBe(PANCAKE_PUSH.SKIPPED);
  });
});
