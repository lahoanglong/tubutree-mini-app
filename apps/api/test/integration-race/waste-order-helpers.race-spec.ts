import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createUser, deleteItData, randCode, summarize } from './helpers';
import { blockedBackends, holdFirstCall, holdLock, lockWaiters, raceWithHold, waitUntil } from './fixtures/waste-fixtures';

describe('waste race order helpers (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const userIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
  });
  afterAll(async () => {
    await deleteItData(prisma, { userIds });
    await moduleRef?.close();
  });

  const contender = (lockSql: Prisma.Sql, name: string, order: string[]) => () =>
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(lockSql);
        order.push(name);
      },
      { timeout: 30_000 },
    );

  it('holdLock on an advisory lock: two $executeRaw contenders queue (lockWaiters reaches 2) and finish in start order after release', async () => {
    // 731999 is a test-only class: the four waste classes 731001-731004 belong to production code.
    const lock = Prisma.sql`SELECT pg_advisory_xact_lock(731999, hashtext(${randCode(8)}))`;
    const order: string[] = [];
    const hold = await holdLock(prisma, lock);
    let first!: Promise<void>;
    let second!: Promise<void>;
    try {
      first = contender(lock, 'first', order)();
      await waitUntil(async () => (await lockWaiters(prisma, hold.pid)) >= 1, 'first queued');
      second = contender(lock, 'second', order)();
      await waitUntil(async () => (await lockWaiters(prisma, hold.pid)) >= 2, 'second queued');
      expect(order).toEqual([]);
    } finally {
      hold.release();
      await hold.done;
    }
    const s = summarize(await Promise.allSettled([first, second]));
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.errors).toEqual([]);
    expect(order).toEqual(['first', 'second']);
  });

  it('raceWithHold on a users row FOR UPDATE: both contenders queue behind the hold and finish in start order', async () => {
    const u = await createUser(prisma);
    userIds.push(u.id);
    const lock = Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${u.id} FOR UPDATE`;
    const order: string[] = [];
    const s = summarize(await raceWithHold(prisma, lock, contender(lock, 'first', order), contender(lock, 'second', order)));
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.errors).toEqual([]);
    expect(order).toEqual(['first', 'second']);
  });

  it('holdFirstCall pauses A inside its transaction after its first lock; B is counted by blockedBackends and runs after release', async () => {
    const u = await createUser(prisma);
    userIds.push(u.id);
    const lock = Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${u.id} FOR UPDATE`;
    const order: string[] = [];
    const step = { afterLock: async (): Promise<void> => undefined };
    const h = holdFirstCall(step, 'afterLock');
    try {
      const a = prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw(lock);
          await step.afterLock();
          order.push('A');
        },
        { timeout: 30_000 },
      );
      await h.reached;
      let bSettled = false;
      const b = contender(lock, 'B', order)().finally(() => (bSettled = true));
      await waitUntil(async () => bSettled || (await blockedBackends(prisma)) >= 1, 'B queued behind A');
      expect(bSettled).toBe(false);
      expect(order).toEqual([]);
      h.release();
      const s = summarize(await Promise.allSettled([a, b]));
      expect(s.errors.join()).not.toMatch(/40P01|P2034/);
      expect(s.errors).toEqual([]);
      expect(order).toEqual(['A', 'B']);
    } finally {
      h.restore();
    }
  });

  it('waitUntil gives up after `tries` polls with the pinned message', async () => {
    await expect(waitUntil(() => false, 'never', 2)).rejects.toThrow('timeout waiting for never');
  });
});
