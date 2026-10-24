import { CronRunService, describeCronError } from './cron-run.service';
import { setCronRunSink } from '../../common/cron-run/track-cron';

interface Row {
  job: string;
  lastStartedAt: Date;
  lastFinishedAt: Date;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  lastDurationMs: number;
  lastAlertedAt: Date | null;
}

function build(opts: { notifyFails?: boolean; admins?: number } = {}) {
  const rows = new Map<string, Row>();
  const prisma = {
    cronRun: {
      upsert: jest.fn(async ({ where, create, update }: { where: { job: string }; create: Row; update: Record<string, unknown> }) => {
        const cur = rows.get(where.job);
        if (!cur) {
          rows.set(where.job, { ...create, lastSuccessAt: create.lastSuccessAt ?? null, lastErrorAt: create.lastErrorAt ?? null, lastError: create.lastError ?? null, lastAlertedAt: create.lastAlertedAt ?? null });
        } else {
          const { consecutiveFailures, ...rest } = update as { consecutiveFailures: number | { increment: number } } & Partial<Row>;
          const next = typeof consecutiveFailures === 'number' ? consecutiveFailures : cur.consecutiveFailures + (consecutiveFailures as { increment: number }).increment;
          rows.set(where.job, { ...cur, ...rest, consecutiveFailures: next });
        }
        return rows.get(where.job)!;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { job: string; OR: { lastAlertedAt: null | { lt: Date } }[] }; data: { lastAlertedAt: Date } }) => {
        const cur = rows.get(where.job);
        if (!cur) return { count: 0 };
        const ok = where.OR.some((c) => (c.lastAlertedAt === null ? cur.lastAlertedAt === null : cur.lastAlertedAt !== null && cur.lastAlertedAt < c.lastAlertedAt.lt));
        if (!ok) return { count: 0 };
        cur.lastAlertedAt = data.lastAlertedAt;
        return { count: 1 };
      }),
      findMany: jest.fn(async () => [...rows.values()].sort((a, b) => a.job.localeCompare(b.job))),
    },
    user: { findMany: jest.fn(async () => Array.from({ length: opts.admins ?? 1 }, (_, i) => ({ id: `a${i}` }))) },
  };
  const notify = jest.fn(async () => {
    if (opts.notifyFails) throw new Error('zns down');
  });
  const svc = new CronRunService(prisma as never, { notify } as never);
  return { svc, rows, prisma, notify };
}

const T0 = new Date('2026-10-24T10:00:00.000Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const run = (job: string, startMin: number, error?: unknown) => ({ job, startedAt: at(startMin), finishedAt: new Date(at(startMin).getTime() + 1500), ...(error === undefined ? {} : { error }) });

describe('CronRunService.record', () => {
  afterEach(() => setCronRunSink(undefined));

  it('thành công: ghi dòng, 0 lỗi liên tiếp, không báo', async () => {
    const { svc, rows, notify } = build();
    await svc.record(run('A.x', 0));
    expect(rows.get('A.x')).toMatchObject({ consecutiveFailures: 0, lastDurationMs: 1500, lastSuccessAt: new Date(at(0).getTime() + 1500), lastError: null });
    expect(notify).not.toHaveBeenCalled();
  });

  it('lỗi: tăng chuỗi, ghi lỗi (không stack), báo admin một lần', async () => {
    const { svc, rows, notify } = build();
    await svc.record(run('A.x', 0, new TypeError('kho lỗi\n    at secret (file.ts:1)')));
    expect(rows.get('A.x')).toMatchObject({ consecutiveFailures: 1, lastError: 'TypeError: kho lỗi' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('a0', 'OPS_CRON_FAILED', { job: 'A.x', count: '1', error: 'TypeError: kho lỗi' });
  });

  it('đang lỗi liên tục: tối đa một báo mỗi 6 giờ cho mỗi job', async () => {
    const { svc, rows, notify } = build();
    await svc.record(run('A.x', 0, new Error('e')));
    await svc.record(run('A.x', 5, new Error('e')));
    await svc.record(run('A.x', 359, new Error('e')));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(rows.get('A.x')!.consecutiveFailures).toBe(3);
    await svc.record(run('A.x', 361, new Error('e')));
    expect(notify).toHaveBeenCalledTimes(2);
    await svc.record(run('B.y', 6, new Error('e')));
    expect(notify).toHaveBeenCalledTimes(3);
  });

  it('chạy thành công thì chuỗi về 0 và lần lỗi sau báo ngay', async () => {
    const { svc, rows, notify } = build();
    await svc.record(run('A.x', 0, new Error('e')));
    await svc.record(run('A.x', 1));
    expect(rows.get('A.x')).toMatchObject({ consecutiveFailures: 0, lastAlertedAt: null, lastError: 'Error: e' });
    await svc.record(run('A.x', 2, new Error('e2')));
    expect(notify).toHaveBeenCalledTimes(2);
    expect(rows.get('A.x')!.consecutiveFailures).toBe(1);
  });

  it('gửi báo lỗi không làm record ném', async () => {
    const { svc } = build({ notifyFails: true });
    await expect(svc.record(run('A.x', 0, new Error('e')))).resolves.toBeUndefined();
  });

  it('DB ghi lỗi thì record ném (decorator bắt và log, cron không hỏng)', async () => {
    const { svc, prisma } = build();
    prisma.cronRun.upsert.mockRejectedValueOnce(new Error('db'));
    await expect(svc.record(run('A.x', 0))).rejects.toThrow('db');
  });

  it('đăng ký làm sink khi khởi tạo', async () => {
    const { svc } = build();
    const spy = jest.spyOn(svc, 'record');
    // onModuleInit gắn sink; chỉ leader mới chạy cron nên chỉ leader ghi.
    svc.onModuleInit();
    const { TrackCron } = await import('../../common/cron-run/track-cron');
    class C {
      @TrackCron()
      async go() {}
    }
    await new C().go();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ job: 'C.go' }));
  });
});

describe('CronRunService.list', () => {
  it('trả các dòng ở dạng chuỗi ISO cho màn admin', async () => {
    const { svc } = build();
    await svc.record(run('A.x', 0, new Error('e')));
    const [row] = await svc.list();
    expect(row).toMatchObject({ job: 'A.x', consecutiveFailures: 1, lastError: 'Error: e', lastSuccessAt: null });
    expect(typeof row!.lastErrorAt).toBe('string');
  });
});

describe('describeCronError', () => {
  it('tên lớp lỗi + dòng đầu có chữ, cắt 300 ký tự', () => {
    expect(describeCronError(new RangeError('\n\n  dòng đầu \nstack'))).toBe('RangeError: dòng đầu');
    expect(describeCronError(new Error('x'.repeat(500)))).toHaveLength(300);
  });
  it('lỗi không phải Error: chỉ ghi kiểu, không in giá trị', () => {
    expect(describeCronError({ password: 'p' })).toBe('NonError: object');
    expect(describeCronError('chuỗi bí mật')).toBe('NonError: string');
  });
  it('lớp lỗi tự đặt tên', () => {
    class BoomError extends Error {}
    expect(describeCronError(new BoomError('m'))).toBe('BoomError: m');
  });
});
