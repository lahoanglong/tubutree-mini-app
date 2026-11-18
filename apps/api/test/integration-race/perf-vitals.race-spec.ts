import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { DataRetentionService } from '../../src/modules/data-retention/data-retention.service';
import { VITALS_MAX_ROUTES, VitalsSummaryService } from '../../src/modules/analytics/vitals/vitals-summary.service';
import { randCode, warmPool } from './helpers';

/**
 * Thẻ "Tốc độ trên máy khách" trên Postgres THẬT: p75 (nội suy như percentile_cont), số mẫu tốt / cần cải thiện / kém theo ngưỡng Core Web
 * Vitals, cửa sổ 7/28 ngày theo `receivedAt`, dòng `*` gộp mọi route; luật dọn chỉ xoá số đo quá 90 ngày, không đụng sự kiện khác.
 * Mỗi lần chạy dùng một mẫu route riêng nên không lẫn dòng của lần chạy trước trong DB race dùng chung.
 */
const DAY = 86_400_000;
const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe('Số đo tốc độ trên máy khách (real Postgres)', () => {
  let prisma: PrismaService;
  const tag = randCode(8).toLowerCase().replace(/[^a-z]/g, 'x');
  const route = `/w405-${tag}/:slug`;

  const vital = (eventName: 'web_vital' | 'mini_vital', name: string, value: number, receivedAt: Date, vp = 's', r = route) => ({
    eventId: randomUUID(),
    eventName,
    occurredAt: receivedAt,
    receivedAt,
    platform: eventName === 'web_vital' ? 'web' : 'miniapp',
    props: { name, value, route: r, vp },
  });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { eventName: { in: ['web_vital', 'mini_vital'] }, props: { path: ['route'], equals: route } } });
    await prisma?.$disconnect();
  });

  it('p75, tốt / cần cải thiện / kém và cửa sổ 7/28 ngày', async () => {
    const lcp = [1000, 2000, 2500, 3000, 3900, 4000, 4100, 5000];
    await prisma.analyticsEvent.createMany({
      data: [
        ...lcp.map((v, i) => vital('web_vital', 'LCP', v, ago(1 + i * 0.1))),
        // Ngoài cửa sổ 7 ngày, trong cửa sổ 28 ngày.
        vital('web_vital', 'LCP', 100, ago(10)),
        vital('web_vital', 'LCP', 100, ago(10)),
        ...[0.01, 0.05, 0.2, 0.3].map((v) => vital('web_vital', 'CLS', v, ago(2), 'l')),
        ...[1200, 2400, 9000].map((v) => vital('mini_vital', 'READY', v, ago(3))),
        // Quá 28 ngày: không vào cửa sổ nào.
        vital('web_vital', 'LCP', 99_000 / 10, ago(40)),
      ],
    });

    const svc = new VitalsSummaryService(prisma);
    const week = await svc.summary(7, NOW);
    const row = (rows: typeof week.rows, platform: string, name: string, vp: string) =>
      rows.find((r) => r.platform === platform && r.name === name && r.route === route && r.viewport === vp);

    // p75 của 8 giá trị: vị trí 0,75 × 7 = 5,25 → 4000 + 0,25 × (4100 − 4000) = 4025.
    expect(row(week.rows, 'web', 'LCP', 's')).toEqual(
      expect.objectContaining({ samples: 8, p75: 4025, good: 3, needsImprovement: 3, poor: 2, rating: 'poor', enoughSamples: false }),
    );
    // CLS giữ 3 số lẻ: vị trí 2,25 → 0,2 + 0,25 × 0,1 = 0,225.
    expect(row(week.rows, 'web', 'CLS', 'l')).toEqual(expect.objectContaining({ samples: 4, p75: 0.225, good: 2, needsImprovement: 1, poor: 1, rating: 'needs-improvement' }));
    expect(row(week.rows, 'miniapp', 'READY', 's')).toEqual(expect.objectContaining({ samples: 3, p75: 5700, good: 2, poor: 1 }));
    const all = week.rows.find((r) => r.platform === 'web' && r.name === 'LCP' && r.route === '*' && r.viewport === 's');
    expect(all?.samples).toBeGreaterThanOrEqual(8);
    expect(week).toEqual(expect.objectContaining({ days: 7, minSamples: 50 }));

    const month = await svc.summary(28, NOW);
    expect(row(month.rows, 'web', 'LCP', 's')).toEqual(expect.objectContaining({ samples: 10, good: 5, poor: 2 }));
  });

  it(`bảng chỉ giữ ${VITALS_MAX_ROUTES} route nhiều mẫu nhất mỗi nền tảng; dòng * vẫn gộp mọi route`, async () => {
    // Cửa sổ đặt ở tương lai để không lẫn số đo thật hay của bài khác trong DB race dùng chung.
    const future = new Date(NOW.getTime() + 1000 * DAY);
    const at = new Date(future.getTime() - DAY);
    const kept = Array.from({ length: VITALS_MAX_ROUTES }, (_, i) => `/w405-${tag}-cap${String(i).padStart(2, '0')}`);
    const dropped = `/w405-${tag}-cap-it`;
    const data = [...kept.flatMap((r) => [vital('web_vital', 'LCP', 1000, at, 's', r), vital('web_vital', 'LCP', 3000, at, 's', r)]), vital('web_vital', 'LCP', 9000, at, 's', dropped)];
    try {
      await prisma.analyticsEvent.createMany({ data });
      const { rows } = await new VitalsSummaryService(prisma).summary(7, future);
      const mine = rows.filter((r) => r.platform === 'web' && r.name === 'LCP' && r.route.startsWith(`/w405-${tag}-cap`));
      expect(mine.map((r) => r.route).sort()).toEqual(kept);
      const all = rows.find((r) => r.platform === 'web' && r.name === 'LCP' && r.route === '*' && r.viewport === 's');
      // Route bị bỏ khỏi bảng (mẫu 9000 ms duy nhất là "kém") vẫn được tính trong dòng gộp.
      expect(all).toEqual(expect.objectContaining({ samples: 2 * VITALS_MAX_ROUTES + 1, good: VITALS_MAX_ROUTES, needsImprovement: VITALS_MAX_ROUTES, poor: 1 }));
    } finally {
      await prisma.analyticsEvent.deleteMany({ where: { eventId: { in: data.map((d) => d.eventId) } } });
    }
  });

  it('dọn dữ liệu: số đo quá 90 ngày bị xoá, số đo còn hạn và sự kiện khác cùng tuổi ở lại', async () => {
    const old = vital('web_vital', 'LCP', 1500, ago(91));
    const fresh = vital('mini_vital', 'LCP', 1500, ago(89));
    const otherOld = { ...vital('web_vital', 'LCP', 1, ago(91)), eventName: 'screen_viewed', props: { route } };
    await prisma.analyticsEvent.createMany({ data: [old, fresh, otherOld] });

    const res = await new DataRetentionService(prisma, new SystemConfigService(prisma)).runAll({ now: NOW, batchSize: 1000, pauseMs: 0 });
    expect(res).toEqual(expect.objectContaining({ deleted: expect.objectContaining({ 'analytics_events.perf_vitals': expect.any(Number) }) }));
    const left = await prisma.analyticsEvent.findMany({ where: { eventId: { in: [old.eventId, fresh.eventId, otherOld.eventId] } }, select: { eventId: true } });
    expect(new Set(left.map((r) => r.eventId))).toEqual(new Set([fresh.eventId, otherOld.eventId]));
  });
});
