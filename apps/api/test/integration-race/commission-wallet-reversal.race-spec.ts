import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { applyWalletDelta } from '../../src/modules/wallet/wallet-ledger.service';
import { findWalletLedgerDrift } from '../../src/modules/wallet/wallet-reconcile';
import { AFFILIATE_AUTO_WALLET_TRANSFER_KEY } from '../../src/modules/affiliate/affiliate-auto-transfer-config';
import { createOrder, createUser, legacyBankCommissionPayout, pinConfig, randCode, setConfig, summarize, warmPool } from './helpers';

/**
 * Hoa hồng đã vào Ví Tubu của CTV mà đơn bị trả: trừ thẳng Ví (COMMISSION_REVERSAL, số dư có thể âm). Chạy trên Postgres thật qua
 * AffiliateService, OrderReturnsService, OrderReversalService thật. Kiểm: trừ đúng số một lần dù chạy lại/song song; hai yêu cầu
 * trả một phần song song; trả đơn chạy chen cron chuyển hoa hồng vào Ví (không mất, không trừ trùng); Ví âm không trả đơn được;
 * lệnh rút ngân hàng cũ không bị trừ; bất biến số dư == tổng sổ giữ nguyên.
 */
describe('Thu hồi hoa hồng đã vào Ví khi đơn bị trả (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let returns: OrderReturnsService;
  let affiliate: AffiliateService;
  const notify = jest.fn().mockResolvedValue(undefined);
  let restoreAutoWallet: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        RewardPointsService,
        AnalyticsEventsService,
        AffiliateService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notify, notifySafe: notify } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    returns = moduleRef.get(OrderReturnsService);
    affiliate = moduleRef.get(AffiliateService);
    await setConfig(prisma, 'returns.window_days', 7);
    await setConfig(prisma, 'affiliate.pit_withhold_pct', 0.1);
    await setConfig(prisma, 'affiliate.pit_withhold_threshold', 50_000_000);
    // Cờ tự chuyển tắt: ca nào cần chuyển hoa hồng vào Ví thì gọi requestPayout tường minh, không để cron của DB dùng chung xen vào.
    restoreAutoWallet = await pinConfig(prisma, AFFILIATE_AUTO_WALLET_TRANSFER_KEY, false);
    (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();
  });

  afterAll(async () => {
    await restoreAutoWallet?.();
    await moduleRef?.close();
  });

  async function variation(price: number, affiliateRate: number | null) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-cwr-p-${tag}`, brand: 'IT', slug: `it-cwr-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: price },
    });
    return prisma.variation.create({
      data: { pancakeId: `it-cwr-v-${tag}`, productId: product.id, sku: `ITCWR-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: price, affiliateRate, stock: 50 },
    });
  }

  /**
   * Đơn CTV đã giao: a: `qtyA` × 100.000 (10% → hoa hồng 10.000 mỗi đơn vị), c: 1 × 20.000 không hoa hồng.
   * Hoa hồng tạo xong chuyển qua requestPayout thật: PAID, Ví CTV được cộng `amount`.
   */
  async function paidInWalletOrder(qtyA: number, opts: { ctvWalletBefore?: number } = {}) {
    const ctv = await createUser(prisma, { role: 'AFFILIATE', walletBalance: 0 });
    if (opts.ctvWalletBefore) {
      await prisma.$transaction((tx) => applyWalletDelta(tx, { userId: ctv.id, delta: opts.ctvWalletBefore!, type: 'ADJUST', reason: 'IT mở đầu' }));
    }
    const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const [a, c] = await Promise.all([variation(100_000, 10), variation(20_000, 0)]);
    const total = qtyA * 100_000 + 20_000;
    const order = await createOrder(prisma, {
      userId: buyer.id,
      referrerUserId: ctv.id,
      status: 'DELIVERED',
      deliveredAt: new Date(),
      subtotal: total,
      total,
      items: {
        create: [
          { variationId: a.id, productName: 'A', variationName: 'Mặc định', unitPrice: 100_000, quantity: qtyA, total: qtyA * 100_000, paidTotal: qtyA * 100_000 },
          { variationId: c.id, productName: 'C', variationName: 'Mặc định', unitPrice: 20_000, quantity: 1, total: 20_000, paidTotal: 20_000 },
        ],
      },
    });
    await affiliate.createCommissionForOrder(order.id);
    await affiliate.lockCommissionsForOrder(order.id);
    await prisma.commission.updateMany({ where: { orderId: order.id }, data: { status: 'APPROVED', approvedAt: new Date() } });
    const commission = await prisma.commission.findFirstOrThrow({ where: { orderId: order.id } });
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    const admin = await createUser(prisma, { role: 'ADMIN' });
    return { ctv, buyer, order, commission, admin, a: items.find((i) => i.variationId === a.id)!, c: items.find((i) => i.variationId === c.id)! };
  }

  /** Chuyển hoa hồng của CTV vào Ví bằng đường thật (PAID, một dòng COMMISSION_PAYOUT). */
  async function moveToWallet(ctvId: string) {
    const amount = (await prisma.commission.aggregate({ where: { affiliateUserId: ctvId, status: 'APPROVED', payoutBatchId: null }, _sum: { amount: true } }))._sum.amount ?? 0;
    return affiliate.requestPayout(ctvId, amount, 'WALLET_BALANCE', undefined, `it-cwr-${randCode(10)}`);
  }

  async function spend(userId: string, amount: number) {
    await prisma.$transaction((tx) => applyWalletDelta(tx, { userId, delta: -amount, type: 'ORDER_PAY', refType: 'ORDER', refId: `it-pay-${randCode(8)}` }));
  }

  const balance = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } })).walletBalance;
  const reversals = (userId: string) => prisma.walletTransaction.findMany({ where: { userId, type: 'COMMISSION_REVERSAL' }, orderBy: { createdAt: 'asc' } });
  const commissionOf = (orderId: string) => prisma.commission.findFirstOrThrow({ where: { orderId } });
  const noDrift = async (userId: string) => expect((await findWalletLedgerDrift(prisma, { userIds: [userId] })).affectedCount).toBe(0);

  const fullReturn = async (o: Awaited<ReturnType<typeof paidInWalletOrder>>) => {
    const req = await returns.request(o.buyer.id, o.order.code, {
      reasonCode: 'DEFECTIVE',
      items: [
        { orderItemId: o.a.id, quantity: o.a.quantity },
        { orderItemId: o.c.id, quantity: 1 },
      ],
      refundMethod: 'WALLET',
    });
    await returns.review(o.admin.id, req.id, { approve: true });
    return req;
  };

  it('trả cả đơn: trừ đúng hoa hồng đã vào Ví, Ví CTV âm được, REJECTED cùng lúc, chạy lại không trừ lần hai, sổ khớp số dư', async () => {
    const o = await paidInWalletOrder(1);
    await moveToWallet(o.ctv.id);
    expect(await balance(o.ctv.id)).toBe(10_000);
    await spend(o.ctv.id, 8_000);
    expect((await commissionOf(o.order.id)).status).toBe('PAID');

    await fullReturn(o);

    expect(await commissionOf(o.order.id)).toMatchObject({ status: 'REJECTED' });
    expect(await balance(o.ctv.id)).toBe(-8_000);
    const rows = await reversals(o.ctv.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delta: -10_000, balanceAfter: -8_000, refType: 'COMMISSION', refId: o.commission.id });
    expect(rows[0]!.reason).toContain(o.order.code);

    await affiliate.reverseCommissionsForOrder(o.order.id);
    await affiliate.reverseCommissionsForOrder(o.order.id);
    expect(await balance(o.ctv.id)).toBe(-8_000);
    expect(await reversals(o.ctv.id)).toHaveLength(1);
    await noDrift(o.ctv.id);
  });

  it('nhiều lần thu hồi song song cho cùng đơn: chỉ trừ một lần', async () => {
    const o = await paidInWalletOrder(1, { ctvWalletBefore: 50_000 });
    await moveToWallet(o.ctv.id);
    await prisma.order.update({ where: { id: o.order.id }, data: { status: 'RETURNED' } });

    const s = summarize(await Promise.allSettled(Array.from({ length: 6 }, () => affiliate.reverseCommissionsForOrder(o.order.id))));
    expect(s.errors).toEqual([]);
    expect(await balance(o.ctv.id)).toBe(50_000);
    expect(await reversals(o.ctv.id)).toHaveLength(1);
    expect((await commissionOf(o.order.id)).status).toBe('REJECTED');
    await noDrift(o.ctv.id);
  });

  it('hoa hồng APPROVED chưa vào Ví: đổi REJECTED, không đụng Ví', async () => {
    const o = await paidInWalletOrder(1, { ctvWalletBefore: 5_000 });
    await prisma.order.update({ where: { id: o.order.id }, data: { status: 'RETURNED' } });
    await affiliate.reverseCommissionsForOrder(o.order.id);
    expect((await commissionOf(o.order.id)).status).toBe('REJECTED');
    expect(await balance(o.ctv.id)).toBe(5_000);
    expect(await reversals(o.ctv.id)).toHaveLength(0);
    await noDrift(o.ctv.id);
  });

  it('trả một phần: hoa hồng đã vào Ví bị cắt và trừ Ví đúng phần cắt, mỗi yêu cầu một dòng sổ', async () => {
    const o = await paidInWalletOrder(2);
    await moveToWallet(o.ctv.id);
    expect(await balance(o.ctv.id)).toBe(20_000);

    const req = await returns.request(o.buyer.id, o.order.code, { reasonCode: 'DEFECTIVE', items: [{ orderItemId: o.a.id, quantity: 1 }], refundMethod: 'WALLET' });
    await returns.review(o.admin.id, req.id, { approve: true });

    const after = await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(after).toMatchObject({ fullReturn: false, commissionReversed: 10_000 });
    expect(await commissionOf(o.order.id)).toMatchObject({ status: 'PAID', amount: 10_000, commissionableTotal: 100_000 });
    expect(await balance(o.ctv.id)).toBe(10_000);
    const rows = await reversals(o.ctv.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delta: -10_000, refId: `${o.commission.id}:${req.id}` });
    await noDrift(o.ctv.id);
  });

  it('trả một phần món không hoa hồng (0%): không cắt, không trừ Ví', async () => {
    const o = await paidInWalletOrder(2);
    await moveToWallet(o.ctv.id);
    const req = await returns.request(o.buyer.id, o.order.code, { reasonCode: 'DEFECTIVE', items: [{ orderItemId: o.c.id, quantity: 1 }], refundMethod: 'WALLET' });
    await returns.review(o.admin.id, req.id, { approve: true });
    expect(await commissionOf(o.order.id)).toMatchObject({ amount: 20_000 });
    expect(await balance(o.ctv.id)).toBe(20_000);
    expect(await reversals(o.ctv.id)).toHaveLength(0);
  });

  it('hai quản trị cùng duyệt một yêu cầu trả một phần: hoa hồng chỉ bị cắt và Ví chỉ bị trừ một lần', async () => {
    const o = await paidInWalletOrder(3);
    await moveToWallet(o.ctv.id);
    expect(await balance(o.ctv.id)).toBe(30_000);
    const second = await createUser(prisma, { role: 'ADMIN' });
    const r1 = await returns.request(o.buyer.id, o.order.code, { reasonCode: 'DEFECTIVE', items: [{ orderItemId: o.a.id, quantity: 1 }], refundMethod: 'WALLET' });

    const s = summarize(await Promise.allSettled([returns.review(o.admin.id, r1.id, { approve: true }), returns.review(second.id, r1.id, { approve: true })]));
    expect(s.fulfilled).toHaveLength(1);
    expect(s.errors).toEqual([expect.stringMatching(/^(BadRequestException|ConflictException)/)]);

    expect(await commissionOf(o.order.id)).toMatchObject({ amount: 20_000, commissionableTotal: 200_000 });
    const rows = await reversals(o.ctv.id);
    expect(rows.map((r) => [r.refId, r.delta])).toEqual([[`${o.commission.id}:${r1.id}`, -10_000]]);
    expect(await balance(o.ctv.id)).toBe(20_000);
    await noDrift(o.ctv.id);
  });

  it('duyệt trả một phần chạy song song với thu hồi cả đơn: tổng trừ đúng bằng hoa hồng đã vào Ví, không trừ trùng', async () => {
    const o = await paidInWalletOrder(2);
    await moveToWallet(o.ctv.id);
    expect(await balance(o.ctv.id)).toBe(20_000);
    const r1 = await returns.request(o.buyer.id, o.order.code, { reasonCode: 'DEFECTIVE', items: [{ orderItemId: o.a.id, quantity: 1 }], refundMethod: 'WALLET' });

    const s = summarize(await Promise.allSettled([returns.review(o.admin.id, r1.id, { approve: true }), affiliate.reverseCommissionsForOrder(o.order.id)]));
    expect(s.errors).toEqual([]);

    expect(await commissionOf(o.order.id)).toMatchObject({ status: 'REJECTED' });
    const rows = await reversals(o.ctv.id);
    expect(rows.reduce((sum, r) => sum + r.delta, 0)).toBe(-20_000);
    expect(await balance(o.ctv.id)).toBe(0);
    await noDrift(o.ctv.id);
  });

  it('trả một phần rồi trả nốt cả đơn: tổng đã trừ đúng bằng hoa hồng đã chuyển vào Ví, Ví về đúng số trước khi có hoa hồng', async () => {
    const o = await paidInWalletOrder(2, { ctvWalletBefore: 3_000 });
    await moveToWallet(o.ctv.id);
    expect(await balance(o.ctv.id)).toBe(23_000);
    const r1 = await returns.request(o.buyer.id, o.order.code, { reasonCode: 'DEFECTIVE', items: [{ orderItemId: o.a.id, quantity: 1 }], refundMethod: 'WALLET' });
    await returns.review(o.admin.id, r1.id, { approve: true });
    expect(await balance(o.ctv.id)).toBe(13_000);

    const r2 = await returns.request(o.buyer.id, o.order.code, {
      reasonCode: 'DEFECTIVE',
      items: [
        { orderItemId: o.a.id, quantity: 1 },
        { orderItemId: o.c.id, quantity: 1 },
      ],
      refundMethod: 'WALLET',
    });
    await returns.review(o.admin.id, r2.id, { approve: true });

    expect(await commissionOf(o.order.id)).toMatchObject({ status: 'REJECTED' });
    expect(await balance(o.ctv.id)).toBe(3_000);
    expect((await reversals(o.ctv.id)).reduce((sum, r) => sum + r.delta, 0)).toBe(-20_000);
    await noDrift(o.ctv.id);
  });

  it('trả đơn chạy song song với việc chuyển hoa hồng vào Ví: không mất tiền, không trừ trùng, tổng sổ khớp (nhiều cặp chạy cùng lúc)', async () => {
    const pairs = await Promise.all(Array.from({ length: 6 }, () => paidInWalletOrder(1)));
    await Promise.all(pairs.map((p) => prisma.order.update({ where: { id: p.order.id }, data: { status: 'RETURNED' } })));

    const settled = await Promise.allSettled(
      pairs.flatMap((p) => [
        affiliate.reverseCommissionsForOrder(p.order.id),
        affiliate.requestPayout(p.ctv.id, 10_000, 'WALLET_BALANCE', undefined, `it-cwr-race-${p.ctv.id}`),
      ]),
    );
    // Thu hồi không bao giờ được lỗi; chuyển vào Ví thua cuộc (hoa hồng đã REJECTED) báo lỗi nghiệp vụ là bình thường.
    const reverseResults = settled.filter((_, i) => i % 2 === 0);
    expect(summarize(reverseResults).errors).toEqual([]);

    for (const p of pairs) {
      expect(await commissionOf(p.order.id)).toMatchObject({ status: 'REJECTED' });
      const ledger = await prisma.walletTransaction.findMany({ where: { userId: p.ctv.id, type: { in: ['COMMISSION_PAYOUT', 'COMMISSION_REVERSAL'] } } });
      const payouts = ledger.filter((l) => l.type === 'COMMISSION_PAYOUT');
      const debits = ledger.filter((l) => l.type === 'COMMISSION_REVERSAL');
      // Hoặc chuyển vào Ví thắng rồi bị trừ lại (net 0), hoặc thu hồi thắng trước và không có đồng nào vào Ví.
      expect(payouts.length).toBe(debits.length);
      expect(payouts.length).toBeLessThanOrEqual(1);
      expect(await balance(p.ctv.id)).toBe(0);
      await noDrift(p.ctv.id);
    }
  });

  it('Ví đang âm: mọi lệnh trừ khác COMMISSION_REVERSAL vẫn bị chặn, số dư và sổ không đổi', async () => {
    const o = await paidInWalletOrder(1);
    await moveToWallet(o.ctv.id);
    await spend(o.ctv.id, 10_000);
    await fullReturn(o);
    expect(await balance(o.ctv.id)).toBe(-10_000);
    const entriesBefore = await prisma.walletTransaction.count({ where: { userId: o.ctv.id } });

    for (const type of ['ORDER_PAY', 'XU_CONVERT', 'WITHDRAW', 'ADJUST'] as const) {
      await expect(
        prisma.$transaction((tx) => applyWalletDelta(tx, { userId: o.ctv.id, delta: -1, type, refId: `it-neg-${type}-${randCode(6)}` })),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(
      prisma.$transaction((tx) => applyWalletDelta(tx, { userId: o.ctv.id, delta: -1, type: 'ORDER_PAY', refId: `it-neg-x-${randCode(6)}`, allowNegative: true })),
    ).rejects.toThrow(/COMMISSION_REVERSAL/);
    expect(await balance(o.ctv.id)).toBe(-10_000);
    expect(await prisma.walletTransaction.count({ where: { userId: o.ctv.id } })).toBe(entriesBefore);

    // Hoa hồng mới về Ví bù vào số âm.
    await prisma.$transaction((tx) => applyWalletDelta(tx, { userId: o.ctv.id, delta: 4_000, type: 'COMMISSION_PAYOUT', refId: `it-bu-${randCode(6)}` }));
    expect(await balance(o.ctv.id)).toBe(-6_000);
    await noDrift(o.ctv.id);
  });

  it('hoa hồng nằm trong lệnh rút ngân hàng cũ (payoutBatchId): không trừ Ví, giữ nguyên trạng thái', async () => {
    const o = await paidInWalletOrder(1);
    const payout = await legacyBankCommissionPayout(prisma, affiliate, o.ctv.id, '079201001234');
    await prisma.order.update({ where: { id: o.order.id }, data: { status: 'RETURNED' } });
    await affiliate.reverseCommissionsForOrder(o.order.id);
    expect(await commissionOf(o.order.id)).toMatchObject({ status: 'APPROVED', payoutBatchId: payout.id });
    expect(await balance(o.ctv.id)).toBe(0);
    expect(await reversals(o.ctv.id)).toHaveLength(0);
  });

  it('CTV đã xoá tài khoản (ẩn danh): không trừ Ví, hoa hồng PAID giữ nguyên để kế toán xử lý', async () => {
    const o = await paidInWalletOrder(1);
    await moveToWallet(o.ctv.id);
    await prisma.user.update({ where: { id: o.ctv.id }, data: { metadata: { anonymizedAt: new Date().toISOString() } } });
    await prisma.order.update({ where: { id: o.order.id }, data: { status: 'RETURNED' } });
    await affiliate.reverseCommissionsForOrder(o.order.id);
    expect(await commissionOf(o.order.id)).toMatchObject({ status: 'PAID' });
    expect(await balance(o.ctv.id)).toBe(10_000);
    expect(await reversals(o.ctv.id)).toHaveLength(0);
  });
});
