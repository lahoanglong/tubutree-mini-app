import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { createDealer, createUser, randCode, summarize, warmPool } from './helpers';

/** C-008: hạn mức công nợ đơn CREDIT trên Postgres thật — có tier (trần thật) và không tier (trần 0). */
describe('DealerService.placeOrder CREDIT limit (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let dealer: DealerService;
  let variationId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        DealerService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
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
});
