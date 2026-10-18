import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WasteAdminItemsService } from '../../src/modules/waste-exchange/catalog/waste-admin-items.service';
import { WasteAdminGiftsService } from '../../src/modules/waste-exchange/catalog/waste-admin-gifts.service';
import { createUser, deleteItData, warmPool } from './helpers';
import { cleanupWaste, createWasteGift, createWasteItem, holdLock } from './fixtures/waste-fixtures';

const SETTLE_MS = 3000;

/**
 * Sắp xếp lại món và quà so với khoá KEY SHARE mà Postgres giữ trên dòng cha khi một FK được chèn
 * (waste_request_lines.itemId, waste_gift_redemptions.giftId): sắp xếp không được chờ khoá đó.
 */
describe('waste reorder vs foreign-key KEY SHARE (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let items: WasteAdminItemsService;
  let gifts: WasteAdminGiftsService;
  const userIds: string[] = [];
  const itemIds: string[] = [];
  const giftIds: string[] = [];
  let itemOrder: { id: string; sortOrder: number }[] = [];
  let giftOrder: { id: string; sortOrder: number }[] = [];

  const newAdmin = async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    userIds.push(admin.id);
    return admin;
  };
  const settledWithin = async (p: Promise<unknown>, ms: number): Promise<boolean> => {
    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      p.then(() => true, () => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
    clearTimeout(timer);
    return outcome;
  };
  const noDeadlock = (results: PromiseSettledResult<unknown>[]) => {
    const errors = results.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));
    expect(errors.join()).not.toMatch(/40P01|deadlock|P2034/);
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [WasteAdminItemsService, WasteAdminGiftsService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    items = moduleRef.get(WasteAdminItemsService);
    gifts = moduleRef.get(WasteAdminGiftsService);
    itemOrder = await prisma.wasteItem.findMany({ select: { id: true, sortOrder: true } });
    giftOrder = await prisma.wasteGift.findMany({ select: { id: true, sortOrder: true } });
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "waste_events" WHERE "kind" IN ('ITEMS_REORDERED', 'GIFTS_REORDERED') AND "actorUserId" = ANY(${userIds}::text[])`;
    for (const r of itemOrder) await prisma.wasteItem.update({ where: { id: r.id }, data: { sortOrder: r.sortOrder } });
    for (const r of giftOrder) await prisma.wasteGift.update({ where: { id: r.id }, data: { sortOrder: r.sortOrder } });
    await cleanupWaste(prisma, { itemIds, giftIds });
    await deleteItData(prisma, { userIds });
    await moduleRef?.close();
  });

  const allIds = async (table: 'items' | 'gifts') => {
    const rows =
      table === 'items'
        ? await prisma.wasteItem.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
        : await prisma.wasteGift.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    return rows.map((r) => r.id);
  };

  it('items reorder completes while an FK check holds KEY SHARE on a row', async () => {
    const admin = await newAdmin();
    for (let i = 0; i < 2; i++) itemIds.push((await createWasteItem(prisma, { status: 'COMING_SOON' })).id);
    const ids = await allIds('items');
    const highest = ids[ids.length - 1]!;
    const hold = await holdLock(prisma, Prisma.sql`SELECT 1 FROM "waste_items" WHERE "id" = ${highest} FOR KEY SHARE`);
    let reorder: Promise<unknown> | undefined;
    let settled = false;
    try {
      reorder = items.reorder(admin.id, { ids: [...ids].reverse() });
      reorder.catch(() => undefined);
      settled = await settledWithin(reorder, SETTLE_MS);
    } finally {
      hold.release();
      await hold.done;
    }
    const result = reorder ? await Promise.allSettled([reorder]) : [];
    expect(settled).toBe(true);
    expect(result.map((r) => r.status)).toEqual(['fulfilled']);
  });

  it('gifts reorder completes while an FK check holds KEY SHARE on a row', async () => {
    const admin = await newAdmin();
    for (let i = 0; i < 2; i++) giftIds.push((await createWasteGift(prisma, { status: 'HIDDEN' })).id);
    const ids = await allIds('gifts');
    const highest = ids[ids.length - 1]!;
    const hold = await holdLock(prisma, Prisma.sql`SELECT 1 FROM "waste_gifts" WHERE "id" = ${highest} FOR KEY SHARE`);
    let reorder: Promise<unknown> | undefined;
    let settled = false;
    try {
      reorder = gifts.reorder(admin.id, { ids: [...ids].reverse() });
      reorder.catch(() => undefined);
      settled = await settledWithin(reorder, SETTLE_MS);
    } finally {
      hold.release();
      await hold.done;
    }
    const result = reorder ? await Promise.allSettled([reorder]) : [];
    expect(settled).toBe(true);
    expect(result.map((r) => r.status)).toEqual(['fulfilled']);
  });

  it('two concurrent items reorders with opposite bodies end in one consistent order', async () => {
    const [adminA, adminB] = [await newAdmin(), await newAdmin()];
    const ids = await allIds('items');

    const results = await Promise.allSettled([
      items.reorder(adminA.id, { ids }),
      items.reorder(adminB.id, { ids: [...ids].reverse() }),
    ]);

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    noDeadlock(results);
    const rows = await prisma.wasteItem.findMany({ select: { id: true, sortOrder: true } });
    const byOrder = [...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.id);
    expect([ids, [...ids].reverse()]).toContainEqual(byOrder);
  });

  it('two concurrent gifts reorders with opposite bodies end in one consistent order', async () => {
    const [adminA, adminB] = [await newAdmin(), await newAdmin()];
    const ids = await allIds('gifts');

    const results = await Promise.allSettled([
      gifts.reorder(adminA.id, { ids }),
      gifts.reorder(adminB.id, { ids: [...ids].reverse() }),
    ]);

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    noDeadlock(results);
    const rows = await prisma.wasteGift.findMany({ select: { id: true, sortOrder: true } });
    const byOrder = [...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.id);
    expect([ids, [...ids].reverse()]).toContainEqual(byOrder);
  });
});
