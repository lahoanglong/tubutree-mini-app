import { ServiceUnavailableException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { createDealer, pinDealerOrderRulesOff, randCode, summarize, warmPool } from './helpers';

/** C-008: hạn mức công nợ đơn CREDIT trên Postgres thật — có tier (trần thật) và không tier (trần 0). */
describe('DealerService.placeOrder CREDIT limit (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let dealer: DealerService;
  let variationId: string;
  let restoreRules: () => Promise<void>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        DealerService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    restoreRules = await pinDealerOrderRulesOff(prisma);
    dealer = moduleRef.get(DealerService);

    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: `it-p-${tag}`,
        brand: 'IT Brand',
        slug: `it-sp-${tag.toLowerCase()}`,
        name: `SP IT ${tag}`,
        description: 'IT',
        basePrice: 100_000,
        thumbnail: `https://img.test/${tag}.jpg`,
      },
    });
    const v = await prisma.variation.create({
      data: {
        pancakeId: `it-v-${tag}`,
        productId: product.id,
        sku: `IT-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 100_000,
        stock: 100_000,
      },
    });
    variationId = v.id;
  });

  afterAll(async () => {
    await restoreRules?.();
    await moduleRef?.close();
  });

  it('đại lý không tier: 4 đơn CREDIT đồng thời đều bị từ chối, sổ công nợ = 0, không có đơn', async () => {
    const d = await createDealer(prisma);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        dealer.placeOrder(d.id, { items: [{ variationId, quantity: 1000 }], paymentMethod: 'CREDIT' } as never),
      ),
    );
    const s = summarize(results);
    const ledger = await prisma.dealerCreditLedger.aggregate({ where: { userId: d.id }, _sum: { delta: true } });
    const orders = await prisma.order.count({ where: { userId: d.id } });
    console.log('[c008] fulfilled=%d rejected=%d debt=%j orders=%d', s.fulfilled.length, s.rejected.length, ledger._sum.delta, orders);
    expect(s.fulfilled.length).toBe(0);
    expect(ledger._sum.delta ?? 0).toBe(0);
    expect(orders).toBe(0);
  });

  it('đại lý có tier hạn mức 160.000: 5 đơn CREDIT 80.000 đồng thời → tổng nợ không vượt hạn mức', async () => {
    const tierId = `it-tier-${randCode(6)}`;
    await prisma.dealerTier.create({
      data: { id: tierId, name: 'IT', minOrderVolume: 0, discountRules: { default: 0.2 }, creditLimit: 160_000 },
    });
    const d = await createDealer(prisma, { metadata: { dealerTierId: tierId } });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        dealer.placeOrder(d.id, { items: [{ variationId, quantity: 1 }], paymentMethod: 'CREDIT' } as never),
      ),
    );
    const s = summarize(results);
    const ledger = await prisma.dealerCreditLedger.aggregate({ where: { userId: d.id }, _sum: { delta: true } });
    console.log('[c008] fulfilled=%d rejected=%d debt=%j', s.fulfilled.length, s.rejected.length, ledger._sum.delta);
    expect(ledger._sum.delta ?? 0).toBeLessThanOrEqual(160_000);
    expect(s.fulfilled.length).toBeLessThanOrEqual(2);
    expect(s.fulfilled.length).toBeGreaterThanOrEqual(1);
  });

  const creditTier = async (creditLimit: number) => {
    const tierId = `it-tier-${randCode(6)}`;
    await prisma.dealerTier.create({
      data: { id: tierId, name: 'IT', minOrderVolume: 0, discountRules: { default: 0.2 }, creditLimit },
    });
    return tierId;
  };

  it('6 đơn CREDIT đồng thời không key: chỉ 201 hoặc 503, không lỗi khác; công nợ khớp tổng đơn đã tạo', async () => {
    const d = await createDealer(prisma, { metadata: { dealerTierId: await creditTier(100_000_000) } });
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        dealer.placeOrder(d.id, { items: [{ variationId, quantity: 1 }], paymentMethod: 'CREDIT' } as never),
      ),
    );
    const s = summarize(results);
    const unexpected = s.rejected.filter((r) => !(r.reason instanceof ServiceUnavailableException));
    const orders = await prisma.order.findMany({ where: { userId: d.id }, select: { total: true } });
    const ledger = await prisma.dealerCreditLedger.aggregate({ where: { userId: d.id }, _sum: { delta: true } });
    console.log('[c23] fulfilled=%d busy=%d errors=%j', s.fulfilled.length, s.rejected.length, s.errors);
    expect(unexpected).toEqual([]);
    expect(s.fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(orders.length).toBe(s.fulfilled.length);
    expect(ledger._sum.delta ?? 0).toBe(orders.reduce((sum, o) => sum + o.total, 0));
  });

  it('cùng Idempotency-Key gửi đồng thời 3 lần: đúng 1 đơn, mọi lần thành công trả cùng order id, không lần nào lỗi', async () => {
    const d = await createDealer(prisma, { metadata: { dealerTierId: await creditTier(100_000_000) } });
    const key = `it-key-${randCode(10)}`;
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        dealer.placeOrder(d.id, { items: [{ variationId, quantity: 1 }], paymentMethod: 'CREDIT' } as never, key),
      ),
    );
    const s = summarize(results);
    const orders = await prisma.order.findMany({ where: { userId: d.id }, select: { id: true, total: true } });
    const ledger = await prisma.dealerCreditLedger.aggregate({ where: { userId: d.id }, _sum: { delta: true } });
    console.log('[c23] key fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, s.errors);
    expect(s.errors).toEqual([]);
    expect(orders.length).toBe(1);
    expect(new Set(s.fulfilled.map((r) => (r.value as { id: string }).id))).toEqual(new Set([orders[0]!.id]));
    expect(ledger._sum.delta ?? 0).toBe(orders[0]!.total);
  });
});
