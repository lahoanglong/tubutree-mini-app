import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { createDealer, pinConfig, randCode, warmPool } from './helpers';

/** Luật đơn sỉ đã chốt (tối thiểu 3 triệu, miễn phí giao từ 5 triệu, khoá mua chịu quá hạn) trên Postgres thật. */
describe('DealerService.placeOrder luật đơn sỉ (real Postgres)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let dealer: DealerService;
  let tierId: string;
  const restores: (() => Promise<void>)[] = [];
  const variationOf: Record<number, string> = {};

  async function variation(price: number) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itor-p-${tag}`, brand: 'IT', slug: `itor-${tag.toLowerCase()}`, name: `SP IT ${tag}`, description: 'IT', basePrice: price, thumbnail: `https://img.test/${tag}.jpg` },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `itor-v-${tag}`, productId: product.id, sku: `ITOR-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: price, stock: 1000 },
    });
    return v.id;
  }

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
    for (const [k, v] of [
      ['dealer.min_order_value_vnd', 3_000_000],
      ['dealer.free_ship_threshold_vnd', 5_000_000],
      ['dealer.shipping_fee_below_threshold_vnd', 19_000],
      ['dealer.block_credit_when_overdue', true],
    ] as const) restores.push(await pinConfig(prisma, k, v));
    dealer = moduleRef.get(DealerService);
    for (const price of [2_999_999, 4_000_000, 5_000_000]) variationOf[price] = await variation(price);
    tierId = `it-tier-${randCode(6)}`;
    await prisma.dealerTier.create({
      data: { id: tierId, name: 'IT NET15', minOrderVolume: 0, discountRules: { default: 0 }, creditLimit: 100_000_000, paymentTerms: 'NET 15' },
    });
  });

  afterAll(async () => {
    for (const restore of restores.reverse()) await restore();
    await moduleRef?.close();
  });

  const newDealer = () => createDealer(prisma, { metadata: { dealerTierId: tierId } });
  const order = (userId: string, price: number, paymentMethod: 'PREPAID' | 'CREDIT') =>
    dealer.placeOrder(userId, { items: [{ variationId: variationOf[price]!, quantity: 1 }], paymentMethod } as never);

  it('đơn 2.999.999đ bị 400, không có đơn nào được tạo', async () => {
    const d = await newDealer();
    await expect(order(d.id, 2_999_999, 'PREPAID')).rejects.toMatchObject({ status: 400 });
    expect(await prisma.order.count({ where: { userId: d.id } })).toBe(0);
  });

  it('đơn 4.000.000đ thu phí giao 19.000đ; đơn 5.000.000đ miễn phí giao', async () => {
    const d = await newDealer();
    const four = await order(d.id, 4_000_000, 'PREPAID');
    const five = await order(d.id, 5_000_000, 'PREPAID');
    const rows = await prisma.order.findMany({ where: { id: { in: [four.id, five.id] } }, select: { id: true, subtotal: true, shippingFee: true, total: true } });
    const by = new Map(rows.map((r) => [r.id, r]));
    expect(by.get(four.id)).toMatchObject({ subtotal: 4_000_000, shippingFee: 19_000, total: 4_019_000 });
    expect(by.get(five.id)).toMatchObject({ subtotal: 5_000_000, shippingFee: 0, total: 5_000_000 });
  });

  it('đơn ghi công nợ ghi nợ đúng total gồm phí giao', async () => {
    const d = await newDealer();
    const o = await order(d.id, 4_000_000, 'CREDIT');
    const row = await prisma.dealerCreditLedger.findFirstOrThrow({ where: { userId: d.id, refType: 'ORDER', refId: o.id } });
    expect(row.delta).toBe(4_019_000);
  });

  it('nợ đơn NET 15 đã 16 ngày: CREDIT bị 400 và không ghi thêm nợ, PREPAID vẫn đặt được; trả đủ thì hết khoá', async () => {
    const d = await newDealer();
    await prisma.dealerCreditLedger.create({
      data: { userId: d.id, delta: 15_000_000, refType: 'ORDER', refId: `old-${randCode(6)}`, createdAt: new Date(Date.now() - 16 * DAY) },
    });
    await expect(order(d.id, 4_000_000, 'CREDIT')).rejects.toThrow(/quá hạn/);
    expect(await prisma.dealerCreditLedger.count({ where: { userId: d.id } })).toBe(1);
    await expect(order(d.id, 4_000_000, 'PREPAID')).resolves.toBeDefined();

    await prisma.dealerCreditLedger.create({ data: { userId: d.id, delta: -15_000_000, refType: 'PAYMENT', note: 'IT' } });
    await expect(order(d.id, 4_000_000, 'CREDIT')).resolves.toBeDefined();
  });
});
