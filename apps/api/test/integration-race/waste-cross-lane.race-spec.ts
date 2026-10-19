jest.mock('../../src/modules/integrations/gomdon/gomdon-config', () => ({
  ...jest.requireActual('../../src/modules/integrations/gomdon/gomdon-config'),
  isGomdonRecyclingEnabled: jest.fn().mockResolvedValue(true),
}));

import { randomInt } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, type WasteRequest } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CheckoutService } from '../../src/modules/checkout/checkout.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { LoyaltyExpiryService } from '../../src/modules/loyalty/loyalty-expiry.service';
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
import { PICKUP_REQUEST_GONE_MESSAGE } from '../../src/modules/waste-exchange/pickup/waste-pickup-attach';
import { WasteExpiryCron } from '../../src/modules/waste-exchange/pickup/waste-expiry.cron';
import { WasteAccessService } from '../../src/modules/waste-exchange/core/waste-access.service';
import { WasteConfigService } from '../../src/modules/waste-exchange/core/waste-config.service';
import { WasteHoldService } from '../../src/modules/waste-exchange/core/waste-hold.service';
import { WASTE_MESSAGES } from '../../src/modules/waste-exchange/core/waste-messages';
import { WasteNotifierService } from '../../src/modules/waste-exchange/core/waste-notifier.service';
import { WasteShipLockService } from '../../src/modules/waste-exchange/core/waste-ship-lock.service';
import { WasteRequestsService } from '../../src/modules/waste-exchange/customer/waste-requests.service';
import { WasteConfirmService, type WasteStaffCall } from '../../src/modules/waste-exchange/receiving/waste-confirm.service';
import { WasteReverseService } from '../../src/modules/waste-exchange/receiving/waste-reverse.service';
import { cleanupWaste, createWarehouse, createWasteItem, createWasteRequest, holdLock, lockWaiters, raceWithHold, waitUntil } from './fixtures/waste-fixtures';
import { createOrder, createUser, deleteItData, randCode, setConfig, warmPool } from './helpers';

const CONFIG_KEYS = [
  'waste.enabled',
  'waste.lane_dropoff_enabled',
  'waste.lane_mailin_enabled',
  'waste.lane_pickup_enabled',
  'waste.staff_daily_cap_points',
  'loyalty.vnd_per_point_redeem',
  'loyalty.max_redeem_pct',
  'loyalty.point_expire_months',
];
const ROUNDS = 3;
const PRICE = 100_000;
const POINTS_USED = 10_000;
const STALE = 'Khách vừa sửa yêu cầu, vui lòng tra lại mã';
const NOT_CONFIRMABLE = 'Yêu cầu không ở trạng thái xác nhận được';

function expectNoDeadlock(errors: string[]) {
  expect(errors.join()).not.toMatch(/40P01|P2034/);
}

describe('Cross-lane waste lock pairs in both orders (real Postgres, spec 10.1 / 17.3)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let requests: WasteRequestsService;
  let confirmSvc: WasteConfirmService;
  let reverseSvc: WasteReverseService;
  let checkout: CheckoutService;
  let cart: CartService;
  let wh: Awaited<ReturnType<typeof createWarehouse>>;
  let carton: Awaited<ReturnType<typeof createWasteItem>>;
  let milkCarton: Awaited<ReturnType<typeof createWasteItem>>;
  let admin: { id: string };
  let savedConfig: { key: string; value: unknown }[] = [];
  const created = { userIds: [] as string[], productIds: [] as string[] };
  const reg = { itemIds: [] as string[] };

  const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  const clearConfigCache = () => (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();
  const requestRow = (id: string) => Prisma.sql`SELECT "id" FROM "waste_requests" WHERE "id" = ${id} FOR UPDATE`;
  const usersRow = (id: string) => Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${id} FOR UPDATE`;
  const errorsOf = (rs: PromiseSettledResult<unknown>[]) =>
    rs.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));

  function expectRejected(r: PromiseSettledResult<unknown>, type: typeof ConflictException | typeof BadRequestException, message: string) {
    expect(r.status).toBe('rejected');
    const reason = (r as PromiseRejectedResult).reason as Error;
    expect(reason).toBeInstanceOf(type);
    expect(reason.message).toBe(message);
  }

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
        LoyaltyExpiryService,
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
        WasteConfigService,
        WasteAccessService,
        WasteHoldService,
        WasteRequestsService,
        WasteConfirmService,
        WasteReverseService,
        WasteShipLockService,
        WasteExpiryCron,
        {
          provide: WasteNotifierService,
          useValue: {
            parcelReceived: jest.fn().mockResolvedValue(undefined),
            pointsCredited: jest.fn().mockResolvedValue(undefined),
            requestRejected: jest.fn().mockResolvedValue(undefined),
            requestExpired: jest.fn().mockResolvedValue(undefined),
            pickupStarted: jest.fn().mockResolvedValue(undefined),
            pickupCancelled: jest.fn().mockResolvedValue(undefined),
            pointsReversed: jest.fn().mockResolvedValue(undefined),
            shipLocked: jest.fn().mockResolvedValue(undefined),
            giftCancelled: jest.fn().mockResolvedValue(undefined),
            perkReviewed: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    requests = moduleRef.get(WasteRequestsService);
    confirmSvc = moduleRef.get(WasteConfirmService);
    reverseSvc = moduleRef.get(WasteReverseService);
    checkout = moduleRef.get(CheckoutService);
    cart = moduleRef.get(CartService);
    savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } }, select: { key: true, value: true } });
    await setConfig(prisma, 'waste.enabled', true);
    await setConfig(prisma, 'waste.lane_dropoff_enabled', true);
    await setConfig(prisma, 'waste.lane_mailin_enabled', true);
    await setConfig(prisma, 'waste.lane_pickup_enabled', true);
    await setConfig(prisma, 'waste.staff_daily_cap_points', 20_000_000);
    await setConfig(prisma, 'loyalty.vnd_per_point_redeem', 1);
    await setConfig(prisma, 'loyalty.max_redeem_pct', 0.2);
    await setConfig(prisma, 'loyalty.point_expire_months', 12);
    clearConfigCache();

    wh = await createWarehouse(prisma);
    carton = await createWasteItem(prisma);
    milkCarton = await createWasteItem(prisma, { unitsPerPoint: 5, pointsPerGroup: 1000 });
    reg.itemIds.push(carton.id, milkCarton.id);
    admin = await createUser(prisma, { role: 'ADMIN', phone: phone() });
    created.userIds.push(admin.id);
  });

  afterAll(async () => {
    if (prisma) {
      await cleanupWaste(prisma, reg);
      await deleteItData(prisma, created);
      await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
      for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
      clearConfigCache();
    }
    await moduleRef?.close();
  });

  async function newUser(over: Parameters<typeof createUser>[1] = {}) {
    const u = await createUser(prisma, { phone: phone(), ...over });
    created.userIds.push(u.id);
    return u;
  }
  const newStaff = () => newUser({ role: 'STAFF' });

  const dropOff = (userId: string, lines: { itemId: string; declaredQty: number }[]) =>
    createWasteRequest(prisma, { userId, method: 'DROP_OFF', status: 'OPEN', pointId: wh.id, lines });
  const pickup = (userId: string) =>
    createWasteRequest(prisma, { userId, method: 'PICKUP', status: 'OPEN', pointId: wh.id, lines: [{ itemId: carton.id, declaredQty: 12 }] });

  const deskCall = (staffId: string, requestId: string): WasteStaffCall => ({
    callerUserId: staffId,
    requestId,
    route: 'DESK',
    device: { ip: null, userAgent: null },
  });
  const confirm = (staffId: string, requestId: string, lines: { itemId: string; declaredQty: number; receivedQty: number }[]) =>
    confirmSvc.confirm(deskCall(staffId, requestId), { lines });
  const edit = (userId: string, id: string, lines: { itemId: string; declaredQty: number }[]) => requests.edit(userId, id, { lines });
  const full = (itemId: string, qty: number) => ({ itemId, declaredQty: qty, receivedQty: qty });

  const recycleRows = (requestId: string) => prisma.pointsTransaction.findMany({ where: { refType: 'RECYCLE', refId: requestId } });
  const reqRow = (id: string) => prisma.wasteRequest.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { itemCode: 'asc' } } } });
  const eventCount = (requestId: string, kind: 'REQUEST_EDITED' | 'REQUEST_ATTACHED' | 'REQUEST_CANCELLED') =>
    prisma.wasteEvent.count({ where: { requestId, kind } });

  /** The balance is backed by the RECYCLE ledger row that `completedRequest` writes, so no seed row here. */
  async function checkoutCustomer(pointsBalance = 0) {
    const u = await newUser({ pointsBalance });
    const addr = await prisma.address.create({
      data: {
        userId: u.id,
        recipient: 'Khach IT',
        phone: phone(),
        province: 'Ha Noi',
        district: '',
        ward: 'Phuong IT',
        street: '1 Duong IT',
        provinceCode: '84_VN01',
        districtCode: '',
        wardCode: '00001',
      },
    });
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itcl-p-${tag}`, brand: 'IT', slug: `itcl-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: PRICE },
    });
    created.productIds.push(product.id);
    const v = await prisma.variation.create({
      data: { pancakeId: `itcl-v-${tag}`, productId: product.id, sku: `ITCL-${tag}`, name: 'Chai', attributes: {}, retailPrice: PRICE, stock: 100 },
    });
    await cart.addItem(u.id, { variationId: v.id, quantity: 1 });
    return { u, addr };
  }
  const place = (u: { id: string }, addr: { id: string }, req: { id: string }, pointsToUse = 0) =>
    checkout.placeOrder(u.id, { addressId: addr.id, paymentMethod: 'COD', pointsToUse, wasteRequestId: req.id } as never);

  /** DROP_OFF request already COMPLETED with its RECYCLE ledger row, 20 000 points. */
  async function completedRequest(userId: string, over: { method?: 'PICKUP'; orderId?: string } = {}): Promise<WasteRequest> {
    const r = await createWasteRequest(prisma, {
      userId,
      method: over.method ?? 'DROP_OFF',
      status: 'COMPLETED',
      pointId: wh.id,
      orderId: over.orderId,
      lines: [{ itemId: carton.id, declaredQty: 20, receivedQty: 20 }],
    });
    await prisma.wasteRequest.update({ where: { id: r.id }, data: { pointsAwarded: 20_000, completedAt: new Date() } });
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 12);
    await prisma.pointsTransaction.create({
      data: { userId, delta: 20_000, lot: 'STANDARD', reason: 'RECYCLE:' + r.code, refType: 'RECYCLE', refId: r.id, expiresAt },
    });
    return r;
  }

  async function expectBalanceMatchesLedger(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } });
    const sum = await prisma.pointsTransaction.aggregate({ where: { userId, lot: 'STANDARD' }, _sum: { delta: true } });
    expect(u.pointsBalance).toBe(sum._sum.delta ?? 0);
  }

  describe('request row: edit, confirm, cancel and attach', () => {
    it('edit then confirm', async () => {
      const errors: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const c = await newUser();
        const staff = await newStaff();
        const req = await dropOff(c.id, [{ itemId: carton.id, declaredQty: 3 }]);
        const rs = await raceWithHold(
          prisma,
          requestRow(req.id),
          () => edit(c.id, req.id, [{ itemId: carton.id, declaredQty: 3 }, { itemId: milkCarton.id, declaredQty: 5 }]),
          () => confirm(staff.id, req.id, [full(carton.id, 3)]),
        );
        errors.push(...errorsOf(rs));
        expect(rs[0].status).toBe('fulfilled');
        expectRejected(rs[1], ConflictException, STALE);
        const row = await reqRow(req.id);
        expect(row.status).toBe('OPEN');
        expect(row.lines).toHaveLength(2);
        expect(await recycleRows(req.id)).toHaveLength(0);
      }
      expectNoDeadlock(errors);
    });

    it('confirm then edit', async () => {
      const errors: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const c = await newUser();
        const staff = await newStaff();
        const req = await dropOff(c.id, [{ itemId: carton.id, declaredQty: 3 }]);
        const rs = await raceWithHold(
          prisma,
          requestRow(req.id),
          () => confirm(staff.id, req.id, [full(carton.id, 3)]),
          () => edit(c.id, req.id, [{ itemId: carton.id, declaredQty: 3 }, { itemId: milkCarton.id, declaredQty: 5 }]),
        );
        errors.push(...errorsOf(rs));
        expect(rs[0].status).toBe('fulfilled');
        expectRejected(rs[1], ConflictException, WASTE_MESSAGES.NOT_EDITABLE);
        const row = await reqRow(req.id);
        expect(row.status).toBe('COMPLETED');
        expect(row.lines).toHaveLength(1);
        const rows = await recycleRows(req.id);
        expect(rows.map((r) => r.delta)).toEqual([3000]);
      }
      expectNoDeadlock(errors);
    });

    it('edit(qty-only) then confirm', async () => {
      const errors: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const c = await newUser();
        const staff = await newStaff();
        const req = await dropOff(c.id, [{ itemId: milkCarton.id, declaredQty: 5 }]);
        const rs = await raceWithHold(
          prisma,
          requestRow(req.id),
          () => edit(c.id, req.id, [{ itemId: milkCarton.id, declaredQty: 6 }]),
          () => confirm(staff.id, req.id, [full(milkCarton.id, 5)]),
        );
        errors.push(...errorsOf(rs));
        expect(rs[0].status).toBe('fulfilled');
        expectRejected(rs[1], ConflictException, STALE);
        const row = await reqRow(req.id);
        expect(row.lines.map((l) => l.declaredQty)).toEqual([6]);
        expect(row.estimatedPoints).toBe(1000);
        expect(await recycleRows(req.id)).toHaveLength(0);
      }
      expectNoDeadlock(errors);
    });

    it('confirm then edit(qty-only)', async () => {
      const errors: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const c = await newUser();
        const staff = await newStaff();
        const req = await dropOff(c.id, [{ itemId: milkCarton.id, declaredQty: 5 }]);
        const rs = await raceWithHold(
          prisma,
          requestRow(req.id),
          () => confirm(staff.id, req.id, [full(milkCarton.id, 5)]),
          () => edit(c.id, req.id, [{ itemId: milkCarton.id, declaredQty: 6 }]),
        );
        errors.push(...errorsOf(rs));
        expect(rs[0].status).toBe('fulfilled');
        expectRejected(rs[1], ConflictException, WASTE_MESSAGES.NOT_EDITABLE);
        expect((await recycleRows(req.id)).map((r) => r.delta)).toEqual([1000]);
        expect((await reqRow(req.id)).lines.map((l) => l.declaredQty)).toEqual([5]);
      }
      expectNoDeadlock(errors);
    });

    it('edit then attach', async () => {
      const errors: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const { u, addr } = await checkoutCustomer();
        const req = await pickup(u.id);
        const rs = await raceWithHold(
          prisma,
          requestRow(req.id),
          () => edit(u.id, req.id, [{ itemId: carton.id, declaredQty: 14 }]),
          () => place(u, addr, req),
        );
        errors.push(...errorsOf(rs));
        expect(rs.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
        const order = (rs[1] as PromiseFulfilledResult<{ id: string }>).value;
        const row = await reqRow(req.id);
        expect(row.lines.map((l) => l.declaredQty)).toEqual([14]);
        expect(row.orderId).toBe(order.id);
        expect(await eventCount(req.id, 'REQUEST_EDITED')).toBe(1);
        expect(await eventCount(req.id, 'REQUEST_ATTACHED')).toBe(1);
      }
      expectNoDeadlock(errors);
    });

    it('attach then edit', async () => {
      const errors: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const { u, addr } = await checkoutCustomer();
        const req = await pickup(u.id);
        const rs = await raceWithHold(
          prisma,
          requestRow(req.id),
          () => place(u, addr, req),
          () => edit(u.id, req.id, [{ itemId: carton.id, declaredQty: 14 }]),
        );
        errors.push(...errorsOf(rs));
        expect(rs[0].status).toBe('fulfilled');
        expectRejected(rs[1], ConflictException, WASTE_MESSAGES.NOT_EDITABLE);
        const order = (rs[0] as PromiseFulfilledResult<{ id: string }>).value;
        const row = await reqRow(req.id);
        expect(row.lines.map((l) => l.declaredQty)).toEqual([12]);
        expect(row.orderId).toBe(order.id);
      }
      expectNoDeadlock(errors);
    });

    it('cancel then attach', async () => {
      const errors: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const { u, addr } = await checkoutCustomer();
        const req = await pickup(u.id);
        const rs = await raceWithHold(
          prisma,
          requestRow(req.id),
          () => requests.cancel(u.id, req.id),
          () => place(u, addr, req),
        );
        errors.push(...errorsOf(rs));
        expect(rs[0].status).toBe('fulfilled');
        expectRejected(rs[1], ConflictException, PICKUP_REQUEST_GONE_MESSAGE);
        expect(await prisma.order.count({ where: { userId: u.id } })).toBe(0);
        expect(await reqRow(req.id)).toMatchObject({ status: 'CANCELLED', orderId: null });
      }
      expectNoDeadlock(errors);
    });

    it('attach then cancel', async () => {
      const errors: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const { u, addr } = await checkoutCustomer();
        const req = await pickup(u.id);
        const rs = await raceWithHold(
          prisma,
          requestRow(req.id),
          () => place(u, addr, req),
          () => requests.cancel(u.id, req.id),
        );
        errors.push(...errorsOf(rs));
        expect(rs[0].status).toBe('fulfilled');
        expectRejected(rs[1], ConflictException, WASTE_MESSAGES.NOT_CANCELLABLE);
        const order = (rs[0] as PromiseFulfilledResult<{ id: string }>).value;
        const row = await reqRow(req.id);
        expect(row.status).toBe('OPEN');
        expect(row.orderId).toBe(order.id);
        expect(row.closedAt).toBeNull();
        expect(await eventCount(req.id, 'REQUEST_ATTACHED')).toBe(1);
        expect(await eventCount(req.id, 'REQUEST_CANCELLED')).toBe(0);
      }
      expectNoDeadlock(errors);
    });

    it('cancel then confirm', async () => {
      const errors: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const c = await newUser();
        const staff = await newStaff();
        const req = await dropOff(c.id, [{ itemId: carton.id, declaredQty: 3 }]);
        const rs = await raceWithHold(
          prisma,
          requestRow(req.id),
          () => requests.cancel(c.id, req.id),
          () => confirm(staff.id, req.id, [full(carton.id, 3)]),
        );
        errors.push(...errorsOf(rs));
        expect(rs[0].status).toBe('fulfilled');
        expectRejected(rs[1], ConflictException, NOT_CONFIRMABLE);
        expect(await recycleRows(req.id)).toHaveLength(0);
        expect((await reqRow(req.id)).status).toBe('CANCELLED');
      }
      expectNoDeadlock(errors);
    });

    it('confirm then cancel', async () => {
      const errors: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const c = await newUser();
        const staff = await newStaff();
        const req = await dropOff(c.id, [{ itemId: carton.id, declaredQty: 3 }]);
        const rs = await raceWithHold(
          prisma,
          requestRow(req.id),
          () => confirm(staff.id, req.id, [full(carton.id, 3)]),
          () => requests.cancel(c.id, req.id),
        );
        errors.push(...errorsOf(rs));
        expect(rs[0].status).toBe('fulfilled');
        expectRejected(rs[1], ConflictException, WASTE_MESSAGES.NOT_CANCELLABLE);
        expect(await recycleRows(req.id)).toHaveLength(1);
        expect((await reqRow(req.id)).status).toBe('COMPLETED');
      }
      expectNoDeadlock(errors);
    });
  });

  describe('reverse against checkout-with-points', () => {
    it('reverse then checkout-with-points (COMPLETED + OPEN)', async () => {
      const errors: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const { u, addr } = await checkoutCustomer(20_000);
        const r1 = await completedRequest(u.id);
        const r2 = await pickup(u.id);
        const rs = await raceWithHold(
          prisma,
          usersRow(u.id),
          () => reverseSvc.reverse(admin.id, r1.id, { reason: 'gian lận' }),
          () => place(u, addr, r2, POINTS_USED),
        );
        errors.push(...errorsOf(rs));
        expect(rs[0]).toMatchObject({ status: 'fulfilled', value: { status: 'REVERSED', pointsTaken: 20_000, shortfallPoints: 0 } });
        expectRejected(rs[1], BadRequestException, 'Số điểm Xanh không đủ (hiện có 0 điểm).');
        expect(await prisma.order.count({ where: { userId: u.id } })).toBe(0);
        expect(await reqRow(r2.id)).toMatchObject({ status: 'OPEN', orderId: null });
        expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).pointsBalance).toBe(0);
        await expectBalanceMatchesLedger(u.id);
      }
      expectNoDeadlock(errors);
    });

    it('checkout-with-points then reverse (COMPLETED + OPEN)', async () => {
      const errors: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const { u, addr } = await checkoutCustomer(20_000);
        const r1 = await completedRequest(u.id);
        const r2 = await pickup(u.id);
        const rs = await raceWithHold(
          prisma,
          usersRow(u.id),
          () => place(u, addr, r2, POINTS_USED),
          () => reverseSvc.reverse(admin.id, r1.id, { reason: 'gian lận' }),
        );
        errors.push(...errorsOf(rs));
        expect(rs[0].status).toBe('fulfilled');
        const order = (rs[0] as PromiseFulfilledResult<{ id: string }>).value;
        expect((await reqRow(r2.id)).orderId).toBe(order.id);
        expect(await eventCount(r2.id, 'REQUEST_ATTACHED')).toBe(1);
        expect(rs[1]).toMatchObject({ status: 'fulfilled', value: { status: 'REVERSED', pointsTaken: 10_000, shortfallPoints: 10_000 } });
        expect((await reqRow(r1.id)).reversalShortfallPoints).toBe(10_000);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).pointsBalance).toBe(0);
        await expectBalanceMatchesLedger(u.id);
      }
      expectNoDeadlock(errors);
    });
  });

  describe('checkout asked to attach the COMPLETED request itself', () => {
    /** The seed of the shared reverse case with R1 a PICKUP request bound to an order, and no R2. */
    async function boundCompleted() {
      const { u, addr } = await checkoutCustomer(20_000);
      const order = await createOrder(prisma, { userId: u.id });
      const r1 = await completedRequest(u.id, { method: 'PICKUP', orderId: order.id });
      return { u, addr, order, r1 };
    }

    it('reverse then checkout attaching the COMPLETED request', async () => {
      const errors: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const { u, addr, order, r1 } = await boundCompleted();
        const hold = await holdLock(prisma, requestRow(r1.id));
        let reversed: Promise<unknown>;
        let placed: Promise<unknown>;
        let checkoutSettled = false;
        try {
          reversed = reverseSvc.reverse(admin.id, r1.id, { reason: 'gian lận' });
          reversed.catch(() => undefined);
          await waitUntil(async () => (await lockWaiters(prisma, hold.pid)) >= 1, 'reverse queued on R1');
          placed = place(u, addr, r1, POINTS_USED).finally(() => {
            checkoutSettled = true;
          });
          placed.catch(() => undefined);
          await waitUntil(() => checkoutSettled, 'checkout settled while R1 is held');
        } finally {
          hold.release();
          await hold.done;
        }
        const rs = await Promise.allSettled([placed, reversed]);
        errors.push(...errorsOf(rs));
        expectRejected(rs[0], ConflictException, PICKUP_REQUEST_GONE_MESSAGE);
        expect(rs[1]).toMatchObject({ status: 'fulfilled', value: { status: 'REVERSED' } });
        expect(await prisma.order.count({ where: { userId: u.id } })).toBe(1);
        const row = await reqRow(r1.id);
        expect(row.status).toBe('REVERSED');
        expect(row.orderId).toBe(order.id);
        await expectBalanceMatchesLedger(u.id);
      }
      expectNoDeadlock(errors);
    });

    it('checkout attaching the COMPLETED request then reverse', async () => {
      const errors: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const { u, addr, order, r1 } = await boundCompleted();
        const hold = await holdLock(prisma, usersRow(u.id));
        let reversed: Promise<unknown>;
        let placed: Promise<unknown>;
        let checkoutSettled = false;
        try {
          placed = place(u, addr, r1, POINTS_USED).finally(() => {
            checkoutSettled = true;
          });
          placed.catch(() => undefined);
          await waitUntil(() => checkoutSettled, 'checkout settled while the users row is held');
          reversed = reverseSvc.reverse(admin.id, r1.id, { reason: 'gian lận' });
          reversed.catch(() => undefined);
          await waitUntil(async () => (await lockWaiters(prisma, hold.pid)) >= 1, 'reverse queued on the users row');
        } finally {
          hold.release();
          await hold.done;
        }
        const rs = await Promise.allSettled([placed, reversed]);
        errors.push(...errorsOf(rs));
        expectRejected(rs[0], ConflictException, PICKUP_REQUEST_GONE_MESSAGE);
        expect(rs[1]).toMatchObject({ status: 'fulfilled', value: { status: 'REVERSED' } });
        expect(await prisma.order.count({ where: { userId: u.id } })).toBe(1);
        const row = await reqRow(r1.id);
        expect(row.status).toBe('REVERSED');
        expect(row.orderId).toBe(order.id);
        await expectBalanceMatchesLedger(u.id);
      }
      expectNoDeadlock(errors);
    });
  });

  describe('advisory lock classes (731001 customer, 731002 tracking, 731003 staff cap)', () => {
    const customerKey = (key: string) => Prisma.sql`SELECT pg_advisory_xact_lock(731001, hashtext(${key}))`;
    const trackingKey = (key: string) => Prisma.sql`SELECT pg_advisory_xact_lock(731002, hashtext(${key}))`;
    const staffCapKey = (key: string) => Prisma.sql`SELECT pg_advisory_xact_lock(731003, hashtext(${key}))`;
    const trackingLock = Prisma.sql`SELECT pg_advisory_xact_lock(731002, 0)`;
    const staffCapZero = Prisma.sql`SELECT pg_advisory_xact_lock(731003, 0)`;

    async function completesWhileHeld(errors: string[], lockSql: Prisma.Sql, run: () => Promise<unknown>) {
      const hold = await holdLock(prisma, lockSql);
      let settled = false;
      const victim = run().finally(() => {
        settled = true;
      });
      victim.catch((e: unknown) => errors.push(String((e as Error)?.message ?? e)));
      try {
        await waitUntil(() => settled, 'victim completes while the other class is held', 80);
        expect(await lockWaiters(prisma, hold.pid)).toBe(0);
      } finally {
        hold.release();
        await hold.done;
      }
      await expect(victim).resolves.toBeDefined();
    }

    async function waitsWhileHeld(errors: string[], lockSql: Prisma.Sql, run: () => Promise<unknown>) {
      const hold = await holdLock(prisma, lockSql);
      let settled = false;
      const ctl = run().finally(() => {
        settled = true;
      });
      ctl.catch((e: unknown) => errors.push(String((e as Error)?.message ?? e)));
      try {
        await waitUntil(async () => (await lockWaiters(prisma, hold.pid)) >= 1, 'control queued');
        expect(settled).toBe(false);
      } finally {
        hold.release();
        await hold.done;
      }
      await expect(ctl).resolves.toBeDefined();
    }

    async function confirmPair(staffId: string) {
      const c1 = await newUser();
      const c2 = await newUser();
      const r1 = await dropOff(c1.id, [{ itemId: carton.id, declaredQty: 3 }]);
      const r2 = await dropOff(c2.id, [{ itemId: carton.id, declaredQty: 3 }]);
      return {
        victim: () => confirm(staffId, r1.id, [full(carton.id, 3)]),
        control: () => confirm(staffId, r2.id, [full(carton.id, 3)]),
      };
    }

    it('CUSTOMER lock then STAFF_CAP lock', async () => {
      const errors: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const staff = await newStaff();
        const { victim, control } = await confirmPair(staff.id);
        await completesWhileHeld(errors, customerKey(staff.id), victim);
        await waitsWhileHeld(errors, staffCapKey(staff.id), control);
      }
      expectNoDeadlock(errors);
    });

    it('STAFF_CAP lock then CUSTOMER lock', async () => {
      const errors: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const c = await newUser();
        const r1 = await dropOff(c.id, [{ itemId: carton.id, declaredQty: 3 }]);
        const r2 = await dropOff(c.id, [{ itemId: carton.id, declaredQty: 3 }]);
        await completesWhileHeld(errors, staffCapKey(c.id), () => edit(c.id, r1.id, [{ itemId: carton.id, declaredQty: 4 }]));
        await waitsWhileHeld(errors, customerKey(c.id), () => edit(c.id, r2.id, [{ itemId: carton.id, declaredQty: 4 }]));
      }
      expectNoDeadlock(errors);
    });

    it('TRACKING lock then STAFF_CAP lock', async () => {
      const errors: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const staff = await newStaff();
        const { victim, control } = await confirmPair(staff.id);
        await completesWhileHeld(errors, trackingKey(staff.id), victim);
        await waitsWhileHeld(errors, staffCapKey(staff.id), control);
      }
      expectNoDeadlock(errors);
    });

    it('STAFF_CAP lock then TRACKING lock', async () => {
      const errors: string[] = [];
      const mailIn = async () => {
        const c = await newUser();
        const r = await createWasteRequest(prisma, { userId: c.id, method: 'MAIL_IN', status: 'OPEN', pointId: wh.id, lines: [{ itemId: carton.id, declaredQty: 20 }] });
        return { c, r };
      };
      for (let i = 0; i < ROUNDS; i++) {
        const a = await mailIn();
        const b = await mailIn();
        await completesWhileHeld(errors, staffCapZero, () =>
          requests.setTracking(a.c.id, a.r.id, { carrier: 'GHTK', trackingCode: `IT${randCode(8)}` }),
        );
        await waitsWhileHeld(errors, trackingLock, () =>
          requests.setTracking(b.c.id, b.r.id, { carrier: 'GHTK', trackingCode: `IT${randCode(8)}` }),
        );
      }
      expectNoDeadlock(errors);
    });
  });
});
