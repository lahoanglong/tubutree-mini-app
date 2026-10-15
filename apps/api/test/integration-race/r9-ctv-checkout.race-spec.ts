import { randomInt } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { createUser, randCode, summarize, warmPool } from './helpers';

/**
 * UAT vòng 5, form CTV "lên đơn hộ" (real Postgres):
 *  - R5-CHECKOUT-1: mạng chậm rồi gửi lại cùng Idempotency-Key (tuần tự hoặc chồng nhau, kể cả khi lần gửi lại đụng hết hàng
 *    vì chính lần đầu vừa giữ kho) chỉ ra MỘT đơn, MỘT hoa hồng, kho trừ một lần.
 *  - R5-CHECKOUT-2: SĐT người nhận rác bị từ chối; SĐT của chính CTV gõ kiểu nào cũng bị chặn.
 *  - R5-CHECKOUT-3: báo giá khoá COD đúng câu mà bước tạo đơn từ chối.
 */
describe('r9-ctv-checkout — CTV lên đơn hộ (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;
  const enqueuePush = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        RewardPointsService,
        AnalyticsEventsService,
        AffiliateService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(20_000) } },
        { provide: PancakeOrderService, useValue: { enqueuePush } },
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
  const customer = (over: Record<string, unknown> = {}) => ({
    recipient: 'Khách của CTV',
    phone: randomPhone(),
    province: 'Hà Nội',
    ward: 'Phường IT',
    street: '1 Đường IT',
    provinceCode: '84_VN01',
    wardCode: '00001',
    ...over,
  });

  async function variation(opts: { retailPrice?: number; stock?: number } = {}) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: `it-r9-p-${tag}`,
        brand: 'IT Brand',
        slug: `it-r9-${tag.toLowerCase()}`,
        name: `SP r9 ${tag}`,
        description: 'IT',
        basePrice: opts.retailPrice ?? 100_000,
        isActive: true,
        approvalStatus: 'APPROVED',
      },
    });
    return prisma.variation.create({
      data: {
        pancakeId: `it-r9-v-${tag}`,
        productId: product.id,
        sku: `IT-R9-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: opts.retailPrice ?? 100_000,
        affiliateRate: 10,
        stock: opts.stock ?? 100,
        isActive: true,
      },
    });
  }

  async function ctvOrdersState(ctvId: string, variationId: string) {
    const orders = await prisma.order.findMany({ where: { userId: ctvId }, select: { id: true } });
    const commissions = await prisma.commission.findMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
    const v = await prisma.variation.findUniqueOrThrow({ where: { id: variationId }, select: { stock: true } });
    return { orders: orders.length, commissions: commissions.length, stock: v.stock };
  }

  describe('R5-CHECKOUT-1: cùng Idempotency-Key = một đơn, một hoa hồng', () => {
    it('gửi lại cùng key sau khi lần đầu đã ghi đơn (CTV thấy quá thời gian rồi bấm lại) → trả lại đúng đơn đó, không đơn thứ hai', async () => {
      const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: randomPhone() });
      const v = await variation({ stock: 10 });
      const dto = { items: [{ variationId: v.id, quantity: 1 }], customer: customer(), paymentMethod: 'COD' as const, expectedTotal: 120_000 };
      const key = `it-r9-${randCode(12)}`;

      const first = await affiliate.placeOrderForCustomer(ctv.id, dto, key);
      const second = await affiliate.placeOrderForCustomer(ctv.id, dto, key);

      expect(second.id).toBe(first.id);
      expect(second.code).toBe(first.code);
      expect(await ctvOrdersState(ctv.id, v.id)).toEqual({ orders: 1, commissions: 1, stock: 9 });
    });

    it('5 lần gửi chồng nhau cùng key (lần đầu còn đang ghi) → cả 5 trả cùng một đơn; một đơn, một hoa hồng, kho trừ một lần', async () => {
      const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: randomPhone() });
      const v = await variation({ stock: 10 });
      const dto = { items: [{ variationId: v.id, quantity: 2 }], customer: customer(), paymentMethod: 'COD' as const };
      const key = `it-r9-${randCode(12)}`;

      const results = await Promise.allSettled(Array.from({ length: 5 }, () => affiliate.placeOrderForCustomer(ctv.id, dto, key)));
      const s = summarize(results);
      console.log('[r9 same key x5] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, [...new Set(s.errors)]);

      expect(s.rejected).toHaveLength(0);
      expect(new Set(s.fulfilled.map((r) => r.value.id)).size).toBe(1);
      expect(await ctvOrdersState(ctv.id, v.id)).toEqual({ orders: 1, commissions: 1, stock: 8 });
    });

    it('chỉ còn đúng số hàng của đơn: lần gửi lại chồng lên lần đầu đụng hết hàng do chính lần đầu giữ → vẫn trả đơn đã tạo, không báo hết hàng', async () => {
      const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: randomPhone() });
      const v = await variation({ stock: 3 });
      const dto = { items: [{ variationId: v.id, quantity: 3 }], customer: customer(), paymentMethod: 'COD' as const };
      const key = `it-r9-${randCode(12)}`;

      const results = await Promise.allSettled(Array.from({ length: 4 }, () => affiliate.placeOrderForCustomer(ctv.id, dto, key)));
      const s = summarize(results);
      console.log('[r9 same key, stock = qty] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, [...new Set(s.errors)]);

      expect(s.rejected).toHaveLength(0);
      expect(new Set(s.fulfilled.map((r) => r.value.id)).size).toBe(1);
      expect(await ctvOrdersState(ctv.id, v.id)).toEqual({ orders: 1, commissions: 1, stock: 0 });
    });

    it('khác key (CTV đổi món/khách rồi gửi) → đơn khác như bình thường', async () => {
      const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: randomPhone() });
      const v = await variation({ stock: 10 });
      const dto = { items: [{ variationId: v.id, quantity: 1 }], customer: customer(), paymentMethod: 'COD' as const };

      const a = await affiliate.placeOrderForCustomer(ctv.id, dto, `it-r9-${randCode(12)}`);
      const b = await affiliate.placeOrderForCustomer(ctv.id, { ...dto, items: [{ variationId: v.id, quantity: 2 }] }, `it-r9-${randCode(12)}`);

      expect(a.id).not.toBe(b.id);
      expect(await ctvOrdersState(ctv.id, v.id)).toEqual({ orders: 2, commissions: 2, stock: 7 });
    });

    it('key của CTV khác → không trả đơn của người kia, không tạo đơn', async () => {
      const owner = await createUser(prisma, { role: 'AFFILIATE', phone: randomPhone() });
      const other = await createUser(prisma, { role: 'AFFILIATE', phone: randomPhone() });
      const v = await variation({ stock: 10 });
      const dto = { items: [{ variationId: v.id, quantity: 1 }], customer: customer(), paymentMethod: 'COD' as const };
      const key = `it-r9-${randCode(12)}`;
      await affiliate.placeOrderForCustomer(owner.id, dto, key);

      await expect(affiliate.placeOrderForCustomer(other.id, dto, key)).rejects.toBeInstanceOf(BadRequestException);
      expect(await prisma.order.count({ where: { userId: other.id } })).toBe(0);
    });
  });

  describe('R5-CHECKOUT-2: SĐT người nhận', () => {
    it.each([
      ['rỗng', () => ''],
      ['chữ', () => 'abc'],
      ['của chính CTV bỏ số 0 đầu', (own: string) => own.slice(1)],
    ])('SĐT %s → từ chối, không tạo đơn', async (_label, typed) => {
      const own = randomPhone();
      const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: own });
      const v = await variation({ stock: 10 });
      await expect(
        affiliate.placeOrderForCustomer(ctv.id, { items: [{ variationId: v.id, quantity: 1 }], customer: customer({ phone: typed(own) }), paymentMethod: 'COD' }),
      ).rejects.toThrow('Số điện thoại người nhận không hợp lệ');
      expect(await ctvOrdersState(ctv.id, v.id)).toEqual({ orders: 0, commissions: 0, stock: 10 });
    });

    const rest = (own: string) => own.slice(1);
    it.each([
      ['0xxxxxxxxx', (own: string) => own],
      ['+84 có dấu cách', (own: string) => `+84 ${rest(own).slice(0, 2)} ${rest(own).slice(2, 5)} ${rest(own).slice(5)}`],
      ['84 không dấu +', (own: string) => `84${rest(own)}`],
      ['có dấu chấm', (own: string) => `${own.slice(0, 3)}.${own.slice(3, 6)}.${own.slice(6)}`],
      ['có dấu gạch', (own: string) => `${own.slice(0, 3)}-${own.slice(3, 6)}-${own.slice(6)}`],
    ])('SĐT của chính CTV gõ dạng %s → từ chối, không đơn, không hoa hồng', async (_label, typed) => {
      const own = randomPhone();
      const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: own });
      const v = await variation({ stock: 10 });
      await expect(
        affiliate.placeOrderForCustomer(ctv.id, { items: [{ variationId: v.id, quantity: 1 }], customer: customer({ phone: typed(own) }), paymentMethod: 'COD' }),
      ).rejects.toThrow('SĐT của chính bạn');
      expect(await ctvOrdersState(ctv.id, v.id)).toEqual({ orders: 0, commissions: 0, stock: 10 });
    });
  });

  it('R5-CHECKOUT-3: báo giá 5.400.000đ khoá COD; tạo đơn COD từ chối đúng câu đó, chuyển khoản tạo được', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: randomPhone() });
    const v = await variation({ retailPrice: 1_793_334, stock: 10 });
    const items = [{ variationId: v.id, quantity: 3 }];

    const q = await affiliate.quoteOrderForCustomer(ctv.id, { items });
    expect(q.total).toBe(5_400_002);
    expect(q.blockedPaymentMethods.COD).toBe(
      'Thanh toán khi nhận hàng (COD) chỉ nhận đơn tối đa 5.000.000đ, đơn này là 5.400.002đ. Vui lòng chọn chuyển khoản.',
    );
    await expect(
      affiliate.placeOrderForCustomer(ctv.id, { items, customer: customer(), paymentMethod: 'COD', expectedTotal: q.total }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PAYMENT_METHOD_NOT_ALLOWED', message: q.blockedPaymentMethods.COD }) });
    expect(await ctvOrdersState(ctv.id, v.id)).toEqual({ orders: 0, commissions: 0, stock: 10 });

    const bank = await affiliate.placeOrderForCustomer(ctv.id, { items, customer: customer(), paymentMethod: 'BANK_TRANSFER', expectedTotal: q.total });
    expect(bank.total).toBe(5_400_002);
  });
});
