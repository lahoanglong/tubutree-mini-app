import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { SystemConfig } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { WasteAccessService } from '../../src/modules/waste-exchange/core/waste-access.service';
import { WasteConfigService } from '../../src/modules/waste-exchange/core/waste-config.service';
import { WasteHoldService } from '../../src/modules/waste-exchange/core/waste-hold.service';
import { WasteNotifierService } from '../../src/modules/waste-exchange/core/waste-notifier.service';
import { WasteShipLockService } from '../../src/modules/waste-exchange/core/waste-ship-lock.service';
import { WasteAdminRequestsService } from '../../src/modules/waste-exchange/receiving/waste-admin-requests.service';
import { createUser, deleteItData, randCode, setConfig, summarize, warmPool } from './helpers';
import { cleanupWaste, createWarehouse, createWasteItem, createWasteRequest } from './fixtures/waste-fixtures';

const CONFIG_KEYS = ['waste.enabled', 'loyalty.point_expire_months', 'waste.in_transit_review_days'];
const DAY = 86_400_000;

let moduleRef: TestingModule;
let prisma: PrismaService;
let service: WasteAdminRequestsService;
let savedConfig: SystemConfig[];
let staff: { id: string };
let adminA: { id: string };
let adminB: { id: string };
let warehouse: Awaited<ReturnType<typeof createWarehouse>>;
let itemId: string;
const userIds: string[] = [];
const reg = { pointIds: [] as string[], itemIds: [] as string[], storefrontIds: [] as string[] };

const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

async function newCustomer() {
  const u = await createUser(prisma, { phone: phone() });
  userIds.push(u.id);
  return u;
}

const mailIn = (userId: string, status: 'RECEIVED' | 'IN_TRANSIT' | 'REJECTED') =>
  createWasteRequest(prisma, { userId, method: 'MAIL_IN', status, pointId: warehouse.id, lines: [{ itemId, declaredQty: 10 }] });

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [PrismaModule],
    providers: [
      SystemConfigService,
      RewardPointsService,
      WasteConfigService,
      WasteAccessService,
      WasteHoldService,
      WasteShipLockService,
      WasteAdminRequestsService,
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
    ],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  service = moduleRef.get(WasteAdminRequestsService);
  await warmPool(prisma);
  savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
  await setConfig(prisma, 'waste.enabled', true);
  await setConfig(prisma, 'loyalty.point_expire_months', 12);
  await setConfig(prisma, 'waste.in_transit_review_days', 30);
  (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();

  staff = await createUser(prisma, { role: 'STAFF', phone: phone() });
  adminA = await createUser(prisma, { role: 'ADMIN', phone: phone() });
  adminB = await createUser(prisma, { role: 'ADMIN', phone: phone() });
  userIds.push(staff.id, adminA.id, adminB.id);
  warehouse = await createWarehouse(prisma);
  const item = await createWasteItem(prisma, { unitsPerPoint: 1, pointsPerGroup: 1000 });
  itemId = item.id;
  reg.itemIds.push(item.id);
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

describe('WasteAdminRequestsService races (real Postgres)', () => {
  it('queue keyset pages cover every row once in createdAt order', async () => {
    const c = await newCustomer();
    const base = Date.now() - 3_600_000;
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await mailIn(c.id, 'RECEIVED');
      await prisma.wasteRequest.update({ where: { id: r.id }, data: { createdAt: new Date(base + i * 1000) } });
      created.push(r.id);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 1000; page++) {
      const out = await service.queue(adminA.id, { filter: 'TO_COUNT', limit: 2, cursor });
      seen.push(...out.rows.map((r) => r.id));
      if (out.nextCursor === null) break;
      cursor = out.nextCursor;
    }
    expect(seen.filter((id) => created.includes(id))).toEqual(created);
  });

  it('TRANSIT_OVERDUE uses inTransitAt, not updatedAt', async () => {
    const c = await newCustomer();
    const overdue = await mailIn(c.id, 'IN_TRANSIT');
    const recent = await mailIn(c.id, 'IN_TRANSIT');
    await prisma.wasteRequest.update({ where: { id: overdue.id }, data: { inTransitAt: new Date(Date.now() - 31 * DAY) } });
    await prisma.wasteRequest.update({ where: { id: recent.id }, data: { inTransitAt: new Date(Date.now() - 5 * DAY) } });
    const out = await service.queue(adminA.id, { filter: 'TRANSIT_OVERDUE', userId: c.id });
    expect(out.rows.map((r) => r.id)).toEqual([overdue.id]);
  });

  it('setFlags × setFlags Promise.all on a customer without a row', async () => {
    const c = await newCustomer();
    const pickup = await createWasteRequest(prisma, { userId: c.id, method: 'PICKUP', status: 'OPEN', pointId: warehouse.id, lines: [{ itemId, declaredQty: 10 }] });
    const results = await Promise.allSettled([
      service.setFlags(adminA.id, c.id, { shipLocked: true, reason: 'nghi ngờ A' }),
      service.setFlags(adminB.id, c.id, { shipLocked: true, reason: 'nghi ngờ B' }),
    ]);
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(0);
    expect(await prisma.wasteUserFlags.count({ where: { userId: c.id } })).toBe(1);
    expect((await prisma.wasteUserFlags.findUniqueOrThrow({ where: { userId: c.id } })).shipLockedAt).not.toBeNull();
    expect(await prisma.wasteEvent.count({ where: { kind: 'USER_FLAGS_UPDATED', meta: { path: ['subjectUserId'], equals: c.id } } })).toBe(1);
    expect((await prisma.wasteRequest.findUniqueOrThrow({ where: { id: pickup.id } })).status).toBe('OPEN');
  });

  it('unlock then the shortfall query does not re-lock at once', async () => {
    const c = await newCustomer();
    const yesterday = new Date(Date.now() - DAY);
    for (let i = 0; i < 3; i++) {
      const r = await mailIn(c.id, 'REJECTED');
      await prisma.wasteRequest.update({ where: { id: r.id }, data: { closedAt: new Date(yesterday.getTime() + i * 1000) } });
    }
    await prisma.wasteUserFlags.create({ data: { userId: c.id, shipLockedAt: new Date() } });
    const shipLock = moduleRef.get(WasteShipLockService);
    await expect(shipLock.shouldLock(prisma, c.id, 50, 3)).resolves.toBe(true);
    await service.setFlags(adminA.id, c.id, { shipLocked: false, reason: 'mở khoá' });
    await expect(shipLock.shouldLock(prisma, c.id, 50, 3)).resolves.toBe(false);
  });

  it('setCost × setCost Promise.all', async () => {
    const c = await newCustomer();
    const r = await mailIn(c.id, 'RECEIVED');
    const results = await Promise.allSettled([
      service.setCost(adminA.id, r.id, { carrierCostVnd: 30_000 }),
      service.setCost(adminB.id, r.id, { carrierCostVnd: 40_000 }),
    ]);
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(0);
    expect([30_000, 40_000]).toContain((await prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } })).carrierCostVnd);
    const events = await prisma.wasteEvent.findMany({ where: { requestId: r.id, kind: 'REQUEST_COST_UPDATED' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(events).toHaveLength(2);
    const meta = (i: number) => events[i]!.meta as { before: { carrierCostVnd: number | null }; after: { carrierCostVnd: number | null } };
    expect(meta(1).before.carrierCostVnd).toBe(meta(0).after.carrierCostVnd);
  });

  it('lookup by shared tracking returns both unclosed requests with trackingConflict', async () => {
    const tracking = `IT${randCode(10)}`.toUpperCase();
    const a = await mailIn((await newCustomer()).id, 'IN_TRANSIT');
    const b = await mailIn((await newCustomer()).id, 'IN_TRANSIT');
    for (const r of [a, b]) {
      await prisma.wasteRequest.update({
        where: { id: r.id },
        data: { carrier: 'GHN', trackingCode: tracking, trackingNorm: tracking, trackingConflict: true, inTransitAt: new Date() },
      });
    }
    const rows = await service.lookup(staff.id, tracking);
    expect(rows.filter((x) => [a.id, b.id].includes(x.id)).map((x) => x.trackingConflict)).toEqual([true, true]);
  });
});
