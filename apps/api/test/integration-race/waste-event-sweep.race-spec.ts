jest.mock('../../src/modules/integrations/gomdon/gomdon-config', () => ({
  ...jest.requireActual('../../src/modules/integrations/gomdon/gomdon-config'),
  isGomdonRecyclingEnabled: jest.fn().mockResolvedValue(true),
}));

import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import type { Prisma, WasteRequestStatus } from '@prisma/client';
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
import { WasteAdminGiftsService } from '../../src/modules/waste-exchange/catalog/waste-admin-gifts.service';
import { WasteAdminItemsService } from '../../src/modules/waste-exchange/catalog/waste-admin-items.service';
import { WasteAdminPointsService } from '../../src/modules/waste-exchange/catalog/waste-admin-points.service';
import { WasteGiftRedemptionsService } from '../../src/modules/waste-exchange/catalog/waste-gift-redemptions.service';
import { WasteAccessService } from '../../src/modules/waste-exchange/core/waste-access.service';
import { WasteConfigService } from '../../src/modules/waste-exchange/core/waste-config.service';
import { WasteHoldService } from '../../src/modules/waste-exchange/core/waste-hold.service';
import { WasteNotifierService } from '../../src/modules/waste-exchange/core/waste-notifier.service';
import { WasteShipLockService } from '../../src/modules/waste-exchange/core/waste-ship-lock.service';
import { WasteRequestsService } from '../../src/modules/waste-exchange/customer/waste-requests.service';
import { WasteExpiryCron } from '../../src/modules/waste-exchange/pickup/waste-expiry.cron';
import { WastePickupHooks } from '../../src/modules/waste-exchange/pickup/waste-pickup-hooks.service';
import { WasteAdminRequestsService } from '../../src/modules/waste-exchange/receiving/waste-admin-requests.service';
import { WasteConfirmService, type WasteStaffCall } from '../../src/modules/waste-exchange/receiving/waste-confirm.service';
import { WasteDeskService } from '../../src/modules/waste-exchange/receiving/waste-desk.service';
import { WasteReceiveService } from '../../src/modules/waste-exchange/receiving/waste-receive.service';
import { WasteReverseService } from '../../src/modules/waste-exchange/receiving/waste-reverse.service';
import { WASTE_EVENT_KINDS, type WasteEventKind } from '../../src/modules/waste-exchange/waste.constants';
import {
  cleanupWaste,
  createGiftRedemption,
  createWarehouse,
  createWasteGift,
  createWasteItem,
  createWastePoint,
  createWasteRequest,
} from './fixtures/waste-fixtures';
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
const PRICE = 100_000;
const SEED_POINTS = 1_000_000;
const POINTS_USED = 10_000;
const SHIP_LOCK_CFG = { shortfallLockPct: 50, shortfallLockStreak: 3 };

type SweepRow = {
  kind: WasteEventKind;
  run: () => Promise<unknown>;
  scope: () => Prisma.WasteEventWhereInput;
  replay?: () => Promise<unknown>;
};

let moduleRef: TestingModule;
let prisma: PrismaService;
let requests: WasteRequestsService;
let hooks: WastePickupHooks;
let expiry: WasteExpiryCron;
let shipLock: WasteShipLockService;
let receive: WasteReceiveService;
let confirmSvc: WasteConfirmService;
let adminRequests: WasteAdminRequestsService;
let desk: WasteDeskService;
let reverseSvc: WasteReverseService;
let adminItems: WasteAdminItemsService;
let adminPoints: WasteAdminPointsService;
let adminGifts: WasteAdminGiftsService;
let redemptions: WasteGiftRedemptionsService;
let checkout: CheckoutService;
let cart: CartService;
let wh: Awaited<ReturnType<typeof createWarehouse>>;
let item: Awaited<ReturnType<typeof createWasteItem>>;
let dropPoint: Awaited<ReturnType<typeof createWastePoint>>;
let savedConfig: { key: string; value: unknown }[] = [];
let savedSort: { items: { id: string; sortOrder: number }[]; points: { id: string; sortOrder: number }[]; gifts: { id: string; sortOrder: number }[] } = {
  items: [],
  points: [],
  gifts: [],
};
const created = { userIds: [] as string[], productIds: [] as string[] };
const reg = { itemIds: [] as string[], pointIds: [] as string[], giftIds: [] as string[], storefrontIds: [] as string[] };

const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
const clearConfigCache = () => (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();

async function newUser(over: Parameters<typeof createUser>[1] = {}) {
  const u = await createUser(prisma, { phone: phone(), ...over });
  created.userIds.push(u.id);
  return u;
}
const newStaff = () => newUser({ role: 'STAFF' });
const newAdmin = () => newUser({ role: 'ADMIN' });

const lines = (declaredQty: number) => [{ itemId: item.id, declaredQty }];
const mailIn = (userId: string, status: WasteRequestStatus, over: Partial<Parameters<typeof createWasteRequest>[1]> = {}) =>
  createWasteRequest(prisma, { userId, method: 'MAIL_IN', status, pointId: wh.id, lines: lines(10), ...over });
const dropOff = (userId: string) => createWasteRequest(prisma, { userId, method: 'DROP_OFF', status: 'OPEN', pointId: dropPoint.id, lines: lines(5) });

const adminCall = (staffId: string, requestId: string): WasteStaffCall => ({
  callerUserId: staffId,
  requestId,
  route: 'ADMIN',
  device: { ip: '127.0.0.0', userAgent: 'sweep' },
});
const confirmLines = () => ({ lines: [{ itemId: item.id, declaredQty: 10, receivedQty: 10 }] });

async function partnerPoint(opts: { ownerUserId?: string } = {}) {
  const p = await createWastePoint(prisma, { kind: 'PARTNER', ...opts, itemIds: [item.id] });
  reg.pointIds.push(p.id);
  if (p.createdStorefront && p.ownerStorefrontId) reg.storefrontIds.push(p.ownerStorefrontId);
  return p;
}

function sweepRow<T>(
  kind: WasteEventKind,
  setup: () => Promise<T>,
  act: (c: T) => Promise<unknown>,
  scope: (c: T) => Prisma.WasteEventWhereInput,
  replay?: (c: T) => Promise<unknown>,
): SweepRow {
  let ctx: T | undefined;
  return {
    kind,
    run: async () => {
      ctx = await setup();
      return act(ctx);
    },
    scope: () => scope(ctx as T),
    ...(replay ? { replay: () => replay(ctx as T) } : {}),
  };
}

const byRequest = (c: { id: string }): Prisma.WasteEventWhereInput => ({ requestId: c.id });
const byPoint = (c: { id: string }): Prisma.WasteEventWhereInput => ({ pointId: c.id });
const byMeta = (key: 'itemId' | 'giftId' | 'subjectUserId', id: string): Prisma.WasteEventWhereInput => ({ meta: { path: [key], equals: id } });
const byActor = (c: { id: string }): Prisma.WasteEventWhereInput => ({ actorUserId: c.id });

async function deliveredOrder(userId: string) {
  const order = await createOrder(prisma, { userId });
  await prisma.order.update({ where: { id: order.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
  return order;
}

async function checkoutCustomer() {
  const u = await createUser(prisma, { role: 'CUSTOMER', pointsBalance: SEED_POINTS, phone: phone() });
  created.userIds.push(u.id);
  await prisma.pointsTransaction.create({ data: { userId: u.id, delta: SEED_POINTS, lot: 'STANDARD', reason: 'IT_SEED_STANDARD', refType: 'IT' } });
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
    data: { pancakeId: `itsw-p-${tag}`, brand: 'IT', slug: `itsw-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: PRICE },
  });
  created.productIds.push(product.id);
  const variation = await prisma.variation.create({
    data: { pancakeId: `itsw-v-${tag}`, productId: product.id, sku: `ITSW-${tag}`, name: 'Chai', attributes: {}, retailPrice: PRICE, stock: 100 },
  });
  await cart.addItem(u.id, { variationId: variation.id, quantity: 1 });
  return { u, addr };
}

let shipLockResolved: { userId: string; pickupId: string } | undefined;
function shipLockCtx(): { userId: string; pickupId: string } {
  if (!shipLockResolved) throw new Error('shipLockOnce has not resolved yet');
  return shipLockResolved;
}
let shipLockMemo: Promise<{ userId: string; pickupId: string; result: Awaited<ReturnType<WasteShipLockService['evaluateAndLock']>> }> | undefined;
// SHIP_LOCKED and REQUEST_CANCELLED_SHIP_LOCK come from one evaluateAndLock call, so both rows share one fixture and one call.
function shipLockOnce() {
  shipLockMemo ??= (async () => {
    const u = await newUser();
    for (let i = 0; i < 3; i++) {
      const r = await mailIn(u.id, 'OPEN');
      await prisma.wasteRequest.update({
        where: { id: r.id },
        data: { status: 'REJECTED', rejectionReason: 'WET', closedAt: new Date(Date.now() - (i + 1) * 60_000), expiresAt: null },
      });
    }
    const pickup = await createWasteRequest(prisma, { userId: u.id, method: 'PICKUP', status: 'OPEN', pointId: wh.id, lines: lines(12) });
    const result = await shipLock.evaluateAndLock(u.id, SHIP_LOCK_CFG);
    shipLockResolved = { userId: u.id, pickupId: pickup.id };
    return { userId: u.id, pickupId: pickup.id, result };
  })();
  return shipLockMemo;
}

async function unmatchedReceiveCase() {
  const staff = await newStaff();
  const c = await newUser();
  const r = await mailIn(c.id, 'IN_TRANSIT');
  return { staff, r };
}
const WRONG_CODE = 'TR-ZZZZZ';

async function receivedMailIn() {
  const c = await newUser();
  return mailIn(c.id, 'RECEIVED');
}

// A reorder must name every row of its table, so the ids are read just before the call.
const reverseIds = (rows: { id: string }[]) => rows.map((r) => r.id).reverse();
const itemIds = async () => reverseIds(await prisma.wasteItem.findMany({ select: { id: true } }));
const pointIds = async () => reverseIds(await prisma.wastePoint.findMany({ select: { id: true } }));
const giftIds = async () => reverseIds(await prisma.wasteGift.findMany({ select: { id: true } }));

const SWEEP: ReadonlyArray<SweepRow> = [
  sweepRow(
    'REQUEST_CREATED',
    async () => ({ u: await newUser(), key: `sw-${randCode(12)}`, id: '' }),
    async (c) => {
      c.id = (await requests.create(c.u.id, c.key, { method: 'DROP_OFF', lines: lines(5), pointId: dropPoint.id, consent: true })).id;
    },
    byRequest,
    (c) => requests.create(c.u.id, c.key, { method: 'DROP_OFF', lines: lines(5), pointId: dropPoint.id, consent: true }),
  ),
  sweepRow(
    'REQUEST_EDITED',
    async () => {
      const u = await newUser();
      return { u, id: (await dropOff(u.id)).id };
    },
    (c) => requests.edit(c.u.id, c.id, { lines: lines(7) }),
    byRequest,
  ),
  sweepRow(
    'TRACKING_SET',
    async () => {
      const u = await newUser();
      return { u, id: (await mailIn(u.id, 'OPEN')).id };
    },
    (c) => requests.setTracking(c.u.id, c.id, { carrier: 'GHN', trackingCode: `SW${randCode(10)}` }),
    byRequest,
  ),
  sweepRow(
    'TRACKING_EDITED',
    async () => {
      const u = await newUser();
      const r = await mailIn(u.id, 'OPEN');
      await requests.setTracking(u.id, r.id, { carrier: 'GHN', trackingCode: `SW${randCode(10)}` });
      return { u, id: r.id };
    },
    (c) => requests.setTracking(c.u.id, c.id, { carrier: 'GHN', trackingCode: `SW${randCode(10)}` }),
    byRequest,
  ),
  sweepRow(
    'REQUEST_CANCELLED',
    async () => {
      const u = await newUser();
      return { u, id: (await dropOff(u.id)).id };
    },
    (c) => requests.cancel(c.u.id, c.id),
    byRequest,
    (c) => requests.cancel(c.u.id, c.id),
  ),
  sweepRow(
    'REQUEST_ATTACHED',
    async () => {
      const { u, addr } = await checkoutCustomer();
      const req = await createWasteRequest(prisma, { userId: u.id, method: 'PICKUP', status: 'OPEN', pointId: wh.id, lines: lines(12) });
      return { u, addr, id: req.id };
    },
    (c) => checkout.placeOrder(c.u.id, { addressId: c.addr.id, paymentMethod: 'COD', pointsToUse: POINTS_USED, wasteRequestId: c.id } as never),
    byRequest,
  ),
  sweepRow(
    'PICKUP_STARTED',
    async () => {
      const u = await newUser();
      const order = await deliveredOrder(u.id);
      const req = await createWasteRequest(prisma, { userId: u.id, method: 'PICKUP', status: 'OPEN', pointId: wh.id, lines: lines(12), orderId: order.id });
      return { orderId: order.id, id: req.id };
    },
    (c) => hooks.onOrderDelivered(c.orderId),
    byRequest,
  ),
  sweepRow(
    'PICKUP_ORDER_CANCELLED',
    async () => {
      const u = await newUser();
      const order = await createOrder(prisma, { userId: u.id });
      const req = await createWasteRequest(prisma, { userId: u.id, method: 'PICKUP', status: 'OPEN', pointId: wh.id, lines: lines(12), orderId: order.id });
      await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
      return { orderId: order.id, id: req.id };
    },
    (c) => hooks.onOrderCancelled(c.orderId),
    byRequest,
  ),
  sweepRow(
    'REQUEST_EXPIRED',
    async () => {
      const u = await newUser();
      return { id: (await mailIn(u.id, 'OPEN', { expiresAt: new Date(Date.now() - 60_000) })).id };
    },
    () => expiry.run(new Date()),
    byRequest,
  ),
  sweepRow(
    'HOOK_ANOMALY',
    async () => {
      const u = await newUser();
      const order = await deliveredOrder(u.id);
      const req = await createWasteRequest(prisma, { userId: u.id, method: 'PICKUP', status: 'CANCELLED', pointId: wh.id, lines: lines(12), orderId: order.id });
      await prisma.wasteRequest.update({ where: { id: req.id }, data: { closeReason: 'ORDER_CANCELLED', closedAt: new Date() } });
      return { orderId: order.id, id: req.id };
    },
    (c) => hooks.onOrderDelivered(c.orderId),
    byRequest,
  ),
  {
    kind: 'SHIP_LOCKED',
    run: async () => (await shipLockOnce()).result,
    scope: () => byMeta('subjectUserId', shipLockCtx().userId),
  },
  {
    kind: 'REQUEST_CANCELLED_SHIP_LOCK',
    run: async () => (await shipLockOnce()).result,
    scope: () => ({ requestId: shipLockCtx().pickupId }),
  },
  sweepRow(
    'PARCEL_RECEIVED',
    async () => {
      const staff = await newStaff();
      const c = await newUser();
      return { staff, r: await mailIn(c.id, 'IN_TRANSIT') };
    },
    (c) => receive.receive(c.staff.id, c.r.id, { match: { parcelCode: c.r.code } }),
    (c) => byRequest(c.r),
    (c) => receive.receive(c.staff.id, c.r.id, { match: { parcelCode: c.r.code } }),
  ),
  sweepRow(
    'PARCEL_UNMATCHED',
    unmatchedReceiveCase,
    (c) => receive.receive(c.staff.id, c.r.id, { match: { parcelCode: WRONG_CODE } }),
    (c) => byRequest(c.r),
    (c) => receive.receive(c.staff.id, c.r.id, { match: { parcelCode: WRONG_CODE } }),
  ),
  sweepRow(
    'UNMATCHED_RECORDED',
    newStaff,
    (staff) => receive.createUnmatched(staff.id, { description: `Sweep ${randCode(6)}` }),
    byActor,
  ),
  sweepRow(
    'UNMATCHED_RESOLVED',
    async () => {
      const staff = await newStaff();
      const c = await newUser();
      const um = await receive.createUnmatched(staff.id, { description: `Sweep ${randCode(6)}` });
      return { staff, um, r: await mailIn(c.id, 'IN_TRANSIT') };
    },
    (c) => receive.resolveUnmatched(c.staff.id, c.um.id, { action: 'MATCH', requestId: c.r.id, note: 'Sweep khớp' }),
    (c) => byActor(c.staff),
  ),
  sweepRow(
    'UNMATCHED_CLOSED',
    async () => {
      const staff = await newStaff();
      return { staff, um: await receive.createUnmatched(staff.id, { description: `Sweep ${randCode(6)}` }) };
    },
    (c) => receive.resolveUnmatched(c.staff.id, c.um.id, { action: 'CLOSE', note: 'Sweep đóng' }),
    (c) => byActor(c.staff),
  ),
  sweepRow(
    'REQUEST_CONFIRMED',
    async () => ({ staff: await newStaff(), r: await receivedMailIn() }),
    (c) => confirmSvc.confirm(adminCall(c.staff.id, c.r.id), confirmLines()),
    (c) => byRequest(c.r),
    (c) => confirmSvc.confirm(adminCall(c.staff.id, c.r.id), confirmLines()),
  ),
  sweepRow(
    'REQUEST_REJECTED',
    async () => ({ staff: await newStaff(), r: await receivedMailIn() }),
    (c) => confirmSvc.reject(adminCall(c.staff.id, c.r.id), { rejectionReason: 'WET' }),
    (c) => byRequest(c.r),
  ),
  sweepRow(
    'REQUEST_CLOSED_LOST',
    async () => {
      const c = await newUser();
      return { admin: await newAdmin(), r: await mailIn(c.id, 'IN_TRANSIT') };
    },
    (c) => confirmSvc.closeLost(c.admin.id, c.r.id, { reason: 'Sweep thất lạc' }),
    (c) => byRequest(c.r),
  ),
  sweepRow(
    'REQUEST_REOPENED',
    async () => {
      const c = await newUser();
      const r = await mailIn(c.id, 'EXPIRED', { expiresAt: null });
      await prisma.wasteRequest.update({ where: { id: r.id }, data: { closedAt: new Date(), closeReason: 'HOLD_EXPIRED' } });
      return { admin: await newAdmin(), r };
    },
    (c) => adminRequests.reopen(c.admin.id, c.r.id, { reason: 'Sweep mở lại' }),
    (c) => byRequest(c.r),
  ),
  sweepRow(
    'REQUEST_COST_UPDATED',
    async () => {
      const c = await newUser();
      return { admin: await newAdmin(), r: await mailIn(c.id, 'IN_TRANSIT') };
    },
    (c) => adminRequests.setCost(c.admin.id, c.r.id, { carrierCostVnd: 15_000 }),
    (c) => byRequest(c.r),
  ),
  sweepRow(
    'USER_FLAGS_UPDATED',
    async () => ({ admin: await newAdmin(), customer: await newUser() }),
    (c) => adminRequests.setFlags(c.admin.id, c.customer.id, { blocked: true, reason: 'Sweep khoá' }),
    (c) => byMeta('subjectUserId', c.customer.id),
  ),
  sweepRow(
    'LOOKUP_MISS',
    newStaff,
    (staff) => desk.lookup(staff.id, WRONG_CODE).catch((e: Error) => e.message),
    byActor,
  ),
  sweepRow(
    'PERK_SUBMITTED',
    async () => {
      const owner = await newUser();
      return { owner, point: await partnerPoint({ ownerUserId: owner.id }) };
    },
    (c) => desk.submitPerk(c.owner.id, c.point.id, { perkText: `Sweep ưu đãi ${randCode(4)}` }),
    (c) => byPoint(c.point),
  ),
  sweepRow(
    'POINTS_REVERSED',
    async () => {
      const staff = await newStaff();
      const r = await receivedMailIn();
      await confirmSvc.confirm(adminCall(staff.id, r.id), confirmLines());
      return { admin: await newAdmin(), r };
    },
    (c) => reverseSvc.reverse(c.admin.id, c.r.id, { reason: 'Sweep thu hồi' }),
    (c) => byRequest(c.r),
    (c) => reverseSvc.reverse(c.admin.id, c.r.id, { reason: 'Sweep thu hồi' }),
  ),
  sweepRow(
    'PERK_APPROVED',
    async () => {
      const point = await partnerPoint();
      await prisma.wastePoint.update({ where: { id: point.id }, data: { perkPendingText: 'Sweep ưu đãi' } });
      return { admin: await newAdmin(), point };
    },
    (c) => adminPoints.approvePerk(c.admin.id, c.point.id),
    (c) => byPoint(c.point),
  ),
  sweepRow(
    'PERK_REJECTED',
    async () => {
      const point = await partnerPoint();
      await prisma.wastePoint.update({ where: { id: point.id }, data: { perkPendingText: 'Sweep ưu đãi' } });
      return { admin: await newAdmin(), point };
    },
    (c) => adminPoints.rejectPerk(c.admin.id, c.point.id),
    (c) => byPoint(c.point),
  ),
  sweepRow(
    'ITEM_CREATED',
    async () => ({ admin: await newAdmin(), id: '' }),
    async (c) => {
      const row = await adminItems.create(c.admin.id, { code: `IT_SW_${randCode(6)}`, name: 'Sweep item', unitLabel: 'cái', unitsPerPoint: 1, pointsPerGroup: 1000 });
      c.id = row.id;
      reg.itemIds.push(row.id);
    },
    (c) => byMeta('itemId', c.id),
  ),
  sweepRow(
    'ITEM_UPDATED',
    async () => {
      const row = await createWasteItem(prisma);
      reg.itemIds.push(row.id);
      return { admin: await newAdmin(), id: row.id };
    },
    (c) => adminItems.update(c.admin.id, c.id, { name: `Sweep ${randCode(6)}` }),
    (c) => byMeta('itemId', c.id),
  ),
  sweepRow(
    'ITEMS_REORDERED',
    newAdmin,
    async (admin) => adminItems.reorder(admin.id, { ids: await itemIds() }),
    byActor,
  ),
  sweepRow(
    'POINT_CREATED',
    async () => ({ admin: await newAdmin(), id: '' }),
    async (c) => {
      const row = await adminPoints.create(c.admin.id, {
        kind: 'PARTNER',
        name: `Sweep điểm ${randCode(6)}`,
        addressLine: 'IT',
        provinceCode: '79',
        provinceName: 'TP.HCM',
        communeCode: 'IT',
        communeName: 'IT',
        monthlyQuotaPoints: 100_000,
      });
      c.id = row.id;
      reg.pointIds.push(row.id);
    },
    byPoint,
  ),
  sweepRow(
    'POINT_UPDATED',
    async () => ({ admin: await newAdmin(), point: await partnerPoint() }),
    (c) => adminPoints.update(c.admin.id, c.point.id, { name: `Sweep ${randCode(6)}` }),
    (c) => byPoint(c.point),
  ),
  sweepRow(
    'POINTS_REORDERED',
    newAdmin,
    async (admin) => adminPoints.reorder(admin.id, { ids: await pointIds() }),
    byActor,
  ),
  sweepRow(
    'POINT_STAFF_ADDED',
    async () => ({ admin: await newAdmin(), point: await partnerPoint(), user: await newUser() }),
    (c) => adminPoints.addStaff(c.admin.id, c.point.id, { userId: c.user.id, role: 'STAFF' }),
    (c) => byPoint(c.point),
  ),
  sweepRow(
    'POINT_STAFF_REMOVED',
    async () => {
      const point = await partnerPoint();
      const user = await newUser();
      await prisma.wastePointStaff.create({ data: { pointId: point.id, userId: user.id, role: 'STAFF', isActive: true } });
      return { admin: await newAdmin(), point, user };
    },
    (c) => adminPoints.removeStaff(c.admin.id, c.point.id, c.user.id),
    (c) => byPoint(c.point),
  ),
  sweepRow(
    'GIFT_CREATED',
    async () => ({ admin: await newAdmin(), id: '' }),
    async (c) => {
      const row = await adminGifts.create(c.admin.id, { kind: 'GIFT', name: `Sweep quà ${randCode(6)}`, pointsCost: 20_000 });
      c.id = row.id;
      reg.giftIds.push(row.id);
    },
    (c) => byMeta('giftId', c.id),
  ),
  sweepRow(
    'GIFT_UPDATED',
    async () => {
      const gift = await createWasteGift(prisma);
      reg.giftIds.push(gift.id);
      return { admin: await newAdmin(), id: gift.id };
    },
    (c) => adminGifts.update(c.admin.id, c.id, { name: `Sweep ${randCode(6)}` }),
    (c) => byMeta('giftId', c.id),
  ),
  sweepRow(
    'GIFTS_REORDERED',
    newAdmin,
    async (admin) => adminGifts.reorder(admin.id, { ids: await giftIds() }),
    byActor,
  ),
  sweepRow(
    'GIFT_FULFILLED',
    async () => {
      const customer = await newUser();
      const gift = await createWasteGift(prisma);
      reg.giftIds.push(gift.id);
      const red = await createGiftRedemption(prisma, { userId: customer.id, giftId: gift.id });
      return { staff: await newStaff(), red };
    },
    (c) => redemptions.fulfilAtDesk(c.staff.id, { code: c.red.code!, pointId: wh.id }),
    (c) => ({ giftRedemptionId: c.red.id }),
    (c) => redemptions.fulfilAtDesk(c.staff.id, { code: c.red.code!, pointId: wh.id }),
  ),
  sweepRow(
    'GIFT_CANCELLED',
    async () => {
      const customer = await newUser();
      const gift = await createWasteGift(prisma);
      reg.giftIds.push(gift.id);
      const red = await createGiftRedemption(prisma, { userId: customer.id, giftId: gift.id });
      return { admin: await newAdmin(), red };
    },
    (c) => redemptions.cancel(c.admin.id, c.red.id, { reason: 'Sweep huỷ', refundPoints: false }),
    (c) => ({ giftRedemptionId: c.red.id }),
    (c) => redemptions.cancel(c.admin.id, c.red.id, { reason: 'Sweep huỷ', refundPoints: false }),
  ),
];

const NOTIFIER_STUB = {
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
};

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
      { provide: WasteNotifierService, useValue: NOTIFIER_STUB },
      WasteConfigService,
      WasteAccessService,
      WasteHoldService,
      WasteRequestsService,
      WasteShipLockService,
      WasteExpiryCron,
      WastePickupHooks,
      WasteReceiveService,
      WasteConfirmService,
      WasteAdminRequestsService,
      WasteDeskService,
      WasteReverseService,
      WasteAdminItemsService,
      WasteAdminPointsService,
      WasteAdminGiftsService,
      WasteGiftRedemptionsService,
    ],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  await warmPool(prisma);
  requests = moduleRef.get(WasteRequestsService);
  hooks = moduleRef.get(WastePickupHooks);
  expiry = moduleRef.get(WasteExpiryCron);
  shipLock = moduleRef.get(WasteShipLockService);
  receive = moduleRef.get(WasteReceiveService);
  confirmSvc = moduleRef.get(WasteConfirmService);
  adminRequests = moduleRef.get(WasteAdminRequestsService);
  desk = moduleRef.get(WasteDeskService);
  reverseSvc = moduleRef.get(WasteReverseService);
  adminItems = moduleRef.get(WasteAdminItemsService);
  adminPoints = moduleRef.get(WasteAdminPointsService);
  adminGifts = moduleRef.get(WasteAdminGiftsService);
  redemptions = moduleRef.get(WasteGiftRedemptionsService);
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

  savedSort = {
    items: await prisma.wasteItem.findMany({ select: { id: true, sortOrder: true } }),
    points: await prisma.wastePoint.findMany({ select: { id: true, sortOrder: true } }),
    gifts: await prisma.wasteGift.findMany({ select: { id: true, sortOrder: true } }),
  };

  wh = await createWarehouse(prisma);
  item = await createWasteItem(prisma, { unitsPerPoint: 1, pointsPerGroup: 1000, dailyCapQty: null, monthlyCapQty: null });
  reg.itemIds.push(item.id);
  const owner = await newUser();
  dropPoint = await partnerPoint({ ownerUserId: owner.id });
});

afterAll(async () => {
  if (prisma) {
    await prisma.$executeRaw`
      DELETE FROM "waste_events" WHERE "meta"->>'subjectUserId' = ANY(${created.userIds}::text[]) OR "meta"->>'itemId' = ANY(${reg.itemIds}::text[]) OR "meta"->>'giftId' = ANY(${reg.giftIds}::text[])`;
    await prisma.wasteUnmatchedParcel.deleteMany({ where: { createdByUserId: { in: created.userIds } } });
    await cleanupWaste(prisma, reg);
    await deleteItData(prisma, created);
    for (const r of savedSort.items) await prisma.wasteItem.updateMany({ where: { id: r.id }, data: { sortOrder: r.sortOrder } });
    for (const r of savedSort.points) await prisma.wastePoint.updateMany({ where: { id: r.id }, data: { sortOrder: r.sortOrder } });
    for (const r of savedSort.gifts) await prisma.wasteGift.updateMany({ where: { id: r.id }, data: { sortOrder: r.sortOrder } });
    await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
    for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
    clearConfigCache();
  }
  await moduleRef?.close();
});

describe('Exactly one WasteEvent per successful write, across all routes (real Postgres, spec 9 / 11.1 / 15.4)', () => {
  it('mọi kind trong WASTE_EVENT_KINDS đều có một dòng trong bảng quét', () => {
    expect(SWEEP.map((s) => s.kind).sort()).toEqual([...WASTE_EVENT_KINDS].sort());
  });

  it.each(SWEEP)('$kind: đúng một sự kiện, lặp lại không thêm', async ({ kind, run, scope, replay }) => {
    await run();

    const where = { kind, ...scope() };
    const rows = await prisma.wasteEvent.findMany({ where });
    expect(rows).toHaveLength(1);

    if (replay) {
      await replay().catch((e: unknown) => {
        if (!(kind.startsWith('GIFT_') && e instanceof ConflictException)) throw e;
        return e.message;
      });
      expect(await prisma.wasteEvent.count({ where })).toBe(1);
    }

    const meta = rows[0]!.meta as Record<string, unknown> | null;
    if (kind !== 'LOOKUP_MISS') expect(Object.keys(meta as object)).toEqual(expect.arrayContaining(['before', 'after']));
    if (kind === 'POINT_STAFF_ADDED' || kind === 'POINT_STAFF_REMOVED') expect(rows[0]!.meta).toHaveProperty('staffUserId');
    if (kind === 'GIFT_FULFILLED' || kind === 'GIFT_CANCELLED') {
      expect(rows[0]!.meta).toHaveProperty('giftId');
      expect(rows[0]!.meta).toHaveProperty('subjectUserId');
    }
    if (kind === 'GIFT_UPDATED') expect(rows[0]!.meta).toHaveProperty('giftId');
    if (kind === 'ITEM_UPDATED') expect(rows[0]!.meta).toHaveProperty('itemId');
    if (kind === 'SHIP_LOCKED') expect(rows[0]!.meta).toHaveProperty('subjectUserId');
    if (kind === 'HOOK_ANOMALY') expect((meta as { before: unknown }).before).toEqual((meta as { after: unknown }).after);
  });

  it('SHIP_LOCKED và REQUEST_CANCELLED_SHIP_LOCK là hai dòng riêng của một lần evaluateAndLock', async () => {
    const { userId, pickupId, result } = await shipLockOnce();
    expect(result).toMatchObject({ locked: true, cancelledRequestIds: [pickupId] });
    const locked = await prisma.wasteEvent.findMany({ where: { kind: 'SHIP_LOCKED', ...byMeta('subjectUserId', userId) } });
    const cancelled = await prisma.wasteEvent.findMany({ where: { kind: 'REQUEST_CANCELLED_SHIP_LOCK', requestId: pickupId } });
    expect(locked).toHaveLength(1);
    expect(cancelled).toHaveLength(1);
    expect(locked[0]!.id).not.toBe(cancelled[0]!.id);
  });

  it('PARCEL_UNMATCHED được ghi trong giao dịch riêng và việc nhận kiện trả UNMATCHED', async () => {
    const { staff, r } = await unmatchedReceiveCase();
    const out = await receive.receive(staff.id, r.id, { match: { parcelCode: WRONG_CODE } });
    expect(out).toMatchObject({ outcome: 'UNMATCHED', reason: 'NO_MATCH' });
    const row = await prisma.wasteUnmatchedParcel.findUniqueOrThrow({ where: { id: (out as { unmatchedId: string }).unmatchedId } });
    expect(row).toMatchObject({ relatedRequestId: r.id, status: 'OPEN' });
    expect(await prisma.wasteEvent.count({ where: { kind: 'PARCEL_UNMATCHED', requestId: r.id } })).toBe(1);
    expect(await prisma.wasteEvent.count({ where: { kind: 'PARCEL_RECEIVED', requestId: r.id } })).toBe(0);
  });
});
