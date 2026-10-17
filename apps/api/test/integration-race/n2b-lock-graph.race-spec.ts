import { randomInt } from 'node:crypto';
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
import { AccountDeletionService } from '../../src/modules/users/account-deletion.service';
import { createUser, deleteItData, randCode, sleep, summarize, warmPool } from './helpers';

const PRICE = 100_000;
const STOCK = 10;
const ROUNDS = 3;

/**
 * Đồ thị khoá giữa đặt đơn (users KEY SHARE rồi gian hàng KEY SHARE qua khoá ngoại orders) và các đường khoá gian hàng bằng khoá mạnh.
 */
describe('Đồ thị khoá: đặt đơn ‖ khoá gian hàng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let deletion: AccountDeletionService;
  const created = { userIds: [] as string[], productIds: [] as string[], storefrontIds: [] as string[], tierIds: [] as string[] };

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
    const merchant = new MerchantFulfilmentService(prisma, {} as never, undefined, moduleRef.get(SystemConfigService));
    deletion = new AccountDeletionService(prisma, merchant);
  });

  afterAll(async () => {
    if (prisma) {
      const { userIds, storefrontIds } = created;
      await prisma.userAdminEvent.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.accountDeletionRequest.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.storefront.updateMany({ where: { id: { in: storefrontIds } }, data: { ownerUserId: null } });
      await deleteItData(prisma, created);
      await prisma.storefront.deleteMany({ where: { id: { in: storefrontIds } } });
    }
    await moduleRef?.close();
  });

  const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  async function user(role: 'ADMIN' | 'DEALER' | 'CUSTOMER' | 'AFFILIATE') {
    const u = await createUser(prisma, { role, phone: phone() });
    created.userIds.push(u.id);
    return u;
  }
  const address = (userId: string) =>
    prisma.address.create({
      data: { userId, recipient: 'IT', phone: phone(), province: 'Ha Noi', district: '', ward: 'P', street: '1', provinceCode: '84_VN01', districtCode: '', wardCode: '00001' },
    });

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

  async function tubuProduct() {
    const p = await prisma.product.create({
      data: {
        fulfilment: 'TUBU', isActive: true, brand: 'IT', slug: `n2b-${randCode(8).toLowerCase()}`, name: 'SP IT', description: 'IT', basePrice: PRICE,
        variations: { create: [{ sku: `N2B-${randCode(8)}`, pancakeId: `n2b-${randCode(8)}`, name: 'v', attributes: {}, retailPrice: PRICE, stock: STOCK }] },
      },
      include: { variations: true },
    });
    created.productIds.push(p.id);
    return p;
  }

  it('ẩn danh tài khoản (gian hàng rồi users FOR UPDATE) ‖ chính chủ đặt đơn qua slug gian hàng của mình: không 40P01, đơn đặt được', async () => {
    const processOnce = (deletion as unknown as { processOnce: (r: string, a: string) => Promise<unknown> }).processOnce.bind(deletion);
    for (let round = 0; round < ROUNDS; round++) {
      const adminUser = await user('ADMIN');
      const owner = await user('AFFILIATE');
      const tag = randCode(8).toLowerCase();
      const sf = await prisma.storefront.create({
        data: { type: 'CTV', isPartner: false, slug: `n2b-${tag}`, subdomain: `n2b-${tag}`, ownerUserId: owner.id, title: `Shop ${tag}`, isPublished: true },
      });
      created.storefrontIds.push(sf.id);
      const addr = await address(owner.id);
      const request = await prisma.accountDeletionRequest.create({ data: { userId: owner.id, reason: 'IT' } });
      const p = await tubuProduct();
      await cart.addItem(owner.id, { variationId: p.variations[0]!.id, quantity: 1 });
      // Giữ users ở KEY SHARE: ẩn danh lấy dòng gian hàng rồi kẹt ở users FOR UPDATE.
      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${owner.id} FOR KEY SHARE`);
      const running: Promise<unknown>[] = [];
      try {
        let d = false;
        running.push(processOnce(request.id, adminUser.id).finally(() => (d = true)));
        await waitUntil(async () => d || (await lockWaiters(holder.pid)) >= 1, 'ẩn danh');
        let s = false;
        running.push(checkout.placeOrder(owner.id, { addressId: addr.id, paymentMethod: 'COD', storefrontSlug: sf.slug } as never).finally(() => (s = true)));
        await waitUntil(async () => s || (await lockWaiters(holder.pid)) >= 2, 'đặt đơn');
      } finally {
        holder.release();
        await holder.done;
      }
      const settled = await Promise.allSettled(running);
      expect(summarize(settled).errors.join(' ')).not.toMatch(/40P01|deadlock|bận/i);
    }
  });
});
