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

describe('waste edit races and edit rules (real Postgres, spec 17.3)', () => {
  const free = { dailyCapQty: null, monthlyCapQty: null };
  for (const [label, first] of [['A then B', 'A'], ['B then A', 'B']] as const) {
    const race = (u: { id: string }, a: () => Promise<unknown>, b: () => Promise<unknown>) =>
      first === 'A' ? raceWithHold(prisma, customerLock(u), a, b) : raceWithHold(prisma, customerLock(u), b, a);
    it(`edit x edit (${label}): both succeed in lock order, last writer's lines stay, two REQUEST_EDITED`, async () => {
      const { u, item, point } = await scene({ dailyCapQty: 20, monthlyCapQty: 60 });
      const r = await create(u, randKey(), [{ itemId: item.id, declaredQty: 2 }], 'DROP_OFF', point.id);
      const a = () => svc.edit(u.id, r.id, { lines: [{ itemId: item.id, declaredQty: 3 }] });
      const b = () => svc.edit(u.id, r.id, { lines: [{ itemId: item.id, declaredQty: 4 }] });
      const rs = await race(u, a, b);
      expect(errorsOf(rs).join()).not.toMatch(/40P01|P2034/);
      expect(rs.every((x) => x.status === 'fulfilled')).toBe(true);
      const lines = await prisma.wasteRequestLine.findMany({ where: { requestId: r.id } });
      expect(lines.map((l) => l.declaredQty)).toEqual([first === 'A' ? 4 : 3]);
      expect(await prisma.wasteEvent.count({ where: { requestId: r.id, kind: 'REQUEST_EDITED' } })).toBe(2);
    });
    it(`edit x create at the month cap (${label}): the first holder wins, the other gets 409`, async () => {
      const { u, item, point } = await scene({ dailyCapQty: null, monthlyCapQty: 10 });
      const r = await create(u, randKey(), [{ itemId: item.id, declaredQty: 4 }], 'DROP_OFF', point.id);
      const edit = () => svc.edit(u.id, r.id, { lines: [{ itemId: item.id, declaredQty: 8 }] });
      const add = () => create(u, randKey(), [{ itemId: item.id, declaredQty: 4 }], 'DROP_OFF', point.id);
      const rs = await race(u, edit, add);
      expect(errorsOf(rs).join()).not.toMatch(/40P01|P2034/);
      expect(rs.map((x) => x.status)).toEqual(['fulfilled', 'rejected']);
      expect(reasonOf(rs[1])).toContain(first === 'A' ? 'tháng này bạn chỉ còn gửi được 2' : 'tháng này bạn chỉ còn gửi được 6');
    });
  }
  it("customer B editing A's request gets 404 and the row is unchanged", async () => {
    const { u, item, point } = await scene(free);
    const other = await customer();
    const r = await create(u, randKey(), [{ itemId: item.id, declaredQty: 2 }], 'DROP_OFF', point.id);
    const before = await prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id }, include: { lines: true } });
    await expect(svc.edit(other.id, r.id, { lines: [{ itemId: item.id, declaredQty: 3 }] })).rejects.toThrow('Không tìm thấy yêu cầu');
    expect(await prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id }, include: { lines: true } })).toEqual(before);
  });
  it('a line whose item became HIDDEN is 409 on edit', async () => {
    const { u, item, point } = await scene(free);
    const r = await create(u, randKey(), [{ itemId: item.id, declaredQty: 2 }], 'DROP_OFF', point.id);
    await prisma.wasteItem.update({ where: { id: item.id }, data: { status: 'HIDDEN' } });
    await expect(svc.edit(u.id, r.id, { lines: [{ itemId: item.id, declaredQty: 3 }] })).rejects.toThrow('Món này hiện chưa nhận, hãy bỏ khỏi danh sách');
  });
  it('editing keeps a point that became unavailable; switching to an unavailable point is 409', async () => {
    const { u, owner, item, point } = await scene(free);
    const r = await create(u, randKey(), [{ itemId: item.id, declaredQty: 2 }], 'DROP_OFF', point.id);
    await prisma.wastePoint.update({ where: { id: point.id }, data: { status: 'PAUSED' } });
    await expect(svc.edit(u.id, r.id, { lines: [{ itemId: item.id, declaredQty: 3 }] })).resolves.toMatchObject({ id: r.id });
    const p2 = await createWastePoint(prisma, { kind: 'PARTNER', ownerUserId: owner.id, itemIds: [item.id] });
    pointIds.push(p2.id);
    await prisma.wastePoint.update({ where: { id: p2.id }, data: { status: 'PAUSED' } });
    await expect(svc.edit(u.id, r.id, { lines: [{ itemId: item.id, declaredQty: 3 }], pointId: p2.id })).rejects.toThrow('Điểm nhận đang tạm ngừng, hãy chọn điểm khác');
  });
  it('MAIL_IN and PICKUP edit still succeeds with the lane flag off and at max open', async () => {
    const { u, item, wh } = await scene(free);
    const mail = await createWasteRequest(prisma, { userId: u.id, method: 'MAIL_IN', status: 'OPEN', pointId: wh.id, lines: [{ itemId: item.id, declaredQty: 16 }] });
    const pick = await createWasteRequest(prisma, { userId: u.id, method: 'PICKUP', status: 'OPEN', pointId: wh.id, lines: [{ itemId: item.id, declaredQty: 11 }] });
    const closedLanes = new WasteRequestsService(
      prisma,
      moduleRef.get(WasteAccessService),
      moduleRef.get(WasteHoldService),
      { snapshot: async () => ({ ...(await moduleRef.get(WasteConfigService).snapshot()), laneMailin: false, lanePickup: false, maxOpenRequests: 1 }) } as never,
      moduleRef.get(SystemConfigService),
    );
    await expect(closedLanes.edit(u.id, mail.id, { lines: [{ itemId: item.id, declaredQty: 17 }] })).resolves.toMatchObject({ id: mail.id });
    await expect(closedLanes.edit(u.id, pick.id, { lines: [{ itemId: item.id, declaredQty: 12 }] })).resolves.toMatchObject({ id: pick.id });
  });
  it('ship-locked customer: MAIL_IN edit is 403', async () => {
    const { u, item, wh } = await scene(free);
    const mail = await createWasteRequest(prisma, { userId: u.id, method: 'MAIL_IN', status: 'OPEN', pointId: wh.id, lines: [{ itemId: item.id, declaredQty: 16 }] });
    await prisma.wasteUserFlags.create({ data: { userId: u.id, shipLockedAt: new Date() } });
    await expect(svc.edit(u.id, mail.id, { lines: [{ itemId: item.id, declaredQty: 17 }] })).rejects.toThrow('Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn, liên hệ CSKH.');
  });
  it('edit keeps code, expiresAt, consentAt, capDayKey and capMonthKey', async () => {
    const { u, item, point } = await scene(free);
    const r = await create(u, randKey(), [{ itemId: item.id, declaredQty: 2 }], 'DROP_OFF', point.id);
    const kept = { code: true, expiresAt: true, consentAt: true, capDayKey: true, capMonthKey: true } as const;
    const before = await prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id }, select: kept });
    await svc.edit(u.id, r.id, { lines: [{ itemId: item.id, declaredQty: 5 }] });
    expect(await prisma.wasteRequest.findUniqueOrThrow({ where: { id: r.id }, select: kept })).toEqual(before);
  });
});
