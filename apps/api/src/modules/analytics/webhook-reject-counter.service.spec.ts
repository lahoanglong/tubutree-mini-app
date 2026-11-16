import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { WebhookRejectCounterService } from './webhook-reject-counter.service';
import { WEBHOOK_SOURCES, normalizeWebhookRejectThreshold } from './webhook-reject-config';

// Các ca ghi lỗi cố ý kích hoạt logger.warn; bỏ output cho test sạch.
beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const MIN = 60_000;
const BUCKET = 5 * MIN;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** 12:03 UTC: không nằm đúng ranh giới khung 5 phút (khung hiện tại bắt đầu 12:00). */
const NOW = new Date('2026-11-16T12:03:00.000Z');
const ALIGNED = new Date('2026-11-16T12:00:00.000Z');

interface Executed {
  sql: string;
  values: unknown[];
}

function fakePrisma(opts: { rows?: { source: string; bucketStart: Date | string; count: number | bigint }[]; failExecute?: () => boolean } = {}) {
  const executed: Executed[] = [];
  const queried: Executed[] = [];
  const executeRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (opts.failExecute?.()) throw new Error('db down');
    executed.push({ sql: strings.join('?'), values });
    return 1;
  });
  const queryRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    queried.push({ sql: strings.join('?'), values });
    return opts.rows ?? [];
  });
  const prisma = { $executeRaw: executeRaw, $queryRaw: queryRaw } as unknown as PrismaService;
  return { prisma, executeRaw, queryRaw, executed, queried };
}

const at = (base: Date, offsetMs: number) => new Date(base.getTime() + offsetMs);
const row = (source: string, startMs: number, count: number) => ({ source, bucketStart: new Date(startMs), count });

describe('WebhookRejectCounterService.record', () => {
  it('chỉ tăng bộ đếm trong bộ nhớ: không chạm DB và không bao giờ ném', () => {
    const { prisma, executeRaw, queryRaw } = fakePrisma();
    const svc = new WebhookRejectCounterService(prisma);
    expect(() => svc.record('pancake', NOW)).not.toThrow();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
    expect(() => svc.record('gomdon', new Date('invalid'))).not.toThrow();
  });

  it('gộp các lần cùng nguồn trong cùng khung 5 phút, tách theo nguồn và theo khung', async () => {
    const { prisma, executed } = fakePrisma();
    const svc = new WebhookRejectCounterService(prisma);
    svc.record('pancake', at(ALIGNED, 0));
    svc.record('pancake', at(ALIGNED, 4 * MIN + 59_000));
    svc.record('pancake', at(ALIGNED, 5 * MIN));
    svc.record('gomdon', at(ALIGNED, 1 * MIN));
    await svc.flush();
    const byKey = Object.fromEntries(executed.map((e) => [`${e.values[0]}|${e.values[1]}`, e.values[2]]));
    expect(byKey).toEqual({
      [`pancake|${ALIGNED.toISOString()}`]: 2,
      [`pancake|${at(ALIGNED, BUCKET).toISOString()}`]: 1,
      [`gomdon|${ALIGNED.toISOString()}`]: 1,
    });
  });
});

describe('WebhookRejectCounterService.flush', () => {
  it('ghi bằng INSERT ... ON CONFLICT cộng dồn, qua tham số (không nối chuỗi), ép ::timestamp như launch-watch', async () => {
    const { prisma, executed } = fakePrisma();
    const svc = new WebhookRejectCounterService(prisma);
    svc.record('pancake', NOW);
    svc.record('pancake', NOW);
    await svc.flush();
    expect(executed).toHaveLength(1);
    const { sql, values } = executed[0]!;
    expect(sql).toContain('INSERT INTO "webhook_reject_counters"');
    expect(sql).toContain('ON CONFLICT ("source", "bucketStart")');
    expect(sql).toContain('"count" = "webhook_reject_counters"."count" + EXCLUDED."count"');
    expect(sql).toContain('"updatedAt" = EXCLUDED."updatedAt"');
    expect(sql).toContain('::timestamp');
    expect(sql).not.toMatch(/pancake|2026/);
    expect(values[0]).toBe('pancake');
    expect(values[1]).toBe(ALIGNED.toISOString());
    expect(values[2]).toBe(2);
  });

  it('ghi xong thì bộ nhớ trống: flush lần hai không ghi lại', async () => {
    const { prisma, executeRaw } = fakePrisma();
    const svc = new WebhookRejectCounterService(prisma);
    svc.record('gomdon', NOW);
    await svc.flush();
    await svc.flush();
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('không có gì để ghi thì không chạm DB', async () => {
    const { prisma, executeRaw } = fakePrisma();
    await new WebhookRejectCounterService(prisma).flush();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('ghi lỗi: không ném, không mất số đếm, lần flush sau ghi lại đủ (kể cả phần ghi thêm trong lúc lỗi)', async () => {
    let fail = true;
    const { prisma, executed } = fakePrisma({ failExecute: () => fail });
    const svc = new WebhookRejectCounterService(prisma);
    svc.record('pancake', NOW);
    svc.record('pancake', NOW);
    await expect(svc.flush()).resolves.toBeUndefined();
    expect(executed).toHaveLength(0);

    svc.record('pancake', NOW);
    fail = false;
    await svc.flush();
    expect(executed).toHaveLength(1);
    expect(executed[0]!.values[2]).toBe(3);
  });

  it('lỗi một khung không làm mất các khung khác: khung lỗi được giữ lại để ghi sau', async () => {
    let calls = 0;
    const { prisma, executed } = fakePrisma({ failExecute: () => ++calls === 1 });
    const svc = new WebhookRejectCounterService(prisma);
    svc.record('pancake', ALIGNED);
    svc.record('gomdon', ALIGNED);
    await svc.flush();
    expect(executed.map((e) => e.values[0])).toEqual(['gomdon']);
    await svc.flush();
    expect(executed.map((e) => e.values[0])).toEqual(['gomdon', 'pancake']);
  });

  it('không chạy chồng: gọi flush khi đang ghi thì dùng lại lần đang chạy, không ghi hai lần', async () => {
    let release: () => void = () => undefined;
    const executeRaw = jest.fn(() => new Promise<number>((resolve) => (release = () => resolve(1))));
    const svc = new WebhookRejectCounterService({ $executeRaw: executeRaw } as unknown as PrismaService);
    svc.record('pancake', NOW);
    const first = svc.flush();
    const second = svc.flush();
    expect(second).toBe(first);
    release();
    await first;
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});

describe('WebhookRejectCounterService vòng đời', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('tự ghi dồn mỗi 30 giây; xoá dòng quá 14 ngày một lần mỗi giờ; dừng và ghi lần cuối khi tắt', async () => {
    const { prisma, executed } = fakePrisma();
    const svc = new WebhookRejectCounterService(prisma);
    svc.onModuleInit();
    svc.record('pancake');
    await jest.advanceTimersByTimeAsync(30_000);
    const inserts = () => executed.filter((e) => e.sql.includes('INSERT INTO'));
    const purges = () => executed.filter((e) => e.sql.includes('DELETE FROM "webhook_reject_counters"'));
    expect(inserts()).toHaveLength(1);
    expect(purges()).toHaveLength(1);
    const cutoff = new Date(String(purges()[0]!.values[0])).getTime();
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(14 * DAY - 31_000);
    expect(Date.now() - cutoff).toBeLessThanOrEqual(14 * DAY + 1_000);

    await jest.advanceTimersByTimeAsync(30 * 60_000);
    expect(purges()).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(31 * 60_000);
    expect(purges()).toHaveLength(2);

    svc.record('gomdon');
    await svc.onModuleDestroy();
    expect(inserts().some((e) => e.values[0] === 'gomdon')).toBe(true);
    const total = executed.length;
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(executed).toHaveLength(total);
  });

  it('xoá quá hạn lỗi chỉ cảnh báo, không ném, và thử lại ở lần ghi dồn sau', async () => {
    let failDelete = true;
    const executeRaw = jest.fn(async (strings: TemplateStringsArray) => {
      if (strings.join('?').includes('DELETE FROM') && failDelete) throw new Error('boom');
      return 1;
    });
    const svc = new WebhookRejectCounterService({ $executeRaw: executeRaw } as unknown as PrismaService);
    svc.onModuleInit();
    await jest.advanceTimersByTimeAsync(30_000);
    const deletes = () => executeRaw.mock.calls.filter((c) => c[0].join('?').includes('DELETE FROM')).length;
    expect(deletes()).toBe(1);
    failDelete = false;
    await jest.advanceTimersByTimeAsync(30_000);
    expect(deletes()).toBe(2);
    await svc.onModuleDestroy();
  });
});

describe('WebhookRejectCounterService.summary', () => {
  it('luôn đủ cả hai nguồn theo thứ tự pancake, gomdon; nguồn chưa có số đếm là 0', async () => {
    const { prisma } = fakePrisma();
    const out = await new WebhookRejectCounterService(prisma).summary(NOW, 10);
    expect(WEBHOOK_SOURCES).toEqual(['pancake', 'gomdon']);
    expect(out).toEqual([
      { source: 'pancake', lastHour: 0, last24h: 0, peakPerHour: 0, lastAt: null, alert: false },
      { source: 'gomdon', lastHour: 0, last24h: 0, peakPerHour: 0, lastAt: null, alert: false },
    ]);
  });

  it('đọc DB bằng một truy vấn tham số hoá, mốc dưới là now - 24 giờ (ép ::timestamp)', async () => {
    const { prisma, queried } = fakePrisma();
    await new WebhookRejectCounterService(prisma).summary(NOW, 10);
    expect(queried).toHaveLength(1);
    expect(queried[0]!.sql).toContain('FROM "webhook_reject_counters"');
    expect(queried[0]!.sql).toContain('::timestamp');
    expect(queried[0]!.values).toEqual([at(NOW, -DAY).toISOString()]);
  });

  it('biên 60 phút: khung có đầu khung đúng bằng now - 60 phút không tính vào lastHour, khung ngay sau thì có', async () => {
    const start = Math.floor(NOW.getTime() / BUCKET) * BUCKET;
    const out = await new WebhookRejectCounterService(
      fakePrisma({
        rows: [
          row('pancake', ALIGNED.getTime() - HOUR, 4), // đúng 11:00 so với now 12:00 => không tính
          row('pancake', ALIGNED.getTime() - HOUR + BUCKET, 3), // 11:05 => tính
          row('pancake', start, 2),
        ],
      }).prisma,
    ).summary(ALIGNED, 1);
    expect(out[0]!).toMatchObject({ lastHour: 3 + 2, last24h: 4 + 3 + 2 });

    const unaligned = await new WebhookRejectCounterService(
      fakePrisma({
        rows: [
          row('pancake', Date.parse('2026-11-16T11:00:00.000Z'), 9), // 11:00 <= now-60'=11:03 => không tính
          row('pancake', Date.parse('2026-11-16T11:05:00.000Z'), 1), // 11:05 > 11:03 => tính
        ],
      }).prisma,
    ).summary(NOW, 1);
    expect(unaligned[0]).toMatchObject({ lastHour: 1, last24h: 10 });
  });

  it('biên 24 giờ: khung có đầu khung đúng now - 24 giờ bị loại khỏi last24h (cả khi DB trả về)', async () => {
    const out = await new WebhookRejectCounterService(
      fakePrisma({
        rows: [row('gomdon', ALIGNED.getTime() - DAY, 100), row('gomdon', ALIGNED.getTime() - DAY + BUCKET, 2)],
      }).prisma,
    ).summary(ALIGNED, 10);
    expect(out[1]!).toMatchObject({ source: 'gomdon', last24h: 2, lastHour: 0, peakPerHour: 2 });
  });

  it('alert đúng ở ngưỡng: lastHour >= N báo, N - 1 thì không', async () => {
    const rows = [row('pancake', ALIGNED.getTime() - 10 * MIN, 6), row('pancake', ALIGNED.getTime() - 20 * MIN, 4)];
    const svc = new WebhookRejectCounterService(fakePrisma({ rows }).prisma);
    expect((await svc.summary(ALIGNED, 10))[0]!).toMatchObject({ lastHour: 10, alert: true });
    expect((await svc.summary(ALIGNED, 11))[0]!).toMatchObject({ lastHour: 10, alert: false });
    expect((await svc.summary(ALIGNED, 9))[0]!.alert).toBe(true);
    expect((await svc.summary(ALIGNED, 10))[1]!.alert).toBe(false);
  });

  it('peakPerHour là tổng 12 khung liên tiếp lớn nhất trong 24 giờ, không phải khung đơn lẻ và không phải tổng cả ngày', async () => {
    const hoursAgo = (h: number, extraMin = 0) => ALIGNED.getTime() - h * HOUR + extraMin * MIN;
    const rows = [
      // Đợt cũ cách đây 10 giờ: 5 + 5 + 5 trong 40 phút = 15.
      row('pancake', hoursAgo(10, 0), 5),
      row('pancake', hoursAgo(10, 20), 5),
      row('pancake', hoursAgo(10, 40), 5),
      // Rải rác ở các giờ khác.
      row('pancake', hoursAgo(5), 2),
      row('pancake', hoursAgo(2), 1),
      row('pancake', hoursAgo(0, -5), 1),
    ];
    const pancake = (await new WebhookRejectCounterService(fakePrisma({ rows }).prisma).summary(ALIGNED, 100))[0]!;
    expect(pancake.last24h).toBe(15 + 2 + 1 + 1);
    expect(pancake.peakPerHour).toBe(15);
    expect(pancake.lastHour).toBe(1);
  });

  it('lastAt là đầu khung mới nhất có số đếm > 0', async () => {
    const newest = ALIGNED.getTime() - 25 * MIN;
    const rows = [row('pancake', ALIGNED.getTime() - 3 * HOUR, 9), row('pancake', newest, 1), row('pancake', ALIGNED.getTime() - 10 * MIN, 0)];
    const summary = await new WebhookRejectCounterService(fakePrisma({ rows }).prisma).summary(ALIGNED, 10);
    const [pancake, gomdon] = [summary[0]!, summary[1]!];
    expect(pancake.lastAt).toBe(new Date(newest).toISOString());
    expect(gomdon.lastAt).toBeNull();
  });

  it('cộng phần chưa ghi trong bộ nhớ vào số đọc từ DB (số liệu tức thời), nguồn lạ trong DB bị bỏ qua, count bigint/chuỗi thời gian vẫn đọc được', async () => {
    const svc = new WebhookRejectCounterService(
      fakePrisma({
        rows: [
          { source: 'pancake', bucketStart: new Date(ALIGNED.getTime() - 15 * MIN), count: 3 },
          { source: 'gomdon', bucketStart: new Date(ALIGNED.getTime() - 10 * MIN).toISOString(), count: 2n },
          { source: 'khac', bucketStart: new Date(ALIGNED.getTime() - 10 * MIN), count: 50 },
        ],
      }).prisma,
    );
    svc.record('pancake', at(ALIGNED, 1 * MIN));
    svc.record('pancake', at(ALIGNED, 2 * MIN));
    const out = await svc.summary(at(ALIGNED, 3 * MIN), 5);
    expect(out[0]!).toMatchObject({ source: 'pancake', lastHour: 5, last24h: 5, alert: true, lastAt: ALIGNED.toISOString() });
    expect(out[1]!).toMatchObject({ source: 'gomdon', lastHour: 2, last24h: 2, alert: false });
    expect(out).toHaveLength(2);
  });

  it('số đếm chỉ có nguồn + số + mốc giờ: đối tượng trả về không có trường nào khác', async () => {
    const out = await new WebhookRejectCounterService(fakePrisma({ rows: [row('pancake', ALIGNED.getTime() - 10 * MIN, 1)] }).prisma).summary(ALIGNED, 1);
    expect(Object.keys(out[0]!).sort()).toEqual(['alert', 'last24h', 'lastAt', 'lastHour', 'peakPerHour', 'source']);
  });
});

describe('normalizeWebhookRejectThreshold (khoá ops.webhook_reject_alert_per_hour)', () => {
  it.each([
    [10, 10],
    [1, 1],
    [100000, 100000],
    [25, 25],
  ])('số nguyên hợp lệ %j giữ nguyên', (input, expected) => {
    expect(normalizeWebhookRejectThreshold(input)).toBe(expected);
  });

  it.each([[0], [-5], [100001], [2.5], ['20'], [null], [undefined], [true], [{}], [[]], [NaN], [Infinity]])('giá trị sai %j dùng mặc định 10', (input) => {
    expect(normalizeWebhookRejectThreshold(input)).toBe(10);
  });
});
