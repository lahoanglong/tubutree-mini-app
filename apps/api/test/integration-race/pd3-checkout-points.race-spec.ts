import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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
import { ComboService } from '../../src/modules/storefront/combo.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { GameService } from '../../src/modules/game/game.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { createUser, randCode, pinConfig, setConfig, summarize, warmPool } from './helpers';

/**
 * PD-3 T6: đặt đơn tiêu Điểm Xanh hai lô chạy chồng nhau và chồng với các luồng tiêu điểm khác (quay
 * thưởng, đổi voucher, góp quỹ cây) trên Postgres thật. CheckoutService, PricingService, LoyaltyService,
 * GameService đều là bản thật; chỉ stub thông báo / Pancake / Gomdon / combo / flash-sale / coupon.
 * Bất biến sau mỗi ca: không lô nào âm, số dư từng lô == tổng sổ của lô đó (findPointsLotDrift).
 */
describe('PD-3 T6: checkout tiêu hai lô dưới tải song song (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let loyalty: LoyaltyService;
  let game: GameService;
  const touched: string[] = [];

  let restoreRedeem: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        CartService,
        CheckoutService,
        PricingService,
        LoyaltyService,
        GameService,
        AffiliateService,
        RewardPointsService,
        WalletService,
        CashbackService,
        OrderReversalService,
        { provide: CouponsService, useValue: { validateAndCompute: jest.fn(), redeem: jest.fn(), release: jest.fn() } },
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
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    loyalty = moduleRef.get(LoyaltyService);
    game = moduleRef.get(GameService);

    // Phải có trước lần get() đầu (SystemConfigService cache 60s).
    restoreRedeem = await pinConfig(prisma, 'loyalty.vnd_per_point_redeem', 1000);
    await setConfig(prisma, 'loyalty.max_redeem_pct', 0.2);
    await setConfig(prisma, 'game.spin_buy_cost_points', 10);
    await setConfig(prisma, 'game.spin_buy_daily_limit', 3);
    await setConfig(prisma, 'game.spin_prizes', [{ id: 'none', name: 'Chúc may mắn', weight: 1, rewardType: 'NONE', value: 0 }]);
    await setConfig(prisma, 'game.tree_points_price', 50);
  });

  afterEach(async () => {
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await restoreRedeem?.();
    await moduleRef?.close();
  });

  /** Người mua có hai lô khớp sổ, địa chỉ, và `lines` sản phẩm 100.000đ (mỗi sản phẩm một dòng) trong giỏ (tồn kho dư). */
  async function buyer(standard: number, converted: number, lines = 1) {
    const u = await createUser(prisma, { pointsBalance: standard, pointsConvertedBalance: converted });
    touched.push(u.id);
    const seed = [
      { lot: 'STANDARD' as const, delta: standard },
      { lot: 'CONVERTED' as const, delta: converted },
    ].filter((r) => r.delta !== 0);
    await prisma.pointsTransaction.createMany({
      data: seed.map((r) => ({ userId: u.id, delta: r.delta, lot: r.lot, reason: `IT_SEED_${r.lot}`, refType: 'IT' })),
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
        provinceCode: '84_VN01',
        districtCode: '',
        wardCode: '00001',
      },
    });
    for (let i = 0; i < lines; i++) {
      const tag = randCode(8);
      const product = await prisma.product.create({
        data: { pancakeId: `itp-p-${tag}`, brand: 'IT', slug: `itp-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 100_000 },
      });
      const v = await prisma.variation.create({
        data: { pancakeId: `itp-v-${tag}`, productId: product.id, sku: `ITP-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, stock: 50 },
      });
      await cart.addItem(u.id, { variationId: v.id, quantity: 1 });
    }
    const lineIds = (await prisma.cartItem.findMany({ where: { cart: { userId: u.id } }, select: { id: true } })).map((l) => l.id);
    return { u, addr, lineIds };
  }

  /**
   * Rào: mọi lời gọi placeOrder đọc giỏ (compute) xong rồi mới cùng đi tiếp vào tx. Không có rào thì
   * lời gọi tới sau lúc đơn đầu đã dọn giỏ sẽ thua vì "giỏ trống", không kiểm được guard trừ điểm.
   * Mỗi lời gọi đặt một dòng riêng (itemIds): cùng một giỏ thì khoá giỏ biến lần sau thành nhận lại đơn vừa đặt,
   * không chạm tới guard trừ điểm.
   */
  function barrierOnGetCart(n: number) {
    const original = cart.getCartForCheckout.bind(cart);
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    return jest.spyOn(cart, 'getCartForCheckout').mockImplementation(async (userId: string) => {
      const res = await original(userId);
      if (++arrived === n) release();
      await gate;
      return res;
    });
  }

  async function lots(userId: string) {
    return prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { pointsBalance: true, pointsConvertedBalance: true },
    });
  }

  it('T6: 5 đơn song song, mỗi đơn cần 100 điểm lô CONVERTED, số dư chỉ đủ 2 → đúng 2 đơn, lô không âm', async () => {
    const { u, addr, lineIds } = await buyer(0, 250, 5);
    const spy = barrierOnGetCart(5);
    let barrierCalls = 0;
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await Promise.allSettled(
        lineIds.map((id) =>
          checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD', pointsToUse: 100, itemIds: [id] } as never),
        ),
      );
    } finally {
      barrierCalls = spy.mock.calls.length;
      spy.mockRestore();
    }
    expect(barrierCalls).toBe(5);
    const s = summarize(results);
    console.log('[T6a] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, [...new Set(s.errors)]);
    expect(s.fulfilled).toHaveLength(2);
    for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);

    const placed = await prisma.order.findMany({ where: { userId: u.id } });
    expect(placed).toHaveLength(2);
    expect(placed.every((o) => o.pointsUsed === 100 && o.pointsUsedConverted === 100)).toBe(true);
    expect(await lots(u.id)).toEqual({ pointsBalance: 0, pointsConvertedBalance: 50 });
    const redeem = await prisma.pointsTransaction.findMany({ where: { userId: u.id, reason: { startsWith: 'ORDER_REDEEM' } } });
    expect(redeem.map((r) => [r.lot, r.delta])).toEqual([
      ['CONVERTED', -100],
      ['CONVERTED', -100],
    ]);
  });

  it('T6: đơn tiêu hai lô chạy chồng với quay thưởng ×5, đổi voucher ×3, góp quỹ cây ×2 → không lô nào âm; quay/voucher chỉ chạm STANDARD', async () => {
    const { u, addr } = await buyer(20_100, 100);
    const results = await Promise.allSettled([
      checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD', pointsToUse: 120 } as never),
      ...Array.from({ length: 5 }, () => game.spin(u.id)),
      ...Array.from({ length: 3 }, () => loyalty.redeemReward(u.id, 'reward-freeship', `rk-${randCode(12)}`)),
      ...Array.from({ length: 2 }, () => game.buyTree(u.id)),
    ]);
    const s = summarize(results);
    console.log('[T6b] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, [...new Set(s.errors)]);
    for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);

    const after = await lots(u.id);
    expect(after.pointsBalance).toBeGreaterThanOrEqual(0);
    expect(after.pointsConvertedBalance).toBeGreaterThanOrEqual(0);

    const rows = await prisma.pointsTransaction.findMany({ where: { userId: u.id, delta: { lt: 0 } } });
    const spinOrVoucher = rows.filter((r) => r.reason === 'GAME_SPIN_COST' || r.reason.startsWith('LOYALTY_REDEEM_VOUCHER:'));
    expect(spinOrVoucher.length).toBeGreaterThan(0);
    expect(spinOrVoucher.every((r) => r.lot === 'STANDARD')).toBe(true);
    // Lô CONVERTED chỉ bị trừ bởi đơn và quỹ cây.
    expect(
      rows.filter((r) => r.lot === 'CONVERTED').every((r) => r.reason.startsWith('ORDER_REDEEM_CONVERTED:') || r.reason.startsWith('GAME_BUY_TREE:')),
    ).toBe(true);

    // Đơn (nếu thành công) ghi đúng phần từng lô vào sổ.
    const order = await prisma.order.findFirst({ where: { userId: u.id } });
    if (order) {
      const std = rows.find((r) => r.reason === `ORDER_REDEEM:${order.code}`)?.delta ?? 0;
      const conv = rows.find((r) => r.reason === `ORDER_REDEEM_CONVERTED:${order.code}`)?.delta ?? 0;
      expect(-std).toBe(order.pointsUsed - order.pointsUsedConverted);
      expect(-conv).toBe(order.pointsUsedConverted);
    }
  });

  it('review C2: FE đã báo đơn 0đ (quotedZeroTotal) mà lô quy đổi chỉ còn đủ giảm một phần → 400, không tạo đơn, không trừ điểm; không có cờ thì COD bình thường', async () => {
    const { u, addr } = await buyer(0, 50);
    const err = await checkout
      .placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD', pointsToUse: 100, quotedZeroTotal: true } as never)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toMatch(/tải lại trang thanh toán/);
    expect(await prisma.order.count({ where: { userId: u.id } })).toBe(0);
    expect(await lots(u.id)).toEqual({ pointsBalance: 0, pointsConvertedBalance: 50 });
    expect(await prisma.pointsTransaction.count({ where: { userId: u.id, reason: { startsWith: 'ORDER_REDEEM' } } })).toBe(0);

    const order = await checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD', pointsToUse: 100 } as never);
    expect(order.total).toBeGreaterThan(0);
    expect(order.paymentMethod).toBe('COD');
    expect(await lots(u.id)).toEqual({ pointsBalance: 0, pointsConvertedBalance: 0 });
  });

  it('T6: 6 lượt góp quỹ cây song song (50 điểm, có 100 STANDARD + 120 CONVERTED) → đúng 4 lượt, lấy STANDARD trước', async () => {
    const { u } = await buyer(100, 120);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => game.buyTree(u.id)));
    const s = summarize(results);
    expect(s.fulfilled).toHaveLength(4);
    for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
    expect(await lots(u.id)).toEqual({ pointsBalance: 0, pointsConvertedBalance: 20 });
    expect(await prisma.plantedTree.count({ where: { userId: u.id } })).toBe(4);
  });
});
