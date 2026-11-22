import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { SystemConfig } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { WasteAccessService } from '../../src/modules/waste-exchange/core/waste-access.service';
import { WasteConfigService } from '../../src/modules/waste-exchange/core/waste-config.service';
import { WasteHoldService } from '../../src/modules/waste-exchange/core/waste-hold.service';
import { WasteNotifierService } from '../../src/modules/waste-exchange/core/waste-notifier.service';
import { WasteShipLockService } from '../../src/modules/waste-exchange/core/waste-ship-lock.service';
import { WasteBulkActionService } from '../../src/modules/waste-exchange/receiving/waste-bulk-action.service';
import { BULK_TEXT, WASTE_BULK_AUDIT_ACTION } from '../../src/modules/waste-exchange/receiving/waste-bulk-action';
import { WasteConfirmService } from '../../src/modules/waste-exchange/receiving/waste-confirm.service';
import { WasteReceiveService } from '../../src/modules/waste-exchange/receiving/waste-receive.service';
import { createUser, deleteItData, setConfig, summarize, warmPool } from './helpers';
import { cleanupWaste, createWarehouse, createWasteItem, createWasteRequest } from './fixtures/waste-fixtures';

const CONFIG_KEYS = ['waste.enabled', 'loyalty.point_expire_months', 'waste.in_transit_review_days'];
const DAY = 86_400_000;

let moduleRef: TestingModule;
let prisma: PrismaService;
let bulk: WasteBulkActionService;
let receive: WasteReceiveService;
let savedConfig: SystemConfig[];
let item: Awaited<ReturnType<typeof createWasteItem>>;
let wh: Awaited<ReturnType<typeof createWarehouse>>;
let staffA: { id: string };
let staffB: { id: string };
let admin: { id: string };
let cust: { id: string; phone: string | null };
const userIds: string[] = [];
const reg = { pointIds: [] as string[], itemIds: [] as string[], storefrontIds: [] as string[] };
const notifier = {
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

const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
const tag = () => Array.from({ length: 10 }, () => 'ABCDEFGHJKMNPQRSTUVWYZ'[randomInt(0, 22)]).join('');
const clearConfigCache = () => (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();

async function newUser(data: Parameters<typeof createUser>[1] = {}) {
  const u = await createUser(prisma, { phone: phone(), ...data });
  userIds.push(u.id);
  return u;
}

/** Kiện gửi kho đang trên đường, có mã vận đơn riêng; `daysAgo` lùi mốc khách gửi để vào hàng "Gửi kho quá hạn". */
async function mailIn(userId: string, daysAgo = 1) {
  const r = await createWasteRequest(prisma, { userId, method: 'MAIL_IN', status: 'IN_TRANSIT', pointId: wh.id, lines: [{ itemId: item.id, declaredQty: 10 }] });
  const tr = `SPX${tag()}`;
  return prisma.wasteRequest.update({
    where: { id: r.id },
    data: { carrier: 'GHN', trackingCode: tr, trackingNorm: tr, inTransitAt: new Date(Date.now() - daysAgo * DAY) },
  });
}

const events = (requestId: string, kind: 'PARCEL_RECEIVED' | 'REQUEST_CLOSED_LOST' | 'UNMATCHED_RESOLVED') => prisma.wasteEvent.count({ where: { requestId, kind } });

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [PrismaModule],
    providers: [
      SystemConfigService,
      RewardPointsService,
      WasteConfigService,
      WasteAccessService,
      WasteHoldService,
      AnalyticsEventsService,
      WasteConfirmService,
      WasteReceiveService,
      WasteBulkActionService,
      { provide: WasteNotifierService, useValue: notifier },
      { provide: NotificationsService, useValue: { notify: async () => undefined, notifySafe: jest.fn().mockResolvedValue(true) } },
      {
        provide: WasteShipLockService,
        useValue: { evaluateAndLock: jest.fn().mockResolvedValue({ locked: false, shipLockedAt: null, cancelledRequestIds: [] }) },
      },
    ],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  bulk = moduleRef.get(WasteBulkActionService);
  receive = moduleRef.get(WasteReceiveService);
  await warmPool(prisma);
  savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
  await setConfig(prisma, 'waste.enabled', true);
  await setConfig(prisma, 'loyalty.point_expire_months', 12);
  await setConfig(prisma, 'waste.in_transit_review_days', 21);
  clearConfigCache();

  wh = await createWarehouse(prisma);
  item = await createWasteItem(prisma, { unitsPerPoint: 1, pointsPerGroup: 1000 });
  reg.itemIds.push(item.id);
  staffA = await newUser({ role: 'STAFF' });
  staffB = await newUser({ role: 'STAFF' });
  admin = await newUser({ role: 'ADMIN' });
  cust = await newUser();
});

afterAll(async () => {
  if (prisma) {
    await prisma.adminAuditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.wasteUnmatchedParcel.deleteMany({ where: { createdByUserId: { in: userIds } } });
    await cleanupWaste(prisma, reg);
    await deleteItData(prisma, { userIds });
    await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
    for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
  }
  await moduleRef?.close();
});

describe('WasteBulkActionService (real Postgres)', () => {
  it('dry run changes nothing and flags MAIL_IN parcels as needing the phone tick', async () => {
    const r = await mailIn(cust.id);
    const res = await bulk.run(staffA.id, { action: 'MARK_RECEIVED', requestIds: [r.id], dryRun: true });
    expect(res).toMatchObject({ dryRun: true, okCount: 1, auditLogId: null });
    expect(res.results[0]).toMatchObject({ outcome: 'READY', needsPhoneConfirm: true });
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ status: 'IN_TRANSIT' });
    await expect(events(r.id, 'PARCEL_RECEIVED')).resolves.toBe(0);
  });

  it('real run without the phone tick refuses MAIL_IN parcels', async () => {
    const r = await mailIn(cust.id);
    const res = await bulk.run(staffA.id, { action: 'MARK_RECEIVED', requestIds: [r.code], dryRun: false });
    expect(res.results[0]).toMatchObject({ ok: false, outcome: 'FAILED', reason: BULK_TEXT.PHONE_NOT_CONFIRMED });
    await expect(events(r.id, 'PARCEL_RECEIVED')).resolves.toBe(0);
  });

  it('receives with the tick, writes one event per request and one audit row', async () => {
    const [a, b] = [await mailIn(cust.id), await mailIn(cust.id)];
    const res = await bulk.run(staffA.id, { action: 'MARK_RECEIVED', requestIds: [a.id, b.code], dryRun: false, phoneMatchConfirmed: true });
    expect(res.results.map((x) => x.outcome)).toEqual(['UPDATED', 'UPDATED']);
    expect(res.auditLogId).not.toBeNull();
    for (const r of [a, b]) {
      await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ status: 'RECEIVED' });
      await expect(events(r.id, 'PARCEL_RECEIVED')).resolves.toBe(1);
    }
    const log = await prisma.adminAuditLog.findUniqueOrThrow({ where: { id: res.auditLogId! } });
    expect(log).toMatchObject({ action: WASTE_BULK_AUDIT_ACTION, targetType: 'WASTE_REQUEST', actorId: staffA.id });
    expect([...log.targetIds].sort()).toEqual([a.code, b.code].sort());
    expect(notifier.parcelReceived).toHaveBeenCalledWith(cust.id, { id: a.id, code: a.code }, expect.any(String));
  });

  it('bulk × bulk on the same request by two staff: one UPDATED, one SKIPPED, one event', async () => {
    const r = await mailIn(cust.id);
    const body = { action: 'MARK_RECEIVED' as const, requestIds: [r.id], dryRun: false, phoneMatchConfirmed: true };
    const s = summarize(await Promise.allSettled([bulk.run(staffA.id, body), bulk.run(staffB.id, body)]));
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(0);
    expect(s.fulfilled.map((f) => f.value.results[0]!.outcome).sort()).toEqual(['SKIPPED', 'UPDATED']);
    await expect(events(r.id, 'PARCEL_RECEIVED')).resolves.toBe(1);
  });

  it('bulk × single receive on the same parcel: one PARCEL_RECEIVED, no deadlock', async () => {
    const r = await mailIn(cust.id);
    const s = summarize(
      await Promise.allSettled([
        bulk.run(staffA.id, { action: 'MARK_RECEIVED', requestIds: [r.id], dryRun: false, phoneMatchConfirmed: true }),
        receive.receive(staffB.id, r.id, { match: { parcelCode: r.code } }),
      ]),
    );
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(0);
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ status: 'RECEIVED' });
    await expect(events(r.id, 'PARCEL_RECEIVED')).resolves.toBe(1);
  });

  it('CLOSE_LOST is admin-only and needs a reason', async () => {
    const r = await mailIn(cust.id, 40);
    await expect(bulk.run(staffA.id, { action: 'CLOSE_LOST', requestIds: [r.id], dryRun: false, reason: 'mất' })).rejects.toMatchObject({ status: 403 });
    await expect(bulk.run(admin.id, { action: 'CLOSE_LOST', requestIds: [r.id], dryRun: false })).rejects.toMatchObject({ status: 400 });
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ status: 'IN_TRANSIT' });
  });

  it('CLOSE_LOST closes only parcels past the review window', async () => {
    const [old, fresh] = [await mailIn(cust.id, 40), await mailIn(cust.id, 3)];
    const res = await bulk.run(admin.id, { action: 'CLOSE_LOST', requestIds: [old.id, fresh.id], dryRun: false, reason: 'Hãng báo thất lạc' });
    expect(res.results.map((x) => x.outcome)).toEqual(['UPDATED', 'FAILED']);
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: old.id } })).resolves.toMatchObject({ status: 'EXPIRED', closeReason: 'LOST' });
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: fresh.id } })).resolves.toMatchObject({ status: 'IN_TRANSIT' });
    await expect(events(old.id, 'REQUEST_CLOSED_LOST')).resolves.toBe(1);
    expect(notifier.requestExpired).toHaveBeenCalledWith(cust.id, { id: old.id, code: old.code, method: 'MAIL_IN' }, 'LOST', expect.any(Date));
  });

  it('tubu-w18-01: CLOSE_LOST refuses a request while an OPEN unmatched parcel is linked to it or carries its tracking code', async () => {
    const [linked, sameTracking, clear] = [await mailIn(cust.id, 40), await mailIn(cust.id, 40), await mailIn(cust.id, 40)];
    const scanned = await prisma.wasteUnmatchedParcel.create({
      data: { createdByUserId: staffA.id, description: 'kiện quét không đối chiếu được', reason: 'NO_MATCH', relatedRequestId: linked.id },
    });
    await receive.createUnmatched(staffA.id, { description: 'kiện nhập tay từ nhãn', trackingCode: sameTracking.trackingCode! });
    const resolved = await prisma.wasteUnmatchedParcel.create({
      data: { createdByUserId: staffA.id, description: 'kiện đã xử lý', reason: 'NO_MATCH', relatedRequestId: clear.id, status: 'RESOLVED' },
    });
    const ids = [linked.id, sameTracking.id, clear.id];

    const dry = await bulk.run(admin.id, { action: 'CLOSE_LOST', requestIds: ids, dryRun: true });
    expect(dry.results.map((x) => x.outcome)).toEqual(['FAILED', 'FAILED', 'READY']);
    expect(dry.results[0]!.reason).toMatch(/Hàng không rõ chủ/);

    const res = await bulk.run(admin.id, { action: 'CLOSE_LOST', requestIds: ids, dryRun: false, reason: 'Hãng báo thất lạc' });
    expect(res.results.map((x) => x.outcome)).toEqual(['FAILED', 'FAILED', 'UPDATED']);
    expect(res.results[1]!.reason).toMatch(/Hàng không rõ chủ/);
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: linked.id } })).resolves.toMatchObject({ status: 'IN_TRANSIT' });
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: sameTracking.id } })).resolves.toMatchObject({ status: 'IN_TRANSIT' });
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: clear.id } })).resolves.toMatchObject({ status: 'EXPIRED', closeReason: 'LOST' });
    await expect(events(linked.id, 'REQUEST_CLOSED_LOST')).resolves.toBe(0);
    await expect(prisma.wasteUnmatchedParcel.findUniqueOrThrow({ where: { id: scanned.id } })).resolves.toMatchObject({ status: 'OPEN' });
    expect(resolved.status).toBe('RESOLVED');
  });

  it('tubu-w18-01: CLOSE_LOST refuses the request whose TR- code is on a disputed OPEN parcel scanned under another request', async () => {
    const other = await newUser();
    const [scannedAs, owner] = [await mailIn(cust.id, 40), await mailIn(other.id, 40)];
    const res = await receive.receive(staffA.id, scannedAs.id, { match: { parcelCode: owner.code } });
    expect(res).toMatchObject({ outcome: 'UNMATCHED', reason: 'TR_TRACKING_CONFLICT' });
    const dry = await bulk.run(admin.id, { action: 'CLOSE_LOST', requestIds: [owner.id, scannedAs.id], dryRun: true });
    expect(dry.results.map((x) => [x.outcome, x.reason])).toEqual([
      ['FAILED', expect.stringMatching(/Hàng không rõ chủ/)],
      ['FAILED', expect.stringMatching(/Hàng không rõ chủ/)],
    ]);
  });

  it('tubu-w18-04: a scan that records a TR- conflict parcel waits while CLOSE_LOST holds the code owner\'s row lock', async () => {
    const other = await newUser();
    const [scannedAs, owner] = [await mailIn(cust.id, 40), await mailIn(other.id, 40)];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let onLocked!: () => void;
    const locked = new Promise<void>((r) => (onLocked = r));
    // Lượt đóng hàng loạt giữ đúng khoá này (FOR UPDATE dòng yêu cầu) trong lúc tìm kiện đang mở.
    const bulkTx = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "waste_requests" WHERE "id" = ${owner.id} FOR UPDATE`;
        onLocked();
        await held;
      },
      { timeout: 30_000 },
    );
    await locked;
    let settled = false;
    const scan = receive.receive(staffA.id, scannedAs.id, { match: { parcelCode: owner.code } }).finally(() => (settled = true));
    await new Promise((r) => setTimeout(r, 1500));
    const whileLocked = { settled, parcels: await prisma.wasteUnmatchedParcel.count({ where: { relatedRequestId: scannedAs.id } }) };
    release();
    await bulkTx;
    const res = await scan;
    expect(whileLocked).toEqual({ settled: false, parcels: 0 });
    expect(res).toMatchObject({ outcome: 'UNMATCHED', reason: 'TR_TRACKING_CONFLICT' });
    await expect(prisma.wasteUnmatchedParcel.count({ where: { relatedRequestId: scannedAs.id, status: 'OPEN' } })).resolves.toBe(1);
  });

  it('CLOSE_LOST × MARK_RECEIVED on the same overdue parcel: exactly one wins', async () => {
    const r = await mailIn(cust.id, 40);
    const s = summarize(
      await Promise.allSettled([
        bulk.run(admin.id, { action: 'CLOSE_LOST', requestIds: [r.id], dryRun: false, reason: 'thất lạc' }),
        bulk.run(staffA.id, { action: 'MARK_RECEIVED', requestIds: [r.id], dryRun: false, phoneMatchConfirmed: true }),
      ]),
    );
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(0);
    expect(s.fulfilled.filter((f) => f.value.results[0]!.outcome === 'UPDATED')).toHaveLength(1);
    const closed = await events(r.id, 'REQUEST_CLOSED_LOST');
    const received = await events(r.id, 'PARCEL_RECEIVED');
    expect(closed + received).toBe(1);
    const row = await prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe(closed === 1 ? 'EXPIRED' : 'RECEIVED');
  });
});

describe('Unmatched parcel suggestions (real Postgres)', () => {
  it('lists the request with the same tracking code and "Khớp & nhận" receives it', async () => {
    const r = await mailIn(cust.id);
    const parcel = await receive.createUnmatched(staffA.id, { description: 'kiện không rõ chủ', carrier: 'GHN', trackingCode: r.trackingCode! });
    const listed = (await receive.listUnmatched(staffA.id, {})).find((p) => p.id === parcel.id);
    expect(listed?.candidates?.map((c) => [c.code, c.basis])).toEqual([[r.code, 'TRACKING']]);
    await receive.resolveUnmatched(staffA.id, parcel.id, { action: 'MATCH', requestId: r.id, note: 'Khớp nhanh theo gợi ý', suggestion: 'TRACKING' });
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ status: 'RECEIVED' });
  });

  it('refuses a suggestion that no longer holds under the lock', async () => {
    const r = await mailIn(cust.id);
    const parcel = await receive.createUnmatched(staffA.id, { description: 'kiện không rõ chủ', trackingCode: r.trackingCode! });
    await prisma.wasteRequest.update({ where: { id: r.id }, data: { trackingCode: 'SPXCHANGED', trackingNorm: `SPXCHANGED${tag()}` } });
    await expect(
      receive.resolveUnmatched(staffA.id, parcel.id, { action: 'MATCH', requestId: r.id, note: 'gợi ý cũ', suggestion: 'TRACKING' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ status: 'IN_TRANSIT' });
    await expect(prisma.wasteUnmatchedParcel.findUniqueOrThrow({ where: { id: parcel.id } })).resolves.toMatchObject({ status: 'OPEN' });
  });

  it('a parcel recorded by Nhận kiện without the phone tick does not suggest the scanned request back, and a forged TRACKING suggestion is a 409', async () => {
    const r = await mailIn(cust.id);
    const res = await receive.receive(staffA.id, r.id, { match: { phoneMatchConfirmed: false } });
    expect(res).toMatchObject({ outcome: 'UNMATCHED', reason: 'NO_MATCH' });
    const unmatchedId = (res as { unmatchedId: string }).unmatchedId;
    const listed = (await receive.listUnmatched(staffA.id, {})).find((p) => p.id === unmatchedId);
    expect(listed?.candidates?.map((c) => c.requestId)).not.toContain(r.id);
    await expect(
      receive.resolveUnmatched(staffA.id, unmatchedId, { action: 'MATCH', requestId: r.id, note: 'gợi ý giả', suggestion: 'TRACKING' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ status: 'IN_TRANSIT' });
  });

  it('a hand-entered parcel whose tracking code two customers share gets no tracking suggestion', async () => {
    const a = await mailIn(cust.id);
    const other = await newUser();
    const b = await mailIn(other.id);
    await prisma.wasteRequest.update({ where: { id: b.id }, data: { trackingCode: a.trackingCode, trackingNorm: a.trackingNorm } });
    const parcel = await receive.createUnmatched(staffA.id, { description: 'kiện chung mã', trackingCode: a.trackingCode! });
    const listed = (await receive.listUnmatched(staffA.id, {})).find((p) => p.id === parcel.id);
    expect(listed?.candidates).toEqual([]);
    await expect(
      receive.resolveUnmatched(staffA.id, parcel.id, { action: 'MATCH', requestId: b.id, note: 'gợi ý giả', suggestion: 'TRACKING' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('tubu-w18-01: 605 older open requests of one customer do not crowd out a newer request\'s tracking suggestion (no page-wide oldest-600 cap)', async () => {
    const heavy = await newUser();
    const stamp = new Date(Date.now() - 100 * DAY);
    await prisma.wasteRequest.createMany({
      data: Array.from({ length: 605 }, (_, i) => ({
        code: `TR-BL${tag()}${i}`,
        userId: heavy.id,
        method: 'MAIL_IN' as const,
        status: 'OPEN' as const,
        pointId: wh.id,
        estimatedPoints: 1,
        capDayKey: 'it-backlog',
        capMonthKey: 'it-backlog',
        idempotencyKey: `it-backlog-${i}`,
        consentAt: stamp,
        consentVersion: 'it',
        createdAt: stamp,
      })),
    });
    try {
      const anchor = await prisma.wasteRequest.findFirstOrThrow({ where: { userId: heavy.id }, select: { id: true } });
      const heavyParcel = await prisma.wasteUnmatchedParcel.create({
        data: { createdByUserId: staffA.id, description: 'kiện của khách tồn nhiều', reason: 'NO_MATCH', relatedRequestId: anchor.id },
      });
      const r = await mailIn(cust.id);
      const parcel = await receive.createUnmatched(staffA.id, { description: 'kiện mới nhập tay', trackingCode: r.trackingCode! });
      const listed = await receive.listUnmatched(staffA.id, {});
      expect(listed.find((p) => p.id === parcel.id)?.candidates?.map((c) => [c.code, c.basis])).toEqual([[r.code, 'TRACKING']]);
      const byPhone = listed.find((p) => p.id === heavyParcel.id)?.candidates ?? [];
      expect(byPhone).toHaveLength(3);
      expect(byPhone.every((c) => c.basis === 'PHONE' && c.requestId !== anchor.id)).toBe(true);
    } finally {
      await prisma.wasteUnmatchedParcel.deleteMany({ where: { relatedRequestId: { in: (await prisma.wasteRequest.findMany({ where: { userId: heavy.id }, select: { id: true } })).map((x) => x.id) } } });
      await prisma.wasteRequest.deleteMany({ where: { userId: heavy.id } });
    }
  });

  it('tubu-w18-01: a tracking code held by two customers gets no tracking suggestion even when one customer fills the rows read for that code', async () => {
    const a = [await mailIn(cust.id, 9), await mailIn(cust.id, 8), await mailIn(cust.id, 7), await mailIn(cust.id, 6), await mailIn(cust.id, 5)];
    const other = await newUser();
    const b = await mailIn(other.id, 1);
    const shared = a[0]!.trackingNorm!;
    await prisma.wasteRequest.updateMany({ where: { id: { in: [...a.slice(1), b].map((r) => r.id) } }, data: { trackingCode: shared, trackingNorm: shared } });
    const parcel = await receive.createUnmatched(staffA.id, { description: 'kiện chung mã nhiều dòng', trackingCode: shared });
    const listed = (await receive.listUnmatched(staffA.id, {})).find((p) => p.id === parcel.id);
    expect(listed?.candidates).toEqual([]);
  });

  it('quick match × bulk receive on the same request: one receive only', async () => {
    const r = await mailIn(cust.id);
    const parcel = await receive.createUnmatched(staffA.id, { description: 'kiện đôi', trackingCode: r.trackingCode! });
    const s = summarize(
      await Promise.allSettled([
        receive.resolveUnmatched(staffA.id, parcel.id, { action: 'MATCH', requestId: r.id, note: 'gợi ý', suggestion: 'TRACKING' }),
        bulk.run(staffB.id, { action: 'MARK_RECEIVED', requestIds: [r.id], dryRun: false, phoneMatchConfirmed: true }),
      ]),
    );
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    await expect(prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ status: 'RECEIVED' });
    const matched = (await prisma.wasteUnmatchedParcel.findUniqueOrThrow({ where: { id: parcel.id } })).status === 'RESOLVED';
    const bulkUpdated = s.fulfilled.some((f) => 'results' in (f.value as object) && (f.value as { results: { outcome: string }[] }).results[0]!.outcome === 'UPDATED');
    expect(Number(matched) + Number(bulkUpdated)).toBe(1);
  });
});
