import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, type SystemConfig } from '@prisma/client';
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
import { WasteConfirmService, type WasteStaffCall } from '../../src/modules/waste-exchange/receiving/waste-confirm.service';
import { WasteReceiveService } from '../../src/modules/waste-exchange/receiving/waste-receive.service';
import { createUser, setConfig, summarize, warmPool, deleteItData } from './helpers';
import { cleanupWaste, createWarehouse, createWasteItem, createWasteRequest, raceWithHold } from './fixtures/waste-fixtures';

const CONFIG_KEYS = ['waste.enabled', 'loyalty.point_expire_months'];

let moduleRef: TestingModule;
let prisma: PrismaService;
let receive: WasteReceiveService;
let confirm: WasteConfirmService;
let savedConfig: SystemConfig[];
let item: Awaited<ReturnType<typeof createWasteItem>>;
let wh: Awaited<ReturnType<typeof createWarehouse>>;
let staffA: { id: string };
let staffB: { id: string };
let cust: { id: string };
const userIds: string[] = [];
const reg = { pointIds: [] as string[], itemIds: [] as string[], storefrontIds: [] as string[] };

const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
const clearConfigCache = () => (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();
const call = (staffId: string, requestId: string) => ({
  callerUserId: staffId,
  requestId,
  route: 'ADMIN' as const,
  device: { ip: '127.0.0.0', userAgent: 'race' },
}) satisfies WasteStaffCall;

async function newUser(data: Parameters<typeof createUser>[1] = {}) {
  const u = await createUser(prisma, { phone: phone(), ...data });
  userIds.push(u.id);
  return u;
}

function inTransit(userId: string) {
  return createWasteRequest(prisma, {
    userId,
    method: 'MAIL_IN',
    status: 'IN_TRANSIT',
    pointId: wh.id,
    lines: [{ itemId: item.id, declaredQty: 10 }],
  });
}

const eventCount = (requestId: string, kind: 'PARCEL_RECEIVED' | 'PARCEL_UNMATCHED' | 'UNMATCHED_RESOLVED') =>
  prisma.wasteEvent.count({ where: { requestId, kind } });
const unmatchedCount = (requestId: string) => prisma.wasteUnmatchedParcel.count({ where: { relatedRequestId: requestId } });

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
      WasteReceiveService,
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
  receive = moduleRef.get(WasteReceiveService);
  confirm = moduleRef.get(WasteConfirmService);
  await warmPool(prisma);
  savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
  await setConfig(prisma, 'waste.enabled', true);
  await setConfig(prisma, 'loyalty.point_expire_months', 12);
  clearConfigCache();

  wh = await createWarehouse(prisma);
  item = await createWasteItem(prisma, { unitsPerPoint: 1, pointsPerGroup: 1000 });
  reg.itemIds.push(item.id);
  staffA = await newUser({ role: 'STAFF' });
  staffB = await newUser({ role: 'STAFF' });
  cust = await newUser();
});

afterAll(async () => {
  if (prisma) {
    await prisma.wasteUnmatchedParcel.deleteMany({ where: { createdByUserId: { in: userIds } } });
    await cleanupWaste(prisma, reg);
    await deleteItData(prisma, { userIds });
    await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
    for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
  }
  await moduleRef?.close();
});

describe('WasteReceiveService races (real Postgres)', () => {
  it('receive then receive by the same staff (sequential) gives ALREADY_RECEIVED', async () => {
    const r = await inTransit(cust.id);
    const body = { match: { parcelCode: r.code } };
    expect((await receive.receive(staffA.id, r.id, body)).outcome).toBe('RECEIVED');
    expect((await receive.receive(staffA.id, r.id, body)).outcome).toBe('ALREADY_RECEIVED');
    await expect(eventCount(r.id, 'PARCEL_RECEIVED')).resolves.toBe(1);
    await expect(unmatchedCount(r.id)).resolves.toBe(0);
  });

  it('receive × receive Promise.all by the same staff', async () => {
    const r = await inTransit(cust.id);
    const body = { match: { parcelCode: r.code } };
    const results = await Promise.allSettled([receive.receive(staffA.id, r.id, body), receive.receive(staffA.id, r.id, body)]);
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(0);
    expect(s.fulfilled.map((f) => f.value.outcome).sort()).toEqual(['ALREADY_RECEIVED', 'RECEIVED']);
    await expect(eventCount(r.id, 'PARCEL_RECEIVED')).resolves.toBe(1);
    await expect(unmatchedCount(r.id)).resolves.toBe(0);
  });

  it('EXPIRED request: two concurrent receives create exactly one unmatched row', async () => {
    const r = await createWasteRequest(prisma, {
      userId: cust.id,
      method: 'MAIL_IN',
      status: 'EXPIRED',
      expiresAt: null,
      pointId: wh.id,
      lines: [{ itemId: item.id, declaredQty: 10 }],
    });
    await prisma.wasteRequest.update({ where: { id: r.id }, data: { closedAt: new Date(), closeReason: 'HOLD_EXPIRED' } });
    const body = { match: { parcelCode: r.code } };
    const results = await Promise.allSettled([receive.receive(staffA.id, r.id, body), receive.receive(staffA.id, r.id, body)]);
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(0);
    const [a, b] = s.fulfilled.map((f) => f.value);
    expect(a).toMatchObject({ outcome: 'UNMATCHED', reason: 'EXPIRED_REQUEST' });
    expect(b).toMatchObject({ outcome: 'UNMATCHED' });
    expect((a as { unmatchedId: string }).unmatchedId).toBe((b as { unmatchedId: string }).unmatchedId);
    await expect(unmatchedCount(r.id)).resolves.toBe(1);
    await expect(eventCount(r.id, 'PARCEL_UNMATCHED')).resolves.toBe(1);
  });

  it('receive by staff B after staff A received goes to unmatched', async () => {
    const r = await inTransit(cust.id);
    const body = { match: { parcelCode: r.code } };
    expect((await receive.receive(staffA.id, r.id, body)).outcome).toBe('RECEIVED');
    await expect(receive.receive(staffB.id, r.id, body)).resolves.toMatchObject({ outcome: 'UNMATCHED', reason: 'NOT_RECEIVABLE' });
    await expect(unmatchedCount(r.id)).resolves.toBe(1);
  });

  it('receive after 10 minutes by the same staff goes to unmatched', async () => {
    const r = await inTransit(cust.id);
    const body = { match: { parcelCode: r.code } };
    expect((await receive.receive(staffA.id, r.id, body)).outcome).toBe('RECEIVED');
    await prisma.wasteEvent.updateMany({
      where: { requestId: r.id, kind: 'PARCEL_RECEIVED' },
      data: { createdAt: new Date(Date.now() - 11 * 60_000) },
    });
    await expect(receive.receive(staffA.id, r.id, body)).resolves.toMatchObject({ outcome: 'UNMATCHED' });
    await expect(unmatchedCount(r.id)).resolves.toBe(1);
  });

  it('the unmatched row is committed before the route returns', async () => {
    const r = await inTransit(cust.id);
    const other = await inTransit((await newUser()).id);
    const res = await receive.receive(staffA.id, r.id, { match: { parcelCode: other.code } });
    expect(res).toMatchObject({ outcome: 'UNMATCHED', reason: 'TR_TRACKING_CONFLICT' });
    const row = await prisma.wasteUnmatchedParcel.findUnique({ where: { id: (res as { unmatchedId: string }).unmatchedId } });
    expect(row?.status).toBe('OPEN');
  });

  it('resolve × resolve by two staff matches once', async () => {
    const parcel = await receive.createUnmatched(staffA.id, { description: 'IT kiện lạ' });
    const r = await inTransit(cust.id);
    const resolveBody = { action: 'MATCH' as const, requestId: r.id, note: 'khớp tay' };
    const results = await Promise.allSettled([
      receive.resolveUnmatched(staffA.id, parcel.id, resolveBody),
      receive.resolveUnmatched(staffB.id, parcel.id, resolveBody),
    ]);
    const s = summarize(results);
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.fulfilled).toHaveLength(1);
    expect(s.rejected).toHaveLength(1);
    expect((s.rejected[0]!.reason as { getStatus: () => number }).getStatus()).toBe(409);
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ status: 'RECEIVED' });
    await expect(eventCount(r.id, 'UNMATCHED_RESOLVED')).resolves.toBe(1);
  });

  it.each(['receive then confirm', 'confirm then receive'])('%s', async (name) => {
    const r = await inTransit(cust.id);
    const doReceive = () => receive.receive(staffA.id, r.id, { match: { parcelCode: r.code } });
    const doConfirm = () =>
      confirm.confirm(call(staffB.id, r.id), {
        lines: [{ itemId: item.id, declaredQty: 10, receivedQty: 10 }],
        match: { parcelCode: r.code },
      });
    const lock = Prisma.sql`SELECT "id" FROM "waste_requests" WHERE "id" = ${r.id} FOR UPDATE`;
    const results =
      name === 'receive then confirm'
        ? await raceWithHold(prisma, lock, doReceive, doConfirm)
        : (await raceWithHold(prisma, lock, doConfirm, doReceive)).slice().reverse();
    const [rcv, cnf] = results as [PromiseSettledResult<Awaited<ReturnType<typeof doReceive>>>, PromiseSettledResult<Awaited<ReturnType<typeof doConfirm>>>];
    expect(summarize(results).errors.join()).not.toMatch(/40P01|P2034/);
    expect(cnf).toMatchObject({ status: 'fulfilled', value: expect.objectContaining({ status: 'COMPLETED' }) });
    if (name === 'receive then confirm') {
      expect(rcv).toMatchObject({ status: 'fulfilled', value: expect.objectContaining({ outcome: 'RECEIVED' }) });
    } else {
      expect(rcv).toMatchObject({ status: 'fulfilled', value: expect.objectContaining({ outcome: 'UNMATCHED', reason: 'NOT_RECEIVABLE' }) });
    }
  });

  it('receive then receive by the same staff with TRACKING_PHONE gives ALREADY_RECEIVED', async () => {
    const r = await createWasteRequest(prisma, { userId: cust.id, method: 'MAIL_IN', status: 'IN_TRANSIT', pointId: wh.id, lines: [{ itemId: item.id, declaredQty: 10 }] });
    const tr = `SPX${Date.now()}`;
    await prisma.wasteRequest.update({ where: { id: r.id }, data: { carrier: 'GHN', trackingCode: tr, trackingNorm: tr } });
    const body = { match: { phoneMatchConfirmed: true } };
    expect((await receive.receive(staffA.id, r.id, body)).outcome).toBe('RECEIVED');
    expect((await receive.receive(staffA.id, r.id, body)).outcome).toBe('ALREADY_RECEIVED');
    expect(await prisma.wasteUnmatchedParcel.count({ where: { relatedRequestId: r.id } })).toBe(0);
    expect(await prisma.wasteEvent.count({ where: { requestId: r.id, kind: 'PARCEL_RECEIVED' } })).toBe(1);
  });

  it('receive with waste.enabled false still receives an IN_TRANSIT MAIL_IN', async () => {
    const r = await inTransit(cust.id);
    await setConfig(prisma, 'waste.enabled', false);
    clearConfigCache();
    try {
      const res = await receive.receive(staffA.id, r.id, { match: { parcelCode: r.code } });
      expect(res.outcome).toBe('RECEIVED');
      await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ status: 'RECEIVED' });
      await expect(eventCount(r.id, 'PARCEL_RECEIVED')).resolves.toBe(1);
    } finally {
      await setConfig(prisma, 'waste.enabled', true);
      clearConfigCache();
    }
  });
});
