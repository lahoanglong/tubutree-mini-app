import { randomInt } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { WasteAccessService } from '../../src/modules/waste-exchange/core/waste-access.service';
import { WasteConfigService } from '../../src/modules/waste-exchange/core/waste-config.service';
import { WasteNotifierService } from '../../src/modules/waste-exchange/core/waste-notifier.service';
import { WasteDeskService } from '../../src/modules/waste-exchange/receiving/waste-desk.service';
import { WasteAdminPointsService } from '../../src/modules/waste-exchange/catalog/waste-admin-points.service';
import { createUser, deleteItData, pinConfig, warmPool } from './helpers';
import { cleanupWaste, createWastePoint, raceWithHold } from './fixtures/waste-fixtures';

const phone = () => '09' + String(randomInt(10_000_000, 99_999_999));
function noDeadlock(results: PromiseSettledResult<unknown>[]) {
  const errors = results.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));
  expect(errors.join()).not.toMatch(/40P01|deadlock|P2034/);
}

const OWNER_EXISTS = 'Điểm đã có chủ điểm. Bỏ chủ điểm cũ trước khi thêm chủ mới.';
const STAFF_FULL = 'Mỗi điểm nhận tối đa 5 người.';
const NEEDS_ONE_OWNER = 'Điểm đại lý chỉ kích hoạt được khi đã có đúng một chủ điểm hợp lệ.';

/**
 * WasteAdminPointsService.addStaff / removeStaff / update on real Postgres. Every contender takes
 * `waste_points ... FOR NO KEY UPDATE` first (lock order 19), so the cap, the one-owner rule and the
 * "activate needs a valid owner" check are decided one after the other, never both on a stale read.
 */
describe('waste-admin-point-staff race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: WasteAdminPointsService;
  let desk: WasteDeskService;
  let restoreConfig: () => Promise<void>;
  let access: WasteAccessService;
  const pointIds: string[] = [];
  const userIds: string[] = [];
  const storefrontIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        WasteConfigService,
        WasteAccessService,
        WasteAdminPointsService,
        WasteDeskService,
        { provide: WasteNotifierService, useValue: { perkReviewed: jest.fn() } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = moduleRef.get(WasteAdminPointsService);
    desk = moduleRef.get(WasteDeskService);
    restoreConfig = await pinConfig(prisma, 'waste.enabled', true);
    (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();
    access = moduleRef.get(WasteAccessService);
  });

  afterAll(async () => {
    await restoreConfig?.();
    await cleanupWaste(prisma, { pointIds, storefrontIds });
    await deleteItData(prisma, { userIds });
    await moduleRef?.close();
  });

  // A user who owns a partner store (a side point gives the fixture its storefront).
  async function owner() {
    const u = await createUser(prisma, { phone: phone() });
    const side = await createWastePoint(prisma, { kind: 'PARTNER', ownerUserId: u.id });
    userIds.push(u.id);
    pointIds.push(side.id);
    if (side.createdStorefront && side.ownerStorefrontId) storefrontIds.push(side.ownerStorefrontId);
    return u;
  }

  const pending = (id: string) => prisma.wastePoint.update({ where: { id }, data: { status: 'PENDING', activatedAt: null } });

  async function pointWithoutStaff() {
    const p = await createWastePoint(prisma, { kind: 'PARTNER' });
    pointIds.push(p.id);
    await pending(p.id);
    return p;
  }

  async function pointWithOwner() {
    const o = await owner();
    const p = await createWastePoint(prisma, { kind: 'PARTNER', ownerUserId: o.id });
    pointIds.push(p.id);
    await pending(p.id);
    return { o, point: p };
  }

  async function admin() {
    const a = await createUser(prisma, { role: 'ADMIN' });
    userIds.push(a.id);
    return a;
  }

  const lockOf = (pointId: string) => Prisma.sql`SELECT "id" FROM "waste_points" WHERE "id" = ${pointId} FOR NO KEY UPDATE`;
  const reasonOf = (r: PromiseSettledResult<unknown>) => (r as PromiseRejectedResult).reason as Error;
  const activeOwners = (pointId: string) => prisma.wastePointStaff.count({ where: { pointId, role: 'OWNER', isActive: true } });
  const activeRows = (pointId: string) => prisma.wastePointStaff.count({ where: { pointId, isActive: true } });

  async function twoOwners(aFirst: boolean) {
    const a = await admin();
    const A = await owner();
    const B = await owner();
    const point = await pointWithoutStaff();
    const addA = () => svc.addStaff(a.id, point.id, { userId: A.id, role: 'OWNER' });
    const addB = () => svc.addStaff(a.id, point.id, { userId: B.id, role: 'OWNER' });

    const results = aFirst
      ? await raceWithHold(prisma, lockOf(point.id), addA, addB)
      : await raceWithHold(prisma, lockOf(point.id), addB, addA);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(reasonOf(results[1])).toBeInstanceOf(ConflictException);
    expect(reasonOf(results[1]).message).toBe(OWNER_EXISTS);
    expect(await activeOwners(point.id)).toBe(1);
    noDeadlock(results);
  }

  async function fifthPerson(aFirst: boolean) {
    const a = await admin();
    const point = await pointWithoutStaff();
    for (let i = 0; i < 4; i++) {
      const u = await createUser(prisma, { phone: phone() });
      userIds.push(u.id);
      await prisma.wastePointStaff.create({ data: { pointId: point.id, userId: u.id, role: 'STAFF' } });
    }
    const A = await createUser(prisma, { phone: phone() });
    const B = await createUser(prisma, { phone: phone() });
    userIds.push(A.id, B.id);
    const addA = () => svc.addStaff(a.id, point.id, { userId: A.id, role: 'STAFF' });
    const addB = () => svc.addStaff(a.id, point.id, { userId: B.id, role: 'STAFF' });

    const results = aFirst
      ? await raceWithHold(prisma, lockOf(point.id), addA, addB)
      : await raceWithHold(prisma, lockOf(point.id), addB, addA);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(reasonOf(results[1])).toBeInstanceOf(ConflictException);
    expect(reasonOf(results[1]).message).toBe(STAFF_FULL);
    expect(await activeRows(point.id)).toBe(5);
    noDeadlock(results);
  }

  it('add OWNER A then add OWNER B: A is owner, B gets the one-owner 409', () => twoOwners(true));

  it('add OWNER B then add OWNER A: B is owner, A gets the one-owner 409', () => twoOwners(false));

  it('add staff A then add staff B with 4 people already: A is the fifth, B gets the 5-person 409', () => fifthPerson(true));

  it('add staff B then add staff A with 4 people already: B is the fifth, A gets the 5-person 409', () => fifthPerson(false));

  it('remove owner then activate: the activation is refused and the point stays PENDING', async () => {
    const a = await admin();
    const { o, point } = await pointWithOwner();
    const remove = () => svc.removeStaff(a.id, point.id, o.id);
    const activate = () => svc.update(a.id, point.id, { status: 'ACTIVE' });

    const results = await raceWithHold(prisma, lockOf(point.id), remove, activate);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(reasonOf(results[1])).toBeInstanceOf(BadRequestException);
    expect(reasonOf(results[1]).message).toBe(NEEDS_ONE_OWNER);
    expect((await prisma.wastePoint.findUniqueOrThrow({ where: { id: point.id } })).status).toBe('PENDING');
    noDeadlock(results);
  });

  it('activate then remove owner: both succeed, the point is ACTIVE and not available', async () => {
    const a = await admin();
    const { o, point } = await pointWithOwner();
    const remove = () => svc.removeStaff(a.id, point.id, o.id);
    const activate = () => svc.update(a.id, point.id, { status: 'ACTIVE' });

    const results = await raceWithHold(prisma, lockOf(point.id), activate, remove);

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((await prisma.wastePoint.findUniqueOrThrow({ where: { id: point.id } })).status).toBe('ACTIVE');
    expect(await activeOwners(point.id)).toBe(0);
    expect((await access.availablePointIds(prisma, [point.id])).has(point.id)).toBe(false);
    noDeadlock(results);
  });

  async function ownerOfPointWithPerk() {
    const a = await admin();
    const { o, point } = await pointWithOwner();
    await prisma.wastePoint.update({ where: { id: point.id }, data: { status: 'ACTIVE', perkText: 'Ưu đãi cũ' } });
    return { a, o, point };
  }

  it('remove owner then the owner submits a perk: Forbidden, the perk fields stay null and no PERK_SUBMITTED event', async () => {
    const { a, o, point } = await ownerOfPointWithPerk();
    const remove = () => svc.removeStaff(a.id, point.id, o.id);
    const submit = () => desk.submitPerk(o.id, point.id, { perkText: 'Ưu đãi của chủ cũ' });

    const results = await raceWithHold(prisma, lockOf(point.id), remove, submit);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(reasonOf(results[1])).toBeInstanceOf(ForbiddenException);
    const row = await prisma.wastePoint.findUniqueOrThrow({ where: { id: point.id } });
    expect(row.perkText).toBeNull();
    expect(row.perkPendingText).toBeNull();
    expect(await prisma.wasteEvent.count({ where: { pointId: point.id, kind: 'PERK_SUBMITTED' } })).toBe(0);
    noDeadlock(results);
  });

  it('the owner submits a perk then is removed: the perk is stored and then cleared with the owner', async () => {
    const { a, o, point } = await ownerOfPointWithPerk();
    const remove = () => svc.removeStaff(a.id, point.id, o.id);
    const submit = () => desk.submitPerk(o.id, point.id, { perkText: 'Ưu đãi mới' });

    const results = await raceWithHold(prisma, lockOf(point.id), submit, remove);

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const row = await prisma.wastePoint.findUniqueOrThrow({ where: { id: point.id } });
    expect(row.perkText).toBeNull();
    expect(row.perkPendingText).toBeNull();
    expect(await prisma.wasteEvent.count({ where: { pointId: point.id, kind: 'PERK_SUBMITTED' } })).toBe(1);
    noDeadlock(results);
  });
});
