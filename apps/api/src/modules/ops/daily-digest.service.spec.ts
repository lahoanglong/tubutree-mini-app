import { Logger } from '@nestjs/common';
import { RunLease } from '../../common/cron-leader/run-lease';
import type { DailyDigest } from './daily-digest';
import { DailyDigestService, DIGEST_STATE_KEY } from './daily-digest.service';
import type { DigestSendOutcome } from './ops-email.service';

// 08:00 giờ VN ngày 24/11/2026: bản tin của ngày 23/11.
const NOW = new Date('2026-11-24T01:00:00.000Z');

function setup(o: { ready?: boolean; blockLifted?: boolean; send?: DigestSendOutcome; lease?: boolean; failAll?: boolean } = {}) {
  const rows = new Map<string, { detail?: unknown; lastOkAt?: Date; lastErrorAt?: Date }>();
  const reject = () => Promise.reject(new Error('db down'));
  const prisma = {
    opsHealthState: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null),
      upsert: jest.fn(async ({ where, create, update }: { where: { key: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        rows.set(where.key, { ...(rows.get(where.key) ?? create), ...update });
      }),
    },
    $queryRaw: jest.fn(o.failAll ? reject : async () => []),
    order: {
      aggregate: jest.fn(o.failAll ? reject : async () => ({ _count: { _all: 0 }, _sum: { total: null } })),
      findMany: jest.fn(o.failAll ? reject : async () => []),
    },
    variation: { count: jest.fn(o.failAll ? reject : async () => 0), findMany: jest.fn(o.failAll ? reject : async () => []) },
  };
  const email = {
    isReady: jest.fn(() => o.ready ?? true),
    blockLifted: jest.fn(async () => o.blockLifted ?? true),
    sendDigest: jest.fn(async (_d: DailyDigest): Promise<DigestSendOutcome> => o.send ?? 'SENT'),
  };
  const counter = { countForDay: jest.fn(o.failAll ? reject : async () => 3) };
  const release = jest.fn(async () => undefined);
  const acquire = jest.spyOn(RunLease, 'tryAcquire').mockResolvedValue(o.lease === false ? null : ({ release } as unknown as RunLease));
  const svc = new DailyDigestService(prisma as never, email as never, counter as never);
  return { svc, prisma, email, counter, rows, release, acquire };
}

describe('DailyDigestService.run', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('gửi bản tin của hôm qua (giờ VN), nhớ ngày đã gửi, lượt gửi bù sau không gửi lại', async () => {
    const { svc, email, rows, release, counter } = setup();
    await expect(svc.run(NOW)).resolves.toBe('SENT');
    expect(email.sendDigest).toHaveBeenCalledTimes(1);
    const digest = email.sendDigest.mock.calls[0]![0];
    expect(digest.day).toBe('2026-11-23');
    expect(digest.serverErrors).toBe(3);
    expect(counter.countForDay).toHaveBeenCalledWith('2026-11-23');
    expect(rows.get(DIGEST_STATE_KEY)).toMatchObject({ detail: { day: '2026-11-23', outcome: 'SENT' }, lastOkAt: NOW });
    expect(release).toHaveBeenCalledTimes(1);

    await expect(svc.run(new Date(NOW.getTime() + 30 * 60_000))).resolves.toBe('ALREADY_SENT');
    expect(email.sendDigest).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(2);
    // Sáng hôm sau là ngày mới.
    await expect(svc.run(new Date(NOW.getTime() + 86_400_000))).resolves.toBe('SENT');
    expect(email.sendDigest.mock.calls[1]![0].day).toBe('2026-11-24');
  });

  it('kênh email chưa cấu hình: không giành khoá, không đọc số liệu', async () => {
    const { svc, acquire, prisma } = setup({ ready: false });
    await expect(svc.run(NOW)).resolves.toBe('NOT_CONFIGURED');
    expect(acquire).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('replica khác đang gửi: LOCKED, không gửi', async () => {
    const { svc, email } = setup({ lease: false });
    await expect(svc.run(NOW)).resolves.toBe('LOCKED');
    expect(email.sendDigest).not.toHaveBeenCalled();
  });

  it('kênh đang bị chặn vì lỗi vĩnh viễn: không gom số liệu, không gửi, không chốt ngày', async () => {
    const { svc, email, prisma, rows } = setup({ blockLifted: false });
    await expect(svc.run(NOW)).resolves.toBe('BLOCKED');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(email.sendDigest).not.toHaveBeenCalled();
    expect(rows.has(DIGEST_STATE_KEY)).toBe(false);
  });

  it('SMTP lỗi tạm thời: RETRY và không chốt ngày, lượt sau gửi lại; lỗi vĩnh viễn: chốt ngày là BLOCKED', async () => {
    const retry = setup({ send: 'RETRY' });
    await expect(retry.svc.run(NOW)).resolves.toBe('RETRY');
    expect(retry.rows.has(DIGEST_STATE_KEY)).toBe(false);
    expect(retry.release).toHaveBeenCalled();

    const blocked = setup({ send: 'BLOCKED' });
    await expect(blocked.svc.run(NOW)).resolves.toBe('BLOCKED');
    expect(blocked.rows.get(DIGEST_STATE_KEY)).toMatchObject({ detail: { day: '2026-11-23', outcome: 'BLOCKED' } });
    await expect(blocked.svc.run(NOW)).resolves.toBe('ALREADY_SENT');
  });

  it('mọi mục số liệu đều lỗi (DB sập): không gửi thư rỗng, RETRY; vẫn nhả khoá', async () => {
    const { svc, email, release } = setup({ failAll: true });
    await expect(svc.run(NOW)).resolves.toBe('RETRY');
    expect(email.sendDigest).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('DailyDigestService.collect', () => {
  afterEach(() => jest.restoreAllMocks());

  it('một mục lỗi chỉ làm mục đó null, các mục khác vẫn có số; log error để màn Tác vụ nền thấy', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { svc, prisma } = setup();
    prisma.order.aggregate.mockRejectedValueOnce(new Error('timeout'));
    const d = await svc.collect('2026-11-23', NOW);
    expect(d.unpaidTransfers).toBeNull();
    expect(d.orders).toEqual({ placed: 0, cancelled: 0, paidOrders: 0, revenue: 0, gmv: 0 });
    expect(d.stuckOrders).toEqual({ count: 0, oldest: [] });
    expect(d.lowStock).toEqual({ count: 0, outOfStock: 0, items: [] });
    expect(d.zeroResults).toEqual([]);
    expect(d.serverErrors).toBe(3);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('mục unpaidTransfers lỗi truy vấn: timeout'));
  });
});
