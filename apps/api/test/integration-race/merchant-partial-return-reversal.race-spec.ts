import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, setConfig, summarize, warmPool } from './helpers';

const DAY = 86_400_000;

/**
 * Tích hợp p5 (trả hàng theo dòng) × p8 (đối soát gian hàng tự giao) trên Postgres THẬT. Đơn COD gian hàng đã lên phiếu đối
 * soát (SALE) rồi khách trả một phần: kỳ sau phải có đúng MỘT dòng REVERSAL 'RETURN:<id yêu cầu>' trừ lại phần hàng trả, kể cả
 * khi admin duyệt chồng lúc lập phiếu; trả nốt thì REVERSAL cuối chỉ đảo phần còn lại — cộng mọi dòng của đơn đúng bằng số tiền
 * mặt COD gian hàng đã thu (cùng luật reversalLineOf của trả cả đơn). Hàng trả về gian hàng: gian hàng xác nhận nhận và cộng kho,
 * admin kho Tubu không được.
 */
describe('Trả một phần dòng hàng gian hàng đã đối soát → REVERSAL (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let returns: OrderReturnsService;
  let settlement: MerchantFulfilmentService;
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
        MerchantFulfilmentService,
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: { notify } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    await setConfig(prisma, 'merchant.settlement_hold_days', 7);
    returns = moduleRef.get(OrderReturnsService);
    settlement = moduleRef.get(MerchantFulfilmentService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => notify.mockClear());

  async function setup() {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itpr-${tag}`, title: `Vườn IT ${tag}`, ownerUserId: owner.id, commissionPct: 0.15 },
    });
    const product = await prisma.product.create({
      data: {
        storefrontId: store.id,
        fulfilment: 'MERCHANT',
        brand: 'IT',
        slug: `itpr-${tag}`,
        name: `Bưởi ${tag}`,
        description: 'IT',
        basePrice: 50_000,
        variations: { create: { sku: `ITPR-${tag}`, name: 'Quả', attributes: {}, retailPrice: 50_000, stock: 10 } },
      },
      include: { variations: true },
    });
    const v = product.variations[0]!;
    const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    // COD gian hàng tự giao: 2 quả × 50.000 + ship 30.000 = 130.000 tiền mặt gian hàng đã thu; phí sàn 15%.
    const order = await createOrder(prisma, {
      userId: buyer.id,
      status: 'DELIVERED',
      deliveredAt: new Date(Date.now() - 2 * DAY),
      fulfiller: 'MERCHANT',
      fulfillerStorefrontId: store.id,
      merchantCommissionPct: 0.15,
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      subtotal: 100_000,
      shippingFee: 30_000,
      total: 130_000,
      items: { create: { variationId: v.id, productName: 'Bưởi', variationName: 'Quả', unitPrice: 50_000, quantity: 2, total: 100_000 } },
    });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    return { owner, store, v, buyer, order, item };
  }

  const linesOf = (orderId: string) => prisma.merchantPayoutLine.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  const stockOf = async (id: string) => (await prisma.variation.findUniqueOrThrow({ where: { id } })).stock;
  const walletOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).walletBalance;

  it('duyệt trả 1/2 quả chồng với 3 lần lập phiếu → đúng 1 dòng REVERSAL RETURN:<id> (−42.500) trong đúng 1 phiếu; trả nốt → tổng các dòng = −130.000 tiền COD', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const { owner, store, v, buyer, order, item } = await setup();

    const r1 = await returns.request(buyer.id, order.code, {
      reasonCode: 'OTHER',
      reason: 'Một quả bị dập khi nhận',
      items: [{ orderItemId: item.id, quantity: 1 }],
    });
    // Qua hạn giữ 7 ngày trong lúc yêu cầu chờ duyệt: đơn lên phiếu SALE trước khi admin duyệt.
    await prisma.order.update({ where: { id: order.id }, data: { deliveredAt: new Date(Date.now() - 10 * DAY) } });
    await settlement.createPayout('admin-it', store.id);
    expect((await linesOf(order.id)).map((l) => [l.kind, l.refKey, l.netAmount])).toEqual([['SALE', '', -15_000]]);

    const preview = await returns.preview(r1.id);
    expect(preview.returnTo).toEqual({ kind: 'MERCHANT', name: store.title });
    const raced = summarize(
      await Promise.allSettled([
        returns.review(admin.id, r1.id, { approve: true, expectedRefund: preview.refund }),
        settlement.createPayout('admin-a', store.id),
        settlement.createPayout('admin-b', store.id),
        settlement.createPayout('admin-c', store.id),
      ]),
    );
    console.log('[partial x4] errors=%j', [...new Set(raced.errors)]);
    expect(raced.fulfilled.length).toBeGreaterThanOrEqual(1);
    await settlement.createPayout('admin-it', store.id).catch((e: unknown) => expect(e).toBeInstanceOf(BadRequestException));

    const afterPartial = await linesOf(order.id);
    const partial = afterPartial.filter((l) => l.kind === 'REVERSAL');
    expect(partial).toHaveLength(1);
    expect(partial[0]).toMatchObject({ refKey: `RETURN:${r1.id}`, goodsAmount: -50_000, shippingFee: 0, commissionAmount: -7_500, codCollected: 0, netAmount: -42_500 });
    expect(await walletOf(buyer.id)).toBe(50_000);
    expect(notify).toHaveBeenCalledWith(owner.id, 'MERCHANT_RETURN_APPROVED', expect.objectContaining({ order_code: order.code }));
    expect((await settlement.statementFor(store.id)).lines).toHaveLength(0);

    // Hàng về gian hàng: kho Tubu không nhận; gian hàng xác nhận một lần thì kho sản phẩm của gian hàng +1.
    const stock0 = await stockOf(v.id);
    await expect(returns.markReceived(admin.id, r1.id)).rejects.toThrow('gian hàng');
    const got = summarize(await Promise.allSettled([returns.markReceivedByMerchant(owner.id, r1.id), returns.markReceivedByMerchant(owner.id, r1.id)]));
    expect(got.fulfilled).toHaveLength(1);
    expect(await stockOf(v.id)).toBe(stock0 + 1);
    expect((await returns.listForMerchant(owner.id)).map((r) => r.id)).toContain(r1.id);

    // Trả nốt quả còn lại: đơn RETURNED, REVERSAL cả đơn chỉ đảo phần còn lại.
    const r2 = await returns.request(buyer.id, order.code, {
      reasonCode: 'OTHER',
      reason: 'Trả nốt quả còn lại',
      items: [{ orderItemId: item.id, quantity: 1 }],
    }).catch(async (e: unknown) => {
      // Hạn đổi/trả tính từ deliveredAt đã lùi 10 ngày: mở cửa sổ cho lần trả thứ hai của kịch bản.
      if (!(e instanceof BadRequestException)) throw e;
      await prisma.order.update({ where: { id: order.id }, data: { deliveredAt: new Date(Date.now() - 2 * DAY) } });
      return returns.request(buyer.id, order.code, { reasonCode: 'OTHER', reason: 'Trả nốt quả còn lại', items: [{ orderItemId: item.id, quantity: 1 }] });
    });
    await prisma.order.update({ where: { id: order.id }, data: { deliveredAt: new Date(Date.now() - 10 * DAY) } });
    await returns.review(admin.id, r2.id, { approve: true });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('RETURNED');
    expect(await walletOf(buyer.id)).toBe(130_000);

    await Promise.allSettled([settlement.createPayout('admin-d', store.id), settlement.createPayout('admin-e', store.id)]);
    const all = await linesOf(order.id);
    console.log('[partial final] %j', all.map((l) => [l.kind, l.refKey, l.netAmount]));
    const reversalKeys = all.filter((l) => l.kind === 'REVERSAL').map((l) => l.refKey);
    expect(reversalKeys).toEqual(expect.arrayContaining([`RETURN:${r1.id}`, '']));
    expect(new Set(all.map((l) => `${l.kind}|${l.refKey}`)).size).toBe(all.length);
    expect(all.reduce((s, l) => s + l.netAmount, 0)).toBe(-130_000);
    expect(all.reduce((s, l) => s + l.goodsAmount, 0)).toBe(0);
    expect(all.reduce((s, l) => s + l.commissionAmount, 0)).toBe(0);
    expect((await settlement.statementFor(store.id)).lines).toHaveLength(0);
  });

  it('trả một phần được duyệt TRƯỚC khi đơn đủ hạn đối soát → phiếu đầu có SALE kèm REVERSAL của lần trả, tổng thực nhận chỉ còn phần giữ lại', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const { store, buyer, order, item } = await setup();
    const r1 = await returns.request(buyer.id, order.code, { reasonCode: 'OTHER', reason: 'Trả bớt một quả', items: [{ orderItemId: item.id, quantity: 1 }] });
    await returns.review(admin.id, r1.id, { approve: true });
    await prisma.order.update({ where: { id: order.id }, data: { deliveredAt: new Date(Date.now() - 10 * DAY) } });

    const s = summarize(await Promise.allSettled([1, 2, 3].map((i) => settlement.createPayout(`admin-${i}`, store.id))));
    expect(s.fulfilled).toHaveLength(1);
    const lines = await linesOf(order.id);
    expect(lines.map((l) => [l.kind, l.refKey]).sort()).toEqual([['REVERSAL', `RETURN:${r1.id}`], ['SALE', '']]);
    expect(new Set(lines.map((l) => l.payoutId)).size).toBe(1);
    // SALE −15.000 (phí sàn cả đơn, COD đã thu 130.000) + REVERSAL −42.500 (gian hàng nộp lại 50.000 − phí sàn 7.500).
    expect(lines.reduce((sum, l) => sum + l.netAmount, 0)).toBe(-57_500);
  });
});
