import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createOrder, createUser, deleteItData, randCode } from './helpers';
import { readApiSql, splitSqlStatements } from './sql-script';
import {
  cleanupWaste, createGiftRedemption, createWarehouse, createWasteGift, createWasteItem, createWastePoint, createWasteRequest,
} from './fixtures/waste-fixtures';

const MIGRATION = 'prisma/migrations/20261020000000_waste_exchange/migration.sql';
// Spec 11.4 (lines 306-312) with $3 and $4 cast to int; M3.1a incrementPointUsage uses this exact text.
const QUOTA_SQL = `INSERT INTO waste_point_usage ("pointId", "monthKey", "pointsUsed", confirmations) VALUES ($1, $2, $3::int, 1) ON CONFLICT ("pointId", "monthKey") DO UPDATE SET "pointsUsed" = waste_point_usage."pointsUsed" + EXCLUDED."pointsUsed", confirmations = waste_point_usage.confirmations + 1 WHERE waste_point_usage."pointsUsed" + EXCLUDED."pointsUsed" <= $4::int RETURNING "pointsUsed"`;

describe('waste DB constraints (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const userIds: string[] = [];
  const reg = { pointIds: [] as string[], itemIds: [] as string[], giftIds: [] as string[], storefrontIds: [] as string[] };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
  });
  afterAll(async () => {
    await cleanupWaste(prisma, reg);
    await deleteItData(prisma, { userIds });
    await moduleRef?.close();
  });

  const exec = (sql: string, ...params: unknown[]) => prisma.$executeRawUnsafe(sql, ...params);
  const violates = (p: Promise<unknown>, constraint: string) =>
    expect(p).rejects.toThrow(new RegExp(`violates check constraint "${constraint}"`));
  const setRow = (table: string, id: string, clause: string) => exec(`UPDATE "${table}" SET ${clause} WHERE "id" = $1`, id);

  it('waste_items checks accept the boundary and reject one step beyond', async () => {
    const item = await createWasteItem(prisma);
    reg.itemIds.push(item.id);
    const set = (c: string) => setRow('waste_items', item.id, c);
    await violates(set(`"unitsPerPoint" = 0`), 'waste_items_units_per_point_chk');
    await set(`"unitsPerPoint" = 5`);
    await violates(set(`"pointsPerGroup" = 0`), 'waste_items_points_per_group_chk');
    await set(`"pointsPerGroup" = 2000`);
    await violates(set(`"dropsPerUnit" = -1`), 'waste_items_drops_chk');
    await set(`"dropsPerUnit" = 0`);
    await violates(set(`"dailyCapQty" = 0`), 'waste_items_daily_cap_chk');
    await set(`"dailyCapQty" = 10`);
    await set(`"dailyCapQty" = NULL`);
    await violates(set(`"monthlyCapQty" = 0`), 'waste_items_monthly_cap_chk');
    await set(`"monthlyCapQty" = 60`);
    await violates(set(`"hazardous" = true`), 'waste_items_hazardous_not_active_chk');
    await set(`"hazardous" = true, "status" = 'COMING_SOON'`);
    await violates(set(`"status" = 'ACTIVE'`), 'waste_items_hazardous_not_active_chk');
  });

  it('waste_points checks: partner needs a quota, warehouse never pauses', async () => {
    const warehouse = await createWarehouse(prisma);
    const partner = await createWastePoint(prisma, { kind: 'PARTNER', quota: 100_000 });
    reg.pointIds.push(partner.id);
    const set = (id: string, c: string) => setRow('waste_points', id, c);
    await violates(set(partner.id, `"monthlyQuotaPoints" = NULL`), 'waste_points_partner_quota_chk');
    await set(partner.id, `"monthlyQuotaPoints" = 300000`);
    await set(warehouse.id, `"monthlyQuotaPoints" = NULL`);
    await violates(set(warehouse.id, `"status" = 'PAUSED'`), 'waste_points_warehouse_active_chk');
    await violates(set(warehouse.id, `"status" = 'PENDING'`), 'waste_points_warehouse_active_chk');
    await set(partner.id, `"status" = 'PAUSED'`);
  });

  it('waste_requests_expires_at_chk covers its three branches; request line and usage checks hold', async () => {
    const user = await createUser(prisma);
    userIds.push(user.id);
    const item = await createWasteItem(prisma, { unitsPerPoint: 1 });
    reg.itemIds.push(item.id);
    const warehouse = await createWarehouse(prisma);
    const order = await createOrder(prisma, { userId: user.id });
    const mk = (method: 'MAIL_IN' | 'PICKUP') =>
      createWasteRequest(prisma, { userId: user.id, method, status: 'OPEN', pointId: warehouse.id, lines: [{ itemId: item.id, declaredQty: 3 }] });
    const [mailin, pickup, pickup2] = [await mk('MAIL_IN'), await mk('PICKUP'), await mk('PICKUP')];
    const chk = 'waste_requests_expires_at_chk';
    const set = (id: string, c: string) => setRow('waste_requests', id, c);
    await violates(set(pickup.id, `"orderId" = '${order.id}'`), chk);
    await set(pickup.id, `"orderId" = '${order.id}', "expiresAt" = NULL`);
    // spec 11.3 and 18.3: the order-delivered hook moves an attached OPEN pickup to IN_TRANSIT and sets expiresAt in one statement; either half alone breaks the CHECK
    await violates(set(pickup.id, `"status" = 'IN_TRANSIT'`), chk);
    await violates(set(pickup.id, `"expiresAt" = now() + interval '14 days'`), chk);
    await set(pickup.id, `"status" = 'IN_TRANSIT', "inTransitAt" = now(), "expiresAt" = now() + interval '14 days'`);
    await violates(set(mailin.id, `"status" = 'IN_TRANSIT'`), chk);
    await set(mailin.id, `"status" = 'IN_TRANSIT', "expiresAt" = NULL`);
    await violates(set(pickup2.id, `"status" = 'IN_TRANSIT', "expiresAt" = NULL`), chk);
    await set(pickup2.id, `"status" = 'IN_TRANSIT'`);

    const [line] = await prisma.wasteRequestLine.findMany({ where: { requestId: mailin.id } });
    const setLine = (c: string) => setRow('waste_request_lines', line!.id, c);
    await violates(setLine(`"receivedQty" = 4`), 'waste_request_lines_received_chk');
    await violates(setLine(`"receivedQty" = -1`), 'waste_request_lines_received_chk');
    await setLine(`"receivedQty" = 3`);
    await setLine(`"receivedQty" = 0`);
    await violates(setLine(`"declaredQty" = 0`), 'waste_request_lines_declared_chk');

    const partner = await createWastePoint(prisma, { kind: 'PARTNER' });
    reg.pointIds.push(partner.id);
    await prisma.wastePointUsage.create({ data: { pointId: partner.id, monthKey: '2026-10' } });
    await violates(
      exec(`UPDATE "waste_point_usage" SET "pointsUsed" = -1 WHERE "pointId" = $1 AND "monthKey" = '2026-10'`, partner.id),
      'waste_point_usage_points_chk',
    );
    await exec(`UPDATE "waste_point_usage" SET "pointsUsed" = 0 WHERE "pointId" = $1 AND "monthKey" = '2026-10'`, partner.id);
  });

  it('waste_gifts and waste_gift_redemptions checks', async () => {
    const user = await createUser(prisma);
    userIds.push(user.id);
    const gift = await createWasteGift(prisma, { kind: 'GIFT', pointsCost: 10_000, stock: 5 });
    const voucher = await createWasteGift(prisma, { kind: 'VOUCHER', pointsCost: 20_000, voucherType: 'FREESHIP', voucherValue: 0, voucherValidDays: 30 });
    const tree = await createWasteGift(prisma, { kind: 'TREE', pointsCost: 0 });
    reg.giftIds.push(gift.id, voucher.id, tree.id);
    const set = (id: string, c: string) => setRow('waste_gifts', id, c);
    await violates(set(gift.id, `"stock" = -1`), 'waste_gifts_stock_chk');
    await set(gift.id, `"stock" = 0`);
    await set(gift.id, `"stock" = NULL`);
    await violates(set(gift.id, `"pointsCost" = 0`), 'waste_gifts_points_cost_chk');
    await violates(set(gift.id, `"pointsCost" = 2000001`), 'waste_gifts_points_cost_chk');
    await set(gift.id, `"pointsCost" = 1`);
    await set(gift.id, `"pointsCost" = 2000000`);
    await violates(set(gift.id, `"kind" = 'VOUCHER'`), 'waste_gifts_voucher_fields_chk');
    for (const col of ['voucherType', 'voucherValue', 'voucherValidDays']) {
      await violates(set(voucher.id, `"${col}" = NULL`), 'waste_gifts_voucher_fields_chk');
    }
    await set(voucher.id, `"voucherMinOrder" = NULL, "voucherMaxDiscount" = NULL`);
    expect(tree.pointsCost).toBe(0);

    const redemption = await createGiftRedemption(prisma, { userId: user.id, giftId: gift.id, status: 'READY', giftKind: 'GIFT' });
    const setRed = (c: string) => setRow('waste_gift_redemptions', redemption.id, c);
    await violates(setRed(`"code" = NULL`), 'waste_gift_redemptions_ready_chk');
    await violates(setRed(`"giftKind" = 'VOUCHER'`), 'waste_gift_redemptions_ready_chk');
    await setRed(`"status" = 'FULFILLED', "code" = NULL`);
  });

  it('points_transactions partial unique indexes key on refId per refType, across users', async () => {
    const [a, b] = [await createUser(prisma), await createUser(prisma)];
    userIds.push(a.id, b.id);
    const ref = randCode(8);
    const ins = (id: string, userId: string, refType: string) =>
      exec(`INSERT INTO "points_transactions" ("id", "userId", "delta", "reason", "refType", "refId") VALUES ($1, $2, 1000, 'IT', $3, $4)`, id, userId, refType, ref);
    const cases: [string, string][] = [
      ['RECYCLE', 'points_transactions_recycle_ref_key'],
      ['RECYCLE_REVERSED', 'points_transactions_recycle_reverse_key'],
      ['GIFT_REFUND', 'points_transactions_gift_refund_key'],
    ];
    for (const [type, name] of cases) {
      await ins(`it-${type}-1-${ref}`, a.id, type);
      // Prisma's raw-query error carries the SQLSTATE and the key, not the index name; the name is pinned by the pg_indexes lookup below.
      await expect(ins(`it-${type}-2-${ref}`, b.id, type)).rejects.toMatchObject({ meta: { code: '23505' } });
      const [idx] = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = $1 AND indexdef LIKE $2`, name, `%'${type}'%`);
      expect(idx!.n).toBe(1);
    }
    // The path RewardPointsService.grant takes (applyPointsDelta with skipDuplicates calls createManyAndReturn): spec 18.3 asks for a check through Prisma.
    const skipped = await prisma.pointsTransaction.createManyAndReturn({
      data: [{ id: `it-RECYCLE-3-${ref}`, userId: b.id, delta: 1000, reason: 'IT', refType: 'RECYCLE', refId: ref }],
      skipDuplicates: true,
      select: { id: true },
    });
    expect(skipped).toEqual([]);
    const [row] = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "points_transactions" WHERE "refId" = $1`, ref);
    expect(row!.n).toBe(3);
  });

  it('waste_points_one_warehouse_key and waste_point_staff_one_owner_key', async () => {
    await createWarehouse(prisma);
    await expect(
      prisma.wastePoint.create({
        data: { kind: 'WAREHOUSE', status: 'ACTIVE', name: 'IT second', addressLine: 'IT', provinceCode: '79', provinceName: 'TP.HCM', communeCode: 'IT', communeName: 'IT' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const [o1, o2, s1] = [await createUser(prisma), await createUser(prisma), await createUser(prisma)];
    userIds.push(o1.id, o2.id, s1.id);
    const partner = await createWastePoint(prisma, { kind: 'PARTNER', ownerUserId: o1.id });
    reg.pointIds.push(partner.id);
    if (partner.createdStorefront) reg.storefrontIds.push(partner.ownerStorefrontId!);
    await expect(prisma.wastePointStaff.create({ data: { pointId: partner.id, userId: o2.id, role: 'OWNER' } })).rejects.toMatchObject({ code: 'P2002' });
    await prisma.wastePointStaff.create({ data: { pointId: partner.id, userId: s1.id, role: 'STAFF' } });
    await prisma.wastePointStaff.updateMany({ where: { pointId: partner.id, userId: o1.id }, data: { isActive: false } });
    await prisma.wastePointStaff.create({ data: { pointId: partner.id, userId: o2.id, role: 'OWNER' } });
  });

  it('two partner points of the same owner reuse one storefront (storefronts_ownerUserId_key, no P2002)', async () => {
    const owner = await createUser(prisma);
    userIds.push(owner.id);
    const first = await createWastePoint(prisma, { kind: 'PARTNER', ownerUserId: owner.id });
    const second = await createWastePoint(prisma, { kind: 'PARTNER', ownerUserId: owner.id });
    reg.pointIds.push(first.id, second.id);
    if (first.createdStorefront) reg.storefrontIds.push(first.ownerStorefrontId!);
    expect([first.createdStorefront, second.createdStorefront]).toEqual([true, false]);
    expect(second.ownerStorefrontId).toBe(first.ownerStorefrontId);
    expect(await prisma.storefront.count({ where: { ownerUserId: owner.id } })).toBe(1);
  });

  it('spec 11.4 statement increments atomically, refuses past the quota, and is exact under concurrency', async () => {
    const partner = await createWastePoint(prisma, { kind: 'PARTNER', quota: 12_000 });
    reg.pointIds.push(partner.id);
    const hit = () => prisma.$queryRawUnsafe<{ pointsUsed: number }[]>(QUOTA_SQL, partner.id, '2026-10', 5000, 12_000);
    expect(await hit()).toEqual([{ pointsUsed: 5000 }]);
    expect(await hit()).toEqual([{ pointsUsed: 10_000 }]);
    expect(await hit()).toEqual([]);

    const fresh = await createWastePoint(prisma, { kind: 'PARTNER', quota: 12_000 });
    reg.pointIds.push(fresh.id);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => prisma.$queryRawUnsafe<{ pointsUsed: number }[]>(QUOTA_SQL, fresh.id, '2026-10', 5000, 12_000)),
    );
    expect(results.filter((r) => r.length === 1)).toHaveLength(2);
    const [usage] = await prisma.wastePointUsage.findMany({ where: { pointId: fresh.id, monthKey: '2026-10' } });
    expect(usage).toMatchObject({ pointsUsed: 10_000, confirmations: 2 });
  });

  it('re-applying the hand-written section is a no-op (IF NOT EXISTS and duplicate_object guards)', async () => {
    const sql = readApiSql(MIGRATION);
    const a = sql.indexOf('-- BEGIN WASTE HAND-WRITTEN CONSTRAINTS');
    const b = sql.indexOf('-- END WASTE HAND-WRITTEN CONSTRAINTS');
    const statements = splitSqlStatements(sql.slice(a, b));
    expect(statements).toHaveLength(21);
    for (let pass = 0; pass < 2; pass++) for (const s of statements) await prisma.$executeRawUnsafe(s);
  });
});
