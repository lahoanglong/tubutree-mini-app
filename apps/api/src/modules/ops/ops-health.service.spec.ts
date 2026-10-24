import { Logger } from '@nestjs/common';
import { OpsHealthService } from './ops-health.service';
import { recordWebhookDelivery, WEBHOOK_STATE_KEY } from './ops-state';
import type { OpsProblem } from './ops-alerts';

const HOOK_URL = 'https://hooks.slack.com/services/T0/B0/SECRETTOKEN';

interface Row {
  key: string;
  lastOkAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  detail: unknown;
  alertSince: Date | null;
  alertedAt: Date | null;
}

/** Hàng ops_health_states trong bộ nhớ: đủ findUnique/upsert cho kênh webhook và trí nhớ chống báo lặp. */
function fakePrisma() {
  const rows = new Map<string, Row>();
  return {
    rows,
    opsHealthState: {
      findUnique: async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null,
      upsert: async ({ where, create, update }: { where: { key: string }; create: Partial<Row>; update: Partial<Row> }) => {
        const cur = rows.get(where.key);
        const base: Row = { key: where.key, lastOkAt: null, lastErrorAt: null, lastError: null, detail: null, alertSince: null, alertedAt: null };
        rows.set(where.key, { ...(cur ?? { ...base, ...create }), ...(cur ? update : {}) });
      },
    },
  };
}

const problem: OpsProblem = { key: 'queue.failed', message: 'Hàng đợi có job lỗi', severity: 'warning' } as unknown as OpsProblem;

function build(env: Record<string, string>, send: jest.Mock) {
  const prisma = fakePrisma();
  const svc = new OpsHealthService(prisma as never, { get: (k: string) => env[k] ?? '' } as never, [], undefined, undefined, undefined, send as never);
  jest.spyOn(svc, 'snapshot').mockImplementation(
    async (now = new Date()) =>
      ({
        generatedAt: now.toISOString(),
        thresholds: { repeatHours: 6 },
        problems: [problem],
      }) as never,
  );
  return { svc, prisma };
}

describe('OpsHealthService — kênh webhook báo động (R6-ADMIN-4)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  const channel = async (svc: OpsHealthService) =>
    (await (svc as unknown as { webhookChannel(): Promise<Record<string, unknown>> }).webhookChannel()) as Record<string, unknown>;

  it('chưa đặt OPS_ALERT_WEBHOOK_URL: kênh DISABLED, không lỗi, không ghi gì', async () => {
    const send = jest.fn();
    const { svc, prisma } = build({}, send);
    await svc.checkAndAlert(new Date());
    expect(send).not.toHaveBeenCalled();
    expect(await channel(svc)).toMatchObject({ state: 'DISABLED', lastOkAt: null, lastErrorAt: null, lastErrorKind: null, lastErrorHint: null });
    expect(prisma.rows.has(WEBHOOK_STATE_KEY)).toBe(false);
  });

  it('gửi được: READY, ghi lastOkAt, không có lỗi', async () => {
    const send = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const { svc } = build({ OPS_ALERT_WEBHOOK_URL: HOOK_URL }, send);
    const t0 = new Date('2026-10-15T10:00:00Z');
    await svc.checkAndAlert(t0);
    expect(await channel(svc)).toMatchObject({ state: 'READY', lastOkAt: t0.toISOString(), lastErrorAt: null, lastErrorKind: null, lastErrorHint: null });
  });

  it('HTTP 410: ghi lỗi PERMANENT kèm gợi ý kiểm tra OPS_ALERT_WEBHOOK_URL, không gửi lại ở lượt sau, không lộ URL', async () => {
    const send = jest.fn().mockResolvedValue({ ok: false, status: 410 });
    const { svc, prisma } = build({ OPS_ALERT_WEBHOOK_URL: HOOK_URL }, send);
    const t0 = new Date('2026-10-15T10:00:00Z');
    await svc.checkAndAlert(t0);
    const ch = await channel(svc);
    expect(ch).toMatchObject({ state: 'READY', lastError: 'HTTP 410', lastErrorKind: 'PERMANENT', lastErrorAt: t0.toISOString() });
    expect(String(ch.lastErrorHint)).toContain('OPS_ALERT_WEBHOOK_URL');
    expect(JSON.stringify(ch)).not.toContain('SECRETTOKEN');
    expect(JSON.stringify([...prisma.rows.values()])).not.toContain('SECRETTOKEN');

    await svc.checkAndAlert(new Date(t0.getTime() + 5 * 60_000));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('HTTP 503 và lỗi mạng: lỗi TRANSIENT, không có gợi ý "dừng gửi", gửi lại ở lượt sau; URL trong thông báo lỗi bị che', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockRejectedValueOnce(new Error(`connect ECONNREFUSED ${HOOK_URL}`));
    const { svc } = build({ OPS_ALERT_WEBHOOK_URL: HOOK_URL }, send);
    const t0 = new Date('2026-10-15T10:00:00Z');
    await svc.checkAndAlert(t0);
    expect(await channel(svc)).toMatchObject({ lastError: 'HTTP 503', lastErrorKind: 'TRANSIENT', lastErrorHint: null });
    await svc.checkAndAlert(new Date(t0.getTime() + 5 * 60_000));
    expect(send).toHaveBeenCalledTimes(2);
    const ch = await channel(svc);
    expect(ch).toMatchObject({ lastErrorKind: 'TRANSIENT' });
    expect(String(ch.lastError)).toContain('[webhook]');
    expect(JSON.stringify(ch)).not.toContain('SECRETTOKEN');
  });

  it('lỗi cũ giữ nguyên khi gửi được lại: lastOkAt mới hơn lastErrorAt để màn hình biết đã ổn', async () => {
    const send = jest.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, status: 200 });
    const { svc } = build({ OPS_ALERT_WEBHOOK_URL: HOOK_URL }, send);
    const t0 = new Date('2026-10-15T10:00:00Z');
    const t1 = new Date(t0.getTime() + 5 * 60_000);
    await svc.checkAndAlert(t0);
    await svc.checkAndAlert(t1);
    expect(await channel(svc)).toMatchObject({ lastErrorAt: t0.toISOString(), lastOkAt: t1.toISOString(), lastErrorKind: null, lastErrorHint: null });
  });

  it('đã gửi được lại sau lỗi vĩnh viễn: API không còn trả loại lỗi/gợi ý của lần hỏng cũ', async () => {
    const { svc } = build({ OPS_ALERT_WEBHOOK_URL: HOOK_URL }, jest.fn());
    const t0 = new Date('2026-10-15T10:00:00Z');
    await recordWebhookDelivery((svc as unknown as { prisma: never }).prisma, { ok: false, error: 'HTTP 410', kind: 'PERMANENT' }, t0);
    expect(await channel(svc)).toMatchObject({ lastErrorKind: 'PERMANENT' });
    await recordWebhookDelivery((svc as unknown as { prisma: never }).prisma, { ok: true }, new Date(t0.getTime() + 60_000));
    expect(await channel(svc)).toMatchObject({ lastErrorKind: null, lastErrorHint: null, lastError: 'HTTP 410' });
  });

  it('hai lượt cron chạy song song không làm hỏng trạng thái kênh: vẫn ra một trạng thái hợp lệ', async () => {
    const send = jest.fn().mockResolvedValue({ ok: false, status: 410 });
    const { svc } = build({ OPS_ALERT_WEBHOOK_URL: HOOK_URL }, send);
    const t0 = new Date('2026-10-15T10:00:00Z');
    await Promise.all([svc.checkAndAlert(t0), svc.checkAndAlert(t0)]);
    expect(await channel(svc)).toMatchObject({ state: 'READY', lastErrorKind: 'PERMANENT' });
  });
});

describe('OpsHealthService.cronJobs (mục Tác vụ nền của màn sức khoẻ)', () => {
  const row = { job: 'A.x', lastStartedAt: 'a', lastFinishedAt: 'b', lastSuccessAt: null, lastErrorAt: 'c', lastError: 'Error: e', consecutiveFailures: 2, lastDurationMs: 5 };

  it('trả các dòng cron_runs', async () => {
    const svc = new OpsHealthService({} as never, {} as never, [], undefined, undefined, undefined, undefined, undefined, { list: async () => [row] } as never);
    await expect(svc.cronJobs()).resolves.toEqual([row]);
  });

  it('đọc bảng lỗi (chưa migrate…) thì trả rỗng, không làm hỏng cả màn', async () => {
    const svc = new OpsHealthService({} as never, {} as never, [], undefined, undefined, undefined, undefined, undefined, { list: async () => Promise.reject(new Error('no table')) } as never);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(svc.cronJobs()).resolves.toEqual([]);
  });

  it('thiếu CronRunService: rỗng', async () => {
    const svc = new OpsHealthService({} as never, {} as never, []);
    await expect(svc.cronJobs()).resolves.toEqual([]);
  });
});

describe('cron thoát sớm vì chạy chồng', () => {
  it('OpsHealthService.handleCron báo SKIPPED cho sổ cron', async () => {
    const { setCronRunSink } = await import('../../common/cron-run/track-cron');
    const reports: { outcome: string }[] = [];
    setCronRunSink({ record: (r) => void reports.push(r) });
    const svc = new OpsHealthService({} as never, {} as never, []);
    (svc as unknown as { running: boolean }).running = true;
    await svc.handleCron();
    setCronRunSink(undefined);
    expect(reports).toEqual([expect.objectContaining({ outcome: 'SKIPPED' })]);
  });
});
