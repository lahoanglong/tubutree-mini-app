import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WasteAdminItemsService } from '../../src/modules/waste-exchange/catalog/waste-admin-items.service';
import { createUser, deleteItData, randCode, warmPool } from './helpers';
import { cleanupWaste, createWasteItem, raceWithHold } from './fixtures/waste-fixtures';

function noDeadlock(results: PromiseSettledResult<unknown>[]) {
  const errors = results.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));
  expect(errors.join()).not.toMatch(/40P01|deadlock|P2034/);
}

/**
 * WasteAdminItemsService trên Postgres thật: hai lần tạo cùng mã món, và cờ nguy hại đua với việc đặt Đang nhận.
 */
describe('waste-admin-items race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let items: WasteAdminItemsService;
  const userIds: string[] = [];
  const itemIds: string[] = [];
  const codes: string[] = [];

  const newAdmin = async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    userIds.push(admin.id);
    return admin;
  };
  const newItem = async () => {
    const item = await createWasteItem(prisma, { status: 'COMING_SOON', hazardous: false });
    itemIds.push(item.id);
    return item;
  };
  const itemLock = (id: string) => Prisma.sql`SELECT "id" FROM "waste_items" WHERE "id" = ${id} FOR UPDATE`;
  const rowOf = (id: string) => prisma.wasteItem.findUniqueOrThrow({ where: { id }, select: { hazardous: true, status: true } });
  const noHazardousActive = async () => {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS "n" FROM "waste_items" WHERE "hazardous" AND "status" = 'ACTIVE'`;
    expect(row?.n).toBe(0);
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [WasteAdminItemsService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    items = moduleRef.get(WasteAdminItemsService);
  });

  afterAll(async () => {
    const created = await prisma.wasteItem.findMany({ where: { code: { in: codes } }, select: { id: true } });
    const all = [...itemIds, ...created.map((c) => c.id)];
    await prisma.$executeRaw`DELETE FROM "waste_events" WHERE "kind" IN ('ITEM_CREATED', 'ITEM_UPDATED') AND "meta"->>'itemId' = ANY(${all}::text[])`;
    await cleanupWaste(prisma, { itemIds: all });
    await deleteItData(prisma, { userIds });
    await moduleRef?.close();
  });

  const duplicateCreate = async (swap: boolean) => {
    const [adminA, adminB] = [await newAdmin(), await newAdmin()];
    const code = `IT_DUP_${randCode(4).toUpperCase()}`;
    codes.push(code);
    const body = { code, name: 'IT dup', unitLabel: 'cái', unitsPerPoint: 1, pointsPerGroup: 1000 };
    const calls = [() => items.create(adminA.id, body), () => items.create(adminB.id, body)];
    if (swap) calls.reverse();

    const results = await Promise.allSettled(calls.map((c) => c()));

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect((rejected.reason as ConflictException).message).toBe('Mã món đã tồn tại.');
    expect(await prisma.wasteItem.count({ where: { code } })).toBe(1);
    noDeadlock(results);
  };

  it('create A then create B with the same code: one wins, the other gets a 409', () => duplicateCreate(false));

  it('create B then create A with the same code: one wins, the other gets a 409', () => duplicateCreate(true));

  it('hazardous then activate: the flag stands and the ACTIVE edit is refused', async () => {
    const admin = await newAdmin();
    const item = await newItem();

    const results = await raceWithHold(
      prisma,
      itemLock(item.id),
      () => items.update(admin.id, item.id, { hazardous: true }),
      () => items.update(admin.id, item.id, { status: 'ACTIVE' }),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ status: 400, message: 'Món nguy hại không được đặt Đang nhận.' });
    expect(await rowOf(item.id)).toEqual({ hazardous: true, status: 'COMING_SOON' });
    await noHazardousActive();
    noDeadlock(results);
  });

  it('activate then hazardous: the item stays ACTIVE and the flag is refused', async () => {
    const admin = await newAdmin();
    const item = await newItem();

    const results = await raceWithHold(
      prisma,
      itemLock(item.id),
      () => items.update(admin.id, item.id, { status: 'ACTIVE' }),
      () => items.update(admin.id, item.id, { hazardous: true }),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({
      status: 400,
      message: 'Món đang nhận không bật được cờ nguy hại; hãy chuyển món sang Sắp nhận hoặc Ẩn trước.',
    });
    expect(await rowOf(item.id)).toEqual({ hazardous: false, status: 'ACTIVE' });
    await noHazardousActive();
    noDeadlock(results);
  });
});
