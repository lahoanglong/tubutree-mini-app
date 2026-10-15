import { createHmac } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { CustomerRefundsService } from '../../src/modules/orders/customer-refunds.service';
import { recordLatePaymentRefund } from '../../src/modules/orders/refund-queue';
import { CartService } from '../../src/modules/cart/cart.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { ZalopayService } from '../../src/modules/integrations/payment/zalopay.service';
import { createOrder, createUser, randCode, summarize, warmPool } from './helpers';

const ZALOPAY_KEY2 = 'it-key2';
function zalopayConfig() {
  const map: Record<string, string> = { ZALOPAY_APP_ID: '2553', ZALOPAY_KEY1: 'it-key1', ZALOPAY_KEY2, ZALOPAY_ENDPOINT: 'http://127.0.0.1:9' };
  return { get: (k: string) => map[k] ?? '' };
}
function zalopayMac(raw: string) {
  return createHmac('sha256', ZALOPAY_KEY2).update(raw).digest('hex');
}

/**
 * P5 (D2/D3) trên Postgres THẬT: trả hàng theo dòng/số lượng, cộng kho khi nhận hàng về, khách chọn nơi nhận tiền
 * hoàn (Ví Tubu hoặc tài khoản ngân hàng → hàng đợi admin chuyển tay), tiền về muộn tạo yêu cầu hoàn đúng một lần.
 * Bất biến tiền: tổng mọi lần hoàn của một đơn không vượt order.total, mỗi khoản chỉ chi một lần.
 */
describe('P5 hoàn tiền + trả hàng theo dòng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let returns: OrderReturnsService;
  let refunds: CustomerRefundsService;
  let orders: OrdersService;
  let orderStatus: OrderStatusService;
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        OrdersService,
        OrderReturnsService,
        CustomerRefundsService,
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: { notify } },
        { provide: CartService, useValue: {} },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    returns = moduleRef.get(OrderReturnsService);
    refunds = moduleRef.get(CustomerRefundsService);
    orders = moduleRef.get(OrdersService);
    orderStatus = moduleRef.get(OrderStatusService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => notify.mockClear());

  async function variation(stock = 40) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT', slug: `it-p5-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 89_000 },
    });
    return prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Chai', attributes: {}, retailPrice: 89_000, stock },
    });
  }

  async function walletOf(userId: string) {
    return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } })).walletBalance;
  }

  async function stockOf(variationId: string) {
    return (await prisma.variation.findUniqueOrThrow({ where: { id: variationId } })).stock;
  }

  /** Đơn COD đã giao: 3 chai × 89.000 + ship 15.000 = 282.000, dùng 0 điểm. */
  async function deliveredCod(over: { paymentMethod?: 'COD' | 'BANK_TRANSFER'; paymentStatus?: 'UNPAID' | 'PAID' } = {}) {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const v = await variation();
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      paymentMethod: over.paymentMethod ?? 'COD',
      paymentStatus: over.paymentStatus ?? 'UNPAID',
      subtotal: 267_000,
      shippingFee: 15_000,
      total: 282_000,
      deliveredAt: new Date(),
      items: {
        create: [{ variationId: v.id, productName: 'Nước giặt', variationName: 'Chai', unitPrice: 89_000, quantity: 3, total: 267_000 }],
      },
    });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    return { user, v, order, item };
  }

  it('MONEY-7/ADMINOPS-6: trả 1/3 chai → hoàn đúng 1 chai, chưa cộng kho; nhận hàng về mới cộng 1, không cộng lần hai', async () => {
    const adminUser = await createUser(prisma, { role: 'ADMIN' });
    const { user, v, order, item } = await deliveredCod();
    const stock0 = await stockOf(v.id);

    const req = await returns.request(user.id, order.code, {
      reasonCode: 'OTHER',
      reason: 'Không còn nhu cầu dùng chai này',
      items: [{ orderItemId: item.id, quantity: 1 }],
    });
    const preview = await returns.preview(req.id);
    expect(preview.refund).toBe(89_000);

    await returns.review(adminUser.id, req.id, { approve: true, expectedRefund: 89_000 });
    expect(await walletOf(user.id)).toBe(89_000);
    expect(await stockOf(v.id)).toBe(stock0);
    const o1 = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o1.status).toBe('DELIVERED');

    await returns.markReceived(adminUser.id, req.id);
    expect(await stockOf(v.id)).toBe(stock0 + 1);
    await expect(returns.markReceived(adminUser.id, req.id)).rejects.toThrow();
    expect(await stockOf(v.id)).toBe(stock0 + 1);
  });

  it('trả một phần rồi trả nốt → tổng hoàn đúng bằng order.total (kể cả ship lần cuối), đơn RETURNED, kho cộng đủ 3', async () => {
    const adminUser = await createUser(prisma, { role: 'ADMIN' });
    const { user, v, order, item } = await deliveredCod();
    const stock0 = await stockOf(v.id);

    const r1 = await returns.request(user.id, order.code, { reasonCode: 'OTHER', reason: 'Trả bớt một chai', items: [{ orderItemId: item.id, quantity: 1 }] });
    await returns.review(adminUser.id, r1.id, { approve: true });
    await returns.markReceived(adminUser.id, r1.id);

    const r2 = await returns.request(user.id, order.code, { reasonCode: 'OTHER', reason: 'Trả nốt hai chai', items: [{ orderItemId: item.id, quantity: 2 }] });
    await expect(returns.review(adminUser.id, r2.id, { approve: true, expectedRefund: 1 })).rejects.toThrow('Số tiền hoàn đã đổi');
    const preview = await returns.preview(r2.id);
    expect(preview.refund).toBe(282_000 - 89_000);
    await returns.review(adminUser.id, r2.id, { approve: true, expectedRefund: preview.refund });
    await returns.markReceived(adminUser.id, r2.id);

    expect(await walletOf(user.id)).toBe(282_000);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('RETURNED');
    expect(await stockOf(v.id)).toBe(stock0 + 3);
  });

  it('2 admin duyệt đồng thời cùng một yêu cầu trả một phần → 1 thắng, Ví cộng đúng 1 lần', async () => {
    const [a1, a2] = await Promise.all([createUser(prisma, { role: 'ADMIN' }), createUser(prisma, { role: 'ADMIN' })]);
    const { user, order, item } = await deliveredCod();
    const req = await returns.request(user.id, order.code, { reasonCode: 'DEFECTIVE', items: [{ orderItemId: item.id, quantity: 1 }] });

    const s = summarize(await Promise.allSettled([returns.review(a1.id, req.id, { approve: true }), returns.review(a2.id, req.id, { approve: true })]));
    expect(s.fulfilled.length).toBe(1);
    // Lỗi do shop (DEFECTIVE) → hoàn cả ship một lần: 89.000 + 15.000.
    expect(await walletOf(user.id)).toBe(104_000);
  });

  it('Pancake báo "Đã hoàn" (RETURNED) sau một lần trả một phần → chỉ hoàn phần còn lại, tổng = order.total', async () => {
    const adminUser = await createUser(prisma, { role: 'ADMIN' });
    const { user, order, item } = await deliveredCod();
    const req = await returns.request(user.id, order.code, { reasonCode: 'OTHER', reason: 'Trả bớt một chai', items: [{ orderItemId: item.id, quantity: 1 }] });
    await returns.review(adminUser.id, req.id, { approve: true });

    await orderStatus.setStatus(order.id, 'RETURNED', { actorType: 'PANCAKE' });
    expect(await walletOf(user.id)).toBe(282_000);
  });

  it('trả một phần đã duyệt chưa nhận về, Pancake/admin lật RETURNED, rồi nhận hàng về → kho cộng đúng bằng số chai của dòng', async () => {
    const adminUser = await createUser(prisma, { role: 'ADMIN' });
    const { user, v, order, item } = await deliveredCod();
    const stock0 = await stockOf(v.id);
    const req = await returns.request(user.id, order.code, { reasonCode: 'OTHER', reason: 'Trả bớt một chai', items: [{ orderItemId: item.id, quantity: 1 }] });
    await returns.review(adminUser.id, req.id, { approve: true });

    await orderStatus.setStatus(order.id, 'RETURNED', { actorType: 'PANCAKE' });
    expect(await stockOf(v.id)).toBe(stock0 + item.quantity - 1);
    await returns.markReceived(adminUser.id, req.id);
    expect(await stockOf(v.id)).toBe(stock0 + item.quantity);
  });

  it('BUYERMINI-11/MONEY-9: khách chọn hoàn về ngân hàng → khoản chờ chuyển khoản, Ví không đổi; admin xác nhận kèm mã GD', async () => {
    const adminUser = await createUser(prisma, { role: 'ADMIN' });
    const { user, order, item } = await deliveredCod();
    const req = await returns.request(user.id, order.code, {
      reasonCode: 'WRONG_ITEM',
      items: [{ orderItemId: item.id, quantity: 1 }],
      refundMethod: 'BANK',
      bankName: 'Techcombank',
      accountNumber: '1903 1234 5678',
      accountName: 'nguyen van a',
    });
    await returns.review(adminUser.id, req.id, { approve: true });

    expect(await walletOf(user.id)).toBe(0);
    const row = await prisma.orderCustomerRefund.findFirstOrThrow({ where: { orderId: order.id } });
    expect(row).toMatchObject({
      kind: 'RETURN',
      refKey: req.id,
      amount: 104_000,
      method: 'MANUAL_TRANSFER',
      status: 'PENDING',
      userId: user.id,
      bankAccountNo: '190312345678',
      bankAccountName: 'NGUYEN VAN A',
    });
    // R2-BUYERMINI-9: một lần duyệt chỉ một tin cho khách — tin duyệt đã nói số tiền và tài khoản.
    expect(notify).toHaveBeenCalledWith(user.id, 'RETURN_APPROVED_DETAIL', expect.objectContaining({ refund_note: expect.stringContaining('Techcombank ••• 5678') }));
    expect(notify).not.toHaveBeenCalledWith(user.id, 'REFUND_BANK_REQUESTED', expect.anything());

    await refunds.claim(adminUser.id, row.id);
    await refunds.markPaid(adminUser.id, row.id, { bankRef: 'FT26101400001' });
    expect(await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'COMPLETED', bankRef: 'FT26101400001' });
    expect(notify).toHaveBeenCalledWith(user.id, 'REFUND_BANK_COMPLETED', expect.objectContaining({ bank_ref: 'FT26101400001' }));
  });

  it('BUYERMINI-9: khách huỷ đơn chuyển khoản đã trả và chọn ngân hàng → đơn REFUNDED, khoản CANCEL chờ chuyển, Ví không đổi', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 300_000 });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'CONFIRMED',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'PAID',
      total: 114_000,
      subtotal: 114_000,
    });

    await orders.cancel(user.id, order.code, { refundMethod: 'BANK', bankName: 'VCB', accountNumber: '0071000123456', accountName: 'Tran Thi B' });

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED' });
    expect(await walletOf(user.id)).toBe(300_000);
    expect(await prisma.orderCustomerRefund.findFirstOrThrow({ where: { orderId: order.id } })).toMatchObject({
      kind: 'CANCEL',
      amount: 114_000,
      status: 'PENDING',
    });
    expect(notify).toHaveBeenCalledWith(user.id, 'ORDER_CANCELLED', {
      order_code: order.code,
      refund_note: expect.stringContaining('chuyển khoản 114.000đ về VCB ••• 3456'),
    });
    expect(notify).not.toHaveBeenCalledWith(user.id, 'REFUND_BANK_REQUESTED', expect.anything());
  });

  it('BUYERMINI-7/MONEY-6: tiền về muộn cho đơn đã huỷ — webhook gửi lại đồng thời 3 lần → đúng 1 yêu cầu hoàn, báo khách 1 lần', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    const order = await createOrder(prisma, { userId: user.id, status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 197_000 });
    const ctx = { prisma, notifications: { notify }, logger: { warn: jest.fn(), log: jest.fn() } };

    const created = await Promise.all(
      [1, 2, 3].map(() => recordLatePaymentRefund(ctx, order, { amount: 197_000, source: 'PANCAKE', refKey: 'p1:197000' })),
    );
    expect(created.filter(Boolean)).toHaveLength(1);
    expect(await prisma.orderCustomerRefund.count({ where: { orderId: order.id, kind: 'LATE_PAYMENT' } })).toBe(1);
    expect(notify.mock.calls.filter(([, code]) => code === 'REFUND_LATE_PAYMENT')).toHaveLength(1);
  });

  it.each(['CANCELLED', 'RETURNED'] as const)(
    'ZaloPay gửi lại callback đã lật PAID sau khi đơn %s và đã hoàn → không tạo khoản hoàn thứ hai, Ví không cộng thêm',
    async (status) => {
      const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
      const appTransId = `260101_${randCode(10)}`;
      const order = await createOrder(prisma, {
        userId: user.id,
        status: 'PENDING_PAYMENT',
        paymentMethod: 'ZALOPAY',
        paymentStatus: 'UNPAID',
        total: 150_000,
        subtotal: 150_000,
        paymentTxnId: appTransId,
      });
      const zalopay = new ZalopayService(prisma, { notify } as never, zalopayConfig() as never);
      const raw = JSON.stringify({ app_trans_id: appTransId, amount: 150_000 });
      expect((await zalopay.handleCallback(raw, zalopayMac(raw))).return_code).toBe(1);
      expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ paymentStatus: 'PAID', status: 'CONFIRMED' });

      if (status === 'CANCELLED') {
        await orders.cancel(user.id, order.code, { refundMethod: 'WALLET' });
      } else {
        await prisma.order.update({ where: { id: order.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
        await orderStatus.setStatus(order.id, 'RETURNED', { actorType: 'ADMIN' });
      }
      expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status, paymentStatus: 'REFUNDED' });
      expect(await walletOf(user.id)).toBe(150_000);
      const walletTrace = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
      expect(walletTrace).toEqual([
        expect.objectContaining({ kind: status === 'CANCELLED' ? 'CANCEL' : 'RETURN', method: 'WALLET', status: 'COMPLETED', amount: 150_000 }),
      ]);

      await Promise.all([1, 2].map(() => zalopay.handleCallback(raw, zalopayMac(raw))));
      expect(await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } })).toEqual(walletTrace);
      expect(await walletOf(user.id)).toBe(150_000);
    },
  );

  it('khách chọn Ví đúng lúc admin bấm "Bắt đầu chuyển khoản" → đúng 1 bên thắng; Ví chỉ cộng khi Ví thắng', async () => {
    for (let round = 0; round < 5; round++) {
      const adminUser = await createUser(prisma, { role: 'ADMIN' });
      const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
      const order = await createOrder(prisma, { userId: user.id, status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', total: 60_000 });
      await recordLatePaymentRefund({ prisma, notifications: { notify }, logger: { warn: jest.fn(), log: jest.fn() } }, order, {
        amount: 60_000,
        source: 'PANCAKE',
        refKey: `race-${round}`,
      });
      const row = await prisma.orderCustomerRefund.findFirstOrThrow({ where: { orderId: order.id } });
      await refunds.chooseDestination(user.id, row.id, { refundMethod: 'BANK', bankName: 'MB', accountNumber: '123456789', accountName: 'Le Van C' });

      const s = summarize(
        await Promise.allSettled([
          refunds.chooseDestination(user.id, row.id, { refundMethod: 'WALLET' }),
          refunds.claim(adminUser.id, row.id).then(() => refunds.markPaid(adminUser.id, row.id, { bankRef: `FT${round}` })),
        ]),
      );
      expect(s.fulfilled.length).toBe(1);
      const done = await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id: row.id } });
      expect(done.status).toBe('COMPLETED');
      expect(await walletOf(user.id)).toBe(done.method === 'WALLET' ? 60_000 : 0);
    }
  });
});
