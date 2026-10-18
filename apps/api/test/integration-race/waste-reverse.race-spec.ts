import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, type SystemConfig } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { LoyaltyExpiryService } from '../../src/modules/loyalty/loyalty-expiry.service';
import { applyPointsDelta } from '../../src/modules/loyalty/points-ledger';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { WasteAccessService } from '../../src/modules/waste-exchange/core/waste-access.service';
import { WasteConfigService } from '../../src/modules/waste-exchange/core/waste-config.service';
import { WasteHoldService } from '../../src/modules/waste-exchange/core/waste-hold.service';
import { WasteNotifierService } from '../../src/modules/waste-exchange/core/waste-notifier.service';
import { WasteShipLockService } from '../../src/modules/waste-exchange/core/waste-ship-lock.service';
import { WasteConfirmService } from '../../src/modules/waste-exchange/receiving/waste-confirm.service';
import { WasteReverseService } from '../../src/modules/waste-exchange/receiving/waste-reverse.service';
import { createUser, deleteItData, setConfig, summarize, warmPool } from './helpers';
import { cleanupWaste, createWarehouse, createWasteItem, createWasteRequest, raceWithHold } from './fixtures/waste-fixtures';

const CONFIG_KEYS = ['waste.enabled', 'loyalty.point_expire_months'];
const DAY = 86_400_000;

let moduleRef: TestingModule;
let prisma: PrismaService;
let reverse: WasteReverseService;
let confirm: WasteConfirmService;
let expiry: LoyaltyExpiryService;
let rewards: RewardPointsService;
let savedConfig: SystemConfig[];
let admin: { id: string };
let staff: { id: string };
let warehouse: Awaited<ReturnType<typeof createWarehouse>>;
let item: Awaited<ReturnType<typeof createWasteItem>>;
let itemId: string;
let yesterday: Date;
let touched: string[] = [];
const userIds: string[] = [];
const reg = { pointIds: [] as string[], itemIds: [] as string[], storefrontIds: [] as string[] };

const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
const userRow = (id: string) => Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${id} FOR UPDATE`;
const balance = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pointsBalance;
const reasonGiven = { reason: 'gian lận' };

async function newCustomer() {
  const u = await createUser(prisma, { phone: phone() });
  userIds.push(u.id);
  touched.push(u.id);
  return u;
}

async function completed(customer: { id: string }, points: number, expiresAt: Date = new Date(Date.now() + 300 * DAY)) {
  const qty = points / item.pointsPerGroup;
  const request = await createWasteRequest(prisma, {
    userId: customer.id,
    method: 'MAIL_IN',
    status: 'COMPLETED',
    pointId: warehouse.id,
    lines: [{ itemId, declaredQty: qty, receivedQty: qty }],
  });
  const now = new Date();
  await prisma.wasteRequest.update({
    where: { id: request.id },
    data: { pointsAwarded: points, completedAt: now, closedAt: now, confirmedByUserId: staff.id },
  });
  await rewards.grant(customer.id, points, `RECYCLE:${request.code}`, 'RECYCLE', request.id, undefined, expiresAt);
  return request;
}

async function oldLot(userId: string, points: number) {
  await prisma.$transaction([
    prisma.pointsTransaction.create({
      data: {
        userId,
        delta: points,
        lot: 'STANDARD',
        reason: 'IT_OLD_LOT',
        refType: 'GAME',
        createdAt: new Date(Date.now() - 400 * DAY),
        expiresAt: null,
      },
    }),
    prisma.user.update({ where: { id: userId }, data: { pointsBalance: { increment: points } } }),
  ]);
}

async function mailInReceived(customer: { id: string }, declaredQty: number) {
  return createWasteRequest(prisma, {
    userId: customer.id,
    method: 'MAIL_IN',
    status: 'RECEIVED',
    pointId: warehouse.id,
    lines: [{ itemId, declaredQty }],
  });
}

const confirmCall = (requestId: string) =>
  confirm.confirm(
    { callerUserId: staff.id, requestId, route: 'ADMIN', device: { ip: null, userAgent: null } },
    { lines: [{ itemId, declaredQty: 10, receivedQty: 10 }] },
  );

const spend = (userId: string, amount: number) =>
  prisma.$transaction((tx) => applyPointsDelta(tx, { userId, delta: -amount, lot: 'STANDARD', reason: 'IT_SPEND', refType: 'IT' }));

/** Customer with a 400-day-old unexpiring lot of 20 000 and a 30 000 lot that expired yesterday, ready to be reversed. */
async function expiredLotCustomer() {
  const c = await newCustomer();
  await oldLot(c.id, 20_000);
  const a = await completed(c, 30_000, yesterday);
  return { c, a };
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [PrismaModule],
    providers: [
      SystemConfigService,
      RewardPointsService,
      WasteConfigService,
      WasteAccessService,
      WasteHoldService,
      WasteConfirmService,
      WasteReverseService,
      LoyaltyExpiryService,
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
      { provide: NotificationsService, useValue: { notify: async () => undefined } },
      {
        provide: WasteShipLockService,
        useValue: { evaluateAndLock: jest.fn().mockResolvedValue({ locked: false, shipLockedAt: null, cancelledRequestIds: [] }) },
      },
    ],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  reverse = moduleRef.get(WasteReverseService);
  confirm = moduleRef.get(WasteConfirmService);
  expiry = moduleRef.get(LoyaltyExpiryService);
  rewards = moduleRef.get(RewardPointsService);
  await warmPool(prisma);
  savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
  await setConfig(prisma, 'waste.enabled', true);
  await setConfig(prisma, 'loyalty.point_expire_months', 12);
  (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();

  admin = await createUser(prisma, { role: 'ADMIN', phone: phone() });
  staff = await createUser(prisma, { role: 'STAFF', phone: phone() });
  userIds.push(admin.id, staff.id);
  warehouse = await createWarehouse(prisma);
  item = await createWasteItem(prisma, { unitsPerPoint: 1, pointsPerGroup: 1000 });
  itemId = item.id;
  reg.itemIds.push(item.id);
  yesterday = new Date(Date.now() - DAY);
});

afterEach(async () => {
  expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  touched = [];
});

afterAll(async () => {
  if (prisma) {
    await cleanupWaste(prisma, reg);
    await deleteItData(prisma, { userIds });
    await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
    for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
  }
  await moduleRef?.close();
});

describe('WasteReverseService races (real Postgres)', () => {
  it('reverse then confirm', async () => {
    const c = await newCustomer();
    const a = await completed(c, 20_000);
    const b = await mailInReceived(c, 10);
    const results = await raceWithHold(prisma, userRow(c.id), () => reverse.reverse(admin.id, a.id, reasonGiven), () => confirmCall(b.id));
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(0);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: { pointsTaken: 20_000, shortfallPoints: 0 } });
    await expect(balance(c.id)).resolves.toBe(10_000);
  });

  it('confirm then reverse', async () => {
    const c = await newCustomer();
    const a = await completed(c, 20_000);
    const b = await mailInReceived(c, 10);
    const results = await raceWithHold(prisma, userRow(c.id), () => confirmCall(b.id), () => reverse.reverse(admin.id, a.id, reasonGiven));
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(0);
    await expect(balance(c.id)).resolves.toBe(10_000);
  });

  it('reverse × reverse Promise.all', async () => {
    const c = await newCustomer();
    const a = await completed(c, 20_000);
    const results = await Promise.allSettled([reverse.reverse(admin.id, a.id, reasonGiven), reverse.reverse(admin.id, a.id, reasonGiven)]);
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(0);
    expect(s.fulfilled[0]!.value).toEqual(s.fulfilled[1]!.value);
    await expect(prisma.pointsTransaction.count({ where: { refType: 'RECYCLE_REVERSED', refId: a.id } })).resolves.toBe(1);
    await expect(prisma.wasteEvent.count({ where: { requestId: a.id, kind: 'POINTS_REVERSED' } })).resolves.toBe(1);
  });

  it('reverse then expiry cron', async () => {
    const { c, a } = await expiredLotCustomer();
    const results = await raceWithHold(prisma, userRow(c.id), () => reverse.reverse(admin.id, a.id, reasonGiven), () => expiry.expirePoints());
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: { pointsTaken: 30_000 } });
    expect(results[1].status).toBe('fulfilled');
    await expect(balance(c.id)).resolves.toBe(20_000);
    await expect(prisma.pointsTransaction.count({ where: { userId: c.id, reason: 'POINTS_EXPIRED' } })).resolves.toBe(0);
  });

  it('expiry cron then reverse', async () => {
    const { c, a } = await expiredLotCustomer();
    const results = await raceWithHold(prisma, userRow(c.id), () => expiry.expirePoints(), () => reverse.reverse(admin.id, a.id, reasonGiven));
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: { pointsTaken: 0, shortfallPoints: 30_000 } });
    await expect(prisma.pointsTransaction.count({ where: { refType: 'RECYCLE_REVERSED', refId: a.id } })).resolves.toBe(0);
    await expect(balance(c.id)).resolves.toBe(20_000);
  });

  it('reverse × expiry cron Promise.all', async () => {
    const { c, a } = await expiredLotCustomer();
    const results = await Promise.allSettled([reverse.reverse(admin.id, a.id, reasonGiven), expiry.expirePoints()]);
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(0);
    await expect(balance(c.id)).resolves.toBe(20_000);
  });

  it('reverse after a partial spend takes the remainder', async () => {
    const c = await newCustomer();
    const a = await completed(c, 50_000);
    await spend(c.id, 35_000);
    const result = await reverse.reverse(admin.id, a.id, reasonGiven);
    expect(result).toEqual({ requestId: a.id, status: 'REVERSED', pointsTaken: 15_000, shortfallPoints: 35_000 });
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: a.id } })).resolves.toMatchObject({ reversalShortfallPoints: 35_000 });
    await expect(balance(c.id)).resolves.toBe(0);
  });

  it('reverse with nothing left writes no ledger row', async () => {
    const c = await newCustomer();
    const a = await completed(c, 10_000);
    await spend(c.id, 10_000);
    const result = await reverse.reverse(admin.id, a.id, reasonGiven);
    expect(result).toMatchObject({ pointsTaken: 0, status: 'REVERSED' });
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: a.id } })).resolves.toMatchObject({ status: 'REVERSED' });
    await expect(prisma.pointsTransaction.count({ where: { refType: 'RECYCLE_REVERSED', refId: a.id } })).resolves.toBe(0);
  });
});
