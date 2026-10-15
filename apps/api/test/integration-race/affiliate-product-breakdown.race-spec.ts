import { Test, type TestingModule } from '@nestjs/testing';
import type { CommissionStatus } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/** AffiliateService.productCommissionBreakdown: hoa hồng theo sản phẩm khớp số hoa hồng thật sau trả một phần. */
describe('AffiliateService.productCommissionBreakdown partial returns (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        RewardPointsService,
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

  async function variation(rate: number) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itpb-p-${tag}`, brand: 'IT', slug: `itpb-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 260_000 },
    });
    return prisma.variation.create({
      data: { pancakeId: `itpb-v-${tag}`, productId: product.id, sku: `ITPB-${tag}`, name: 'v', attributes: {}, retailPrice: 260_000, stock: 20, affiliateRate: rate },
    });
  }

  async function setup(status: CommissionStatus, amount = 98_000) {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const buyer = await createUser(prisma);
    const honey = await variation(10);
    const pepper = await variation(10);
    const order = await createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', paymentStatus: 'PAID', total: 980_000, referrerUserId: ctv.id });
    const honeyLine = await prisma.orderItem.create({
      data: { orderId: order.id, variationId: honey.id, productName: `Mật ong ${order.id}`, variationName: 'v', unitPrice: 260_000, quantity: 3, total: 780_000 },
    });
    const pepperLine = await prisma.orderItem.create({
      data: { orderId: order.id, variationId: pepper.id, productName: `Tiêu ${order.id}`, variationName: 'v', unitPrice: 100_000, quantity: 2, total: 200_000 },
    });
    await prisma.commission.create({
      data: {
        affiliateUserId: ctv.id, orderId: order.id, orderTotal: 980_000, commissionableTotal: 980_000, rate: 10, amount, status,
        lineAmounts: { [honeyLine.id]: 78_000, [pepperLine.id]: 20_000 },
      },
    });
    let clock = Date.parse('2026-01-01T00:00:00Z');
    const ret = async (line: { id: string }, quantity: number, fullReturn = false, approved = true) => {
      clock += 60_000;
      const r = await prisma.returnRequest.create({
        data: { orderId: order.id, userId: buyer.id, reason: 'IT', status: approved ? 'APPROVED' : 'REQUESTED', refundAmount: 1, fullReturn, reviewedAt: new Date(clock) },
      });
      await prisma.returnRequestItem.create({ data: { returnRequestId: r.id, orderItemId: line.id, quantity, refundAmount: 1 } });
    };
    const read = async () => {
      const rows = await affiliate.productCommissionBreakdown(ctv.id);
      return Object.fromEntries(rows.map((r) => [r.productName.startsWith('Mật') ? 'honey' : 'pepper', r.commission]));
    };
    const total = async () => {
      const rows = await affiliate.productCommissionBreakdown(ctv.id);
      return rows.reduce((a, r) => a + r.commission, 0);
    };
    const setStatus = (to: CommissionStatus) => prisma.commission.updateMany({ where: { orderId: order.id }, data: { status: to } });
    return { ret, read, total, setStatus, amount, honeyLine, pepperLine };
  }

  it('hoa hồng chờ duyệt: trừ phần trả một phần theo dòng, dòng trả hết bị bỏ', async () => {
    const { ret, read, total, amount, honeyLine, pepperLine } = await setup('PENDING', 52_000);
    await ret(honeyLine, 1);
    await ret(pepperLine, 2);
    expect(await read()).toEqual({ honey: 52_000 });
    expect(await total()).toBe(amount);
  });

  it('yêu cầu chưa duyệt / fullReturn không tính', async () => {
    const { ret, read, honeyLine } = await setup('LOCKED');
    await ret(honeyLine, 1, false, false);
    await ret(honeyLine, 3, true);
    expect((await read()).honey).toBe(78_000);
  });

  it('trả khi LOCKED đã cắt, cron chuyển APPROVED: vẫn hiện số đã cắt, tổng = commission.amount', async () => {
    const { ret, read, total, setStatus, honeyLine } = await setup('LOCKED', 72_000);
    await ret(honeyLine, 1);
    await setStatus('APPROVED');
    expect(await read()).toEqual({ honey: 52_000, pepper: 20_000 });
    expect(await total()).toBe(72_000);
  });

  it('như trên sau khi đã PAID', async () => {
    const { ret, read, total, setStatus, honeyLine } = await setup('LOCKED', 72_000);
    await ret(honeyLine, 1);
    await setStatus('PAID');
    expect(await read()).toEqual({ honey: 52_000, pepper: 20_000 });
    expect(await total()).toBe(72_000);
  });

  it.each(['APPROVED', 'PAID'] as const)('trả duyệt SAU khi %s (không cắt): giữ số gốc, tổng = commission.amount', async (status) => {
    const { ret, read, total, amount, honeyLine } = await setup(status);
    await ret(honeyLine, 1);
    expect(await read()).toEqual({ honey: 78_000, pepper: 20_000 });
    expect(await total()).toBe(amount);
  });

  it('hỗn hợp: một lần trả lúc LOCKED (đã cắt), lần hai sau APPROVED (không cắt): tổng = commission.amount', async () => {
    const { ret, read, total, setStatus, honeyLine } = await setup('LOCKED', 72_000);
    await ret(honeyLine, 1);
    await setStatus('APPROVED');
    await ret(honeyLine, 1);
    expect(await read()).toEqual({ honey: 52_000, pepper: 20_000 });
    expect(await total()).toBe(72_000);
  });

  it('dòng trả hết bị bỏ dù hoa hồng đã APPROVED (đã cắt lúc LOCKED)', async () => {
    const { ret, read, total, setStatus, pepperLine } = await setup('LOCKED', 78_000);
    await ret(pepperLine, 2);
    await setStatus('APPROVED');
    expect(await read()).toEqual({ honey: 78_000 });
    expect(await total()).toBe(78_000);
  });
});
