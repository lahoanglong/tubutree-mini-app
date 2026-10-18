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
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isGomdonRecyclingEnabled } from '../../src/modules/integrations/gomdon/gomdon-config';
import { PICKUP_PAUSED_MESSAGE, PICKUP_REQUEST_GONE_MESSAGE } from '../../src/modules/waste-exchange/pickup/waste-pickup-attach';
import { WasteNotifierService } from '../../src/modules/waste-exchange/core/waste-notifier.service';
import { WasteShipLockService } from '../../src/modules/waste-exchange/core/waste-ship-lock.service';
import { WasteConfigService } from '../../src/modules/waste-exchange/core/waste-config.service';
import { WasteExpiryCron } from '../../src/modules/waste-exchange/pickup/waste-expiry.cron';
import { cleanupWaste, createWarehouse, createWasteItem, createWasteRequest, raceWithHold } from './fixtures/waste-fixtures';
import { createUser, deleteItData, randCode, setConfig, summarize, warmPool } from './helpers';

jest.mock('../../src/modules/integrations/gomdon/gomdon-config', () => ({
  ...jest.requireActual('../../src/modules/integrations/gomdon/gomdon-config'),
  isGomdonRecyclingEnabled: jest.fn().mockResolvedValue(true),
}));

const PRICE = 100_000;
const SEED_POINTS = 1_000_000;
const POINTS_USED = 10_000;

describe('Pickup attach at checkout ‖ two-step ship lock ‖ expiry cron (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let checkout: CheckoutService;
  let cart: CartService;
  let shipLock: WasteShipLockService;
  let expiry: WasteExpiryCron;
  let warehouse: Awaited<ReturnType<typeof createWarehouse>>;
  let item: Awaited<ReturnType<typeof createWasteItem>>;
  let savedConfig: { key: string; value: unknown }[] = [];
  const CONFIG_KEYS = ['loyalty.vnd_per_point_redeem', 'loyalty.max_redeem_pct', 'waste.enabled', 'waste.lane_pickup_enabled'];
  const created = { userIds: [] as string[], productIds: [] as string[], flashSaleIds: [] as string[] };

  const clearConfigCache = () => (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();

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
        OrderReversalService,
        OrderStatusService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: GomdonOrderService, useValue: { isRecyclingEnabled: jest.fn().mockResolvedValue(false), enqueuePush: jest.fn() } },
        { provide: LifecycleService, useValue: { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } },
        { provide: CashbackProviderRegistry, useValue: { all: () => [] } },
        WasteShipLockService,
        WasteConfigService,
        WasteExpiryCron,
        { provide: WasteNotifierService, useValue: { shipLocked: jest.fn().mockResolvedValue(undefined), requestExpired: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    shipLock = moduleRef.get(WasteShipLockService);
    expiry = moduleRef.get(WasteExpiryCron);
    savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
    await setConfig(prisma, 'loyalty.vnd_per_point_redeem', 1);
    await setConfig(prisma, 'loyalty.max_redeem_pct', 0.2);
    await setConfig(prisma, 'waste.enabled', true);
    await setConfig(prisma, 'waste.lane_pickup_enabled', true);
    clearConfigCache();
    warehouse = await createWarehouse(prisma);
    item = await createWasteItem(prisma, { name: 'Vỏ hộp sữa', unitLabel: 'vỏ' });
  });

  afterAll(async () => {
    if (prisma) {
      await cleanupWaste(prisma, { itemIds: [item.id] });
      await deleteItData(prisma, created);
      await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
      for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
      clearConfigCache();
    }
    await moduleRef?.close();
  });

  /** Khách có SEED_POINTS điểm thường khớp sổ và một địa chỉ. */
  async function customer() {
    const u = await createUser(prisma, { role: 'CUSTOMER', pointsBalance: SEED_POINTS });
    created.userIds.push(u.id);
    await prisma.pointsTransaction.create({ data: { userId: u.id, delta: SEED_POINTS, lot: 'STANDARD', reason: 'IT_SEED_STANDARD', refType: 'IT' } });
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
    return { u, addr };
  }

  async function variation() {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itlo-p-${tag}`, brand: 'IT', slug: `itlo-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: PRICE },
    });
    created.productIds.push(product.id);
    return prisma.variation.create({
      data: { pancakeId: `itlo-v-${tag}`, productId: product.id, sku: `ITLO-${tag}`, name: 'Chai', attributes: {}, retailPrice: PRICE, stock: 100 },
    });
  }

  /** Vòng khoá báo riêng (40P01) trước khi đòi không có lỗi nào. */
  function expectNoErrors(s: { errors: string[] }) {
    expect(s.errors.filter((e) => e.includes('40P01'))).toEqual([]);
    expect(s.errors).toEqual([]);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
  }

  const usersRow = (id: string) => Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${id} FOR UPDATE`;
  const requestRow = (id: string) => Prisma.sql`SELECT "id" FROM "waste_requests" WHERE "id" = ${id} FOR UPDATE`;
  async function pickupCustomer() {
    const { u, addr } = await customer();
    const v = await variation();
    await cart.addItem(u.id, { variationId: v.id, quantity: 1 });
    const req = await createWasteRequest(prisma, { userId: u.id, method: 'PICKUP', status: 'OPEN', pointId: warehouse.id, lines: [{ itemId: item.id, declaredQty: 12 }] });
    return { u, addr, req };
  }
  /** Ba lần thiếu gần nhất (REJECTED, MAIL_IN) để evaluateAndLock khoá thật với streak 3 (§15.6). */
  async function seedThreeStrikes(userId: string) {
    for (let i = 0; i < 3; i++) {
      const r = await createWasteRequest(prisma, { userId, method: 'MAIL_IN', status: 'OPEN', pointId: warehouse.id, lines: [{ itemId: item.id, declaredQty: 20 }] });
      await prisma.wasteRequest.update({ where: { id: r.id }, data: { status: 'REJECTED', rejectionReason: 'WET', closedAt: new Date(Date.now() - (i + 1) * 60_000), expiresAt: null } });
    }
  }
  const place = (u: { id: string }, addr: { id: string }, req: { id: string }) =>
    checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD', pointsToUse: POINTS_USED, wasteRequestId: req.id } as never);
  const lock = (userId: string) => shipLock.evaluateAndLock(userId, { shortfallLockPct: 50, shortfallLockStreak: 3 });

  it('checkout attaches: Tubu order flagged with the server note, request OPEN with orderId and expiresAt NULL, one REQUEST_ATTACHED event', async () => {
    const { u, addr, req } = await pickupCustomer();
    const order = (await place(u, addr, req)) as { id: string };
    const row = await prisma.wasteRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(row).toMatchObject({ status: 'OPEN', orderId: order.id, expiresAt: null });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.hasRecyclingPickup).toBe(true);
    expect(o.recyclingNote).toBe(`Thu kèm rác ${req.code}: Vỏ hộp sữa: 12 vỏ`);
    expect(await prisma.wasteEvent.count({ where: { requestId: req.id, kind: 'REQUEST_ATTACHED', actorRole: 'CUSTOMER', actorUserId: u.id } })).toBe(1);
    expect(isGomdonRecyclingEnabled).toHaveBeenCalled();
  });

  it('a request past expiresAt but not yet swept still attaches (§12.3)', async () => {
    const { u, addr, req } = await pickupCustomer();
    await prisma.wasteRequest.update({ where: { id: req.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await expect(place(u, addr, req)).resolves.toBeDefined();
    expect((await prisma.wasteRequest.findUniqueOrThrow({ where: { id: req.id } })).expiresAt).toBeNull();
  });

  it.each([
    ['shipLockedAt', { shipLockedAt: new Date() }],
    ['blockedAt', { blockedAt: new Date() }],
  ])('flags.%s set → 409 paused, no order, request untouched, points untouched', async (_k, data) => {
    const { u, addr, req } = await pickupCustomer();
    await prisma.wasteUserFlags.create({ data: { userId: u.id, ...data } });
    const err = await place(u, addr, req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(PICKUP_PAUSED_MESSAGE);
    expect(await prisma.order.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.wasteRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'OPEN', orderId: null });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { pointsBalance: true } })).pointsBalance).toBe(SEED_POINTS);
    // customer() writes exactly one ledger row (IT_SEED_STANDARD); a deduction that escaped the rollback would add a second.
    expect(await prisma.pointsTransaction.count({ where: { userId: u.id } })).toBe(1);
  });

  it('ship-lock step 1 then checkout', async () => {
    const { u, addr, req } = await pickupCustomer();
    await seedThreeStrikes(u.id);
    const s = summarize<unknown>(await raceWithHold(prisma, usersRow(u.id), () => lock(u.id), () => place(u, addr, req)));
    expectNoErrors(s);
    const flags = await prisma.wasteUserFlags.findUniqueOrThrow({ where: { userId: u.id } });
    expect(flags.shipLockedAt).not.toBeNull();
    const row = await prisma.wasteRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(row.status).toBe('OPEN');
    expect(row.orderId).not.toBeNull();
  });

  it('checkout then ship-lock step 1', async () => {
    const { u, addr, req } = await pickupCustomer();
    await seedThreeStrikes(u.id);
    const s = summarize<unknown>(await raceWithHold(prisma, usersRow(u.id), () => place(u, addr, req), () => lock(u.id)));
    expectNoErrors(s);
    expect((await prisma.wasteUserFlags.findUniqueOrThrow({ where: { userId: u.id } })).shipLockedAt).not.toBeNull();
    expect((await prisma.wasteRequest.findUniqueOrThrow({ where: { id: req.id } })).orderId).not.toBeNull();
  });

  it('ship-lock step 2 then checkout', async () => {
    const { u, addr, req } = await pickupCustomer();
    await seedThreeStrikes(u.id);
    const s = summarize<unknown>(await raceWithHold(prisma, requestRow(req.id), () => lock(u.id), () => place(u, addr, req)));
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(1);
    expect([PICKUP_REQUEST_GONE_MESSAGE, PICKUP_PAUSED_MESSAGE]).toContain((s.rejected[0]!.reason as Error).message);
    expect(await prisma.order.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.wasteRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'CANCELLED', closeReason: 'SHIP_LOCKED', orderId: null });
  });

  it('checkout then ship-lock step 2', async () => {
    const { u, addr, req } = await pickupCustomer();
    await seedThreeStrikes(u.id);
    const s = summarize<unknown>(await raceWithHold(prisma, requestRow(req.id), () => place(u, addr, req), () => lock(u.id)));
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(1);
    expect((s.rejected[0]!.reason as Error).message).toBe(PICKUP_PAUSED_MESSAGE);
    expect(await prisma.order.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.wasteRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'CANCELLED', closeReason: 'SHIP_LOCKED' });
  });

  it('attach day 5 then expiry cron day 7 does not close (§17.3)', async () => {
    const { u, addr, req } = await pickupCustomer();
    const DAY = 86_400_000;
    await prisma.wasteRequest.update({ where: { id: req.id }, data: { createdAt: new Date(Date.now() - 5 * DAY), expiresAt: new Date(Date.now() + 2 * DAY) } });
    await place(u, addr, req);
    await expiry.run(new Date(Date.now() + 2 * DAY + 60_000));
    expect(await prisma.wasteRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'OPEN', expiresAt: null, closeReason: null });
    expect(await prisma.wasteEvent.count({ where: { requestId: req.id, kind: 'REQUEST_EXPIRED' } })).toBe(0);
  });

  it('checkout attach then expiry cron', async () => {
    const { u, addr, req } = await pickupCustomer();
    await prisma.wasteRequest.update({ where: { id: req.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const s = summarize<unknown>(await raceWithHold(prisma, requestRow(req.id), () => place(u, addr, req), () => expiry.run(new Date())));
    expectNoErrors(s);
    const row = await prisma.wasteRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(row.status).toBe('OPEN');
    expect(row.orderId).not.toBeNull();
    expect(await prisma.wasteEvent.count({ where: { requestId: req.id, kind: 'REQUEST_EXPIRED' } })).toBe(0);
  });

  it('expiry cron then checkout attach', async () => {
    const { u, addr, req } = await pickupCustomer();
    await prisma.wasteRequest.update({ where: { id: req.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const s = summarize<unknown>(await raceWithHold(prisma, requestRow(req.id), () => expiry.run(new Date()), () => place(u, addr, req)));
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(1);
    expect((s.rejected[0]!.reason as Error).message).toBe(PICKUP_REQUEST_GONE_MESSAGE);
    expect(await prisma.order.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.wasteRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'EXPIRED', closeReason: 'HOLD_EXPIRED' });
    expect(await prisma.wasteEvent.count({ where: { requestId: req.id, kind: 'REQUEST_EXPIRED' } })).toBe(1);
  });
});
