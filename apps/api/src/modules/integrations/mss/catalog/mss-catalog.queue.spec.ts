import type { Job, Queue } from 'bullmq';
import {
  doorbellJobId,
  MSS_CATALOG_PENDING_KEY,
  MSS_DOORBELL_MAX_IDS,
  MSS_DOORBELL_WINDOW_MS,
  MssCatalogCron,
  MssCatalogProcessor,
  MssCatalogQueue,
  type MssCatalogJobData,
} from './mss-catalog.queue';
import type { MssCatalogService } from './mss-catalog.service';

/** Redis set + hàng BullMQ giả: `add` trùng jobId thì giữ job cũ, như BullMQ. */
function fakeQueue() {
  const sets = new Map<string, Set<string>>();
  const jobs = new Map<string, { name: string; data: MssCatalogJobData; delay?: number }>();
  const redis = {
    sadd: jest.fn(async (key: string, ...m: string[]) => {
      const s = sets.get(key) ?? new Set<string>();
      sets.set(key, s);
      let n = 0;
      for (const x of m) {
        if (!s.has(x)) {
          s.add(x);
          n++;
        }
      }
      return n;
    }),
    scard: jest.fn(async (key: string) => sets.get(key)?.size ?? 0),
    expire: jest.fn(async () => 1),
    del: jest.fn(async (key: string) => Number(sets.delete(key))),
    multi() {
      const ops: (() => unknown)[] = [];
      const chain = {
        smembers(key: string) {
          ops.push(() => [...(sets.get(key) ?? [])]);
          return chain;
        },
        del(key: string) {
          ops.push(() => Number(sets.delete(key)));
          return chain;
        },
        async exec() {
          return ops.map((op) => [null, op()] as [null, unknown]);
        },
      };
      return chain;
    },
  };
  const add = jest.fn(async (name: string, data: MssCatalogJobData, opts: { jobId: string; delay?: number }) => {
    if (!jobs.has(opts.jobId)) jobs.set(opts.jobId, { name, data, delay: opts.delay });
    return { id: opts.jobId };
  });
  const queue = { client: Promise.resolve(redis), add } as unknown as Queue<MssCatalogJobData>;
  return { queue, sets, jobs, add, redis };
}

describe('doorbellJobId: gộp chuông theo khung 10 giây', () => {
  it('mọi lúc trong một khung cho cùng jobId, hẹn chạy lúc khung đóng', () => {
    const start = 1_763_340_000_000;
    expect(doorbellJobId(start)).toEqual({ jobId: `ids-${start}`, delay: MSS_DOORBELL_WINDOW_MS });
    expect(doorbellJobId(start + 9_999)).toEqual({ jobId: `ids-${start}`, delay: 1 });
    expect(doorbellJobId(start + 10_000).jobId).toBe(`ids-${start + 10_000}`);
  });
});

describe('MssCatalogQueue', () => {
  it('hai chuông trong cùng khung (kể cả từ hai tiến trình): một job, tập chờ là hợp các mã', async () => {
    const f = fakeQueue();
    const a = new MssCatalogQueue(f.queue);
    const b = new MssCatalogQueue(f.queue);
    const t = 1_763_340_000_000;
    const [n1, n2] = await Promise.all([a.ring(['p1', 'p2'], t + 100), b.ring(['p2', 'p3'], t + 4_000)]);
    expect(n1 + n2).toBe(3);
    expect([...f.jobs.keys()]).toEqual([`ids-${t}`]);
    expect([...f.sets.get(MSS_CATALOG_PENDING_KEY)!].sort()).toEqual(['p1', 'p2', 'p3']);
    expect(f.redis.expire).toHaveBeenCalledWith(MSS_CATALOG_PENDING_KEY, 86_400);
  });

  it('chuông ở khung sau: job mới', async () => {
    const f = fakeQueue();
    const q = new MssCatalogQueue(f.queue);
    await q.ring(['p1'], 1_763_340_000_000);
    await q.ring(['p1'], 1_763_340_010_000);
    expect(f.jobs.size).toBe(2);
  });

  it('drainPending lấy và xoá tập chờ trong một lần', async () => {
    const f = fakeQueue();
    const q = new MssCatalogQueue(f.queue);
    await q.ring(['p1', 'p2']);
    expect((await q.drainPending()).sort()).toEqual(['p1', 'p2']);
    expect(await q.drainPending()).toEqual([]);
    expect(await q.pendingCount()).toBe(0);
  });

  it('enqueue theo phút: nút bấm liên tiếp và cron trên hai tiến trình không xếp trùng', async () => {
    const f = fakeQueue();
    const q = new MssCatalogQueue(f.queue);
    const t = 1_763_340_000_000;
    await q.enqueue('full', 'admin', t);
    await q.enqueue('full', 'admin', t + 30_000);
    await q.enqueue('incremental', 'cron', t + 30_000);
    expect([...f.jobs.keys()].sort()).toEqual([`full-${t / 60_000}`, `incremental-${t / 60_000}`]);
  });

  it('Redis không đọc được: pendingCount trả null, clearPending không ném', async () => {
    const client = Promise.reject(new Error('ECONNREFUSED'));
    client.catch(() => undefined);
    const q = new MssCatalogQueue({ client } as unknown as Queue<MssCatalogJobData>);
    expect(await q.pendingCount()).toBeNull();
    await expect(q.clearPending()).resolves.toBeUndefined();
  });
});

describe('MssCatalogProcessor', () => {
  function proc(pending: string[], effective = true) {
    const f = fakeQueue();
    const q = new MssCatalogQueue(f.queue);
    if (pending.length) f.sets.set(MSS_CATALOG_PENDING_KEY, new Set(pending));
    const run = jest.fn(async (kind: string) => ({ status: 'ok', stats: { kind }, error: null }));
    const catalog = { run, effective: jest.fn(async () => effective) } as unknown as MssCatalogService;
    const job = (data: MssCatalogJobData) => ({ data }) as Job<MssCatalogJobData>;
    return { p: new MssCatalogProcessor(catalog, q), run, job, f };
  }

  it('job chuông: lấy hết mã chờ, một lượt kéo theo mã', async () => {
    const { p, run, job, f } = proc(['p1', 'p2']);
    await p.process(job({ kind: 'ids', trigger: 'doorbell' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe('ids');
    expect((run.mock.calls[0] as unknown[])[2]).toEqual(expect.arrayContaining(['p1', 'p2']));
    expect(f.sets.has(MSS_CATALOG_PENDING_KEY)).toBe(false);
  });

  it('job chuông mà tập chờ rỗng (lượt khác đã lấy): không gọi MSS', async () => {
    const { p, run, job } = proc([]);
    expect(await p.process(job({ kind: 'ids', trigger: 'doorbell' }))).toEqual({ status: 'empty' });
    expect(run).not.toHaveBeenCalled();
  });

  it(`quá ${MSS_DOORBELL_MAX_IDS} mã chờ: kéo theo mốc thay vì hỏi từng mã`, async () => {
    const { p, run, job } = proc(Array.from({ length: MSS_DOORBELL_MAX_IDS + 1 }, (_, i) => `p${i}`));
    await p.process(job({ kind: 'ids', trigger: 'doorbell' }));
    expect(run).toHaveBeenCalledWith('incremental', 'doorbell');
  });

  it('lượt theo mốc/toàn bộ xoá tập chờ khi cờ có hiệu lực; cờ tắt thì giữ', async () => {
    const on = proc(['p1']);
    await on.p.process(on.job({ kind: 'full', trigger: 'admin' }));
    expect(on.run).toHaveBeenCalledWith('full', 'admin');
    expect(on.f.sets.has(MSS_CATALOG_PENDING_KEY)).toBe(false);

    const off = proc(['p1'], false);
    await off.p.process(off.job({ kind: 'incremental', trigger: 'cron' }));
    expect(off.f.sets.get(MSS_CATALOG_PENDING_KEY)?.size).toBe(1);
  });
});

describe('MssCatalogCron', () => {
  it('cờ tắt: không xếp job; bật: xếp đúng loại', async () => {
    const enqueue = jest.fn(async () => undefined);
    const queue = { enqueue } as unknown as MssCatalogQueue;
    const off = new MssCatalogCron({ effective: jest.fn(async () => false) } as unknown as MssCatalogService, queue);
    await off.incremental();
    await off.full();
    expect(enqueue).not.toHaveBeenCalled();

    const on = new MssCatalogCron({ effective: jest.fn(async () => true) } as unknown as MssCatalogService, queue);
    await on.incremental();
    await on.full();
    expect(enqueue.mock.calls).toEqual([
      ['incremental', 'cron'],
      ['full', 'full'],
    ]);
  });
});
