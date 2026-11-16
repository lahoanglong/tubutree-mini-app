import { PrismaService } from '../../src/prisma/prisma.service';
import { WebhookRejectCounterService } from '../../src/modules/analytics/webhook-reject-counter.service';
import './setup-env';

/**
 * Bộ đếm webhook bị từ chối 401 trên Postgres THẬT: spec đơn vị chỉ mock `$executeRaw`/`$queryRaw`, nên đây là nơi duy nhất chứng minh câu
 * INSERT ... ON CONFLICT cộng dồn đúng và summary đọc đúng kiểu timestamp. Dùng mốc `now` ở tương lai xa (2046) để không lẫn dữ liệu của spec khác;
 * dọn đúng các dòng của mốc đó khi xong.
 */
const NOW = new Date('2046-06-15T12:03:00.000Z');
const BUCKET_FROM = new Date('2046-06-14T00:00:00.000Z');
const BUCKET_TO = new Date('2046-06-16T00:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe('WebhookRejectCounterService — SQL trên Postgres thật', () => {
  let prisma: PrismaService;

  const clean = () =>
    prisma.$executeRaw`DELETE FROM "webhook_reject_counters" WHERE "bucketStart" >= ${BUCKET_FROM.toISOString()}::timestamp AND "bucketStart" < ${BUCKET_TO.toISOString()}::timestamp`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await clean();
  });

  afterAll(async () => {
    await clean();
    await prisma?.$disconnect();
  });

  it('flush cộng dồn vào dòng có sẵn (hai lần flush, cùng khung 5 phút) và summary đọc lại đúng', async () => {
    const svc = new WebhookRejectCounterService(prisma);
    for (let i = 0; i < 3; i += 1) svc.record('pancake', minutesAgo(1));
    await svc.flush();
    for (let i = 0; i < 4; i += 1) svc.record('pancake', minutesAgo(2));
    svc.record('gomdon', minutesAgo(30));
    await svc.flush();

    const rows = await prisma.$queryRaw<{ source: string; count: number }[]>`
      SELECT "source", "count" FROM "webhook_reject_counters"
       WHERE "bucketStart" >= ${BUCKET_FROM.toISOString()}::timestamp AND "bucketStart" < ${BUCKET_TO.toISOString()}::timestamp
       ORDER BY "source"`;
    expect(rows.map((r) => [r.source, Number(r.count)])).toEqual([
      ['gomdon', 1],
      ['pancake', 7],
    ]);

    const fresh = new WebhookRejectCounterService(prisma);
    const [pancake, gomdon] = await fresh.summary(NOW, 5);
    expect(pancake).toMatchObject({ source: 'pancake', lastHour: 7, last24h: 7, peakPerHour: 7, alert: true });
    expect(gomdon).toMatchObject({ source: 'gomdon', lastHour: 1, last24h: 1, alert: false });
    expect(pancake.lastAt).toBe('2046-06-15T12:00:00.000Z');
  });
});
