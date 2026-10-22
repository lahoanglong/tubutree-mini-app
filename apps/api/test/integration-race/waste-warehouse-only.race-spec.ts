jest.mock('../../src/modules/integrations/gomdon/gomdon-config', () => ({
  ...jest.requireActual('../../src/modules/integrations/gomdon/gomdon-config'),
  isGomdonRecyclingEnabled: jest.fn().mockResolvedValue(true),
}));

import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { SystemConfig } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { WasteAdminPointsService } from '../../src/modules/waste-exchange/catalog/waste-admin-points.service';
import { WasteAccessService } from '../../src/modules/waste-exchange/core/waste-access.service';
import { WasteConfigService } from '../../src/modules/waste-exchange/core/waste-config.service';
import { WasteHoldService } from '../../src/modules/waste-exchange/core/waste-hold.service';
import { WasteNotifierService } from '../../src/modules/waste-exchange/core/waste-notifier.service';
import { WasteShipLockService } from '../../src/modules/waste-exchange/core/waste-ship-lock.service';
import { WasteRequestsService } from '../../src/modules/waste-exchange/customer/waste-requests.service';
import { WasteConfirmService, type WasteStaffCall } from '../../src/modules/waste-exchange/receiving/waste-confirm.service';
import { createUser, deleteItData, setConfig, warmPool } from './helpers';
import { cleanupWaste, createWarehouse, createWasteItem, createWastePoint, createWasteRequest } from './fixtures/waste-fixtures';

const CONFIG_KEYS = ['waste.enabled', 'loyalty.point_expire_months', 'waste.staff_daily_cap_points'];

let moduleRef: TestingModule;
let prisma: PrismaService;
let confirmSvc: WasteConfirmService;
let requestsSvc: WasteRequestsService;
let adminPointsSvc: WasteAdminPointsService;
let savedConfig: SystemConfig[];
let milk: Awaited<ReturnType<typeof createWasteItem>>;
let carton: Awaited<ReturnType<typeof createWasteItem>>;
let warehouse: Awaited<ReturnType<typeof createWarehouse>>;
let admin: { id: string };
const userIds: string[] = [];
const reg = { pointIds: [] as string[], itemIds: [] as string[], storefrontIds: [] as string[] };

const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
const clearConfigCache = () => (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();
const call = (staffId: string, requestId: string, route: 'DESK' | 'ADMIN'): WasteStaffCall => ({
  callerUserId: staffId,
  requestId,
  route,
  device: { ip: '127.0.0.0', userAgent: 'race' },
});
const lineBody = (itemId: string, qty: number) => ({ lines: [{ itemId, declaredQty: qty, receivedQty: qty }] });

async function newUser(data: Parameters<typeof createUser>[1] = {}) {
  const u = await createUser(prisma, { phone: phone(), ...data });
  userIds.push(u.id);
  return u;
}

/** A partner point the way a database that predates the rule can hold it: linked straight to a warehouse-only item. */
async function legacyPartnerPoint(ownerId: string, itemIds: string[]) {
  const point = await createWastePoint(prisma, { kind: 'PARTNER', ownerUserId: ownerId, quota: 100_000, itemIds });
  reg.pointIds.push(point.id);
  if (point.createdStorefront && point.ownerStorefrontId) reg.storefrontIds.push(point.ownerStorefrontId);
  return point;
}

/** What the ledger of one customer says right now; a blocked call must leave it exactly as it was. */
async function ledgerOf(userId: string, pointId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } });
  const [entries, usage, events, drops] = await Promise.all([
    prisma.pointsTransaction.count({ where: { userId } }),
    prisma.wastePointUsage.findMany({ where: { pointId }, select: { monthKey: true, pointsUsed: true, confirmations: true } }),
    prisma.wasteEvent.count({ where: { pointId, kind: 'REQUEST_CONFIRMED' } }),
    prisma.gameProfile.findUnique({ where: { userId }, select: { totalSeeds: true } }),
  ]);
  return { balance: user.pointsBalance, entries, usage, confirmedEvents: events, seeds: drops?.totalSeeds ?? null };
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
      WasteRequestsService,
      WasteAdminPointsService,
      {
        provide: WasteNotifierService,
        useValue: {
          pointsCredited: jest.fn().mockResolvedValue(undefined),
          requestRejected: jest.fn().mockResolvedValue(undefined),
          perkReviewed: jest.fn().mockResolvedValue(undefined),
        },
      },
      { provide: NotificationsService, useValue: { notify: async () => undefined } },
      { provide: WasteShipLockService, useValue: { evaluateAndLock: jest.fn().mockResolvedValue({ locked: false, shipLockedAt: null, cancelledRequestIds: [] }) } },
    ],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  confirmSvc = moduleRef.get(WasteConfirmService);
  requestsSvc = moduleRef.get(WasteRequestsService);
  adminPointsSvc = moduleRef.get(WasteAdminPointsService);
  await warmPool(prisma);
  savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
  await setConfig(prisma, 'waste.enabled', true);
  await setConfig(prisma, 'loyalty.point_expire_months', 12);
  await setConfig(prisma, 'waste.staff_daily_cap_points', 1_000_000);
  clearConfigCache();

  warehouse = await createWarehouse(prisma);
  milk = await createWasteItem(prisma, { unitsPerPoint: 5, pointsPerGroup: 1000, warehouseOnly: true, dailyCapQty: null, monthlyCapQty: null });
  carton = await createWasteItem(prisma, { unitsPerPoint: 1, pointsPerGroup: 1000, dailyCapQty: null, monthlyCapQty: null });
  reg.itemIds.push(milk.id, carton.id);
  admin = await newUser({ role: 'ADMIN' });
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

const addr = { addressLine: '1 IT', provinceCode: '79', provinceName: 'TP.HCM', communeCode: 'IT', communeName: 'IT' };

describe('warehouse-only items (real Postgres)', () => {
  it('the migration flags the seeded milk carton and Tubu bottle, and nothing else', async () => {
    const rows = await prisma.wasteItem.findMany({ where: { warehouseOnly: true, id: { in: ['wi-carton', 'wi-bubble-wrap', 'wi-milk-carton', 'wi-tubu-bottle', 'wi-battery'] } } });
    expect(rows.map((r) => r.code).sort()).toEqual(['MILK_CARTON', 'TUBU_BOTTLE']);
  });

  it('a PARTNER point cannot be saved with the item: 400, and no point or link row appears', async () => {
    const before = await prisma.wastePointItem.count({ where: { itemId: milk.id } });
    const name = `IT điểm wh-only ${randomInt(1e9)}`;
    await expect(
      adminPointsSvc.create(admin.id, { kind: 'PARTNER', name, ...addr, monthlyQuotaPoints: 100_000, itemIds: [carton.id, milk.id] }),
    ).rejects.toThrow('Điểm đại lý không nhận:');
    await expect(prisma.wastePoint.count({ where: { name } })).resolves.toBe(0);

    const owner = await newUser();
    const point = await legacyPartnerPoint(owner.id, [carton.id]);
    await expect(adminPointsSvc.update(admin.id, point.id, { itemIds: [carton.id, milk.id] })).rejects.toThrow('Điểm đại lý không nhận:');
    await expect(prisma.wastePointItem.findMany({ where: { pointId: point.id }, select: { itemId: true } })).resolves.toEqual([{ itemId: carton.id }]);
    await expect(prisma.wastePointItem.count({ where: { itemId: milk.id } })).resolves.toBe(before);
  });

  it('a PARTNER point still accepts a normal item', async () => {
    const owner = await newUser();
    const point = await legacyPartnerPoint(owner.id, []);
    await expect(adminPointsSvc.update(admin.id, point.id, { itemIds: [carton.id] })).resolves.toMatchObject({ acceptedItemIds: [carton.id] });
  });

  it('the warehouse can be saved with the item', async () => {
    await expect(adminPointsSvc.update(admin.id, warehouse.id, { itemIds: [carton.id, milk.id] })).resolves.toMatchObject({ kind: 'WAREHOUSE' });
    await adminPointsSvc.update(admin.id, warehouse.id, { itemIds: [] });
  });

  it('a customer cannot hold a request for the item at a point that is still linked to it', async () => {
    const owner = await newUser();
    const point = await legacyPartnerPoint(owner.id, [carton.id, milk.id]);
    const customer = await newUser();
    await expect(
      requestsSvc.create(customer.id, `it-${randomInt(1e9)}`, { method: 'DROP_OFF', pointId: point.id, lines: [{ itemId: milk.id, declaredQty: 50 }], consent: true }),
    ).rejects.toThrow('Điểm nhận này không nhận:');
    await expect(prisma.wasteRequest.count({ where: { userId: customer.id } })).resolves.toBe(0);
  });

  it('desk confirm of a request that predates the rule is refused and the ledger does not move', async () => {
    const owner = await newUser();
    const point = await legacyPartnerPoint(owner.id, [carton.id, milk.id]);
    const customer = await newUser();
    const r = await createWasteRequest(prisma, { userId: customer.id, method: 'DROP_OFF', status: 'OPEN', pointId: point.id, lines: [{ itemId: milk.id, declaredQty: 50 }] });
    const before = await ledgerOf(customer.id, point.id);

    await expect(confirmSvc.confirm(call(owner.id, r.id, 'DESK'), lineBody(milk.id, 50))).rejects.toThrow('Điểm đại lý không xác nhận được món chỉ kho Tubu HCMC nhận');

    await expect(ledgerOf(customer.id, point.id)).resolves.toEqual(before);
    await expect(prisma.pointsTransaction.count({ where: { refType: 'RECYCLE', refId: r.id } })).resolves.toBe(0);
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ status: 'OPEN', pointsAwarded: null });
    expect(before.balance).toBe(0);
  });

  it('control: the same point still confirms a normal item and credits the ledger, and the warehouse credits the milk carton', async () => {
    const owner = await newUser();
    const point = await legacyPartnerPoint(owner.id, [carton.id, milk.id]);
    const customer = await newUser();
    const ok = await createWasteRequest(prisma, { userId: customer.id, method: 'DROP_OFF', status: 'OPEN', pointId: point.id, lines: [{ itemId: carton.id, declaredQty: 10 }] });
    await expect(confirmSvc.confirm(call(owner.id, ok.id, 'DESK'), lineBody(carton.id, 10))).resolves.toMatchObject({ pointsAwarded: 10_000 });
    await expect(prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).resolves.toMatchObject({ pointsBalance: 10_000 });

    const staff = await newUser({ role: 'STAFF' });
    const buyer = await newUser();
    const mail = await createWasteRequest(prisma, { userId: buyer.id, method: 'MAIL_IN', status: 'RECEIVED', pointId: warehouse.id, lines: [{ itemId: milk.id, declaredQty: 50 }] });
    await expect(confirmSvc.confirm(call(staff.id, mail.id, 'ADMIN'), lineBody(milk.id, 50))).resolves.toMatchObject({ pointsAwarded: 10_000 });
    await expect(prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).resolves.toMatchObject({ pointsBalance: 10_000 });
  });
});
