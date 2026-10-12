import { randomInt } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { WalletTxType } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CheckoutService } from '../../src/modules/checkout/checkout.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { GomdonOrderService } from '../../src/modules/integrations/gomdon/gomdon-order.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { applyWalletDelta } from '../../src/modules/wallet/wallet-ledger.service';
import { ComboService } from '../../src/modules/storefront/combo.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import type { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import type { Env } from '../../src/config/env.validation';
import { createOrder, createUser, randCode, setConfig, summarize, warmPool } from './helpers';

/**
 * C-060: mọi luồng nghiệp vụ đổi Ví Tubu (rút, hoàn lệnh rút, đổi xu, rút hoa hồng về ví, cashback,
 * trả đơn bằng ví, hoàn đơn, gộp phiên khách) phải ghi đúng 1 dòng wallet_transactions trong CÙNG tx
 * với thay đổi số dư — chạy song song trên Postgres thật, số dư luôn == tổng sổ, không âm.
 */
describe('Sổ cái ví qua các luồng nghiệp vụ (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let wallet: WalletService;
  let affiliate: AffiliateService;
  let cashback: CashbackService;
  let checkout: CheckoutService;
  let cart: CartService;
  let reversal: OrderReversalService;
  let auth: AuthService;
  let zaloIdForNextCall = '';

  const pricing = {
    calcShippingFee: jest.fn().mockResolvedValue(0),
    calcTierDiscount: jest.fn().mockReturnValue(0),
    resolvePointsRedemptionByLot: jest.fn().mockResolvedValue({ pointsUsed: 0, pointsUsedStandard: 0, pointsUsedConverted: 0, discount: 0 }),
    calcPointsEarned: jest.fn().mockResolvedValue(0),
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        CartService,
        CheckoutService,
        AffiliateService,
        RewardPointsService,
        WalletService,
        CashbackService,
        OrderReversalService,
        { provide: CouponsService, useValue: { validateAndCompute: jest.fn(), redeem: jest.fn(), release: jest.fn() } },
        { provide: PricingService, useValue: pricing },
        {
          provide: LoyaltyService,
          useValue: {
            lockedOrderPoints: jest.fn().mockResolvedValue({ locked: 0 }),
            returnWindowDays: jest.fn().mockResolvedValue(7),
            getTierMultiplier: jest.fn().mockResolvedValue(1),
          },
        },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: GomdonOrderService,
          useValue: { isRecyclingEnabled: jest.fn().mockResolvedValue(false), enqueuePush: jest.fn() },
        },
        { provide: ComboService, useValue: { computeForStorefront: jest.fn().mockResolvedValue({ total: 0, perLine: {} }) } },
        {
          provide: FlashSaleService,
          useValue: {
            resolveEffective: jest.fn().mockResolvedValue(new Map()),
            consumeQuota: jest.fn(),
            restore: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: CashbackProviderRegistry, useValue: { all: () => [] } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    wallet = moduleRef.get(WalletService);
    affiliate = moduleRef.get(AffiliateService);
    cashback = moduleRef.get(CashbackService);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    reversal = moduleRef.get(OrderReversalService);

    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-ledger', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30 };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const zalo = {
      getUserInfo: async () => ({ zaloId: zaloIdForNextCall, name: 'Zalo IT' }),
      resolvePhoneNumber: async () => null,
    } as unknown as ZaloService;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    auth = new AuthService(prisma, new JwtService(), config, zalo, rbac);

    await setConfig(prisma, 'wallet.withdraw_min', 100_000);
    await setConfig(prisma, 'wallet.withdraw_fee', 3_000);
    await setConfig(prisma, 'affiliate.min_withdraw_bank', 50_000);
    await setConfig(prisma, 'cashback.hold_days', 30);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /** Ví mới có số dư đầu kỳ ghi qua sổ (giống backfill OPENING của migration). */
  async function newWallet(opening: number, extra: Parameters<typeof createUser>[1] = {}) {
    const user = await createUser(prisma, extra);
    if (opening !== 0) {
      await prisma.$transaction((tx) =>
        applyWalletDelta(tx, { userId: user.id, delta: opening, type: 'OPENING', refType: 'OPENING', refId: 'OPENING' }),
      );
    }
    return user;
  }

  async function ledgerOf(userId: string) {
    const [u, rows] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } }),
      prisma.walletTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    ]);
    const sum = rows.reduce((s, r) => s + r.delta, 0);
    return { balance: u.walletBalance, sum, rows, byType: (t: WalletTxType) => rows.filter((r) => r.type === t) };
  }

  async function expectBalanced(userId: string) {
    const l = await ledgerOf(userId);
    expect(l.balance).toBe(l.sum);
    expect(l.balance).toBeGreaterThanOrEqual(0);
    return l;
  }

  it('rút tiền song song vượt số dư + đổi xu (đã ngừng, PD-3) song song → mỗi lần rút đúng 1 dòng sổ, không dòng XU_CONVERT, số dư == tổng sổ, không âm', async () => {
    const u = await newWallet(250_000);
    const res = await Promise.allSettled([
      wallet.withdraw(u.id, 100_000, { bank: 'VCB' }, `wd-${randCode(8)}`),
      wallet.withdraw(u.id, 100_000, { bank: 'VCB' }, `wd-${randCode(8)}`),
      wallet.withdraw(u.id, 100_000, { bank: 'VCB' }, `wd-${randCode(8)}`),
      wallet.convertToXu(),
      wallet.convertToXu(),
    ]);
    const s = summarize(res);
    const l = await expectBalanced(u.id);
    const withdraws = l.byType('WITHDRAW');
    expect(l.byType('XU_CONVERT')).toHaveLength(0);
    expect(withdraws.length).toBe(s.fulfilled.length);
    expect(withdraws.length).toBe(2);
    expect(withdraws.every((r) => r.delta === -100_000 && r.refType === 'PAYOUT')).toBe(true);
    const payouts = await prisma.payout.findMany({ where: { userId: u.id } });
    expect(withdraws.map((r) => r.refId).sort()).toEqual(payouts.map((p) => p.id).sort());
  });

  it('PD-3 (T18): đổi Ví → xu gửi 5 lần song song → cả 5 nhận 410, ví giữ nguyên, không dòng XU_CONVERT, xu vẫn 0', async () => {
    const u = await newWallet(100_000);
    const res = await Promise.allSettled(Array.from({ length: 5 }, () => wallet.convertToXu()));
    expect(res.every((r) => r.status === 'rejected' && (r.reason as { getStatus?: () => number }).getStatus?.() === 410)).toBe(true);
    const l = await expectBalanced(u.id);
    expect(l.balance).toBe(100_000);
    expect(l.byType('XU_CONVERT')).toHaveLength(0);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { coinsBalance: true } });
    expect(after.coinsBalance).toBe(0);
  });

  it('admin từ chối lệnh rút 2 lần song song → hoàn gross đúng 1 lần, 1 dòng WITHDRAW_REFUND theo payout', async () => {
    const u = await newWallet(150_000);
    const r = await wallet.withdraw(u.id, 120_000, { bank: 'VCB' }, `wd-${randCode(8)}`);
    const admin = await createUser(prisma, { role: 'ADMIN' });
    await Promise.allSettled([
      affiliate.rejectPayout(admin.id, r.payoutId, 'Sai STK'),
      affiliate.rejectPayout(admin.id, r.payoutId, 'Sai STK'),
    ]);
    const l = await expectBalanced(u.id);
    expect(l.balance).toBe(150_000);
    const refunds = l.byType('WITHDRAW_REFUND');
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ delta: 120_000, refType: 'PAYOUT', refId: r.payoutId });
  });

  it('CTV rút hoa hồng về ví 4 lần song song → cộng đúng 1 lần, 1 dòng COMMISSION_PAYOUT', async () => {
    const ctv = await newWallet(5_000, { role: 'AFFILIATE' });
    const buyer = await createUser(prisma);
    for (const amount of [40_000, 60_000]) {
      const order = await createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', referrerUserId: ctv.id, total: amount * 10 });
      await prisma.commission.create({
        data: {
          affiliateUserId: ctv.id,
          orderId: order.id,
          orderTotal: order.total,
          commissionableTotal: order.total,
          rate: 10,
          amount,
          status: 'APPROVED',
          lockedAt: new Date(Date.now() - 30 * 864e5),
          approvedAt: new Date(),
        },
      });
    }
    await Promise.allSettled(Array.from({ length: 4 }, () => affiliate.requestPayout(ctv.id, 100_000, 'WALLET_BALANCE')));
    const l = await expectBalanced(ctv.id);
    expect(l.balance).toBe(105_000);
    const credits = l.byType('COMMISSION_PAYOUT');
    expect(credits).toHaveLength(1);
    const payout = await prisma.payout.findFirstOrThrow({ where: { userId: ctv.id, method: 'WALLET_BALANCE' } });
    expect(credits[0]).toMatchObject({ delta: 100_000, refType: 'PAYOUT', refId: payout.id });
  });

  it('cron settle cashback chạy chồng 2 lần → ví cộng đúng 1 lần, 1 dòng CASHBACK theo giao dịch', async () => {
    const u = await newWallet(0, { cashbackPending: 25_000 });
    const cb = await prisma.cashbackTransaction.create({
      data: {
        userId: u.id,
        provider: 'it-ledger',
        merchantOrderId: `mo-${randCode(10)}`,
        orderAmount: 500_000,
        commission: 50_000,
        userReward: 25_000,
        status: 'CONFIRMED',
        postbackPayload: {},
        confirmedAt: new Date(Date.now() - 40 * 864e5),
      },
    });
    await Promise.all([cashback.settleConfirmed(), cashback.settleConfirmed()]);
    const l = await expectBalanced(u.id);
    expect(l.balance).toBe(25_000);
    expect(l.byType('CASHBACK')).toEqual([expect.objectContaining({ delta: 25_000, refType: 'CASHBACK', refId: cb.id })]);
  });

  async function walletBuyer(opening: number) {
    const u = await newWallet(opening);
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itl-p-${tag}`, brand: 'IT', slug: `itl-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `itl-v-${tag}`, productId: product.id, sku: `ITL-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, stock: 50 },
    });
    const addr = await prisma.address.create({
      data: {
        userId: u.id,
        recipient: 'Khach IT',
        phone: `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`,
        province: 'Ha Noi',
        district: '',
        ward: 'Phuong IT',
        street: '1 Duong IT',
        provinceCode: '01',
        districtCode: '',
        wardCode: '00001',
      },
    });
    await cart.addItem(u.id, { variationId: v.id, quantity: 1 });
    return { u, addr };
  }

  it('2 đơn trả bằng ví song song chỉ đủ tiền cho 1 → 1 đơn, 1 dòng ORDER_PAY theo đơn; huỷ 2 lần song song → hoàn đúng 1 lần', async () => {
    const { u, addr } = await walletBuyer(150_000);
    const res = await Promise.allSettled([
      checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'WALLET' } as never),
      checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'WALLET' } as never),
    ]);
    expect(summarize(res).fulfilled.length).toBeGreaterThanOrEqual(1);
    const orders = await prisma.order.findMany({ where: { userId: u.id }, include: { items: true } });
    expect(orders).toHaveLength(1);
    const order = orders[0]!;
    let l = await expectBalanced(u.id);
    expect(l.byType('ORDER_PAY')).toEqual([
      expect.objectContaining({ delta: -order.total, refType: 'ORDER', refId: order.id }),
    ]);

    await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    await Promise.allSettled([
      prisma.$transaction((tx) => reversal.reverseFinancials(tx, order)),
      prisma.$transaction((tx) => reversal.reverseFinancials(tx, order)),
    ]);
    l = await expectBalanced(u.id);
    expect(l.balance).toBe(150_000);
    expect(l.byType('ORDER_REFUND')).toEqual([
      expect.objectContaining({ delta: order.total, refType: 'ORDER', refId: order.id }),
    ]);
  });

  it('hoàn đơn CTV lên hộ về ví khách cuối → 1 dòng ORDER_REFUND trên ví khách', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const customer = await newWallet(0);
    const order = await createOrder(prisma, {
      userId: customer.id,
      referrerUserId: ctv.id,
      placedForCustomer: true,
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'PAID',
      total: 220_000,
    });
    const withItems = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    await prisma.$transaction((tx) => reversal.reverseFinancials(tx, withItems));
    const l = await expectBalanced(customer.id);
    expect(l.balance).toBe(220_000);
    expect(l.byType('ORDER_REFUND')).toEqual([expect.objectContaining({ delta: 220_000, refId: order.id })]);
  });

  it('gộp phiên khách có ví → MERGE_OUT ở khách, MERGE_IN ở tài khoản đích, cả hai khớp sổ', async () => {
    const guest = await newWallet(20_000, { zaloId: `guest_dev_${randCode(8)}`, fullName: 'Khách' });
    const target = await newWallet(5_000, { zaloId: `zalo_${randCode(10)}` });
    zaloIdForNextCall = target.zaloId!;
    const res = await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');
    expect(res.user.id).toBe(target.id);

    const g = await expectBalanced(guest.id);
    const t = await expectBalanced(target.id);
    expect(g.balance).toBe(0);
    expect(t.balance).toBe(25_000);
    expect(g.byType('MERGE_OUT')).toEqual([expect.objectContaining({ delta: -20_000, refType: 'USER', refId: target.id })]);
    expect(t.byType('MERGE_IN')).toEqual([expect.objectContaining({ delta: 20_000, refType: 'USER', refId: guest.id })]);
  });
});
