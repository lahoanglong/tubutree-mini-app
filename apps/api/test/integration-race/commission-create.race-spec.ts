import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { CoinsService } from '../../src/modules/wallet/coins.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { createOrder, createUser, randCode, summarize, warmPool } from './helpers';

/**
 * C-002 / A2-005 (docs/2026-10-review): hoa hồng CTV từng được tạo SAU khi tx đơn commit, lỗi bị
 * `.catch(log)` nuốt và bảng commissions không có unique (orderId, affiliateUserId). Trên Postgres
 * thật: tạo hoa hồng song song chỉ ra đúng 1 dòng, và lỗi tạo hoa hồng làm đơn hộ rollback thay vì
 * để lại đơn không hoa hồng.
 */
describe('Tạo hoa hồng CTV (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        CoinsService,
        AnalyticsEventsService,
        AffiliateService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    affiliate = moduleRef.get(AffiliateService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const randomPhone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

  async function variation(opts: { retailPrice?: number; affiliateRate?: number; stock?: number } = {}) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: `it-p-${tag}`,
        brand: 'IT Brand',
        slug: `it-sp-${tag.toLowerCase()}`,
        name: `SP IT ${tag}`,
        description: 'IT',
        basePrice: opts.retailPrice ?? 100_000,
        isActive: true,
        approvalStatus: 'APPROVED',
      },
    });
    return prisma.variation.create({
      data: {
        pancakeId: `it-v-${tag}`,
        productId: product.id,
        sku: `IT-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: opts.retailPrice ?? 100_000,
        affiliateRate: opts.affiliateRate ?? 10,
        stock: opts.stock ?? 100,
        isActive: true,
      },
    });
  }

  it('10 lần tạo hoa hồng song song cho cùng đơn → đúng 1 dòng, không lần nào lỗi', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const buyer = await createUser(prisma);
    const v = await variation({ retailPrice: 200_000, affiliateRate: 10 });
    const order = await createOrder(prisma, {
      userId: buyer.id,
      referrerUserId: ctv.id,
      total: 200_000,
      items: {
        create: [
          {
            variationId: v.id,
            productName: 'SP IT',
            variationName: 'Mặc định',
            unitPrice: 200_000,
            quantity: 1,
            total: 200_000,
          },
        ],
      },
    });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => affiliate.createCommissionForOrder(order.id)),
    );
    const s = summarize(results);
    const rows = await prisma.commission.findMany({ where: { orderId: order.id } });
    // eslint-disable-next-line no-console
    console.log('[commission x10] fulfilled=%d rejected=%d rows=%d errors=%j', s.fulfilled.length, s.rejected.length, rows.length, [...new Set(s.errors)]);

    expect(s.rejected).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.affiliateUserId).toBe(ctv.id);
    expect(rows[0]!.amount).toBe(20_000);
  });

  it('DB chặn dòng hoa hồng thứ 2 cho cùng (đơn, người hưởng)', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const buyer = await createUser(prisma);
    const order = await createOrder(prisma, { userId: buyer.id, referrerUserId: ctv.id });
    const row = { affiliateUserId: ctv.id, orderId: order.id, orderTotal: 100_000, rate: 10, amount: 10_000 };
    await prisma.commission.create({ data: row });

    await expect(prisma.commission.create({ data: row })).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.commission.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('đơn hộ: hoa hồng có ngay khi đơn trả về (cùng tx)', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: randomPhone() });
    const v = await variation({ retailPrice: 150_000, affiliateRate: 10 });

    const order = await affiliate.placeOrderForCustomer(ctv.id, {
      paymentMethod: 'COD',
      items: [{ variationId: v.id, quantity: 2 }],
      customer: {
        recipient: 'Khach IT',
        phone: randomPhone(),
        province: 'Ha Noi',
        ward: 'Phuong IT',
        street: '1 Duong IT',
        provinceCode: '01',
        wardCode: '00001',
      },
    } as never);

    const rows = await prisma.commission.findMany({ where: { orderId: order.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.affiliateUserId).toBe(ctv.id);
    expect(rows[0]!.amount).toBe(30_000);
  });

  it('đơn hộ: tạo hoa hồng lỗi → đơn rollback (không đơn mồ côi, kho không bị trừ), lỗi không bị nuốt', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: randomPhone() });
    const v = await variation({ retailPrice: 150_000, affiliateRate: 10, stock: 50 });
    const spy = jest.spyOn(affiliate, 'createCommissionForOrder').mockRejectedValueOnce(new Error('db blip'));
    const ordersBefore = await prisma.order.count({ where: { userId: ctv.id } });

    try {
      await expect(
        affiliate.placeOrderForCustomer(ctv.id, {
          paymentMethod: 'COD',
          items: [{ variationId: v.id, quantity: 3 }],
          customer: {
            recipient: 'Khach IT',
            phone: randomPhone(),
            province: 'Ha Noi',
            ward: 'Phuong IT',
            street: '1 Duong IT',
            provinceCode: '01',
            wardCode: '00001',
          },
        } as never),
      ).rejects.toThrow('db blip');
    } finally {
      spy.mockRestore();
    }

    expect(await prisma.order.count({ where: { userId: ctv.id } })).toBe(ordersBefore);
    const after = await prisma.variation.findUniqueOrThrow({ where: { id: v.id } });
    expect(after.stock).toBe(50);
  });
});
