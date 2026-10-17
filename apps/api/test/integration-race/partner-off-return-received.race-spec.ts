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
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

const DAY = 86_400_000;

/**
 * Yêu cầu trả đã duyệt của gian hàng đã tắt cờ isPartner: gian hàng vẫn nhận được hàng về (cộng kho) khi đơn có dòng SALE đã lưu
 * trên phiếu (cùng quy tắc D3 của `openLinesOf`); gian hàng còn là đối tác không đổi; gian hàng chưa từng được trả (không có
 * SALE) vẫn 404. Postgres THẬT.
 */
describe('Nhận hàng trả về sau khi gian hàng tắt cờ đối tác (real Postgres)', () => {
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
  async function setup(opts: { isPartner: boolean; pm?: 'COD' | 'BANK_TRANSFER'; ps?: 'UNPAID' | 'PAID' }) {
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
      paymentMethod: opts.pm ?? 'COD',
      paymentStatus: opts.ps ?? 'UNPAID',
      subtotal: 100_000,
      shippingFee: 30_000,
      total: 130_000,
      items: { create: { variationId: v.id, productName: 'Bưởi', variationName: 'Quả', unitPrice: 50_000, quantity: 2, total: 100_000 } },
    });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    return { owner, store, buyer, order, item };
  }

  async function requestAndApprove(ctx: Awaited<ReturnType<typeof setup>>) {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const r = await returns.request(ctx.buyer.id, ctx.order.code, {
      reasonCode: 'OTHER',
      reason: 'Một quả bị dập khi nhận',
      items: [{ orderItemId: ctx.item.id, quantity: 1 }],
    });
    await returns.review(admin.id, r.id, { approve: true });
    return r;
  }
  async function partnerOffPaid() {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const ctx = await setup({ isPartner: true });
    const sale = await settlement.createPayout('admin-it', ctx.store.id);
    await settlement.markPayoutPaid('admin-it', sale.id, 'FT-IT');
    await prisma.product.updateMany({ where: { storefrontId: ctx.store.id }, data: { isActive: false } });
    await settlement.setStorePartner(admin.id, ctx.store.id, false);
    return ctx;
  }
  const stockOf = async (orderId: string) => {
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    return (await prisma.variation.findUniqueOrThrow({ where: { id: item.variationId! } })).stock;
  };

  it('tắt cờ sau khi đơn đã vào phiếu SALE, rồi khách trả và admin duyệt: chủ gian hàng vẫn xác nhận nhận hàng, kho cộng lại', async () => {
    const ctx = await partnerOffPaid();
    const r = await requestAndApprove(ctx);
    const before = await stockOf(ctx.order.id);

    const view = await returns.markReceivedByMerchant(ctx.owner.id, r.id);
    expect(view.receivedAt).toBeInstanceOf(Date);
    expect(await stockOf(ctx.order.id)).toBe(before + 1);
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: r.id } })).receivedBy).toBe(ctx.owner.id);
  });

  it('chủ gian hàng khác vẫn 404 dù cờ đã tắt và đơn có SALE', async () => {
    const ctx = await partnerOffPaid();
    const r = await requestAndApprove(ctx);
    const stranger = await createUser(prisma, { role: 'CUSTOMER' });
    await expect(returns.markReceivedByMerchant(stranger.id, r.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('gian hàng còn là đối tác: xác nhận nhận hàng như cũ', async () => {
    const ctx = await setup({ isPartner: true });
    const r = await requestAndApprove(ctx);
    const view = await returns.markReceivedByMerchant(ctx.owner.id, r.id);
    expect(view.receivedAt).toBeInstanceOf(Date);
  });

  it('gian hàng chưa từng là đối tác (đơn không có SALE đã lưu): vẫn 404, không cộng kho', async () => {
    const ctx = await setup({ isPartner: false });
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const r = await prisma.returnRequest.create({
      data: {
        orderId: ctx.order.id,
        userId: ctx.buyer.id,
        reason: 'Trả hàng',
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewedBy: admin.id,
        items: { create: { orderItemId: ctx.item.id, quantity: 1 } },
      },
    });
    const before = await stockOf(ctx.order.id);
    await expect(returns.markReceivedByMerchant(ctx.owner.id, r.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(await stockOf(ctx.order.id)).toBe(before);
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: r.id } })).receivedAt).toBeNull();
  });
});
