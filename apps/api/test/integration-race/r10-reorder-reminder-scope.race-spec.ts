import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

const DAY = 864e5;

/**
 * Nhắc mua lại (REORDER_REMINDER) trên Postgres thật: chỉ đơn bán lẻ khách tự mua. Đơn CTV lên hộ mang userId của CTV (người
 * dùng SP là khách của họ) và đơn đại lý là hàng buôn — người nhận tin không phải người dùng SP.
 */
describe('Nhắc mua lại chỉ cho đơn bán lẻ khách tự mua (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let lifecycle: LifecycleService;
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    lifecycle = new LifecycleService(prisma, moduleRef.get(SystemConfigService), { notify } as unknown as NotificationsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => notify.mockClear());

  async function variation() {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itr10-p-${tag}`, brand: 'IT', slug: `itr10-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    return prisma.variation.create({
      data: { pancakeId: `itr10-v-${tag}`, productId: product.id, sku: `ITR10-${tag}`, name: 'Hũ', attributes: {}, retailPrice: 100_000, stock: 10 },
    });
  }

  async function delivered(userId: string, over: Record<string, unknown> = {}) {
    const v = await variation();
    await createOrder(prisma, {
      userId,
      status: 'DELIVERED',
      createdAt: new Date(Date.now() - 60 * DAY),
      deliveredAt: new Date(Date.now() - 58 * DAY),
      items: { create: { variationId: v.id, productName: 'SP IT', variationName: 'Hũ', unitPrice: 100_000, quantity: 1, total: 100_000 } },
      ...over,
    });
    return v.id;
  }

  it('khách tự mua bán lẻ được nhắc; CTV (đơn lên hộ khách) và đại lý (đơn buôn) không', async () => {
    const customer = await createUser(prisma, { role: 'CUSTOMER' });
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const dealer = await createUser(prisma, { role: 'DEALER' });
    const customerVariation = await delivered(customer.id);
    const ctvVariation = await delivered(ctv.id, { placedForCustomer: true, endCustomerKey: '0900000001' });
    const dealerVariation = await delivered(dealer.id, { type: 'DEALER' });

    await lifecycle.sendReorderReminders();

    const mine = new Set([customer.id, ctv.id, dealer.id]);
    const reminded = notify.mock.calls.filter((c: unknown[]) => mine.has(c[0] as string) && c[1] === 'REORDER_REMINDER');
    expect(reminded.map((c: unknown[]) => c[0])).toEqual([customer.id]);
    expect((reminded[0]![2] as { variation_id: string }).variation_id).toBe(customerVariation);

    const rows = await prisma.reorderReminder.findMany({ where: { userId: { in: [customer.id, ctv.id, dealer.id] } } });
    expect(rows.map((r) => r.userId)).toEqual([customer.id]);
    expect(rows.some((r) => [ctvVariation, dealerVariation].includes(r.variationId))).toBe(false);
  });
});
