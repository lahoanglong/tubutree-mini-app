import { randomInt } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
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
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

const DAY = 864e5;

/**
 * PF-6a: lockedOrderPoints đọc `returns.window_days` qua SystemConfigService. Lần trượt cache của lệnh get lấy THÊM một
 * kết nối pool; nếu xảy ra trong tx (đang giữ một kết nối và khoá dòng user) thì tải bùng nổ lúc cache hết hạn có thể cạn
 * pool (P2024). Bốn đường tiêu Điểm Xanh thường trong tx (đổi voucher, vòng quay, góp quỹ cây, checkout) phải đọc cửa sổ
 * NGOÀI tx rồi truyền cho lockedOrderPoints.
 *
 * Cách đo (cùng ca (g) của pf5-spin-locked-points): xoá cache cấu hình, bọc SystemConfigService.get, mỗi lần get trượt cache
 * đếm phiên "idle in transaction" trong pg_stat_activity (tx đang chờ JS nên hiện ra ở đó). Phải bằng 0 ở mọi lần trượt.
 * Cache còn bị xoá thêm đúng lúc `$transaction` mở: quay và checkout làm ấm cache trước tx (PF-5a, và báo giá của
 * checkout), nên chỉ khi cache hết hạn GIỮA bước làm ấm và tx (khoảng hở gồm cả thời gian chờ FOR UPDATE) mới lộ ra
 * lần đọc trong tx; bước xoá này dựng đúng khoảng hở đó.
 */
describe('PF-6a cửa sổ đổi/trả được đọc ngoài tx ở cả bốn đường tiêu điểm (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let config: SystemConfigService;
  let cart: CartService;
  let checkout: CheckoutService;
  let loyalty: LoyaltyService;
  let game: GameService;
  let variationId: string;
  const touched: string[] = [];

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
    config = moduleRef.get(SystemConfigService);
    cart = moduleRef.get(CartService);
    checkout = moduleRef.get(CheckoutService);
    loyalty = moduleRef.get(LoyaltyService);
    game = moduleRef.get(GameService);

    await setConfig(prisma, 'returns.window_days', 7);
    await setConfig(prisma, 'loyalty.vnd_per_point_redeem', 1000);
    await setConfig(prisma, 'loyalty.max_redeem_pct', 0.5);
    await setConfig(prisma, 'loyalty.point_expire_months', 12);
    await setConfig(prisma, 'game.spin_buy_cost_points', 10);
    await setConfig(prisma, 'game.spin_buy_daily_limit', 100);
    await setConfig(prisma, 'game.spin_prizes', [{ id: 'none', name: 'Chúc may mắn', weight: 1, rewardType: 'NONE', value: 0 }]);
    await setConfig(prisma, 'game.tree_points_price', 50);

    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it6-p-${tag}`, brand: 'IT', slug: `it6-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it6-v-${tag}`, productId: product.id, sku: `IT6-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, stock: 10_000 },
    });
    variationId = v.id;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await setConfig(prisma, 'returns.window_days', 7);
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /**
   * Khách có `pts` điểm thường, toàn bộ từ một đơn giao 2 ngày trước (còn khoá khi cửa sổ là 7 ngày, tự do khi là 1 ngày),
   * kèm địa chỉ và 1 sản phẩm trong giỏ để đặt được đơn.
   */
  async function holder(pts: number) {
    const user = await createUser(prisma, { pointsBalance: pts });
    touched.push(user.id);
    const deliveredAt = new Date(Date.now() - 2 * DAY);
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      deliveredAt,
      pointsEarned: pts,
      paymentStatus: 'PAID',
    });
    await prisma.pointsTransaction.create({
      data: { userId: user.id, delta: pts, lot: 'STANDARD', reason: `ORDER_DELIVERED:${order.code}`, refType: 'ORDER', refId: order.id, createdAt: deliveredAt },
    });
    const addr = await prisma.address.create({
      data: {
        userId: user.id,
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
    await cart.addItem(user.id, { variationId, quantity: 1 });
    return { user, addr };
  }

  /**
   * Mỗi đường tiêu điểm với số điểm tiêu. `whenLocked`: đổi voucher, quay và góp quỹ từ chối khi điểm đang khoá; checkout
   * thì kẹp pointsToUse theo số dùng được ngay lúc báo giá (compute, ngoài tx) nên đơn vẫn đặt được mà không tiêu điểm.
   */
  type Holder = { user: { id: string }; addr: { id: string } };
  const spenders: Record<string, { cost: number; whenLocked: 'reject' | 'clamp'; run: (u: Holder) => Promise<unknown> }> = {
    'đổi voucher (LoyaltyService.redeemReward)': {
      cost: 20,
      whenLocked: 'reject',
      run: (u) => loyalty.redeemReward(u.user.id, 'reward-freeship'),
    },
    'vòng quay (GameService.spin)': { cost: 10, whenLocked: 'reject', run: (u) => game.spin(u.user.id) },
    'góp quỹ cây (GameService.buyTree)': { cost: 50, whenLocked: 'reject', run: (u) => game.buyTree(u.user.id) },
    'checkout (CheckoutService.placeOrder)': {
      cost: 20,
      whenLocked: 'clamp',
      run: (u) => checkout.placeOrder(u.user.id, { addressId: u.addr.id, paymentMethod: 'COD', pointsToUse: 20 } as never),
    },
  };

  const balance = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pointsBalance;

  /** Xoá cache cấu hình (lúc bắt đầu và lúc mở tx) và ghi lại mọi lần get trượt cache xảy ra khi có tx đang mở. */
  function watchConfigMissesInTx() {
    const cache = (config as unknown as { cache: Map<string, unknown> }).cache;
    cache.clear();
    const realTransaction = prisma.$transaction.bind(prisma) as (...args: unknown[]) => Promise<unknown>;
    jest.spyOn(prisma, '$transaction').mockImplementation(((...args: unknown[]) => {
      cache.clear();
      return realTransaction(...args);
    }) as never);
    const realGet = config.get.bind(config) as (key: string, fallback?: unknown) => Promise<unknown>;
    const inTxMisses: string[] = [];
    jest.spyOn(config, 'get').mockImplementation((async (key: string, fallback?: unknown) => {
      if (!cache.has(key)) {
        const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND state LIKE 'idle in transaction%'`;
        if (n > 0) inTxMisses.push(key);
      }
      return realGet(key, fallback);
    }) as never);
    return inTxMisses;
  }

  describe.each(Object.entries(spenders))('%s', (_name, spender) => {
    it('cache cấu hình trống: mọi lần đọc cấu hình trượt cache đều xảy ra khi KHÔNG có tx nào đang mở (cửa sổ 1 ngày → điểm tự do, tiêu được)', async () => {
      await setConfig(prisma, 'returns.window_days', 1);
      const u = await holder(60);
      const inTxMisses = watchConfigMissesInTx();

      await spender.run(u);

      expect(inTxMisses).toEqual([]);
      expect(await balance(u.user.id)).toBe(60 - spender.cost);
    });

    it('giá trị cửa sổ đọc ngoài tx là giá trị cấu hình thật: cửa sổ 7 ngày → điểm đơn giao 2 ngày trước còn khoá, số dư nguyên', async () => {
      const u = await holder(60);
      const inTxMisses = watchConfigMissesInTx();

      if (spender.whenLocked === 'reject') {
        await expect(spender.run(u)).rejects.toBeInstanceOf(BadRequestException);
      } else {
        await spender.run(u);
        const placed = await prisma.order.findMany({ where: { userId: u.user.id, status: { not: 'DELIVERED' } } });
        expect(placed).toHaveLength(1);
        expect(placed[0]!.pointsUsed).toBe(0);
      }

      expect(inTxMisses).toEqual([]);
      expect(await balance(u.user.id)).toBe(60);
    });
  });
});
