import { NotFoundException } from '@nestjs/common';
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
 * Gian hàng đã tắt cờ isPartner mà vẫn còn khoản đối soát mở (REVERSAL do khách trả hàng phát sinh SAU khi tắt cờ): admin phải
 * lập được phiếu để thu/đối soát; gian hàng chưa từng là đối tác hoặc không còn gì mở vẫn 404. Postgres THẬT.
 */
describe('Lập phiếu cho gian hàng đã tắt cờ đối tác còn khoản mở (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let returns: OrderReturnsService;
  let settlement: MerchantFulfilmentService;

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
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    await setConfig(prisma, 'merchant.settlement_hold_days', 1);
    returns = moduleRef.get(OrderReturnsService);
    settlement = moduleRef.get(MerchantFulfilmentService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /** CTV (cờ đối tác bật) có một đơn COD tự giao 130.000 đã giao; chưa vào phiếu. */
  async function setup(opts: { isPartner: boolean }) {
    const owner = await createUser(prisma, { role: 'CUSTOMER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: { type: 'CTV', isPartner: opts.isPartner, slug: `itpo-${tag}`, title: `Vườn IT ${tag}`, ownerUserId: owner.id, commissionPct: 0.15 },
    });
    const product = await prisma.product.create({
      data: {
        storefrontId: store.id,
        fulfilment: 'MERCHANT',
        brand: 'IT',
        slug: `itpo-${tag}`,
        name: `Bưởi ${tag}`,
        description: 'IT',
        basePrice: 50_000,
        variations: { create: { sku: `ITPO-${tag}`, name: 'Quả', attributes: {}, retailPrice: 50_000, stock: 10 } },
      },
      include: { variations: true },
    });
    const v = product.variations[0]!;
    const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
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
    return { owner, store, buyer, order, item };
  }

  /**
   * Đơn đã vào phiếu SALE (đã chuyển tiền), admin tắt cờ đối tác (không còn việc dở nên được tắt), SAU ĐÓ khách xin trả 1 quả
   * trong hạn đổi/trả và admin duyệt: REVERSAL phát sinh khi gian hàng không còn là đối tác.
   */
  async function partnerOffWithOpenReversal() {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const ctx = await setup({ isPartner: true });
    const sale = await settlement.createPayout('admin-it', ctx.store.id);
    await settlement.markPayoutPaid('admin-it', sale.id, 'FT-IT');
    await prisma.product.updateMany({ where: { storefrontId: ctx.store.id }, data: { isActive: false } });
    await settlement.setStorePartner(admin.id, ctx.store.id, false);
    const r1 = await returns.request(ctx.buyer.id, ctx.order.code, {
      reasonCode: 'OTHER',
      reason: 'Một quả bị dập khi nhận',
      items: [{ orderItemId: ctx.item.id, quantity: 1 }],
    });
    await returns.review(admin.id, r1.id, { approve: true });
    return { ...ctx, r1 };
  }

  it('tắt cờ đối tác rồi trả hàng phát sinh REVERSAL → lập được phiếu chứa REVERSAL, tổng sổ khớp phiếu, lần hai không còn gì', async () => {
    const { store, order, r1 } = await partnerOffWithOpenReversal();
    expect((await prisma.storefront.findUniqueOrThrow({ where: { id: store.id } })).isPartner).toBe(false);
    const statement = await settlement.statementFor(store.id);
    expect(statement.lines.map((l) => [l.kind, l.refKey, l.netAmount])).toEqual([['REVERSAL', `RETURN:${r1.id}`, -42_500]]);

    const payout = await settlement.createPayout('admin-it', store.id, undefined, statement.total);
    expect(payout.amount).toBe(-42_500);
    expect(payout.lines.map((l) => [l.kind, l.refKey, l.netAmount])).toEqual([['REVERSAL', `RETURN:${r1.id}`, -42_500]]);
    expect(payout.lines.reduce((s, l) => s + l.netAmount, 0)).toBe(payout.amount);
    const all = await prisma.merchantPayoutLine.findMany({ where: { orderId: order.id } });
    expect(all.reduce((s, l) => s + l.netAmount, 0)).toBe(-57_500);
    await expect(settlement.createPayout('admin-it', store.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tổng quan admin liệt kê gian hàng đã tắt cờ còn khoản mở để bấm Lập phiếu; hết khoản thì biến mất', async () => {
    const { store } = await partnerOffWithOpenReversal();
    const row = (await settlement.adminOverview()).stores.find((s) => s.storefrontId === store.id);
    expect(row).toMatchObject({ isPartner: false, settleableLines: 1, settleableAmount: -42_500 });
    await settlement.createPayout('admin-it', store.id);
    expect((await settlement.adminOverview()).stores.find((s) => s.storefrontId === store.id)).toBeUndefined();
  });

  it('lập phiếu hai lần đồng thời → đúng một phiếu, lần còn lại bị từ chối', async () => {
    const { store } = await partnerOffWithOpenReversal();
    const s = summarize(await Promise.allSettled([settlement.createPayout('admin-a', store.id), settlement.createPayout('admin-b', store.id)]));
    expect(s.fulfilled).toHaveLength(1);
    expect(await prisma.merchantPayout.count({ where: { storefrontId: store.id, status: 'PENDING' } })).toBe(1);
  });

  it('gian hàng chưa từng là đối tác (không có dòng nào mở) → vẫn 404', async () => {
    const { store } = await setup({ isPartner: false });
    await prisma.order.updateMany({ where: { fulfillerStorefrontId: store.id }, data: { fulfiller: 'TUBU', fulfillerStorefrontId: null } });
    await expect(settlement.createPayout('admin-it', store.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(await prisma.merchantPayout.count({ where: { storefrontId: store.id } })).toBe(0);
  });

  it('gian hàng đã tắt cờ và không còn gì mở → vẫn 404', async () => {
    const { store } = await partnerOffWithOpenReversal();
    await settlement.createPayout('admin-it', store.id);
    await expect(settlement.createPayout('admin-it', store.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
