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

  describe('tổng các dòng luôn bằng Commission.amount', () => {
    async function line(orderId: string, name: string, rate: number | null, total: number, blocked = false) {
      const v = await variation(rate ?? 0);
      if (blocked) await prisma.product.update({ where: { id: v.productId }, data: { affiliateBlocked: true } });
      const item = await prisma.orderItem.create({
        data: { orderId, variationId: v.id, productName: `${name} ${orderId}`, variationName: 'v', unitPrice: total, quantity: 1, total },
      });
      return { v, item };
    }

    async function order(total: number) {
      const ctv = await createUser(prisma, { role: 'AFFILIATE' });
      const buyer = await createUser(prisma);
      const o = await createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', paymentStatus: 'PAID', total, referrerUserId: ctv.id });
      return { ctv, o };
    }

    const sumOf = async (ctvId: string) => (await affiliate.productCommissionBreakdown(ctvId)).reduce((a, r) => a + r.commission, 0);

    it('(a) dòng bị chặn affiliate không có khoá trong lineAmounts: không hiện hoa hồng ma dù biến thể còn mức 10%', async () => {
      const { ctv, o } = await order(300_000);
      const ok = await line(o.id, 'OK', 10, 100_000);
      await line(o.id, 'BLOCKED', 10, 200_000, true);
      await prisma.commission.create({
        data: { affiliateUserId: ctv.id, orderId: o.id, orderTotal: 300_000, commissionableTotal: 100_000, rate: 5, amount: 10_000, status: 'LOCKED', lineAmounts: { [ok.item.id]: 10_000 } },
      });
      const rows = await affiliate.productCommissionBreakdown(ctv.id);
      expect(rows.map((r) => [r.productName.split(' ')[0], r.commission])).toEqual([['OK', 10_000]]);
      expect(await sumOf(ctv.id)).toBe(10_000);
    });

    it('(b) mức % của biến thể bị gỡ sau khi đặt: vẫn hiện đúng hoa hồng đã lưu', async () => {
      const { ctv, o } = await order(100_000);
      const ok = await line(o.id, 'OK', 10, 100_000);
      await prisma.commission.create({
        data: { affiliateUserId: ctv.id, orderId: o.id, orderTotal: 100_000, commissionableTotal: 100_000, rate: 10, amount: 10_000, status: 'PENDING', lineAmounts: { [ok.item.id]: 10_000 } },
      });
      await prisma.variation.update({ where: { id: ok.v.id }, data: { affiliateRate: null } });
      const rows = await affiliate.productCommissionBreakdown(ctv.id);
      expect(rows.map((r) => r.commission)).toEqual([10_000]);
      expect(await sumOf(ctv.id)).toBe(10_000);
    });

    it.each([
      ['mức % hiện tại thấp hơn lúc đặt', 5, 100_000],
      ['mức % hiện tại cao hơn lúc đặt', 20, 100_000],
      ['mức % đã bị gỡ (hiện tại 0) nhưng còn dòng khác có mức', 0, 100_000],
    ])('hoa hồng cũ không có lineAmounts, %s: tổng vẫn bằng Commission.amount', async (_name, nowRate) => {
      const { ctv, o } = await order(300_000);
      const a = await line(o.id, 'A', 10, 100_000);
      await line(o.id, 'B', 10, 200_000);
      await prisma.commission.create({
        data: { affiliateUserId: ctv.id, orderId: o.id, orderTotal: 300_000, commissionableTotal: 300_000, rate: 10, amount: 30_000, status: 'APPROVED' },
      });
      await prisma.variation.update({ where: { id: a.v.id }, data: { affiliateRate: nowRate } });
      expect(await sumOf(ctv.id)).toBe(30_000);
    });
  });
});
