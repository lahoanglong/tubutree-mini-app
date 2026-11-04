import { PrismaService } from '../../src/prisma/prisma.service';
import { runExclusive } from '../../src/common/cron-leader/run-exclusive';
import { DeliveredEffectsResyncCron } from '../../src/modules/orders/delivered-effects-resync.cron';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { warmPool } from './helpers';

/**
 * Khoá lượt chạy cron trên Postgres THẬT: chỉ một lượt cùng khoá chạy, lease hết hạn thì giành lại được, đang chạy thì được gia hạn,
 * lỗi thì nhả; và cron đã chuyển không giữ kết nối "idle in transaction" trong lúc làm việc.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gate = () => {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
};

describe('runExclusive (real Postgres)', () => {
  let prisma: PrismaService;
  const key = `it-run-${Date.now()}`;
  const leaseName = (k: string) => `run:${k}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });

  afterAll(async () => {
    await prisma.cronLease.deleteMany({ where: { name: { startsWith: 'run:it-run-' } } });
    await prisma?.$disconnect();
  });

  it('(a) hai lượt cùng khoá chạy song song: chỉ một fn chạy', async () => {
    const k = `${key}-a`;
    const g = gate();
    const fn = jest.fn(async () => {
      await g.promise;
      return 'done';
    });
    const first = runExclusive(prisma, k, fn);
    await sleep(100);
    const second = await runExclusive(prisma, k, fn);
    expect(second).toEqual({ acquired: false });
    g.open();
    await expect(first).resolves.toEqual({ acquired: true, value: 'done' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(await prisma.cronLease.findUnique({ where: { name: leaseName(k) } })).toBeNull();
  });

  it('(a2) nhiều lượt giành cùng lúc: đúng một lượt được chạy', async () => {
    const k = `${key}-a2`;
    const g = gate();
    const fn = jest.fn(async () => {
      await g.promise;
    });
    const all = Array.from({ length: 8 }, () => runExclusive(prisma, k, fn));
    await sleep(150);
    g.open();
    const results = await Promise.all(all);
    expect(results.filter((r) => r.acquired)).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('(b) lease đã hết hạn thì giành được', async () => {
    const k = `${key}-b`;
    await prisma.cronLease.create({ data: { name: leaseName(k), holder: 'chet', updatedAt: new Date(), expiresAt: new Date(Date.now() - 60_000) } });
    const fn = jest.fn(async () => 'ok');
    await expect(runExclusive(prisma, k, fn)).resolves.toEqual({ acquired: true, value: 'ok' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('(b2) lease còn hạn của lượt khác thì không giành được', async () => {
    const k = `${key}-b2`;
    await prisma.cronLease.create({ data: { name: leaseName(k), holder: 'khac', updatedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) } });
    const fn = jest.fn(async () => 'ok');
    await expect(runExclusive(prisma, k, fn)).resolves.toEqual({ acquired: false });
    expect(fn).not.toHaveBeenCalled();
    expect((await prisma.cronLease.findUniqueOrThrow({ where: { name: leaseName(k) } })).holder).toBe('khac');
  });

  it('(c) đang chạy thì lease được gia hạn: quá ttl ban đầu lượt hai vẫn không giành được', async () => {
    const k = `${key}-c`;
    const ttlMs = 900;
    const g = gate();
    const first = runExclusive(prisma, k, async () => { await g.promise; }, { ttlMs });
    await sleep(ttlMs + 700);
    const fn2 = jest.fn(async () => 'x');
    await expect(runExclusive(prisma, k, fn2, { ttlMs })).resolves.toEqual({ acquired: false });
    expect(fn2).not.toHaveBeenCalled();
    g.open();
    await first;
  });

  it('(d) fn ném lỗi thì lease được xoá và lỗi được ném lại', async () => {
    const k = `${key}-d`;
    await expect(runExclusive(prisma, k, async () => { throw new Error('hỏng'); })).rejects.toThrow('hỏng');
    expect(await prisma.cronLease.findUnique({ where: { name: leaseName(k) } })).toBeNull();
    await expect(runExclusive(prisma, k, async () => 'lại')).resolves.toEqual({ acquired: true, value: 'lại' });
  });

  it('nhả khoá chỉ xoá lease của chính lượt mình', async () => {
    const k = `${key}-own`;
    const g = gate();
    const first = runExclusive(prisma, k, async () => { await g.promise; });
    await sleep(100);
    await prisma.cronLease.update({ where: { name: leaseName(k) }, data: { holder: 'lượt-khác' } });
    g.open();
    await first;
    expect((await prisma.cronLease.findUniqueOrThrow({ where: { name: leaseName(k) } })).holder).toBe('lượt-khác');
  });

  it('(e) cron đã chuyển đang chạy việc dài: không có kết nối "idle in transaction" nào của DB này', async () => {
    const orderStatus = { resyncDeliveredEffects: jest.fn().mockResolvedValue({ outcome: 'ALREADY_DONE' }) };
    const cron = new DeliveredEffectsResyncCron(prisma, orderStatus as unknown as OrderStatusService);
    const g = gate();
    const entered = gate();
    const spy = jest.spyOn(prisma.order, 'findMany').mockImplementation((async () => {
      entered.open();
      await g.promise;
      return [];
    }) as never);
    try {
      const run = cron.resyncPending();
      await entered.promise;
      const idle = await prisma.$queryRaw<{ pid: number; query: string }[]>`
        SELECT pid, query FROM pg_stat_activity
         WHERE datname = current_database() AND pid <> pg_backend_pid() AND state = 'idle in transaction'`;
      expect(idle).toEqual([]);
      g.open();
      await expect(run).resolves.toMatchObject({ scanned: 0 });
    } finally {
      g.open();
      spy.mockRestore();
    }
  });
});
