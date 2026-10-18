import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WasteAccessService } from '../../src/modules/waste-exchange/core/waste-access.service';
import { WasteHoldService } from '../../src/modules/waste-exchange/core/waste-hold.service';
import { WasteShipLockService } from '../../src/modules/waste-exchange/core/waste-ship-lock.service';
import { WasteNotifierService } from '../../src/modules/waste-exchange/core/waste-notifier.service';
import { vnDateKey, vnMonthKey } from '../../src/common/vn-time';
import { createOrder, createUser as createItUser, deleteItData, warmPool } from './helpers';
import { cleanupWaste, createWarehouse, createWasteItem, createWastePoint, createWasteRequest } from './fixtures/waste-fixtures';

let moduleRef: TestingModule;
let prisma: PrismaService;
let access: WasteAccessService;
let hold: WasteHoldService;
let shipLock: WasteShipLockService;
let notifier: { shipLocked: jest.Mock };
const userIds: string[] = [];
const pointIds: string[] = [];
const itemIds: string[] = [];
const storefrontIds: string[] = [];
const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
async function createUser(db: PrismaService, data: Parameters<typeof createItUser>[1] = {}) {
  const u = await createItUser(db, data);
  userIds.push(u.id);
  return u;
}
const reg = (p: Awaited<ReturnType<typeof createWastePoint>>) => {
  pointIds.push(p.id);
  if (p.createdStorefront && p.ownerStorefrontId) storefrontIds.push(p.ownerStorefrontId);
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [WasteAccessService, WasteHoldService, WasteShipLockService, { provide: WasteNotifierService, useValue: { shipLocked: jest.fn().mockResolvedValue(undefined) } }] }).compile();
  prisma = moduleRef.get(PrismaService);
  access = moduleRef.get(WasteAccessService);
  hold = moduleRef.get(WasteHoldService);
  shipLock = moduleRef.get(WasteShipLockService);
  notifier = moduleRef.get(WasteNotifierService) as unknown as { shipLocked: jest.Mock };
  await warmPool(prisma);
});

afterAll(async () => {
  await cleanupWaste(prisma, { pointIds, itemIds, storefrontIds });
  await deleteItData(prisma, { userIds });
  await moduleRef.close();
});

describe('WasteAccessService (real Postgres)', () => {
  it('availablePointIds: warehouse and a PARTNER with one valid OWNER are in; every broken owner condition takes the point out (spec 15.1 d)', async () => {
    const wh = await createWarehouse(prisma);
    const mk = async () => { const o = await createUser(prisma, { phone: phone() }); const p = await createWastePoint(prisma, { kind: 'PARTNER', ownerUserId: o.id }); reg(p); return { o, p }; };
    const ok = await mk();
    const ownerBlocked = await mk(); await prisma.user.update({ where: { id: ownerBlocked.o.id }, data: { isBlocked: true } });
    const ownerMerged = await mk(); const other = await createUser(prisma); await prisma.user.update({ where: { id: ownerMerged.o.id }, data: { mergedIntoId: other.id } });
    const ownerWasteBlocked = await mk(); await prisma.wasteUserFlags.create({ data: { userId: ownerWasteBlocked.o.id, blockedAt: new Date() } });
    const storeLost = await mk(); await prisma.storefront.update({ where: { id: storeLost.p.ownerStorefrontId! }, data: { type: 'CTV', isPartner: false } });
    const ownerInactive = await mk(); await prisma.wastePointStaff.updateMany({ where: { pointId: ownerInactive.p.id }, data: { isActive: false } });
    const paused = await mk(); await prisma.wastePoint.update({ where: { id: paused.p.id }, data: { status: 'PAUSED' } });
    const ids = [wh.id, ok.p.id, ownerBlocked.p.id, ownerMerged.p.id, ownerWasteBlocked.p.id, storeLost.p.id, ownerInactive.p.id, paused.p.id];
    const got = await access.availablePointIds(prisma, ids);
    expect([...got].sort()).toEqual([wh.id, ok.p.id].sort());
  });

  it('assertPointAccess: owner and staff at their PARTNER point; outsider 403; programme off 403 at PARTNER only', async () => {
    const owner = await createUser(prisma, { phone: phone() });
    const staff = await createUser(prisma, { phone: phone() });
    const outsider = await createUser(prisma, { phone: phone() });
    const p = await createWastePoint(prisma, { kind: 'PARTNER', ownerUserId: owner.id }); reg(p);
    await prisma.wastePointStaff.create({ data: { pointId: p.id, userId: staff.id, role: 'STAFF' } });
    await expect(access.assertPointAccess(owner.id, p.id, { programmeEnabled: true })).resolves.toMatchObject({ pointId: p.id, kind: 'PARTNER', actorRole: 'POINT_STAFF', myRole: 'OWNER' });
    await expect(access.assertPointAccess(staff.id, p.id, { programmeEnabled: true })).resolves.toMatchObject({ actorRole: 'POINT_STAFF', myRole: 'STAFF' });
    await expect(access.assertPointAccess(outsider.id, p.id, { programmeEnabled: true })).rejects.toThrow('Bạn không phải người ở điểm nhận này');
    await expect(access.assertPointAccess(owner.id, p.id, { programmeEnabled: false })).rejects.toThrow('Tính năng Đổi rác lấy quà đang tắt. Liên hệ quản trị viên.');
    const wh = await createWarehouse(prisma);
    const whStaff = await createUser(prisma, { role: 'STAFF' });
    await expect(access.assertPointAccess(whStaff.id, wh.id, { programmeEnabled: false })).resolves.toMatchObject({ kind: 'WAREHOUSE', actorRole: 'STAFF', myRole: 'STAFF' });
    await expect(access.assertPointAccess(outsider.id, 'nope', { programmeEnabled: true })).rejects.toThrow('Không tìm thấy điểm nhận');
  });

  it('a PARTNER whose OWNER lost the partner store is 403 for everyone at the point and leaves listOperablePoints (spec 17.3 permission list)', async () => {
    const owner = await createUser(prisma, { phone: phone() });
    const staff = await createUser(prisma, { phone: phone() });
    const p = await createWastePoint(prisma, { kind: 'PARTNER', ownerUserId: owner.id }); reg(p);
    await prisma.wastePointStaff.create({ data: { pointId: p.id, userId: staff.id, role: 'STAFF' } });
    await prisma.storefront.update({ where: { id: p.ownerStorefrontId! }, data: { type: 'CTV', isPartner: false } });
    for (const u of [owner, staff]) {
      await expect(access.assertPointAccess(u.id, p.id, { programmeEnabled: true })).rejects.toThrow('Điểm nhận này đang chờ Tubu kiểm tra chủ điểm, tạm chưa thao tác được');
      expect((await access.listOperablePoints(u.id, true)).map((x) => x.pointId)).not.toContain(p.id);
    }
  });

  it('demoted or blocked warehouse staff loses access on the next call', async () => {
    const wh = await createWarehouse(prisma);
    const s = await createUser(prisma, { role: 'STAFF' });
    await expect(access.assertPointAccess(s.id, wh.id, { programmeEnabled: true })).resolves.toMatchObject({ actorRole: 'STAFF' });
    expect((await access.listOperablePoints(s.id, false)).map((x) => x.pointId)).toEqual([wh.id]);
    await prisma.user.update({ where: { id: s.id }, data: { role: 'CUSTOMER' } });
    await expect(access.assertPointAccess(s.id, wh.id, { programmeEnabled: true })).rejects.toThrow('Chỉ nhân viên hoặc quản trị viên mới làm được thao tác này.');
    expect(await access.listOperablePoints(s.id, true)).toEqual([]);
    const a = await createUser(prisma, { role: 'ADMIN' });
    await prisma.wasteUserFlags.create({ data: { userId: a.id, blockedAt: new Date() } });
    await expect(access.assertWarehouseActor(a.id)).resolves.toMatchObject({ role: 'ADMIN' });
    const b = await createUser(prisma, { role: 'STAFF' });
    await prisma.wasteUserFlags.create({ data: { userId: b.id, blockedAt: new Date() } });
    await expect(access.assertWarehouseActor(b.id)).rejects.toThrow('Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree.');
  });

  it('assertPointAccess: waste-blocked, blocked or merged caller, paused point; ADMIN exempt from blockedAt (spec 15.1 a, b)', async () => {
    const ok = { programmeEnabled: true };
    const owner = await createUser(prisma, { phone: phone() });
    const staff = await createUser(prisma, { phone: phone() });
    const merged = await createUser(prisma, { phone: phone() });
    const p = await createWastePoint(prisma, { kind: 'PARTNER', ownerUserId: owner.id }); reg(p);
    await prisma.wastePointStaff.createMany({ data: [{ pointId: p.id, userId: staff.id, role: 'STAFF' }, { pointId: p.id, userId: merged.id, role: 'STAFF' }] });
    await prisma.wasteUserFlags.create({ data: { userId: staff.id, blockedAt: new Date() } });
    await expect(access.assertPointAccess(staff.id, p.id, ok)).rejects.toThrow('Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree.');
    await prisma.user.update({ where: { id: staff.id }, data: { isBlocked: true } });
    await expect(access.assertPointAccess(staff.id, p.id, ok)).rejects.toThrow('Tài khoản của bạn không thao tác được tại điểm nhận');
    await prisma.user.update({ where: { id: merged.id }, data: { mergedIntoId: owner.id } });
    await expect(access.assertPointAccess(merged.id, p.id, ok)).rejects.toThrow('Tài khoản của bạn không thao tác được tại điểm nhận');
    await prisma.wastePoint.update({ where: { id: p.id }, data: { status: 'PAUSED' } });
    await expect(access.assertPointAccess(owner.id, p.id, ok)).rejects.toThrow('Điểm nhận này đang không hoạt động');
    const wh = await createWarehouse(prisma);
    const admin = await createUser(prisma, { role: 'ADMIN' });
    await prisma.wasteUserFlags.create({ data: { userId: admin.id, blockedAt: new Date() } });
    await expect(access.assertPointAccess(admin.id, wh.id, ok)).resolves.toMatchObject({ kind: 'WAREHOUSE', actorRole: 'ADMIN' });
  });
});

describe('WasteHoldService.capUsage (real Postgres)', () => {
  it('counts COALESCE(received, declared) over OPEN..REVERSED, skips CANCELLED/REJECTED/EXPIRED, excludes the given request; day keys across all methods', async () => {
    const u = await createUser(prisma, { phone: phone() });
    const item = await createWasteItem(prisma, { dailyCapQty: 20, monthlyCapQty: 60 }); itemIds.push(item.id);
    const wh = await createWarehouse(prisma);
    const mk = (method: 'DROP_OFF' | 'MAIL_IN' | 'PICKUP', status: string, declaredQty: number, receivedQty?: number) =>
      createWasteRequest(prisma, { userId: u.id, method, status: status as never, pointId: wh.id, lines: [{ itemId: item.id, declaredQty, receivedQty }] });
    const open = await mk('DROP_OFF', 'OPEN', 3);
    await mk('MAIL_IN', 'IN_TRANSIT', 4);
    await mk('MAIL_IN', 'COMPLETED', 9, 5);
    await mk('DROP_OFF', 'REVERSED', 2, 2);
    for (const s of ['CANCELLED', 'REJECTED', 'EXPIRED']) await mk('DROP_OFF', s, 7);
    const today = vnDateKey(); const month = vnMonthKey();
    const all = await hold.capUsage(prisma, u.id, today, month);
    expect(all.itemDay.get(item.id)).toBe(14);
    expect(all.itemMonth.get(item.id)).toBe(14);
    expect(all.openCount).toBe(2);
    const without = await hold.capUsage(prisma, u.id, today, month, open.id);
    expect(without.itemMonth.get(item.id)).toBe(11);
    expect(all.pointsMonth).toBe(18_000);
    expect(without.pointsMonth).toBe(15_000);
  });

  it('a customer with only carton reaches the 15000-point mail-in minimum (spec 18.2 item 19, 17.3)', async () => {
    const u = await createUser(prisma, { phone: phone() });
    const carton = await createWasteItem(prisma, { unitsPerPoint: 1, pointsPerGroup: 1_000, dailyCapQty: 20, monthlyCapQty: 60 }); itemIds.push(carton.id);
    await createWarehouse(prisma);
    const r = await prisma.$transaction((tx) => hold.validateAndHold(tx, { path: 'CREATE', userId: u.id, method: 'MAIL_IN', lines: [{ itemId: carton.id, declaredQty: 15 }], pointId: null, now: new Date() }, { laneDropoff: true, laneMailin: true, lanePickup: false, mailinMinPoints: 15_000, pickupMinPoints: 10_000, customerMonthlyCapPoints: 60_000, maxOpenRequests: 3, requestHoldDays: 7 }));
    expect(r.estimatedPoints).toBe(15_000);
  });
});

describe('WasteShipLockService (real Postgres, spec 15.6 cases)', () => {
  const CFG = { shortfallLockPct: 50, shortfallLockStreak: 3 };
  const t = (min: number) => new Date(Date.now() - (100 - min) * 60_000);
  let closedItemId: string | null = null;
  async function closed(userId: string, method: string, status: string, est: number, awarded: number | null, closeReason: string | null, closedAt: Date) {
    const wh = await createWarehouse(prisma);
    if (!closedItemId) {
      const item = await createWasteItem(prisma);
      itemIds.push(item.id);
      closedItemId = item.id;
    }
    const r = await createWasteRequest(prisma, { userId, method: method as never, status: status as never, pointId: wh.id, lines: [{ itemId: closedItemId, declaredQty: est }] });
    return prisma.wasteRequest.update({ where: { id: r.id }, data: { pointsAwarded: awarded, closeReason: closeReason as never, closedAt } });
  }
  it.each<[string, [string, string, number, number | null, string | null][], boolean]>([
    ['three empty MAIL_IN completions lock', [['MAIL_IN', 'COMPLETED', 10, 0, null], ['MAIL_IN', 'COMPLETED', 10, 0, null], ['MAIL_IN', 'COMPLETED', 10, 0, null]], true],
    ['two strikes are not enough', [['MAIL_IN', 'REJECTED', 10, null, null], ['MAIL_IN', 'REJECTED', 10, null, null]], false],
    ['latest good completion breaks the streak', [['MAIL_IN', 'REJECTED', 10, null, null], ['MAIL_IN', 'REJECTED', 10, null, null], ['MAIL_IN', 'COMPLETED', 10, 10_000, null]], false],
    ['awarded exactly 50% is not a strike', [['MAIL_IN', 'REJECTED', 10, null, null], ['MAIL_IN', 'REJECTED', 10, null, null], ['MAIL_IN', 'COMPLETED', 10, 5_000, null]], false],
    ['awarded 40% is a strike', [['MAIL_IN', 'REJECTED', 10, null, null], ['MAIL_IN', 'REJECTED', 10, null, null], ['MAIL_IN', 'COMPLETED', 10, 4_000, null]], true],
    ['REVERSED counts', [['PICKUP', 'REVERSED', 10, 10_000, null], ['MAIL_IN', 'REJECTED', 10, null, null], ['MAIL_IN', 'REJECTED', 10, null, null]], true],
    ['PICKUP_NO_SHOW counts', [['PICKUP', 'EXPIRED', 10, null, 'PICKUP_NO_SHOW'], ['MAIL_IN', 'REJECTED', 10, null, null], ['MAIL_IN', 'REJECTED', 10, null, null]], true],
    ['three COMPLETED at 35% lock', [['MAIL_IN', 'COMPLETED', 20, 7_000, null], ['MAIL_IN', 'COMPLETED', 20, 7_000, null], ['MAIL_IN', 'COMPLETED', 20, 7_000, null]], true],
    ['MAIL_IN closed LOST is never considered', [['MAIL_IN', 'REJECTED', 10, null, null], ['MAIL_IN', 'REJECTED', 10, null, null], ['MAIL_IN', 'EXPIRED', 10, null, 'LOST']], false],
    ['a newest PICKUP_NOT_DISPATCHED does not mask three earlier strikes', [['MAIL_IN', 'REJECTED', 10, null, null], ['MAIL_IN', 'REJECTED', 10, null, null], ['MAIL_IN', 'REJECTED', 10, null, null], ['PICKUP', 'EXPIRED', 10, null, 'PICKUP_NOT_DISPATCHED']], true],
    ['never considered: CANCELLED, MAIL_IN HOLD_EXPIRED, MAIL_IN LOST, PICKUP HOLD_EXPIRED, PICKUP_NOT_DISPATCHED, LOST_AT_WAREHOUSE, DROP_OFF', [['MAIL_IN', 'REJECTED', 10, null, null], ['MAIL_IN', 'REJECTED', 10, null, null], ['MAIL_IN', 'CANCELLED', 10, null, null], ['MAIL_IN', 'EXPIRED', 10, null, 'HOLD_EXPIRED'], ['PICKUP', 'EXPIRED', 10, null, 'PICKUP_NOT_DISPATCHED'], ['MAIL_IN', 'EXPIRED', 10, null, 'LOST_AT_WAREHOUSE'], ['DROP_OFF', 'REJECTED', 10, null, null], ['MAIL_IN', 'EXPIRED', 10, null, 'LOST'], ['PICKUP', 'EXPIRED', 10, null, 'HOLD_EXPIRED']], false],
  ])('%s', async (_n, rows, expected) => {
    const u = await createUser(prisma, { phone: phone() });
    for (const [i, [m, s, est, aw, cr]] of rows.entries()) await closed(u.id, m, s, est, aw, cr, t(i));
    await expect(shipLock.shouldLock(prisma, u.id, 50, 3)).resolves.toBe(expected);
  });

  it('two requests with the same closedAt are ordered by id (spec 15.6 ORDER BY "closedAt" DESC, id DESC)', async () => {
    const u = await createUser(prisma, { phone: phone() });
    const tie = t(0);
    const bad = await closed(u.id, 'MAIL_IN', 'REJECTED', 10, null, null, tie);
    const good = await closed(u.id, 'MAIL_IN', 'COMPLETED', 10, 10_000, null, tie);
    await closed(u.id, 'MAIL_IN', 'REJECTED', 10, null, null, t(1));
    await closed(u.id, 'MAIL_IN', 'REJECTED', 10, null, null, t(2));
    const [top] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM waste_requests WHERE id IN (${bad.id}, ${good.id}) ORDER BY id DESC LIMIT 1`;
    await expect(shipLock.shouldLock(prisma, u.id, 50, 3)).resolves.toBe(top!.id === bad.id);
  });

  it('unlock does not relock on old strikes; three new strikes after shipUnlockedAt lock again', async () => {
    const u = await createUser(prisma, { phone: phone() });
    for (let i = 0; i < 3; i++) await closed(u.id, 'MAIL_IN', 'REJECTED', 10, null, null, t(i));
    await prisma.wasteUserFlags.create({ data: { userId: u.id, shipUnlockedAt: new Date() } });
    await expect(shipLock.shouldLock(prisma, u.id, 50, 3)).resolves.toBe(false);
    for (let i = 0; i < 3; i++) await closed(u.id, 'MAIL_IN', 'REJECTED', 10, null, null, new Date(Date.now() + (i + 1) * 1000));
    await expect(shipLock.shouldLock(prisma, u.id, 50, 3)).resolves.toBe(true);
  });

  it('evaluateAndLock: step 1 locks once, step 2 cancels only the unattached OPEN PICKUP, events and notify once', async () => {
    const u = await createUser(prisma, { phone: phone() });
    for (let i = 0; i < 3; i++) await closed(u.id, 'MAIL_IN', 'REJECTED', 10, null, null, t(i));
    const wh = await createWarehouse(prisma);
    const item = await createWasteItem(prisma); itemIds.push(item.id);
    const pending = await createWasteRequest(prisma, { userId: u.id, method: 'PICKUP', status: 'OPEN', pointId: wh.id, lines: [{ itemId: item.id, declaredQty: 10 }] });
    const order = await createOrder(prisma, { userId: u.id });
    const attached = await createWasteRequest(prisma, { userId: u.id, method: 'PICKUP', status: 'OPEN', pointId: wh.id, orderId: order.id, expiresAt: null, lines: [{ itemId: item.id, declaredQty: 10 }] });
    const mail = await createWasteRequest(prisma, { userId: u.id, method: 'MAIL_IN', status: 'OPEN', pointId: wh.id, lines: [{ itemId: item.id, declaredQty: 15 }] });
    const res = await shipLock.evaluateAndLock(u.id, CFG);
    expect(res.locked).toBe(true);
    expect(res.cancelledRequestIds).toEqual([pending.id]);
    const after = await prisma.wasteRequest.findMany({ where: { id: { in: [pending.id, attached.id, mail.id] } } });
    expect(after.find((r) => r.id === pending.id)).toMatchObject({ status: 'CANCELLED', closeReason: 'SHIP_LOCKED' });
    expect(after.find((r) => r.id === pending.id)!.closedAt).not.toBeNull();
    expect(after.find((r) => r.id === attached.id)!.status).toBe('OPEN');
    expect(after.find((r) => r.id === mail.id)!.status).toBe('OPEN');
    const events = await prisma.wasteEvent.findMany({ where: { OR: [{ requestId: pending.id }, { kind: 'SHIP_LOCKED', meta: { path: ['subjectUserId'], equals: u.id } }] } });
    expect(events.map((e) => [e.kind, e.actorRole]).sort()).toEqual([['REQUEST_CANCELLED_SHIP_LOCK', 'SYSTEM'], ['SHIP_LOCKED', 'SYSTEM']]);
    expect(events.find((e) => e.kind === 'SHIP_LOCKED')!.meta).toEqual({ subjectUserId: u.id, before: { shipLockedAt: null }, after: { shipLockedAt: res.shipLockedAt!.toISOString() } });
    expect(notifier.shipLocked).toHaveBeenCalledTimes(1);
    expect(notifier.shipLocked).toHaveBeenCalledWith(u.id, res.shipLockedAt);
    await expect(shipLock.evaluateAndLock(u.id, CFG)).resolves.toMatchObject({ locked: false, cancelledRequestIds: [] });
    expect(notifier.shipLocked).toHaveBeenCalledTimes(1);
  });

  it('two parallel evaluations write one SHIP_LOCKED event and notify once; an existing flags row (blockedAt set) is updated, not duplicated', async () => {
    notifier.shipLocked.mockClear();
    const u = await createUser(prisma, { phone: phone() });
    await prisma.wasteUserFlags.create({ data: { userId: u.id, blockedAt: new Date() } });
    for (let i = 0; i < 3; i++) await closed(u.id, 'MAIL_IN', 'REJECTED', 10, null, null, t(i));
    const rs = await Promise.allSettled([shipLock.evaluateAndLock(u.id, CFG), shipLock.evaluateAndLock(u.id, CFG)]);
    expect(rs.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(rs.filter((r) => r.status === 'fulfilled' && r.value.locked)).toHaveLength(1);
    expect(await prisma.wasteEvent.count({ where: { kind: 'SHIP_LOCKED', meta: { path: ['subjectUserId'], equals: u.id } } })).toBe(1);
    expect(notifier.shipLocked).toHaveBeenCalledTimes(1);
    expect(await prisma.wasteUserFlags.findUnique({ where: { userId: u.id } })).toMatchObject({ blockedAt: expect.any(Date), shipLockedAt: expect.any(Date) });
  });

  it('a stale positive evaluation does not re-lock after an admin unlock (spec 15.6 Mở khoá)', async () => {
    notifier.shipLocked.mockClear();
    const u = await createUser(prisma, { phone: phone() });
    for (let i = 0; i < 3; i++) await closed(u.id, 'MAIL_IN', 'REJECTED', 10, null, null, t(i));
    await prisma.wasteUserFlags.create({ data: { userId: u.id, shipUnlockedAt: new Date() } });
    const spy = jest.spyOn(shipLock, 'shouldLock').mockResolvedValueOnce(true);
    const res = await shipLock.evaluateAndLock(u.id, CFG);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
    expect(res).toMatchObject({ locked: false, cancelledRequestIds: [] });
    expect((await prisma.wasteUserFlags.findUniqueOrThrow({ where: { userId: u.id } })).shipLockedAt).toBeNull();
    expect(await prisma.wasteEvent.count({ where: { kind: 'SHIP_LOCKED', meta: { path: ['subjectUserId'], equals: u.id } } })).toBe(0);
    expect(notifier.shipLocked).not.toHaveBeenCalled();
  });
});
