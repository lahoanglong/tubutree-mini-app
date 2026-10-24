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
  lastOutcome: string;
  lastErrorCount: number;
}

function build(opts: { notifyFails?: boolean; admins?: number } = {}) {
  const rows = new Map<string, Row>();
  const prisma = {
    cronRun: {
      upsert: jest.fn(async ({ where, create, update }: { where: { job: string }; create: Row; update: Record<string, unknown> }) => {
        const cur = rows.get(where.job);
        if (!cur) {
          rows.set(where.job, { ...create, lastSuccessAt: create.lastSuccessAt ?? null, lastErrorAt: create.lastErrorAt ?? null, lastError: create.lastError ?? null, lastAlertedAt: create.lastAlertedAt ?? null, lastErrorCount: create.lastErrorCount ?? 0 });
        } else {
          const { consecutiveFailures, ...rest } = update as { consecutiveFailures: number | { increment: number } } & Partial<Row>;
          const next = consecutiveFailures === undefined ? cur.consecutiveFailures : typeof consecutiveFailures === 'number' ? consecutiveFailures : cur.consecutiveFailures + (consecutiveFailures as { increment: number }).increment;
          rows.set(where.job, { ...cur, ...rest, consecutiveFailures: next });
        }
        return rows.get(where.job)!;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { job: string; lastAlertedAt?: Date; OR?: { lastAlertedAt: null | { lt: Date } }[] }; data: { lastAlertedAt: Date | null } }) => {
        const cur = rows.get(where.job);
        if (!cur) return { count: 0 };
        if (where.lastAlertedAt !== undefined && cur.lastAlertedAt?.getTime() !== where.lastAlertedAt.getTime()) return { count: 0 };
        if (where.OR && !where.OR.some((c) => (c.lastAlertedAt === null ? cur.lastAlertedAt === null : cur.lastAlertedAt !== null && cur.lastAlertedAt < c.lastAlertedAt.lt))) return { count: 0 };
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
const base = (job: string, startMin: number) => ({ job, startedAt: at(startMin), finishedAt: new Date(at(startMin).getTime() + 1500) });
const ok = (job: string, m: number) => ({ ...base(job, m), outcome: 'OK' as const, errorCount: 0 });
const skipped = (job: string, m: number) => ({ ...base(job, m), outcome: 'SKIPPED' as const, errorCount: 0 });
const threw = (job: string, m: number, error: unknown = new Error('e')) => ({ ...base(job, m), outcome: 'THREW' as const, errorCount: 0, error });
const logged = (job: string, m: number, line = 'sync lỗi', n = 2) => ({ ...base(job, m), outcome: 'ERRORS' as const, errorCount: n, errorLine: line });

describe('CronRunService.record', () => {
  afterEach(() => setCronRunSink(undefined));

  it('OK: ghi dòng, 0 lỗi liên tiếp, không báo', async () => {
    const { svc, rows, notify } = build();
    await svc.record(ok('A.x', 0));
    expect(rows.get('A.x')).toMatchObject({ lastOutcome: 'OK', consecutiveFailures: 0, lastDurationMs: 1500, lastSuccessAt: new Date(at(0).getTime() + 1500), lastError: null });
    expect(notify).not.toHaveBeenCalled();
  });

  it('THREW: tăng chuỗi, ghi lỗi (không stack)', async () => {
    const { svc, rows } = build();
    await svc.record(threw('A.x', 0, new TypeError('kho lỗi\n    at secret (file.ts:1)')));
    expect(rows.get('A.x')).toMatchObject({ lastOutcome: 'THREW', consecutiveFailures: 1, lastError: 'TypeError: kho lỗi', lastSuccessAt: null });
  });

  it('ERRORS: tính là lần hỏng, lưu số log lỗi và dòng đầu, không đặt lastSuccessAt', async () => {
    const { svc, rows } = build();
    await svc.record(logged('A.x', 0, 'pancake timeout', 3));
    expect(rows.get('A.x')).toMatchObject({ lastOutcome: 'ERRORS', consecutiveFailures: 1, lastErrorCount: 3, lastError: 'pancake timeout', lastSuccessAt: null });
  });

  it('một lần lỗi lẻ chưa báo; từ lần liên tiếp thứ hai mới báo, đúng một lần mỗi 6 giờ', async () => {
    const { svc, rows, notify } = build();
    await svc.record(logged('A.x', 0));
    expect(notify).not.toHaveBeenCalled();
    await svc.record(logged('A.x', 5, 'sync lỗi'));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('a0', 'OPS_CRON_FAILED', { job: 'A.x', count: '2', error: 'sync lỗi' });
    await svc.record(threw('A.x', 359));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(rows.get('A.x')!.consecutiveFailures).toBe(3);
    await svc.record(threw('A.x', 372));
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('SKIPPED không đụng chuỗi lỗi, mốc báo hay lastSuccessAt', async () => {
    const { svc, rows } = build();
    await svc.record(ok('A.x', 0));
    await svc.record(logged('A.x', 1));
    await svc.record(logged('A.x', 2));
    const before = { ...rows.get('A.x')! };
    await svc.record(skipped('A.x', 3));
    const after = rows.get('A.x')!;
    expect(after).toMatchObject({ consecutiveFailures: 2, lastAlertedAt: before.lastAlertedAt, lastSuccessAt: before.lastSuccessAt, lastOutcome: 'SKIPPED' });
  });

  it('SKIPPED là lần đầu: tạo dòng với 0 lỗi', async () => {
    const { svc, rows } = build();
    await svc.record(skipped('A.x', 0));
    expect(rows.get('A.x')).toMatchObject({ lastOutcome: 'SKIPPED', consecutiveFailures: 0, lastSuccessAt: null });
  });

  it('OK sau chuỗi lỗi: chuỗi về 0; mốc báo chỉ xoá khi lần lỗi cuối đã hơn 1 giờ', async () => {
    const { svc, rows, notify } = build();
    await svc.record(threw('A.x', 0));
    await svc.record(threw('A.x', 1));
    expect(notify).toHaveBeenCalledTimes(1);
    await svc.record(ok('A.x', 20));
    expect(rows.get('A.x')).toMatchObject({ consecutiveFailures: 0, lastOutcome: 'OK' });
    expect(rows.get('A.x')!.lastAlertedAt).not.toBeNull();
    await svc.record(threw('A.x', 21));
    await svc.record(threw('A.x', 22));
    expect(notify).toHaveBeenCalledTimes(1);
    await svc.record(ok('A.x', 100));
    expect(rows.get('A.x')!.lastAlertedAt).toBeNull();
    await svc.record(threw('A.x', 101));
    await svc.record(threw('A.x', 102));
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('gửi báo lỗi thì nhả mốc báo để lượt sau thử lại, record không ném', async () => {
    const { svc, rows, notify } = build({ notifyFails: true });
    await svc.record(threw('A.x', 0));
    await expect(svc.record(threw('A.x', 1))).resolves.toBeUndefined();
    expect(rows.get('A.x')!.lastAlertedAt).toBeNull();
    await svc.record(threw('A.x', 2));
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('DB ghi lỗi thì record ném (decorator bắt và log, cron không hỏng)', async () => {
    const { svc, prisma } = build();
    prisma.cronRun.upsert.mockRejectedValueOnce(new Error('db'));
    await expect(svc.record(ok('A.x', 0))).rejects.toThrow('db');
  });

  it('đăng ký làm sink khi khởi tạo', async () => {
    const { svc } = build();
    const spy = jest.spyOn(svc, 'record');
    svc.onModuleInit();
    const { TrackCron } = await import('../../common/cron-run/track-cron');
    class C {
      @TrackCron()
      async go() {}
    }
    await new C().go();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ job: 'C.go', outcome: 'OK' }));
  });
});

describe('CronRunService.list', () => {
  it('trả các dòng ở dạng chuỗi ISO cho màn admin', async () => {
    const { svc } = build();
    await svc.record(threw('A.x', 0));
    const [row] = await svc.list();
    expect(row).toMatchObject({ job: 'A.x', consecutiveFailures: 1, lastError: 'Error: e', lastSuccessAt: null, lastOutcome: 'THREW', lastErrorCount: 0 });
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
