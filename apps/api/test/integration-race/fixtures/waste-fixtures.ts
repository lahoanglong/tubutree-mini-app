import { Prisma, type PrismaClient, type WasteGift, type WasteGiftKind, type WasteGiftRedemption, type WasteGiftRedemptionStatus, type WasteItem, type WasteMethod, type WastePoint, type WasteRequest, type WasteRequestStatus } from '@prisma/client';
import { vnDateKey, vnMonthKey } from '../../../src/common/vn-time';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import { randCode, sleep } from '../helpers';

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const DAY_MS = 24 * 60 * 60 * 1000;

function code5(len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

export function createWasteItem(prisma: PrismaService, over: Partial<Prisma.WasteItemUncheckedCreateInput> = {}): Promise<WasteItem> {
  return prisma.wasteItem.create({
    data: {
      code: `IT_${randCode(6)}`,
      name: 'IT item',
      unitLabel: 'cái',
      unitsPerPoint: 1,
      pointsPerGroup: 1000,
      dropsPerUnit: 0,
      status: 'ACTIVE',
      sortOrder: 999,
      ...over,
    },
  });
}

export async function createWarehouse(prisma: PrismaService): Promise<WastePoint> {
  const existing = await prisma.wastePoint.findFirst({ where: { kind: 'WAREHOUSE' } });
  if (existing) return existing;
  try {
    return await prisma.wastePoint.create({
      data: {
        kind: 'WAREHOUSE',
        status: 'ACTIVE',
        name: 'IT Kho',
        addressLine: 'IT',
        provinceCode: '79',
        provinceName: 'TP.HCM',
        communeCode: 'IT',
        communeName: 'IT',
        activatedAt: new Date(),
      },
    });
  } catch (e) {
    // Another suite created the single warehouse between the read and the insert (waste_points_one_warehouse_key).
    if ((e as { code?: string }).code !== 'P2002') throw e;
    return prisma.wastePoint.findFirstOrThrow({ where: { kind: 'WAREHOUSE' } });
  }
}

export async function createWastePoint(
  prisma: PrismaService,
  opts: { kind: 'WAREHOUSE' | 'PARTNER'; ownerUserId?: string; quota?: number; itemIds?: string[] },
): Promise<WastePoint & { ownerStorefrontId: string | null; createdStorefront: boolean }> {
  if (opts.kind === 'WAREHOUSE') {
    return { ...(await createWarehouse(prisma)), ownerStorefrontId: null, createdStorefront: false };
  }
  const tag = randCode(6);
  const point = await prisma.wastePoint.create({
    data: {
      kind: 'PARTNER',
      status: 'ACTIVE',
      name: `IT điểm nhận ${tag}`,
      addressLine: 'IT',
      provinceCode: '79',
      provinceName: 'TP.HCM',
      communeCode: 'IT',
      communeName: 'IT',
      monthlyQuotaPoints: opts.quota ?? 100_000,
      activatedAt: new Date(),
    },
  });
  let ownerStorefrontId: string | null = null;
  let createdStorefront = false;
  if (opts.ownerUserId) {
    await prisma.wastePointStaff.create({ data: { pointId: point.id, userId: opts.ownerUserId, role: 'OWNER', isActive: true } });
    const found = await prisma.storefront.findFirst({ where: { ownerUserId: opts.ownerUserId } });
    if (found) {
      if (found.type !== 'MERCHANT' && !found.isPartner) await prisma.storefront.update({ where: { id: found.id }, data: { isPartner: true } });
      ownerStorefrontId = found.id;
    } else {
      const t = randCode(8).toLowerCase();
      const created = await prisma.storefront.create({
        data: { type: 'MERCHANT', isPartner: true, slug: 'wx-' + t, subdomain: 'wx-' + t, ownerUserId: opts.ownerUserId, title: 'IT điểm nhận ' + t, isPublished: true },
      });
      ownerStorefrontId = created.id;
      createdStorefront = true;
    }
  }
  if (opts.itemIds?.length) {
    await prisma.wastePointItem.createMany({ data: opts.itemIds.map((itemId) => ({ pointId: point.id, itemId })) });
  }
  return { ...point, ownerStorefrontId, createdStorefront };
}

export async function createWasteRequest(
  prisma: PrismaService,
  o: {
    userId: string;
    method: WasteMethod;
    status: WasteRequestStatus;
    pointId: string;
    lines: { itemId: string; declaredQty: number; receivedQty?: number }[];
    orderId?: string;
    capMonthKey?: string;
    expiresAt?: Date | null;
    estimatedPoints?: number;
  },
): Promise<WasteRequest> {
  const items = await prisma.wasteItem.findMany({ where: { id: { in: o.lines.map((l) => l.itemId) } } });
  const byId = new Map(items.map((i) => [i.id, i]));
  const rows = o.lines.map((l) => ({ line: l, item: byId.get(l.itemId)! }));
  const estimatedPoints =
    o.estimatedPoints ?? rows.reduce((s, { line, item }) => s + Math.floor(line.declaredQty / item.unitsPerPoint) * item.pointsPerGroup, 0);
  const estimatedDrops = rows.reduce((s, { line, item }) => s + line.declaredQty * item.dropsPerUnit, 0);
  const now = Date.now();
  const defaultExpiresAt =
    o.status === 'OPEN' && !o.orderId
      ? new Date(now + 7 * DAY_MS)
      : o.method === 'PICKUP' && o.status === 'IN_TRANSIT'
        ? new Date(now + 14 * DAY_MS)
        : null;
  return prisma.wasteRequest.create({
    data: {
      code: `TR-${code5(5)}`,
      userId: o.userId,
      method: o.method,
      status: o.status,
      pointId: o.pointId,
      orderId: o.orderId,
      estimatedPoints,
      estimatedDrops,
      capDayKey: vnDateKey(),
      capMonthKey: o.capMonthKey ?? vnMonthKey(),
      expiresAt: o.expiresAt === undefined ? defaultExpiresAt : o.expiresAt,
      idempotencyKey: `it-${randCode(12)}`,
      consentAt: new Date(),
      consentVersion: '2026-10-17.1',
      lines: {
        create: rows.map(({ line, item }) => ({
          itemId: item.id,
          itemCode: item.code,
          itemName: item.name,
          unitLabel: item.unitLabel,
          unitsPerPoint: item.unitsPerPoint,
          pointsPerGroup: item.pointsPerGroup,
          dropsPerUnit: item.dropsPerUnit,
          gramsPerUnit: item.gramsPerUnit,
          declaredQty: line.declaredQty,
          receivedQty: line.receivedQty,
        })),
      },
    },
  });
}

export function createWasteGift(prisma: PrismaService, over: Partial<Prisma.WasteGiftUncheckedCreateInput> = {}): Promise<WasteGift> {
  return prisma.wasteGift.create({
    data: { id: `it-gift-${randCode(8)}`, kind: 'GIFT', name: 'IT gift', pointsCost: 10_000, status: 'ACTIVE', ...over },
  });
}

export async function createGiftRedemption(
  prisma: PrismaService,
  o: { userId: string; giftId?: string; status?: WasteGiftRedemptionStatus; giftKind?: WasteGiftKind; code?: string | null; pointsCost?: number },
): Promise<WasteGiftRedemption> {
  const gift = o.giftId ? await prisma.wasteGift.findUniqueOrThrow({ where: { id: o.giftId } }) : await createWasteGift(prisma);
  return prisma.wasteGiftRedemption.create({
    data: {
      userId: o.userId,
      giftId: gift.id,
      giftKind: o.giftKind ?? 'GIFT',
      giftName: gift.name,
      pointsCost: o.pointsCost ?? 10_000,
      status: o.status ?? 'READY',
      code: o.code === undefined ? `QG-${code5(8)}` : o.code,
      idempotencyKey: `it-${randCode(12)}`,
      claimExpiresAt: new Date(Date.now() + 60 * DAY_MS),
    },
  });
}

export async function cleanupWaste(
  prisma: PrismaService,
  ids: { pointIds?: string[]; itemIds?: string[]; giftIds?: string[]; storefrontIds?: string[] },
): Promise<void> {
  const pointIds = ids.pointIds ?? [];
  const itemIds = ids.itemIds ?? [];
  const giftIds = ids.giftIds ?? [];
  const storefrontIds = ids.storefrontIds ?? [];
  await prisma.storefront.updateMany({ where: { id: { in: storefrontIds } }, data: { ownerUserId: null } });
  await prisma.$executeRaw`
    DELETE FROM "waste_events"
    WHERE "pointId" = ANY(${pointIds}::text[])
       OR "requestId" IN (SELECT "id" FROM "waste_requests" WHERE "pointId" = ANY(${pointIds}::text[]))`;
  await prisma.wasteRequest.deleteMany({ where: { pointId: { in: pointIds } } });
  await prisma.wasteGiftRedemption.deleteMany({ where: { giftId: { in: giftIds } } });
  await prisma.wasteGift.deleteMany({ where: { id: { in: giftIds } } });
  await prisma.wastePoint.deleteMany({ where: { id: { in: pointIds } } });
  await prisma.wastePointItem.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.wasteRequestLine.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.wasteItem.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.storefront.deleteMany({ where: { id: { in: storefrontIds } } });
}

export async function holdLock(
  prisma: PrismaClient,
  lockSql: Prisma.Sql,
): Promise<{ pid: number; release: () => void; done: Promise<void> }> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let locked!: (pid: number) => void;
  let failed!: (e: unknown) => void;
  const held = new Promise<number>((resolve, reject) => {
    locked = resolve;
    failed = reject;
  });
  // $executeRaw, never $queryRaw: Prisma 5.22 cannot deserialize the void result of pg_advisory_xact_lock.
  const done = prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw(lockSql);
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid()::int AS "pid"`;
      locked(row!.pid);
      await gate;
    },
    { timeout: 30_000 },
  );
  done.catch(failed);
  const pid = await held;
  return { pid, release, done };
}

/** Backends blocked, directly or behind another blocked backend, by the transaction of `holderPid`. */
export async function lockWaiters(prisma: PrismaClient, holderPid: number): Promise<number> {
  const [row] = await prisma.$queryRaw<{ n: number }[]>`
    WITH RECURSIVE "w" AS (
      SELECT "pid" FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids("pid"))
      UNION
      SELECT a."pid" FROM pg_stat_activity a JOIN "w" ON "w"."pid" = ANY(pg_blocking_pids(a."pid"))
    )
    SELECT count(*)::int AS "n" FROM "w"`;
  return row?.n ?? 0;
}

export async function waitUntil(cond: () => Promise<boolean> | boolean, what: string, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await cond()) return;
    await sleep(25);
  }
  throw new Error('timeout waiting for ' + what);
}

// Race specs run with --runInBand, so only the sessions of the current case count.
export async function blockedBackends(prisma: PrismaClient): Promise<number> {
  const [row] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS "n" FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid() AND cardinality(pg_blocking_pids(pid)) > 0`;
  return row?.n ?? 0;
}

export async function raceWithHold<A, B>(
  prisma: PrismaClient,
  lockSql: Prisma.Sql,
  first: () => Promise<A>,
  second: () => Promise<B>,
): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
  const hold = await holdLock(prisma, lockSql);
  let a!: Promise<A>;
  let b!: Promise<B>;
  try {
    a = first();
    a.catch(() => undefined);
    await waitUntil(async () => (await lockWaiters(prisma, hold.pid)) >= 1, 'first contender queued behind the held lock');
    b = second();
    b.catch(() => undefined);
    await waitUntil(async () => (await lockWaiters(prisma, hold.pid)) >= 2, 'second contender queued behind the held lock');
  } finally {
    hold.release();
    await hold.done;
  }
  return Promise.allSettled([a, b]);
}

export function holdFirstCall<T extends object, K extends keyof T>(
  obj: T,
  method: K,
): { reached: Promise<void>; release: () => void; restore: () => void } {
  const original = (obj[method] as unknown as (...a: unknown[]) => unknown).bind(obj);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let markReached!: () => void;
  const reached = new Promise<void>((resolve) => (markReached = resolve));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spy = jest.spyOn(obj as any, method as any).mockImplementationOnce(async (...args: unknown[]) => {
    markReached();
    await gate;
    return original(...args);
  });
  return { reached, release, restore: () => spy.mockRestore() };
}
