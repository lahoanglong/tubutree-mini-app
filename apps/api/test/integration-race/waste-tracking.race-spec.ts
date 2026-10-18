jest.mock('../../src/modules/integrations/gomdon/gomdon-config', () => ({
  ...jest.requireActual('../../src/modules/integrations/gomdon/gomdon-config'),
  isGomdonRecyclingEnabled: jest.fn().mockResolvedValue(true),
}));

import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { WasteLineInput, WasteMethod } from '@tubutree/shared-types';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { WasteConfigService } from '../../src/modules/waste-exchange/core/waste-config.service';
import { WasteAccessService } from '../../src/modules/waste-exchange/core/waste-access.service';
import { WasteHoldService } from '../../src/modules/waste-exchange/core/waste-hold.service';
import { WasteRequestsService } from '../../src/modules/waste-exchange/customer/waste-requests.service';
import { createUser as createItUser, deleteItData, randCode, setConfig, warmPool } from './helpers';
import { cleanupWaste, createWarehouse, createWasteItem, createWastePoint, createWasteRequest, raceWithHold } from './fixtures/waste-fixtures';

const CONFIG_KEYS = ['waste.enabled', 'waste.lane_pickup_enabled'];
let moduleRef: TestingModule;
let prisma: PrismaService;
let svc: WasteRequestsService;
let savedConfig: { key: string; value: unknown }[] = [];
const userIds: string[] = [];
const pointIds: string[] = [];
const itemIds: string[] = [];
const storefrontIds: string[] = [];

const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
const randKey = () => `it-${randCode(12)}`;
const clearConfigCache = () => (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();
async function createUser(data: Parameters<typeof createItUser>[1] = {}) {
  const u = await createItUser(prisma, data);
  userIds.push(u.id);
  return u;
}
const customer = () => createUser({ phone: phone() });
const customerLock = (u: { id: string }) => Prisma.sql`SELECT pg_advisory_xact_lock(731001, hashtext(${u.id}))`;
const trackingLock = Prisma.sql`SELECT pg_advisory_xact_lock(731002, 0)`;
const errorsOf = (rs: PromiseSettledResult<unknown>[]) =>
  rs.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));
const reasonOf = (r: PromiseSettledResult<unknown>) => String(((r as PromiseRejectedResult).reason as Error)?.message);
async function scene(itemOver: Parameters<typeof createWasteItem>[1] = {}) {
  const wh = await createWarehouse(prisma);
  const u = await customer();
  const owner = await customer();
  const item = await createWasteItem(prisma, itemOver);
  itemIds.push(item.id);
  const point = await createWastePoint(prisma, { kind: 'PARTNER', ownerUserId: owner.id, itemIds: [item.id] });
  pointIds.push(point.id);
  if (point.createdStorefront && point.ownerStorefrontId) storefrontIds.push(point.ownerStorefrontId);
  return { u, owner, item, point, wh };
}
const create = (u: { id: string }, key: string, lines: WasteLineInput[], method: WasteMethod = 'DROP_OFF', pointId?: string) =>
  svc.create(u.id, key, { method, lines, pointId, consent: true, ...(method === 'MAIL_IN' ? { packagingConsent: true, postagePaidConsent: true } : {}) });

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [PrismaModule],
    providers: [SystemConfigService, WasteConfigService, WasteAccessService, WasteHoldService, WasteRequestsService],
  }).compile();
  prisma = moduleRef.get(PrismaService);
  svc = moduleRef.get(WasteRequestsService);
  await warmPool(prisma);
  savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
  await setConfig(prisma, 'waste.enabled', true);
  await setConfig(prisma, 'waste.lane_pickup_enabled', true);
  clearConfigCache();
});

afterAll(async () => {
  await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
  for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
  clearConfigCache();
  await cleanupWaste(prisma, { pointIds, itemIds, storefrontIds });
  await deleteItData(prisma, { userIds });
  await moduleRef.close();
});
import { normalizeTracking } from '../../src/modules/waste-exchange/waste-codes';

describe('waste tracking races (real Postgres, spec 17.3)', () => {
  let item: { id: string };
  let wh: { id: string };
  beforeAll(async () => {
    wh = await createWarehouse(prisma);
    item = await createWasteItem(prisma, { dailyCapQty: null, monthlyCapQty: null });
    itemIds.push(item.id);
  });
  async function mailIn(u: { id: string }, status: 'OPEN' | 'IN_TRANSIT' = 'OPEN', code?: string) {
    const r = await createWasteRequest(prisma, { userId: u.id, method: 'MAIL_IN', status, pointId: wh.id, lines: [{ itemId: item.id, declaredQty: 16 }] });
    if (code !== undefined) {
      await prisma.wasteRequest.update({ where: { id: r.id }, data: { carrier: 'GHTK', trackingCode: code, trackingNorm: normalizeTracking(code), expiresAt: null, inTransitAt: new Date() } });
    }
    return r;
  }
  const conflictFlags = async (ids: string[]) =>
    (await prisma.wasteRequest.findMany({ where: { id: { in: ids } }, select: { trackingConflict: true } })).map((r) => r.trackingConflict);
  for (const [label, first] of [['A then B', 'A'], ['B then A', 'B']] as const) {
    const race = (a: () => Promise<unknown>, b: () => Promise<unknown>) =>
      first === 'A' ? raceWithHold(prisma, trackingLock, a, b) : raceWithHold(prisma, trackingLock, b, a);
    it(`two customers enter the same code (${label}): no deadlock, both flagged, neither told`, async () => {
      const [ua, ub] = [await customer(), await customer()];
      const [ra, rb] = [await mailIn(ua), await mailIn(ub)];
      const code = `IT${randCode(8)}`;
      const rs = await race(
        () => svc.setTracking(ua.id, ra.id, { carrier: 'GHTK', trackingCode: code }),
        () => svc.setTracking(ub.id, rb.id, { carrier: 'GHN', trackingCode: code.toLowerCase() }),
      );
      expect(errorsOf(rs).join()).not.toMatch(/40P01|P2034/);
      expect(rs.every((x) => x.status === 'fulfilled')).toBe(true);
      for (const x of rs) expect('trackingConflict' in (x as PromiseFulfilledResult<object>).value).toBe(false);
      const rows = await prisma.wasteRequest.findMany({ where: { id: { in: [ra.id, rb.id] } } });
      expect(rows.map((r) => [r.status, r.trackingConflict, r.expiresAt])).toEqual([['IN_TRANSIT', true, null], ['IN_TRANSIT', true, null]]);
    });
    it(`two customers swap codes (${label}): no deadlock, both flagged`, async () => {
      const [ua, ub] = [await customer(), await customer()];
      const [x, y] = [`IT${randCode(8)}`, `IT${randCode(8)}`];
      const [ra, rb] = [await mailIn(ua, 'IN_TRANSIT', x), await mailIn(ub, 'IN_TRANSIT', y)];
      const rs = await race(
        () => svc.setTracking(ua.id, ra.id, { carrier: 'GHTK', trackingCode: y }),
        () => svc.setTracking(ub.id, rb.id, { carrier: 'GHTK', trackingCode: x }),
      );
      expect(errorsOf(rs).join()).not.toMatch(/40P01|P2034/);
      expect(rs.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(await conflictFlags([ra.id, rb.id])).toEqual([true, true]);
    });
    it(`re-tap of the same code races another customer's first entry (${label})`, async () => {
      const [ua, ub] = [await customer(), await customer()];
      const s = `IT${randCode(8)}`;
      const ra = await mailIn(ua, 'IN_TRANSIT', s);
      const rb = await mailIn(ub);
      const rs = await race(
        () => svc.setTracking(ua.id, ra.id, { carrier: 'GHTK', trackingCode: s }),
        () => svc.setTracking(ub.id, rb.id, { carrier: 'GHN', trackingCode: s }),
      );
      expect(errorsOf(rs).join()).not.toMatch(/40P01|P2034/);
      expect(rs.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(await conflictFlags([ra.id, rb.id])).toEqual([true, true]);
      expect(await prisma.wasteEvent.count({ where: { requestId: ra.id, kind: 'TRACKING_EDITED' } })).toBe(0);
      expect(await prisma.wasteEvent.count({ where: { requestId: rb.id, kind: 'TRACKING_SET' } })).toBe(1);
    });
  }
  it('an OPEN MAIL_IN past expiresAt but not yet swept accepts the first code and clears expiresAt', async () => {
    const u = await customer();
    const r = await mailIn(u);
    await prisma.wasteRequest.update({ where: { id: r.id }, data: { expiresAt: new Date(Date.now() - 3_600_000) } });
    await expect(svc.setTracking(u.id, r.id, { carrier: 'GHTK', trackingCode: `IT${randCode(8)}` })).resolves.toMatchObject({ id: r.id });
    const row = await prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect([row.status, row.expiresAt]).toEqual(['IN_TRANSIT', null]);
    expect(row.inTransitAt).toBeInstanceOf(Date);
  });
  it('own duplicate is caught after normalising spaces and case', async () => {
    const u = await customer();
    await mailIn(u, 'IN_TRANSIT', 'S 123');
    const r2 = await mailIn(u);
    await expect(svc.setTracking(u.id, r2.id, { carrier: 'GHTK', trackingCode: 's123 ' })).rejects.toThrow('Bạn đã dùng mã vận đơn này cho một yêu cầu khác');
    expect((await prisma.wasteRequest.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe('OPEN');
  });
  it('PICKUP and DROP_OFF reject a code and write nothing', async () => {
    const s = await scene({ dailyCapQty: null, monthlyCapQty: null });
    const pick = await createWasteRequest(prisma, { userId: s.u.id, method: 'PICKUP', status: 'OPEN', pointId: s.wh.id, lines: [{ itemId: s.item.id, declaredQty: 11 }] });
    const drop = await createWasteRequest(prisma, { userId: s.u.id, method: 'DROP_OFF', status: 'OPEN', pointId: s.point.id, lines: [{ itemId: s.item.id, declaredQty: 2 }] });
    for (const r of [pick, drop]) {
      const before = await prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } });
      await expect(svc.setTracking(s.u.id, r.id, { carrier: 'GHTK', trackingCode: 'S1' })).rejects.toThrow('Yêu cầu này không dùng mã vận đơn');
      expect((await prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } })).updatedAt).toEqual(before.updatedAt);
      expect(await prisma.wasteEvent.count({ where: { requestId: r.id } })).toBe(0);
    }
  });
  it('changing the code later keeps trackingConflict true', async () => {
    const [ua, ub] = [await customer(), await customer()];
    const s = `IT${randCode(8)}`;
    const ra = await mailIn(ua);
    await mailIn(ub, 'IN_TRANSIT', s);
    await svc.setTracking(ua.id, ra.id, { carrier: 'GHTK', trackingCode: s });
    await svc.setTracking(ua.id, ra.id, { carrier: 'GHTK', trackingCode: `IT${randCode(8)}` });
    expect((await prisma.wasteRequest.findUniqueOrThrow({ where: { id: ra.id } })).trackingConflict).toBe(true);
  });
  it('a blocked customer can still enter a code and cancel', async () => {
    const u = await customer();
    const [r1, r2] = [await mailIn(u), await mailIn(u)];
    await prisma.wasteUserFlags.create({ data: { userId: u.id, blockedAt: new Date() } });
    await expect(svc.setTracking(u.id, r1.id, { carrier: 'GHTK', trackingCode: `IT${randCode(8)}` })).resolves.toMatchObject({ id: r1.id });
    await expect(svc.cancel(u.id, r2.id)).resolves.toMatchObject({ id: r2.id });
    expect((await prisma.wasteRequest.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe('CANCELLED');
  });
  it("customer B gets 404 on A's request for tracking and cancel; A's row unchanged", async () => {
    const [ua, ub] = [await customer(), await customer()];
    const r = await mailIn(ua);
    const before = await prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } });
    await expect(svc.setTracking(ub.id, r.id, { carrier: 'GHTK', trackingCode: 'S1' })).rejects.toThrow('Không tìm thấy yêu cầu');
    await expect(svc.cancel(ub.id, r.id)).rejects.toThrow('Không tìm thấy yêu cầu');
    expect((await prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id } })).updatedAt).toEqual(before.updatedAt);
  });
  it('cancel twice: one CANCELLED row, one REQUEST_CANCELLED event, same DTO; cancel frees the cap', async () => {
    const { u, item: capped, point } = await scene({ dailyCapQty: null, monthlyCapQty: 10 });
    const r = await create(u, randKey(), [{ itemId: capped.id, declaredQty: 10 }], 'DROP_OFF', point.id);
    const one = await svc.cancel(u.id, r.id);
    const two = await svc.cancel(u.id, r.id);
    expect(two).toEqual(one);
    expect(await prisma.wasteEvent.count({ where: { requestId: r.id, kind: 'REQUEST_CANCELLED' } })).toBe(1);
    await expect(create(u, randKey(), [{ itemId: capped.id, declaredQty: 10 }], 'DROP_OFF', point.id)).resolves.toBeDefined();
    expect(await prisma.wasteRequest.count({ where: { userId: u.id, status: 'OPEN' } })).toBe(1);
  });
  it('cancel after a ship-lock system cancel is 409, not a replay', async () => {
    const u = await customer();
    const r = await mailIn(u);
    await prisma.wasteRequest.update({ where: { id: r.id }, data: { status: 'CANCELLED', closeReason: 'SHIP_LOCKED', closedAt: new Date() } });
    await expect(svc.cancel(u.id, r.id)).rejects.toThrow('Yêu cầu này không còn huỷ được');
  });
});
