import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WasteAccessService } from '../../src/modules/waste-exchange/core/waste-access.service';
import { createUser as createItUser, deleteItData, warmPool } from './helpers';
import { cleanupWaste, createWarehouse, createWastePoint } from './fixtures/waste-fixtures';

let moduleRef: TestingModule;
let prisma: PrismaService;
let access: WasteAccessService;
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
  moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [WasteAccessService] }).compile();
  prisma = moduleRef.get(PrismaService);
  access = moduleRef.get(WasteAccessService);
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
