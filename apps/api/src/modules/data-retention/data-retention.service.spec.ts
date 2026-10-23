import 'reflect-metadata';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { DataRetentionService, RETENTION_POLICY, resolveRetentionDays } from './data-retention.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const NOW = new Date('2026-10-10T20:00:00.000Z');
const DAY = 86_400_000;

function make(opts: { locked?: boolean; config?: Record<string, unknown>; batchCounts?: number[] } = {}) {
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: opts.locked ?? true }]) };
  const queue = [...(opts.batchCounts ?? [])];
  const prisma = {
    $transaction: jest.fn<Promise<unknown>, [(t: unknown) => Promise<unknown>]>(async (fn) => fn(tx)),
    $executeRaw: jest.fn(async () => queue.shift() ?? 0),
  };
  const systemConfig = {
    get: jest.fn(async (key: string, fallback: unknown) => (opts.config && key in opts.config ? opts.config[key] : fallback)),
  };
  const svc = new DataRetentionService(prisma as unknown as PrismaService, systemConfig as unknown as SystemConfigService);
  return { svc, prisma, tx, systemConfig };
}

/** Ghép câu SQL Prisma.sql đã truyền vào $executeRaw thành chuỗi + tham số để assert. */
function call(prisma: { $executeRaw: jest.Mock }, i: number) {
  const [strings, ...values] = prisma.$executeRaw.mock.calls[i] as [TemplateStringsArray, ...unknown[]];
  return { strings, values };
}

/** Gom mọi Date trong tham số (kể cả trong Prisma.Sql lồng nhau). */
function datesIn(values: unknown[]): Date[] {
  return values.flatMap((v) => {
    if (v instanceof Date) return [v];
    if (v && typeof v === 'object' && 'values' in v) return datesIn((v as { values: unknown[] }).values);
    return [];
  });
}

describe('DataRetentionService (C-046)', () => {
  it('@Cron chạy theo giờ Việt Nam, ngoài giờ cao điểm (04:30)', () => {
    const meta = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, DataRetentionService.prototype.handleCron);
    expect(meta).toMatchObject({ timeZone: 'Asia/Ho_Chi_Minh', cronTime: '0 30 4 * * *' });
  });

  it('TTL mặc định đúng quyết định Q-21: 395 ngày / 180 / 90 / 30', () => {
    expect(RETENTION_POLICY.analytics_events.defaultDays).toBe(395);
    expect(RETENTION_POLICY.notification_logs.defaultDays).toBe(180);
    expect(RETENTION_POLICY.webhook_events.defaultDays).toBe(90);
    expect(RETENTION_POLICY.refresh_tokens.defaultDays).toBe(30);
  });

  describe('resolveRetentionDays', () => {
    it('giá trị không phải số → mặc định', () => {
      expect(resolveRetentionDays('notification_logs', 'abc')).toBe(180);
      expect(resolveRetentionDays('notification_logs', null)).toBe(180);
      expect(resolveRetentionDays('notification_logs', Number.NaN)).toBe(180);
    });
    it('đặt 0/âm/quá thấp → kẹp về sàn, không xoá sạch bảng', () => {
      expect(resolveRetentionDays('notification_logs', 0)).toBe(30);
      expect(resolveRetentionDays('analytics_events', -5)).toBe(90);
      expect(resolveRetentionDays('refresh_tokens', 1)).toBe(7);
      expect(resolveRetentionDays('webhook_events', 3)).toBe(14);
    });
    it('giá trị hợp lệ được giữ (làm tròn xuống)', () => {
      expect(resolveRetentionDays('notification_logs', 200.7)).toBe(200);
    });
  });

  it('không giữ được khoá advisory → bỏ qua, không xoá gì', async () => {
    const { svc, prisma } = make({ locked: false });
    expect(await svc.runAll({ now: NOW })).toEqual({ skipped: 'LOCKED' });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('đang chạy chồng trong cùng instance → bỏ qua', async () => {
    const { svc, prisma } = make();
    let release!: () => void;
    prisma.$transaction.mockImplementationOnce(() => new Promise((r) => (release = () => r({ deleted: {}, truncated: false }))));
    const first = svc.runAll({ now: NOW });
    expect(await svc.runAll({ now: NOW })).toEqual({ skipped: 'RUNNING' });
    release();
    await first;
  });

  it('xoá đủ 8 bảng và xoá SĐT đơn ngoài app, mốc cắt = now - số ngày TTL cấu hình', async () => {
    const { svc, prisma } = make({ config: { 'retention.notification_logs_days': 60 } });
    const res = await svc.runAll({ now: NOW, pauseMs: 0 });
    expect(res).toEqual({
      deleted: {
        analytics_events: 0,
        notification_logs: 0,
        pancake_webhook_events: 0,
        gomdon_webhook_events: 0,
        oa_inbound_messages: 0,
        'external_orders.phone': 0,
        'external_orders.phone_after_final': 0,
        'external_points_claims.order_phone': 0,
        refresh_tokens: 0,
        support_messages: 0,
        support_forwards: 0,
      },
      truncated: false,
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(11);
    const cutoffs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => datesIn(call(prisma, i).values)[0]!.getTime());
    expect(cutoffs).toEqual([
      NOW.getTime() - 395 * DAY,
      NOW.getTime() - 60 * DAY,
      NOW.getTime() - 90 * DAY,
      NOW.getTime() - 90 * DAY,
      NOW.getTime() - 90 * DAY,
      NOW.getTime() - 90 * DAY,
      NOW.getTime() - 7 * DAY,
      NOW.getTime() - 7 * DAY,
      NOW.getTime() - 30 * DAY,
      NOW.getTime() - 365 * DAY,
      NOW.getTime() - 365 * DAY,
    ]);
  });

  it('đơn ngoài app: chỉ xoá SĐT (UPDATE, giữ dòng), bỏ qua đơn còn claim chờ xử lý', async () => {
    const { svc, prisma } = make();
    await svc.runAll({ now: NOW, pauseMs: 0 });
    const c = call(prisma, 5);
    const sql = [...c.strings, ...c.values.map((v) => (v as { sql?: string }).sql ?? '')].join(' ');
    expect(sql).toContain('UPDATE');
    expect(sql).not.toContain('DELETE');
    expect(sql).toContain('"phone" = NULL');
    expect(sql).toContain("'PENDING', 'REVIEW', 'HELD_NO_MEMBER'");
  });

  it('SĐT đơn ngoài app xoá 7 ngày sau khi claim về trạng thái cuối (CREDITED, VOIDED, REVERSED, LAPSED), giữ dòng và 3 số cuối', async () => {
    const { svc, prisma } = make();
    await svc.runAll({ now: NOW, pauseMs: 0 });
    const c = call(prisma, 6);
    const sql = [...c.strings, ...c.values.map((v) => (v as { sql?: string }).sql ?? '')].join(' ');
    expect(sql).toContain('UPDATE');
    expect(sql).not.toContain('DELETE');
    expect(sql).toContain('"phone" = NULL');
    expect(sql).toContain("'CREDITED', 'VOIDED', 'REVERSED', 'LAPSED'");
    expect(sql).not.toContain('phoneLast3');
    expect(datesIn(c.values)[0]!.getTime()).toBe(NOW.getTime() - 7 * DAY);
  });

  it('bản chép SĐT trên claim chat (orderPhone) xoá cùng luật: claim xong 7 ngày, hoặc đơn đã mất SĐT; UPDATE, không xoá dòng', async () => {
    const { svc, prisma } = make();
    await svc.runAll({ now: NOW, pauseMs: 0 });
    const c = call(prisma, 7);
    const sql = [...c.strings, ...c.values.map((v) => (v as { sql?: string }).sql ?? '')].join(' ');
    expect(sql).toContain('UPDATE');
    expect(sql).not.toContain('DELETE');
    expect(sql).toContain('"orderPhone" = NULL');
    expect(sql).toContain("'CREDITED', 'VOIDED', 'REVERSED', 'LAPSED'");
    expect(sql).toContain('o."phone" IS NULL');
    expect(datesIn(c.values)[0]!.getTime()).toBe(NOW.getTime() - 7 * DAY);
  });

  it('lặp theo lô tới khi lô nhỏ hơn batchSize, cộng dồn số dòng đã xoá', async () => {
    const { svc, prisma } = make({ batchCounts: [3, 3, 1] });
    const res = await svc.runAll({ now: NOW, batchSize: 3, pauseMs: 0 });
    expect(res).toMatchObject({ truncated: false });
    expect((res as { deleted: Record<string, number> }).deleted.analytics_events).toBe(7);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3 + 10);
    expect(call(prisma, 0).values).toContain(3);
  });

  it('quá thời lượng cho phép → dừng sớm và báo truncated', async () => {
    const { svc, prisma } = make({ batchCounts: [3, 3, 3, 3] });
    const res = await svc.runAll({ now: NOW, batchSize: 3, pauseMs: 0, maxRunMs: -1 });
    expect(res).toMatchObject({ truncated: true });
    expect(prisma.$executeRaw.mock.calls.length).toBeLessThan(12);
  });

  it('bảng tồn đọng vô hạn không nuốt hết ngân sách thời gian của các bảng sau', async () => {
    const { svc, prisma } = make();
    const perTable: Record<string, number> = {};
    prisma.$executeRaw.mockImplementation((async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const table = (values[0] as { strings?: string[] })?.strings?.[0] ?? '';
      perTable[table] = (perTable[table] ?? 0) + 1;
      if (table !== '"analytics_events"' && table !== '"refresh_tokens"') return 0;
      await new Promise((r) => setTimeout(r, 5));
      return 3;
    }) as never);
    await svc.runAll({ now: NOW, batchSize: 3, pauseMs: 0, maxRunMs: 400 });
    expect(perTable['"refresh_tokens"']).toBeGreaterThan(3);
  });

  it('một bảng lỗi không chặn các bảng sau', async () => {
    const { svc, prisma } = make();
    prisma.$executeRaw.mockRejectedValueOnce(new Error('boom'));
    const res = await svc.runAll({ now: NOW, pauseMs: 0 });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1 + 10);
    expect((res as { deleted: Record<string, number> }).deleted).not.toHaveProperty('analytics_events');
    expect((res as { deleted: Record<string, number> }).deleted).toHaveProperty('refresh_tokens');
  });

  it('handleCron không bao giờ ném lỗi ra ngoài', async () => {
    const { svc, prisma } = make();
    prisma.$transaction.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.handleCron()).resolves.toBeUndefined();
  });
});
