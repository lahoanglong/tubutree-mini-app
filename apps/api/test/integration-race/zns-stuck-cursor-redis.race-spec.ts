import { Queue } from 'bullmq';
import { ZnsStuckLogCron } from '../../src/modules/notifications/zns-stuck-log.cron';

/**
 * Con trỏ quay vòng của cron đi qua proxy IRedisClient thật của BullMQ tới Redis thật (SET key val { EX } phải thành SET ... EX của ioredis).
 * Bộ race chưa có hạ tầng Redis nên spec chỉ chạy khi có TEST_REDIS_URL, ví dụ:
 *   docker run --rm -d --tmpfs /data -p 46589:6379 --name tubu-hg-redis redis:7-alpine
 *   TEST_REDIS_URL=redis://127.0.0.1:46589 npx jest -c test/integration-race/jest.config.js --runInBand zns-stuck-cursor-redis
 */
const url = process.env.TEST_REDIS_URL;
(url ? describe : describe.skip)('con trỏ cron ZNS kẹt trên Redis thật', () => {
  let queue: Queue;
  let cron: ZnsStuckLogCron;
  const KEY = 'zns-stuck-cron:cursor';
  const api = () => cron as unknown as { loadCursor(q: Queue): Promise<{ sentAt: string; id: string } | null>; saveCursor(q: Queue, c: { sentAt: string; id: string } | null): Promise<void> };

  beforeAll(async () => {
    const u = new URL(url as string);
    queue = new Queue(`it-zns-cursor-${Date.now()}`, { connection: { host: u.hostname, port: Number(u.port) || 6379, maxRetriesPerRequest: null } });
    cron = new ZnsStuckLogCron({} as never, {} as never, queue);
    await (await queue.client).del(KEY);
  });

  afterAll(async () => {
    await (await queue.client).del(KEY);
    await queue.close();
  });

  it('ghi con trỏ: khoá tồn tại với TTL ~1 ngày, đọc lại đúng giá trị', async () => {
    const cursor = { sentAt: '2026-11-05T01:02:03.000Z', id: 'log-abc' };
    await api().saveCursor(queue, cursor);
    const client = (await queue.client) as unknown as { ttl(k: string): Promise<number> };
    const ttl = await client.ttl(KEY);
    expect(ttl).toBeGreaterThan(86_000);
    expect(ttl).toBeLessThanOrEqual(86_400);
    expect(await api().loadCursor(queue)).toEqual(cursor);
  });

  it('một bản cron khác (instance khác) đọc được con trỏ dùng chung', async () => {
    const other = new ZnsStuckLogCron({} as never, {} as never, queue) as unknown as ReturnType<typeof api>;
    expect(await other.loadCursor(queue)).toEqual({ sentAt: '2026-11-05T01:02:03.000Z', id: 'log-abc' });
  });

  it('ghi null xoá khoá; dữ liệu hỏng trong khoá thì coi như không có con trỏ', async () => {
    await api().saveCursor(queue, null);
    expect(await api().loadCursor(queue)).toBeNull();
    await (await queue.client).set(KEY, 'không phải JSON');
    expect(await api().loadCursor(queue)).toBeNull();
    await (await queue.client).del(KEY);
  });
});
