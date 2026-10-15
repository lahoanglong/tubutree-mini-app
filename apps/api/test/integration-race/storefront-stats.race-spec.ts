import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/** StorefrontService.getStats: cùng định nghĩa doanh thu với AffiliateService.storefrontAnalytics. */
describe('StorefrontService.getStats (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: StorefrontService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = new StorefrontService(prisma, moduleRef.get(SystemConfigService), {} as never);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  type Line = { productSlug: string; productName: string; quantity: number; total: number };

  async function setup() {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const other = await createUser(prisma, { role: 'AFFILIATE' });
    const buyer = await createUser(prisma);
    const slug = `it-st-${randCode(8).toLowerCase()}`;
    await prisma.storefront.create({ data: { type: 'CTV', slug, ownerUserId: ctv.id, title: 'Shop IT', isPublished: true } });
    const mk = async (
      status: 'DELIVERED' | 'CONFIRMED' | 'CANCELLED' | 'RETURNED' | 'PENDING_PAYMENT',
      paymentStatus: 'PAID' | 'UNPAID' | 'REFUNDED' | 'FAILED',
      items: Line[],
      extra: { referrerUserId?: string; createdAt?: Date } = {},
    ) => {
      const total = items.reduce((s, i) => s + i.total, 0);
      const order = await createOrder(prisma, {
        userId: buyer.id,
        status,
        paymentStatus,
        total,
        referrerUserId: extra.referrerUserId ?? ctv.id,
        storefrontSlug: slug,
        ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
      });
      const rows = [];
      for (const i of items) {
        rows.push(await prisma.orderItem.create({ data: { orderId: order.id, variationId: 'it-var', variationName: 'v', unitPrice: i.total / i.quantity, ...i } }));
      }
      return { order, items: rows };
    };
    const partialReturn = async (orderId: string, orderItemId: string, quantity: number, refundAmount: number) => {
      const r = await prisma.returnRequest.create({
        data: { orderId, userId: buyer.id, reason: 'IT', status: 'APPROVED', refundAmount, shippingRefund: 0, fullReturn: false },
      });
      await prisma.returnRequestItem.create({ data: { returnRequestId: r.id, orderItemId, quantity, refundAmount } });
    };
    return { ctv, other, mk, partialReturn };
  }

  const honey: Line = { productSlug: 'honey', productName: 'Mật ong', quantity: 3, total: 780_000 };
  const pepper: Line = { productSlug: 'pepper', productName: 'Tiêu', quantity: 2, total: 200_000 };

  it('chỉ đếm đơn bán thật của chính CTV, trừ phần trả một phần, byProduct trừ theo dòng', async () => {
    const { ctv, other, mk, partialReturn } = await setup();
    const a = await mk('DELIVERED', 'PAID', [honey, pepper]);
    await partialReturn(a.order.id, a.items[0].id, 1, 260_000);
    await mk('CANCELLED', 'UNPAID', [honey]);
    await mk('RETURNED', 'PAID', [honey]);
    await mk('PENDING_PAYMENT', 'UNPAID', [honey]);
    await mk('DELIVERED', 'REFUNDED', [honey]);
    await mk('DELIVERED', 'FAILED', [honey]);
    await mk('DELIVERED', 'PAID', [honey], { referrerUserId: other.id });
    await mk('DELIVERED', 'PAID', [pepper], { createdAt: new Date(Date.now() - 40 * 864e5) });

    const s = await svc.getStats(ctv.id);
    expect(s.orders30d).toBe(1);
    expect(s.orders7d).toBe(1);
    expect(s.revenue30d).toBe(980_000 - 260_000);
    expect(s.byProduct).toEqual([
      { productSlug: 'honey', productName: 'Mật ong', qty: 2, revenue: 520_000 },
      { productSlug: 'pepper', productName: 'Tiêu', qty: 2, revenue: 200_000 },
    ]);
  });

  it('dòng trả hết = 0, kẹp doanh thu >= 0, không nạp đơn về Node', async () => {
    const { ctv, mk, partialReturn } = await setup();
    const a = await mk('DELIVERED', 'PAID', [pepper]);
    await partialReturn(a.order.id, a.items[0].id, 2, 500_000);
    const findMany = jest.spyOn(prisma.order, 'findMany');
    try {
      const s = await svc.getStats(ctv.id);
      expect(s.revenue30d).toBe(0);
      expect(s.byProduct.every((p) => p.revenue === 0 && p.qty === 0)).toBe(true);
      expect(findMany).not.toHaveBeenCalled();
    } finally {
      findMany.mockRestore();
    }
  });
});
