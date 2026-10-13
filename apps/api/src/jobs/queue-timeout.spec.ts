import { createRequire } from 'node:module';
import { Queue } from 'bullmq';
import { QueueTimeoutError, withQueueTimeout } from './queue-timeout';
import { addGomdonJob } from '../modules/integrations/gomdon/gomdon-queue';

describe('withQueueTimeout', () => {
  it('trả kết quả khi lệnh queue xong trong hạn', async () => {
    await expect(withQueueTimeout(Promise.resolve('ok'), 'test', 50)).resolves.toBe('ok');
  });

  it('chuyển lỗi của lệnh queue ra ngoài', async () => {
    await expect(withQueueTimeout(Promise.reject(new Error('boom')), 'test', 50)).rejects.toThrow('boom');
  });

  it('lệnh treo (Redis mất kết nối, ioredis giữ trong offline queue) → ném QueueTimeoutError đúng hạn', async () => {
    const started = Date.now();
    await expect(withQueueTimeout(new Promise(() => undefined), 'pancake-push o1', 50)).rejects.toBeInstanceOf(
      QueueTimeoutError,
    );
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('lệnh treo bị reject SAU khi đã hết hạn → không thành unhandled rejection', async () => {
    let rejectLater!: (e: Error) => void;
    const p = new Promise((_, reject) => {
      rejectLater = reject;
    });
    await expect(withQueueTimeout(p, 'x', 10)).rejects.toBeInstanceOf(QueueTimeoutError);
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    rejectLater(new Error('late'));
    await new Promise((r) => setImmediate(r));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

interface RawRedis {
  on(event: string, listener: () => void): void;
  disconnect(): void;
}
type RedisCtor = new (opts: object) => RawRedis;
// ioredis là dependency của bullmq, api không khai báo trực tiếp; tự tạo client để đóng được nó khi
// chưa từng kết nối (queue.close()/disconnect() chờ 'ready' mãi).
const IORedis = createRequire(require.resolve('bullmq'))('ioredis') as { default: RedisCtor };

describe('enqueue khi Redis không tới được (BullMQ thật, cổng đóng)', () => {
  let redis: RawRedis;
  let queue: Queue;

  beforeAll(() => {
    redis = new IORedis.default({ host: '127.0.0.1', port: 1, maxRetriesPerRequest: null, retryStrategy: () => 200 });
    redis.on('error', () => undefined);
    queue = new Queue('p11-redis-down', { connection: redis as never });
    queue.on('error', () => undefined);
  });

  afterAll(() => {
    redis.disconnect();
  });

  it('addGomdonJob lỗi nhanh thay vì treo vô hạn để caller fallback sang cron reconcile', async () => {
    const started = Date.now();
    await expect(addGomdonJob(queue, 'process', { eventId: 'e1' }, 'e1')).rejects.toBeInstanceOf(QueueTimeoutError);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 10_000);
});
