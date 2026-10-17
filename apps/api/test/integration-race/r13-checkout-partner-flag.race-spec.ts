import { randomInt } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
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
import { WalletLedgerService } from '../../src/modules/wallet/wallet-ledger.service';
import { ComboService } from '../../src/modules/storefront/combo.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { createUser, deleteItData, randCode, setConfig, sleep, summarize, warmPool } from './helpers';

const PRICE = 100_000;
const STOCK = 10;
const ROUNDS = 3;
const STORE_CHANGED = 'Gian hàng vừa thay đổi, vui lòng đặt lại.';

/**
 * Checkout đọc gian hàng đối tác (isPartner) NGOÀI tx (giỏ → nơi giao) rồi mới ghi đơn tự giao; admin tắt cờ (setStorePartner:
 * khoá FOR UPDATE dòng gian hàng rồi kiểm vướng mắc) commit đúng giữa hai bước để lại đơn tự giao trên gian hàng không còn là
 * đối tác. Kịch bản đủ ba bên: khách đặt, chủ gỡ sản phẩm tự giao cuối cùng (hết vướng mắc), admin tắt cờ. Tx thứ ba giữ khoá ép
 * thứ tự: giữ biến thể (đặt đơn dừng trước khi khoá gian hàng) hoặc giữ users của khách (đặt đơn dừng ở bước chèn đơn).
 */
describe('Đặt đơn tự giao ‖ admin tắt cờ gian hàng đối tác (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let merchant: MerchantFulfilmentService;
  const CONFIG_KEYS = ['merchant.settlement_hold_days', 'merchant.consignment_settle_from'];
  let savedConfig: { key: string; value: unknown }[] = [];
  const created = { userIds: [] as string[], productIds: [] as string[], storefrontIds: [] as string[] };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        CartService,
        CheckoutService,
        CouponsService,
        PricingService,
        LoyaltyService,
        AffiliateService,
        RewardPointsService,
        WalletService,
        WalletLedgerService,
        CashbackService,
        ComboService,
        FlashSaleService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: GomdonOrderService, useValue: { isRecyclingEnabled: jest.fn().mockResolvedValue(false), enqueuePush: jest.fn() } },
        { provide: LifecycleService, useValue: { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } },
        { provide: CashbackProviderRegistry, useValue: { all: () => [] } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
    await setConfig(prisma, 'merchant.settlement_hold_days', 7);
    await setConfig(prisma, 'merchant.consignment_settle_from', '2000-01-01T00:00:00Z');
    merchant = new MerchantFulfilmentService(prisma, {} as never, undefined, moduleRef.get(SystemConfigService));
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.userAdminEvent.deleteMany({ where: { userId: { in: created.userIds } } });
      await prisma.storefront.updateMany({ where: { id: { in: created.storefrontIds } }, data: { ownerUserId: null } });
      await deleteItData(prisma, created);
      await prisma.storefront.deleteMany({ where: { id: { in: created.storefrontIds } } });
      await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
      for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
    }
    await moduleRef?.close();
  });

  /** Gian hàng CTV đang là đối tác (chủ đã về CTV), một sản phẩm tự giao; khách có giỏ chứa sản phẩm đó và địa chỉ. */
  async function scenario() {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const owner = await createUser(prisma, { role: 'AFFILIATE' });
    const buyer = await createUser(prisma, { role: 'CUSTOMER' });
    created.userIds.push(admin.id, owner.id, buyer.id);
    const tag = randCode(8).toLowerCase();
    const sf = await prisma.storefront.create({
      data: { type: 'CTV', isPartner: true, slug: `itcp-${tag}`, ownerUserId: owner.id, title: `Shop ${tag}`, isPublished: true },
    });
    created.storefrontIds.push(sf.id);
    const product = await prisma.product.create({
      data: { storefrontId: sf.id, fulfilment: 'MERCHANT', brand: 'IT', slug: `itcp-${tag}`, name: `SP ${tag}`, description: 'IT', basePrice: PRICE },
    });
    created.productIds.push(product.id);
    const v = await prisma.variation.create({
      data: { productId: product.id, sku: `ITCP-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: PRICE, stock: STOCK },
    });
    const addr = await prisma.address.create({
      data: {
        userId: buyer.id,
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
    await cart.addItem(buyer.id, { variationId: v.id, quantity: 1 });
    expect((await cart.getCart(buyer.id)).items.map((l) => l.fulfiller.kind)).toEqual(['MERCHANT']);
    return { admin, owner, buyer, sf, product, v, addr };
  }

  async function hold(lock: (tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) => Promise<unknown>) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    let pid = 0;
    const done = prisma.$transaction(
      async (tx) => {
        await lock(tx);
        [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS "pid"`;
        locked();
        await gate;
      },
      { timeout: 30_000 },
    );
    await held;
    return { release, done, pid };
  }

  async function lockWaiters(holderPid: number) {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`
      WITH RECURSIVE "w" AS (
        SELECT "pid" FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids("pid"))
        UNION
        SELECT a."pid" FROM pg_stat_activity a JOIN "w" ON "w"."pid" = ANY(pg_blocking_pids(a."pid"))
      )
      SELECT count(*)::int AS "n" FROM "w"`;
    return row?.n ?? 0;
  }

  async function waitUntil(cond: () => Promise<boolean> | boolean, what: string) {
    for (let i = 0; !(await cond()); i++) {
      if (i > 200) throw new Error(`${what} không tới chỗ chờ khoá`);
      await sleep(25);
    }
  }

  /**
   * Đặt đơn chạy tới khi kẹt sau tx giữ khoá; chủ gỡ sản phẩm tự giao; admin tắt cờ chạy tới khi xong hoặc kẹt (trực tiếp hoặc
   * sau đặt đơn); thả khoá. Luôn thả khoá kể cả khi kiểm tra giữa chừng hỏng.
   */
  async function race(s: Awaited<ReturnType<typeof scenario>>, holder: Awaited<ReturnType<typeof hold>>) {
    const running: Promise<unknown>[] = [];
    try {
      let placeSettled = false;
      running.push(
        checkout.placeOrder(s.buyer.id, { addressId: s.addr.id, paymentMethod: 'COD' } as never).finally(() => (placeSettled = true)),
      );
      await waitUntil(async () => placeSettled || (await lockWaiters(holder.pid)) >= 1, 'đặt đơn');
      expect(placeSettled).toBe(false);
      await prisma.product.update({ where: { id: s.product.id }, data: { isActive: false } });
      let offSettled = false;
      running.push(merchant.setStorePartner(s.admin.id, s.sf.id, false).finally(() => (offSettled = true)));
      await waitUntil(async () => offSettled || (await lockWaiters(holder.pid)) >= 2, 'tắt cờ');
    } finally {
      holder.release();
      await holder.done;
    }
    const settled = await Promise.allSettled(running);
    return { place: settled[0]!, off: settled[1]!, summary: summarize(settled) };
  }

  const isPartner = async (id: string) => (await prisma.storefront.findUniqueOrThrow({ where: { id } })).isPartner;

  it(`admin tắt cờ commit trước khi đặt đơn khoá gian hàng → đặt đơn 409 "${STORE_CHANGED}", không tạo gì (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const s = await scenario();
      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "variations" WHERE "id" = ${s.v.id} FOR UPDATE`);
      const r = await race(s, holder);

      expect(r.off).toEqual({ status: 'fulfilled', value: { id: s.sf.id, isPartner: false } });
      expect(r.place.status).toBe('rejected');
      const err = (r.place as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe(STORE_CHANGED);
      expect(await isPartner(s.sf.id)).toBe(false);
      expect(await prisma.order.count({ where: { userId: s.buyer.id } })).toBe(0);
      expect(await prisma.order.count({ where: { fulfillerStorefrontId: s.sf.id } })).toBe(0);
      expect((await prisma.variation.findUniqueOrThrow({ where: { id: s.v.id } })).stock).toBe(STOCK);
      expect(await prisma.cartItem.count({ where: { cart: { userId: s.buyer.id } } })).toBe(1);
    }
  });

  it(`đặt đơn đã khoá gian hàng trước → tắt cờ chờ rồi thấy đơn tự giao vừa đặt, 409; cờ giữ nguyên (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const s = await scenario();
      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${s.buyer.id} FOR UPDATE`);
      const r = await race(s, holder);

      expect(r.place.status).toBe('fulfilled');
      expect(r.off.status).toBe('rejected');
      const err = (r.off as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toContain('1 đơn tự giao chưa xong');
      expect(await isPartner(s.sf.id)).toBe(true);
      const orders = await prisma.order.findMany({ where: { userId: s.buyer.id } });
      expect(orders.map((o) => [o.fulfiller, o.fulfillerStorefrontId])).toEqual([['MERCHANT', s.sf.id]]);
      expect((await prisma.variation.findUniqueOrThrow({ where: { id: s.v.id } })).stock).toBe(STOCK - 1);
    }
  });
});
