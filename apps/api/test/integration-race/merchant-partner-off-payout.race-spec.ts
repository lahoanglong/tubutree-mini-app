import { ForbiddenException, NotFoundException } from '@nestjs/common';
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

  it('gian hàng chưa từng là đối tác nhưng còn SALE đủ hạn (dữ liệu cũ) → 404, không lập phiếu +SALE, không hiện trong tổng quan', async () => {
    const { store } = await setup({ isPartner: false });
    expect((await settlement.statementFor(store.id)).lines.map((l) => l.kind)).toEqual(['SALE']);
    const todoBefore = await settlement.countStoresToSettle();
    await expect(settlement.createPayout('admin-it', store.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(await prisma.merchantPayout.count({ where: { storefrontId: store.id } })).toBe(0);
    expect(await prisma.merchantPayoutLine.count({ where: { payout: { storefrontId: store.id } } })).toBe(0);
    expect((await settlement.adminOverview()).stores.map((s) => s.storefrontId)).not.toContain(store.id);
    expect(await settlement.countStoresToSettle()).toBe(todoBefore);
  });

  /** Gian hàng đã tắt cờ có thêm một đơn COD đủ hạn chưa vào phiếu (SALE mở) bên cạnh REVERSAL của đơn đã trả hàng. */
  async function partnerOffWithSaleAndReversal() {
    const ctx = await partnerOffWithOpenReversal();
    const v = await prisma.variation.findFirstOrThrow({ where: { product: { storefrontId: ctx.store.id } } });
    const sale2 = await createOrder(prisma, {
      userId: ctx.buyer.id,
      status: 'DELIVERED',
      deliveredAt: new Date(Date.now() - 2 * DAY),
      fulfiller: 'MERCHANT',
      fulfillerStorefrontId: ctx.store.id,
      merchantCommissionPct: 0.15,
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      subtotal: 50_000,
      shippingFee: 0,
      total: 50_000,
      items: { create: { variationId: v.id, productName: 'Bưởi', variationName: 'Quả', unitPrice: 50_000, quantity: 1, total: 50_000 } },
    });
    return { ...ctx, sale2 };
  }

  it('đã tắt cờ, còn SALE và REVERSAL mở → phiếu chỉ chứa REVERSAL, SALE vẫn mở; tổng quan chỉ đếm REVERSAL', async () => {
    const { store, sale2, r1 } = await partnerOffWithSaleAndReversal();
    const statement = await settlement.statementFor(store.id);
    expect(statement.lines.map((l) => l.kind).sort()).toEqual(['REVERSAL', 'SALE']);
    const row = (await settlement.adminOverview()).stores.find((s) => s.storefrontId === store.id);
    expect(row).toMatchObject({ isPartner: false, settleableLines: 1, settleableAmount: -42_500 });

    await expect(settlement.createPayout('admin-it', store.id, undefined, statement.total)).rejects.toThrow(/vừa thay đổi/);
    const payout = await settlement.createPayout('admin-it', store.id, undefined, -42_500);
    expect(payout.amount).toBe(-42_500);
    expect(payout.lines.map((l) => [l.kind, l.refKey])).toEqual([['REVERSAL', `RETURN:${r1.id}`]]);
    expect(await prisma.merchantPayoutLine.count({ where: { orderId: sale2.id } })).toBe(0);
    expect((await settlement.statementFor(store.id)).lines.map((l) => [l.kind, l.orderId])).toEqual([['SALE', sale2.id]]);
    await expect(settlement.createPayout('admin-it', store.id)).rejects.toBeInstanceOf(NotFoundException);
    expect((await settlement.adminOverview()).stores.map((s) => s.storefrontId)).not.toContain(store.id);
  });

  it('myStatement: chủ gian hàng đã tắt cờ chỉ xem được khi đã có phiếu — thấy phiếu và tài khoản Tubu, không thấy SALE chờ; thao tác khác vẫn bị từ chối', async () => {
    await setConfig(prisma, 'payment.bank_name', 'Vietcombank');
    await setConfig(prisma, 'payment.bank_account_no', '0011223344');
    await setConfig(prisma, 'payment.bank_account_name', 'TUBU TREE');
    const { store, owner } = await partnerOffWithSaleAndReversal();
    const noPayout = await setup({ isPartner: false });
    await expect(settlement.myStatement(noPayout.owner.id)).rejects.toBeInstanceOf(ForbiddenException);
    const payout = await settlement.createPayout('admin-it', store.id);
    const mine = await settlement.myStatement(owner.id);
    const slip = mine.payouts.find((p) => p.id === payout.id)!;
    expect(slip.amount).toBe(-42_500);
    expect(slip.lines.map((l) => l.kind)).toEqual(['REVERSAL']);
    expect(mine.tubuAccount).toEqual({ bankName: 'Vietcombank', accountNo: '0011223344', accountName: 'TUBU TREE' });
    expect(mine.lines).toEqual([]);
    expect(mine.total).toBe(0);
    expect(mine.upcoming).toEqual([]);
    await expect(settlement.listOrders(owner.id, undefined)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('đã tắt cờ, chỉ có lần trả một phần đã duyệt trên đơn RETURNED chưa từng có SALE → không bị kéo vào truy vấn tổng quan', async () => {
    const { store, order, buyer, item } = await setup({ isPartner: false });
    await prisma.order.update({ where: { id: order.id }, data: { status: 'RETURNED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'REFUNDED' } });
    await prisma.returnRequest.create({
      data: {
        orderId: order.id,
        userId: buyer.id,
        reason: 'IT',
        status: 'APPROVED',
        fullReturn: false,
        items: { create: { orderItemId: item.id, quantity: 1 } },
      },
    });
    expect((await settlement.statementFor(store.id)).lines).toEqual([]);
    expect(await settlement['storesWithPending']()).not.toContain(store.id);
  });

  it('gian hàng đã tắt cờ và không còn gì mở → vẫn 404', async () => {
    const { store } = await partnerOffWithOpenReversal();
    await settlement.createPayout('admin-it', store.id);
    await expect(settlement.createPayout('admin-it', store.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  async function emptyCtvStore(isPartner: boolean) {
    const owner = await createUser(prisma, { role: 'CUSTOMER' });
    const tag = randCode(8).toLowerCase();
    return prisma.storefront.create({
      data: { type: 'CTV', isPartner, slug: `itpe-${tag}`, title: `Vườn trống ${tag}`, ownerUserId: owner.id },
    });
  }

  it('tổng quan admin liệt kê CTV vừa bật cờ dù chưa có đơn hay liên kết (để còn nút Tắt), không tính vào việc cần lập phiếu', async () => {
    const todoBefore = await settlement.countStoresToSettle();
    const store = await emptyCtvStore(true);
    const row = (await settlement.adminOverview()).stores.find((s) => s.storefrontId === store.id);
    expect(row).toMatchObject({ type: 'CTV', isPartner: true, activeOrders: 0, overdueOrders: 0, settleableLines: 0, settleableAmount: 0, consignmentLines: 0 });
    expect(await settlement.countStoresToSettle()).toBe(todoBefore);
  });

  it('CTV đã tắt cờ và không còn gì mở, hay chưa từng bật cờ → không hiện trong tổng quan', async () => {
    const off = await emptyCtvStore(false);
    const { store: partnerOff } = await partnerOffWithOpenReversal();
    await settlement.createPayout('admin-it', partnerOff.id);
    const ids = (await settlement.adminOverview()).stores.map((s) => s.storefrontId);
    expect(ids).not.toContain(off.id);
    expect(ids).not.toContain(partnerOff.id);
  });
});
