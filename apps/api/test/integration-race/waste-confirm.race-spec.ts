import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, type SystemConfig } from '@prisma/client';
import type { WasteConfirmResultDTO } from '@tubutree/shared-types';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { vnMonthKey } from '../../src/common/vn-time';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { WasteAccessService } from '../../src/modules/waste-exchange/core/waste-access.service';
import { WasteConfigService } from '../../src/modules/waste-exchange/core/waste-config.service';
import { WasteHoldService } from '../../src/modules/waste-exchange/core/waste-hold.service';
import { WasteNotifierService } from '../../src/modules/waste-exchange/core/waste-notifier.service';
import { WasteShipLockService } from '../../src/modules/waste-exchange/core/waste-ship-lock.service';
import { WasteConfirmService, type WasteStaffCall } from '../../src/modules/waste-exchange/receiving/waste-confirm.service';
import { pointUsage } from '../../src/modules/waste-exchange/receiving/waste-quota';
import { lockWasteCustomer } from '../../src/modules/waste-exchange/waste-locks';
import { createUser, setConfig, summarize, warmPool, deleteItData } from './helpers';
import {
  blockedBackends,
  cleanupWaste,
  createWarehouse,
  createWasteItem,
  createWastePoint,
  createWasteRequest,
  holdFirstCall,
  raceWithHold,
  waitUntil,
} from './fixtures/waste-fixtures';

const CONFIG_KEYS = ['waste.enabled', 'loyalty.point_expire_months', 'waste.staff_daily_cap_points'];
const DIFFERENT_FIGURES = 'Yêu cầu đã được xác nhận với số liệu khác';
const NOT_CONFIRMABLE = 'Yêu cầu không ở trạng thái xác nhận được';

let moduleRef: TestingModule;
let prisma: PrismaService;
let confirmSvc: WasteConfirmService;
let savedConfig: SystemConfig[];
let item: Awaited<ReturnType<typeof createWasteItem>>;
let warehouse: Awaited<ReturnType<typeof createWarehouse>>;
let staffA: { id: string };
let staffB: { id: string };
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
const body = (declaredQty: number, receivedQty = declaredQty) => ({ lines: [{ itemId: item.id, declaredQty, receivedQty }] });

async function newUser(data: Parameters<typeof createUser>[1] = {}) {
  const u = await createUser(prisma, { phone: phone(), ...data });
  userIds.push(u.id);
  return u;
}

async function newPartnerPoint(ownerId: string) {
  const point = await createWastePoint(prisma, { kind: 'PARTNER', ownerUserId: ownerId, quota: 100_000, itemIds: [item.id] });
  reg.pointIds.push(point.id);
  if (point.createdStorefront && point.ownerStorefrontId) reg.storefrontIds.push(point.ownerStorefrontId);
  return point;
}

async function mailInReceived(userId: string, declaredQty: number) {
  return createWasteRequest(prisma, {
    userId,
    method: 'MAIL_IN',
    status: 'RECEIVED',
    pointId: warehouse.id,
    lines: [{ itemId: item.id, declaredQty }],
  });
}

async function dropOffOpen(userId: string, pointId: string, declaredQty: number) {
  return createWasteRequest(prisma, {
    userId,
    method: 'DROP_OFF',
    status: 'OPEN',
    pointId,
    lines: [{ itemId: item.id, declaredQty }],
  });
}

/** A holds the request row paused inside `grant`; B starts and queues; A is released. Returns [A, B] outcomes. */
async function heldPair<A, B>(startA: () => Promise<A>, startB: () => Promise<B>) {
  const h = holdFirstCall(moduleRef.get(RewardPointsService), 'grant');
  try {
    const pA = startA();
    pA.catch(() => undefined);
    await h.reached;
    let bSettled = false;
    const pB = startB().finally(() => {
      bSettled = true;
    });
    pB.catch(() => undefined);
    await waitUntil(async () => bSettled || (await blockedBackends(prisma)) >= 1, 'B queued behind A');
    h.release();
    return await Promise.allSettled([pA, pB]);
  } finally {
    h.release();
    h.restore();
  }
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
  confirmSvc = moduleRef.get(WasteConfirmService);
  await warmPool(prisma);
  savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
  await setConfig(prisma, 'waste.enabled', true);
  await setConfig(prisma, 'loyalty.point_expire_months', 12);
  await setConfig(prisma, 'waste.staff_daily_cap_points', 1_000_000);
  clearConfigCache();

  warehouse = await createWarehouse(prisma);
  item = await createWasteItem(prisma, { unitsPerPoint: 1, pointsPerGroup: 1000 });
  reg.itemIds.push(item.id);
  staffA = await newUser({ role: 'STAFF' });
  staffB = await newUser({ role: 'STAFF' });
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

describe('WasteConfirmService races (real Postgres)', () => {
  it('confirm(A) then confirm(B) on one request grants once', async () => {
    const customer = await newUser();
    const r = await mailInReceived(customer.id, 10);
    const results = await heldPair(
      () => confirmSvc.confirm(call(staffA.id, r.id, 'ADMIN'), body(10)),
      () => confirmSvc.confirm(call(staffB.id, r.id, 'ADMIN'), body(10)),
    );
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: expect.objectContaining({ pointsAwarded: 10_000 }) });
    expect(results[1].status).toBe('rejected');
    expect(s.errors[0]).toContain(DIFFERENT_FIGURES);
    await expect(prisma.pointsTransaction.count({ where: { refType: 'RECYCLE', refId: r.id } })).resolves.toBe(1);
    await expect(prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).resolves.toMatchObject({ pointsBalance: 10_000 });
  });

  it('confirm(B) then confirm(A) on one request grants once', async () => {
    const customer = await newUser();
    const r = await mailInReceived(customer.id, 10);
    const results = await heldPair(
      () => confirmSvc.confirm(call(staffB.id, r.id, 'ADMIN'), body(10)),
      () => confirmSvc.confirm(call(staffA.id, r.id, 'ADMIN'), body(10)),
    );
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: expect.objectContaining({ pointsAwarded: 10_000 }) });
    expect(results[1].status).toBe('rejected');
    expect(s.errors[0]).toContain(DIFFERENT_FIGURES);
    await expect(prisma.pointsTransaction.count({ where: { refType: 'RECYCLE', refId: r.id } })).resolves.toBe(1);
    await expect(prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).resolves.toMatchObject({ pointsBalance: 10_000 });
  });

  it('confirm × confirm Promise.all by the same staff with the same figures', async () => {
    const customer = await newUser();
    const r = await mailInReceived(customer.id, 10);
    const results = await Promise.allSettled([
      confirmSvc.confirm(call(staffA.id, r.id, 'ADMIN'), body(10)),
      confirmSvc.confirm(call(staffA.id, r.id, 'ADMIN'), body(10)),
    ]);
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(0);
    const [a, b] = s.fulfilled.map((f) => f.value as WasteConfirmResultDTO);
    expect(a).toEqual(b);
    await expect(prisma.pointsTransaction.count({ where: { refType: 'RECYCLE', refId: r.id } })).resolves.toBe(1);
    await expect(prisma.wasteEvent.count({ where: { requestId: r.id, kind: 'REQUEST_CONFIRMED' } })).resolves.toBe(1);
  });

  it('five confirms at the PARTNER quota edge never exceed the quota', async () => {
    const owner = await newUser();
    const point = await newPartnerPoint(owner.id);
    const colleagues = [await newUser(), await newUser()];
    for (const c of colleagues) {
      await prisma.wastePointStaff.create({ data: { pointId: point.id, userId: c.id, role: 'STAFF', isActive: true } });
    }
    const people = [owner, colleagues[0]!, colleagues[1]!];
    const customers = await Promise.all(Array.from({ length: 5 }, () => newUser()));
    const requests = await Promise.all(customers.map((c) => dropOffOpen(c.id, point.id, 30)));
    const results = await Promise.allSettled(
      requests.map((r, i) => confirmSvc.confirm(call(people[i % 3]!.id, r.id, 'DESK'), body(30))),
    );
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.fulfilled).toHaveLength(3);
    expect(s.rejected).toHaveLength(2);
    for (const e of s.errors) expect(e).toContain('Điểm đã hết hạn mức tháng, còn 10.000 điểm');
    await expect(pointUsage(prisma, point.id, vnMonthKey())).resolves.toEqual({ pointsUsed: 90_000, confirmations: 3 });
    const ledger = await prisma.pointsTransaction.aggregate({
      _sum: { delta: true },
      where: { refType: 'RECYCLE', refId: { in: requests.map((r) => r.id) } },
    });
    expect(ledger._sum.delta).toBe(90_000);
  });

  it('two confirms by one staff near the daily cap: one 409', async () => {
    const capStaff = await newUser({ role: 'STAFF' });
    const customers = [await newUser(), await newUser()];
    const requests = await Promise.all(customers.map((c) => mailInReceived(c.id, 10)));
    await setConfig(prisma, 'waste.staff_daily_cap_points', 15_000);
    clearConfigCache();
    try {
      const results = await Promise.allSettled(requests.map((r) => confirmSvc.confirm(call(capStaff.id, r.id, 'ADMIN'), body(10))));
      const s = summarize(results);
      expect(s.errors.join()).not.toMatch(/40P01|P2034/);
      expect(s.fulfilled).toHaveLength(1);
      expect(s.rejected).toHaveLength(1);
      expect(s.errors[0]).toContain('Bạn đã chạm trần điểm xác nhận hôm nay');
    } finally {
      await setConfig(prisma, 'waste.staff_daily_cap_points', 1_000_000);
      clearConfigCache();
    }
  });

  it('customer-lock edit then confirm (class 731001 × 731003)', async () => {
    const owner = await newUser();
    const point = await newPartnerPoint(owner.id);
    const customer = await newUser();
    const r = await dropOffOpen(customer.id, point.id, 10);

    let locked!: () => void;
    const editLocked = new Promise<void>((res) => (locked = res));
    let open!: () => void;
    const gate = new Promise<void>((res) => (open = res));
    const pEdit = prisma.$transaction(
      async (tx) => {
        await lockWasteCustomer(tx, customer.id);
        await tx.$queryRaw`SELECT "id" FROM "waste_requests" WHERE "id" = ${r.id} FOR UPDATE`;
        await tx.wasteRequestLine.updateMany({ where: { requestId: r.id }, data: { declaredQty: 9 } });
        locked();
        await gate;
      },
      { timeout: 30_000 },
    );
    pEdit.catch(() => undefined);
    await editLocked;

    let cSettled = false;
    const pConfirm = confirmSvc.confirm(call(owner.id, r.id, 'DESK'), body(10)).finally(() => {
      cSettled = true;
    });
    pConfirm.catch(() => undefined);
    await waitUntil(async () => cSettled || (await blockedBackends(prisma)) >= 1, 'confirm queued behind the edit');
    open();
    const results = await Promise.allSettled([pEdit, pConfirm]);
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(s.errors[0]).toContain('Khách vừa sửa yêu cầu, vui lòng tra lại mã');
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ status: 'OPEN' });
    await expect(prisma.pointsTransaction.count({ where: { refType: 'RECYCLE', refId: r.id } })).resolves.toBe(0);
  });

  it('confirm then customer-lock edit (class 731003 × 731001)', async () => {
    const owner = await newUser();
    const point = await newPartnerPoint(owner.id);
    const customer = await newUser();
    const r = await dropOffOpen(customer.id, point.id, 10);

    const results = await heldPair(
      () => confirmSvc.confirm(call(owner.id, r.id, 'DESK'), body(10)),
      () =>
        prisma.$transaction(
          async (tx) => {
            await lockWasteCustomer(tx, customer.id);
            await tx.$queryRaw`SELECT "id" FROM "waste_requests" WHERE "id" = ${r.id} FOR UPDATE`;
            const row = await tx.wasteRequest.findUniqueOrThrow({ where: { id: r.id }, select: { status: true } });
            if (row.status !== 'OPEN') throw new Error('NOT_OPEN');
          },
          { timeout: 30_000 },
        ),
    );
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: expect.objectContaining({ pointsAwarded: 10_000 }) });
    expect(results[1].status).toBe('rejected');
    expect(s.errors[0]).toContain('NOT_OPEN');
  });

  it('reject(A) then confirm(B) on one MAIL_IN RECEIVED request', async () => {
    const customer = await newUser();
    const r = await mailInReceived(customer.id, 10);
    const [a2, b2] = [await newUser({ role: 'STAFF' }), await newUser({ role: 'STAFF' })];
    const lockSql = Prisma.sql`SELECT "id" FROM "waste_requests" WHERE "id" = ${r.id} FOR UPDATE`;
    const results = await raceWithHold(
      prisma,
      lockSql,
      () => confirmSvc.reject(call(a2.id, r.id, 'ADMIN'), { rejectionReason: 'WET' }),
      () => confirmSvc.confirm(call(b2.id, r.id, 'ADMIN'), body(10)),
    );
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: { requestId: r.id, status: 'REJECTED' } });
    expect(results[1].status).toBe('rejected');
    expect(s.errors[0]).toContain(NOT_CONFIRMABLE);
    await expect(prisma.pointsTransaction.count({ where: { refType: 'RECYCLE', refId: r.id } })).resolves.toBe(0);
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ status: 'REJECTED', confirmedByUserId: a2.id });
  });

  it('confirm(B) then reject(A) on one MAIL_IN RECEIVED request', async () => {
    const customer = await newUser();
    const r = await mailInReceived(customer.id, 10);
    const [a2, b2] = [await newUser({ role: 'STAFF' }), await newUser({ role: 'STAFF' })];
    const lockSql = Prisma.sql`SELECT "id" FROM "waste_requests" WHERE "id" = ${r.id} FOR UPDATE`;
    const results = await raceWithHold(
      prisma,
      lockSql,
      () => confirmSvc.confirm(call(b2.id, r.id, 'ADMIN'), body(10)),
      () => confirmSvc.reject(call(a2.id, r.id, 'ADMIN'), { rejectionReason: 'WET' }),
    );
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: expect.objectContaining({ status: 'COMPLETED', pointsAwarded: 10_000 }) });
    expect(results[1].status).toBe('rejected');
    expect(s.errors[0]).toContain(NOT_CONFIRMABLE);
    await expect(prisma.pointsTransaction.count({ where: { refType: 'RECYCLE', refId: r.id } })).resolves.toBe(1);
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ status: 'COMPLETED', confirmedByUserId: b2.id });
  });
});
