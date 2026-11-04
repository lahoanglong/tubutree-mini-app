import { QueueTimeoutError, QUEUE_BREAKER_OPEN_MS, QUEUE_BREAKER_THRESHOLD, resetQueueBreaker, withQueueTimeout } from './queue-timeout';

const hang = () => new Promise<never>(() => undefined);

describe('withQueueTimeout: breaker khi Redis sập (L3-07)', () => {
  let now = 1_000_000;
  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    resetQueueBreaker();
  });
  afterEach(() => jest.restoreAllMocks());

  const failOnce = () => expect(withQueueTimeout(hang(), 'x', 5)).rejects.toBeInstanceOf(QueueTimeoutError);

  it('hằng số: mở sau 3 lần quá hạn liên tiếp, mở 30 giây', () => {
    expect(QUEUE_BREAKER_THRESHOLD).toBe(3);
    expect(QUEUE_BREAKER_OPEN_MS).toBe(30_000);
  });

  it('đủ lần lỗi liên tiếp thì mở: lệnh sau lỗi ngay, không chờ hạn và không gọi lệnh gốc', async () => {
    for (let i = 0; i < QUEUE_BREAKER_THRESHOLD; i++) await failOnce();
    const started = jest.fn();
    const t0 = performance.now();
    await expect(withQueueTimeout(Promise.resolve().then(started), 'y', 2_000)).rejects.toThrow(/tạm ngắt|breaker/i);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('một lần thành công giữa chừng đặt lại bộ đếm', async () => {
    await failOnce();
    await failOnce();
    await expect(withQueueTimeout(Promise.resolve('ok'), 'z', 50)).resolves.toBe('ok');
    await failOnce();
    await failOnce();
    await expect(withQueueTimeout(Promise.resolve('ok'), 'z', 50)).resolves.toBe('ok');
  });

  it('hết 30 giây: cho đúng một lệnh dò; dò thành công thì đóng, dò hỏng thì mở lại ngay', async () => {
    for (let i = 0; i < QUEUE_BREAKER_THRESHOLD; i++) await failOnce();
    now += QUEUE_BREAKER_OPEN_MS + 1;
    await expect(withQueueTimeout(Promise.resolve('up'), 'probe', 50)).resolves.toBe('up');
    await expect(withQueueTimeout(Promise.resolve('up'), 'after', 50)).resolves.toBe('up');

    for (let i = 0; i < QUEUE_BREAKER_THRESHOLD; i++) await failOnce();
    now += QUEUE_BREAKER_OPEN_MS + 1;
    await failOnce();
    await expect(withQueueTimeout(Promise.resolve('x'), 'blocked', 50)).rejects.toThrow(/tạm ngắt|breaker/i);
  });

  it('đang dò: lệnh khác chạy cùng lúc bị chặn ngay, chỉ một lệnh dò chờ hạn', async () => {
    for (let i = 0; i < QUEUE_BREAKER_THRESHOLD; i++) await failOnce();
    now += QUEUE_BREAKER_OPEN_MS + 1;
    const probe = withQueueTimeout(hang(), 'probe', 20);
    await expect(withQueueTimeout(Promise.resolve('x'), 'other', 50)).rejects.toThrow(/tạm ngắt|breaker/i);
    await expect(probe).rejects.toBeInstanceOf(QueueTimeoutError);
  });

  it('lỗi của chính lệnh (không phải quá hạn) không tính vào bộ đếm', async () => {
    for (let i = 0; i < QUEUE_BREAKER_THRESHOLD + 2; i++) await expect(withQueueTimeout(Promise.reject(new Error('boom')), 'e', 50)).rejects.toThrow('boom');
    await expect(withQueueTimeout(Promise.resolve('ok'), 'z', 50)).resolves.toBe('ok');
  });

  it('lời gọi sức khoẻ (breaker: false) quá hạn bao nhiêu lần cũng không mở breaker cho enqueue thường', async () => {
    for (let i = 0; i < QUEUE_BREAKER_THRESHOLD + 2; i++) {
      await expect(withQueueTimeout(hang(), 'ops health queues', 5, { breaker: false })).rejects.toBeInstanceOf(QueueTimeoutError);
    }
    await expect(withQueueTimeout(Promise.resolve('ok'), 'enqueue', 50)).resolves.toBe('ok');
  });

  it('lời gọi sức khoẻ vẫn chạy thật khi breaker đang mở (để báo đúng Redis đã lên lại)', async () => {
    for (let i = 0; i < QUEUE_BREAKER_THRESHOLD; i++) await failOnce();
    await expect(withQueueTimeout(Promise.resolve('up'), 'health ping', 50, { breaker: false })).resolves.toBe('up');
  });
});
