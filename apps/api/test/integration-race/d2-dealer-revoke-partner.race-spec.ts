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
import { AdminService } from '../../src/modules/admin/admin.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { createOrder, createUser, deleteItData, randCode, setConfig, sleep, summarize, warmPool } from './helpers';
import type { OrderStatus, Prisma } from '@prisma/client';


const PRICE = 100_000;
const STOCK = 10;
const ROUNDS = 3;
const DAY = 86_400_000;
const STORE_CHANGED = 'Gian hàng vừa thay đổi, vui lòng đặt lại.';

/**
 * Thu hồi vai trò DEALER (AdminService.setUserRole) tắt cờ isPartner của gian hàng CTV của chủ trong cùng tx, hoặc bị từ chối 409
 * khi gian hàng còn đúng các vướng mắc đang chặn POST /admin/storefronts/:id/partner. Đua với đặt đơn tự giao: khoá gian hàng
 * trước users (như checkout) nên hoặc thu hồi thắng (đặt đơn 409, không tạo gì), hoặc đơn vào trước (thu hồi 409, vai trò giữ).
 */
describe('Thu hồi vai trò đại lý tắt cờ đối tác (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let merchant: MerchantFulfilmentService;
  let admin: AdminService;
  const CONFIG_KEYS = ['merchant.settlement_hold_days', 'merchant.consignment_settle_from'];
  let savedConfig: { key: string; value: unknown }[] = [];
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
    savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
    await setConfig(prisma, 'merchant.settlement_hold_days', 7);
    await setConfig(prisma, 'merchant.consignment_settle_from', '2000-01-01T00:00:00Z');
    merchant = new MerchantFulfilmentService(prisma, {} as never, undefined, moduleRef.get(SystemConfigService));
    const none = {} as never;
    admin = new AdminService(prisma, none, none, none, none, none, none, new RbacService(prisma), none, none, merchant);
  });

  afterAll(async () => {
    if (prisma) {
      const { userIds, storefrontIds } = created;
      await prisma.merchantPayout.deleteMany({ where: { storefrontId: { in: storefrontIds } } });
      await prisma.merchantPancakeLink.deleteMany({ where: { storefrontId: { in: storefrontIds } } });
      await prisma.userAdminEvent.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.storefront.updateMany({ where: { id: { in: storefrontIds } }, data: { ownerUserId: null } });
      await deleteItData(prisma, created);
      await prisma.storefront.deleteMany({ where: { id: { in: storefrontIds } } });
      await prisma.dealerTier.deleteMany({ where: { id: { in: created.tierIds } } });
      await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
      for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
    }
    await moduleRef?.close();
  });

  const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  async function user(role: 'ADMIN' | 'DEALER' | 'CUSTOMER' | 'AFFILIATE') {
    const u = await createUser(prisma, { role, phone: phone() });
    created.userIds.push(u.id);
    return u;
  }

  /** Đại lý (DEALER) có gian hàng CTV là đối tác, không vướng mắc nào. */
  async function dealerStore(o: { isPartner?: boolean; type?: 'CTV' | 'MERCHANT' } = {}) {
    const adminUser = await user('ADMIN');
    const owner = await user('DEALER');
    const buyer = await user('CUSTOMER');
    const tag = randCode(8).toLowerCase();
    const sf = await prisma.storefront.create({
      data: { type: o.type ?? 'CTV', isPartner: o.isPartner ?? true, slug: `itdr-${tag}`, ownerUserId: owner.id, title: `Shop ${tag}`, isPublished: true },
    });
    created.storefrontIds.push(sf.id);
    const flag = async () => (await prisma.storefront.findUniqueOrThrow({ where: { id: sf.id } })).isPartner;
    const role = async () => (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).role;
    const partnerEvents = () => prisma.userAdminEvent.findMany({ where: { userId: owner.id, kind: 'STOREFRONT_PARTNER' } });
    const revoke = () => admin.setUserRole(adminUser.id, owner.phone!, 'CUSTOMER');
    return { adminUser, owner, buyer, sf, tag, flag, role, partnerEvents, revoke };
  }
  type Ctx = Awaited<ReturnType<typeof dealerStore>>;

  async function product(sf: { id: string }, fulfilment: 'MERCHANT' | 'TUBU', isActive: boolean) {
    const p = await prisma.product.create({
      data: {
        storefrontId: sf.id, fulfilment, isActive, brand: 'IT', slug: `itdr-${randCode(8).toLowerCase()}`, name: 'SP IT', description: 'IT', basePrice: 1000,
        variations: { create: [{ sku: `ITDR-${randCode(8)}`, pancakeId: `itdr-${randCode(8)}`, name: 'v', attributes: {}, retailPrice: 1000, stock: 5 }] },
      },
      include: { variations: true },
    });
    created.productIds.push(p.id);
    return p;
  }
  const selfShip = (c: Ctx, status: OrderStatus, extra: Partial<Prisma.OrderUncheckedCreateInput> = {}) =>
    createOrder(prisma, { userId: c.buyer.id, status, fulfiller: 'MERCHANT', fulfillerStorefrontId: c.sf.id, storefrontSlug: c.sf.slug, paymentStatus: 'UNPAID', paymentMethod: 'COD', ...extra });

  async function conflictMessage(p: Promise<unknown>) {
    const err = await p.then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    return (err as ConflictException).message;
  }

  it('không vướng mắc: thu hồi DEALER tắt cờ isPartner, ghi STOREFRONT_PARTNER và ROLE trong cùng lần đổi', async () => {
    const c = await dealerStore();
    await selfShip(c, 'CANCELLED');
    await expect(c.revoke()).resolves.toMatchObject({ ok: true, role: 'CUSTOMER', previousRole: 'DEALER' });
    expect(await c.flag()).toBe(false);
    expect(await c.role()).toBe('CUSTOMER');
    const ev = await c.partnerEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ fromValue: 'true', toValue: 'false', actorId: c.adminUser.id, reason: c.sf.id });
    expect(await prisma.userAdminEvent.count({ where: { userId: c.owner.id, kind: 'ROLE', fromValue: 'DEALER', toValue: 'CUSTOMER' } })).toBe(1);
  });

  const blockers: [string, (c: Ctx) => Promise<unknown>, string][] = [
    ['đơn tự giao chưa xong', (c) => selfShip(c, 'SHIPPING'), '1 đơn tự giao chưa xong'],
    ['phiếu đối soát PENDING', (c) => prisma.merchantPayout.create({ data: { storefrontId: c.sf.id, amount: 1000, createdBy: c.adminUser.id } }), '1 phiếu đối soát chưa chuyển'],
    [
      'liên kết giao hộ đang hiệu lực',
      async (c) => {
        const p = await product(c.sf, 'TUBU', true);
        await prisma.merchantPancakeLink.create({ data: { productId: p.id, storefrontId: c.sf.id, variationId: p.variations[0]!.id } });
      },
      '1 liên kết hàng Tubu giao hộ đang hiệu lực',
    ],
    ['khoản chờ đối soát', (c) => selfShip(c, 'DELIVERED', { deliveredAt: new Date(Date.now() - DAY), paymentStatus: 'PAID' }), 'khoản chờ đối soát'],
    [
      'yêu cầu trả REQUESTED',
      async (c) => {
        const o = await selfShip(c, 'CANCELLED');
        await prisma.returnRequest.create({ data: { orderId: o.id, userId: c.buyer.id, reason: 'IT', status: 'REQUESTED' } });
      },
      '1 yêu cầu trả hàng chờ xử lý',
    ],
    [
      'yêu cầu trả APPROVED chưa nhận về',
      async (c) => {
        const o = await selfShip(c, 'CANCELLED');
        await prisma.returnRequest.create({ data: { orderId: o.id, userId: c.buyer.id, reason: 'IT', status: 'APPROVED' } });
      },
      '1 yêu cầu trả đã duyệt chưa xác nhận nhận hàng',
    ],
    ['sản phẩm tự giao đang bán', (c) => product(c.sf, 'MERCHANT', true), '1 sản phẩm tự giao đang bán'],
  ];

  it.each(blockers)('vướng mắc "%s" → 409 liệt kê bằng tiếng Việt, vai trò và cờ giữ nguyên, không ghi sổ', async (_name, setup, expected) => {
    const c = await dealerStore();
    await setup(c);
    const msg = await conflictMessage(c.revoke());
    expect(msg).toContain(expected);
    expect(msg).toContain('Chưa thể thu hồi vai trò đại lý');
    expect(msg).not.toContain('chủ gian hàng vẫn là đại lý');
    expect(await c.role()).toBe('DEALER');
    expect(await c.flag()).toBe(true);
    expect(await c.partnerEvents()).toHaveLength(0);
    expect(await prisma.userAdminEvent.count({ where: { userId: c.owner.id, kind: 'ROLE' } })).toBe(0);
  });

  it('đổi sang STAFF cũng đi qua cùng kiểm tra (vai trò khác DEALER); còn vướng mắc thì 409', async () => {
    const c = await dealerStore();
    await selfShip(c, 'PACKED');
    await conflictMessage(admin.setUserRole(c.adminUser.id, c.owner.phone!, 'STAFF'));
    expect(await c.role()).toBe('DEALER');
  });

  it('không có gian hàng, cờ đã tắt, gian hàng MERCHANT: thu hồi chạy như trước, không ghi STOREFRONT_PARTNER', async () => {
    const adminUser = await user('ADMIN');
    const bare = await user('DEALER');
    await expect(admin.setUserRole(adminUser.id, bare.phone!, 'CUSTOMER')).resolves.toMatchObject({ role: 'CUSTOMER' });

    const off = await dealerStore({ isPartner: false });
    await selfShip(off, 'SHIPPING');
    await expect(off.revoke()).resolves.toMatchObject({ role: 'CUSTOMER' });
    expect(await off.flag()).toBe(false);
    expect(await off.partnerEvents()).toHaveLength(0);

    const m = await dealerStore({ type: 'MERCHANT' });
    await expect(m.revoke()).resolves.toMatchObject({ role: 'CUSTOMER' });
    expect(await m.flag()).toBe(true);
    expect(await m.partnerEvents()).toHaveLength(0);
  });

  it('cấp DEALER không đụng cờ isPartner', async () => {
    const tier = await prisma.dealerTier.create({ data: { id: `tier_${randCode(8)}`, name: 'Bậc IT', minOrderVolume: 0, discountRules: {} } });
    created.tierIds.push(tier.id);
    const adminUser = await user('ADMIN');
    const owner = await user('AFFILIATE');
    const sf = await prisma.storefront.create({ data: { type: 'CTV', isPartner: false, slug: `itdr-${randCode(8).toLowerCase()}`, ownerUserId: owner.id, title: 'Shop' } });
    created.storefrontIds.push(sf.id);
    await admin.setUserRole(adminUser.id, owner.phone!, 'DEALER', tier.id);
    expect((await prisma.storefront.findUniqueOrThrow({ where: { id: sf.id } })).isPartner).toBe(false);
    expect(await prisma.userAdminEvent.count({ where: { userId: owner.id, kind: 'STOREFRONT_PARTNER' } })).toBe(0);
  });

  /** Gian hàng CTV đối tác, một sản phẩm tự giao đang bán; khách có giỏ chứa sản phẩm đó và địa chỉ. */
  async function raceScenario() {
    const c = await dealerStore();
    const p = await product(c.sf, 'MERCHANT', true);
    const v = p.variations[0]!;
    await prisma.variation.update({ where: { id: v.id }, data: { retailPrice: PRICE, stock: STOCK } });
    const addr = await prisma.address.create({
      data: {
        userId: c.buyer.id, recipient: 'Khach IT', phone: phone(), province: 'Ha Noi', district: '', ward: 'Phuong IT', street: '1 Duong IT',
        provinceCode: '84_VN01', districtCode: '', wardCode: '00001',
      },
    });
    await cart.addItem(c.buyer.id, { variationId: v.id, quantity: 1 });
    expect((await cart.getCart(c.buyer.id)).items.map((l) => l.fulfiller.kind)).toEqual(['MERCHANT']);
    return { ...c, p, v, addr };
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

  /** Đặt đơn chạy tới khi kẹt sau tx giữ khoá; chủ gỡ sản phẩm tự giao; thu hồi chạy tới khi xong hoặc kẹt; thả khoá. */
  async function race(s: Awaited<ReturnType<typeof raceScenario>>, holder: Awaited<ReturnType<typeof hold>>) {
    const running: Promise<unknown>[] = [];
    try {
      let placeSettled = false;
      running.push(
        checkout.placeOrder(s.buyer.id, { addressId: s.addr.id, paymentMethod: 'COD' } as never).finally(() => (placeSettled = true)),
      );
      await waitUntil(async () => placeSettled || (await lockWaiters(holder.pid)) >= 1, 'đặt đơn');
      expect(placeSettled).toBe(false);
      await prisma.product.update({ where: { id: s.p.id }, data: { isActive: false } });
      let revokeSettled = false;
      running.push(s.revoke().finally(() => (revokeSettled = true)));
      await waitUntil(async () => revokeSettled || (await lockWaiters(holder.pid)) >= 2, 'thu hồi');
    } finally {
      holder.release();
      await holder.done;
    }
    const settled = await Promise.allSettled(running);
    return { place: settled[0]!, revoke: settled[1]!, summary: summarize(settled) };
  }

  it(`thu hồi commit trước khi đặt đơn khoá gian hàng → đặt đơn 409 "${STORE_CHANGED}", không tạo gì, cờ tắt (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const s = await raceScenario();
      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "variations" WHERE "id" = ${s.v.id} FOR UPDATE`);
      const r = await race(s, holder);

      expect(r.summary.errors.join(" ")).not.toMatch(/40P01|deadlock/i);
      expect(r.revoke).toMatchObject({ status: 'fulfilled' });
      expect(r.place.status).toBe('rejected');
      const err = (r.place as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe(STORE_CHANGED);
      expect(await s.flag()).toBe(false);
      expect(await s.role()).toBe('CUSTOMER');
      expect(await prisma.order.count({ where: { fulfillerStorefrontId: s.sf.id } })).toBe(0);
      expect((await prisma.variation.findUniqueOrThrow({ where: { id: s.v.id } })).stock).toBe(STOCK);
    }
  });

  it(`đặt đơn đã khoá gian hàng trước → thu hồi chờ rồi thấy đơn tự giao vừa đặt, 409; vai trò và cờ giữ nguyên, không đơn mồ côi (${ROUNDS} vòng)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const s = await raceScenario();
      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${s.buyer.id} FOR UPDATE`);
      const r = await race(s, holder);

      expect(r.summary.errors.join(" ")).not.toMatch(/40P01|deadlock/i);
      expect(r.place.status).toBe('fulfilled');
      expect(r.revoke.status).toBe('rejected');
      const err = (r.revoke as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toContain('1 đơn tự giao chưa xong');
      expect(await s.flag()).toBe(true);
      expect(await s.role()).toBe('DEALER');
      expect(await s.partnerEvents()).toHaveLength(0);
      const orders = await prisma.order.findMany({ where: { userId: s.buyer.id } });
      expect(orders.map((o) => [o.fulfiller, o.fulfillerStorefrontId])).toEqual([['MERCHANT', s.sf.id]]);
    }
  });
});
