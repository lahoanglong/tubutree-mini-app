import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { PerKeyThrottlerStorage } from './per-key-throttler.storage';
import { throttlerRootModule } from './throttle.config';

const TTL = 60_000;
const NAME = 'lookupPhone';

describe('PerKeyThrottlerStorage', () => {
  let storage: PerKeyThrottlerStorage;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-23T08:00:00Z') });
    storage = new PerKeyThrottlerStorage();
  });
  afterEach(() => {
    storage.onModuleDestroy();
    jest.useRealTimers();
  });

  const hit = (s: ThrottlerStorage, key: string, limit = 3, ttl = TTL, block = ttl, name = NAME) => s.increment(key, ttl, limit, block, name);
  const hitN = async (s: ThrottlerStorage, key: string, n: number, limit = 3, ttl = TTL, block = ttl) => {
    let last = await hit(s, key, limit, ttl, block);
    for (let i = 1; i < n; i++) last = await hit(s, key, limit, ttl, block);
    return last;
  };

  it('đếm lượt và trả bản ghi như bản gốc: số lượt, giây còn của cửa sổ, chưa chặn', async () => {
    const first = await hit(storage, 'a');
    expect(first).toEqual({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: expect.any(Number) });
    expect(first.timeToBlockExpire).toBeLessThanOrEqual(0);
    jest.advanceTimersByTime(10_000);
    expect(await hit(storage, 'a')).toMatchObject({ totalHits: 2, timeToExpire: 50, isBlocked: false });
  });

  it('mỗi lượt tự trừ sau ttl (cửa sổ trượt theo từng lượt)', async () => {
    await hit(storage, 'a');
    jest.advanceTimersByTime(20_000);
    await hit(storage, 'a');
    jest.advanceTimersByTime(40_000);
    expect(await hit(storage, 'a', 10)).toMatchObject({ totalHits: 2 });
  });

  it('vượt trần thì chặn đúng blockDuration, lượt bị chặn không đếm, hết chặn thì đếm lại từ 1', async () => {
    const blocked = await hitN(storage, 'a', 4, 3, TTL, 900_000);
    expect(blocked).toMatchObject({ totalHits: 4, isBlocked: true, timeToBlockExpire: 900 });
    jest.advanceTimersByTime(300_000);
    expect(await hit(storage, 'a', 3, TTL, 900_000)).toMatchObject({ isBlocked: true, timeToBlockExpire: 600 });
    jest.advanceTimersByTime(600_000);
    expect(await hit(storage, 'a', 3, TTL, 900_000)).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  /** A bị chặn lúc t0; B gọi 3 lượt lúc t0+30s; A hết chặn và gọi lại lúc t0+60s; lúc t0+90s ba lượt của B đã quá ttl. */
  async function unblockAWhileBHasHits(s: ThrottlerStorage) {
    await hitN(s, 'a', 4, 3);
    jest.advanceTimersByTime(TTL / 2);
    await hitN(s, 'b', 3, 3);
    jest.advanceTimersByTime(TTL / 2);
    expect(await hit(s, 'a')).toMatchObject({ totalHits: 1, isBlocked: false });
    jest.advanceTimersByTime(TTL / 2 + 1);
    return hit(s, 'b');
  }

  it('tubu-w19-03: khoá A hết chặn KHÔNG huỷ hẹn giờ trừ lượt của khoá B cùng throttler', async () => {
    // Ba lượt cũ của B phải được trừ hết: B gọi tiếp vẫn được, không bị chặn.
    expect(await unblockAWhileBHasHits(storage)).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('bằng chứng: ThrottlerStorageService 6.5.0 có lỗi trên (ca này đỏ khi nâng thư viện thì xem lại có còn cần bộ nhớ riêng)', async () => {
    const original = new ThrottlerStorageService();
    try {
      expect(await unblockAWhileBHasHits(original)).toMatchObject({ totalHits: 4, isBlocked: true });
    } finally {
      original.onApplicationShutdown();
    }
  });

  it('cùng chuỗi khoá ở hai throttler khác tên là hai bộ đếm riêng', async () => {
    await hitN(storage, 'same', 4, 3, TTL, TTL);
    expect(await storage.increment('same', TTL, 3, TTL, 'default')).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('blockedSeconds đọc số giây còn chặn mà không đếm thêm lượt', async () => {
    expect(storage.blockedSeconds('a', NAME)).toBe(0);
    await hitN(storage, 'a', 3, 3, TTL, 900_000);
    expect(storage.blockedSeconds('a', NAME)).toBe(0);
    expect(storage.blockedSeconds('a', NAME)).toBe(0);
    await hit(storage, 'a', 3, TTL, 900_000);
    expect(storage.blockedSeconds('a', NAME)).toBe(900);
    expect(storage.blockedSeconds('a', 'default')).toBe(0);
    jest.advanceTimersByTime(899_500);
    expect(storage.blockedSeconds('a', NAME)).toBe(1);
    jest.advanceTimersByTime(500);
    expect(storage.blockedSeconds('a', NAME)).toBe(0);
  });

  it('khoá hết lượt thì bị xoá khỏi bộ nhớ; khoá còn bị chặn lâu hơn ttl thì giữ tới lúc hết chặn', async () => {
    await hitN(storage, 'idle', 2, 3);
    await hitN(storage, 'blocked', 4, 3, TTL, 900_000);
    expect(storage.size).toBe(2);
    jest.advanceTimersByTime(TTL);
    expect(storage.size).toBe(1);
    expect(storage.blockedSeconds('blocked', NAME)).toBe(840);
    jest.advanceTimersByTime(840_001);
    expect(storage.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    expect(await hit(storage, 'blocked', 3, TTL, 900_000)).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('onModuleDestroy huỷ mọi hẹn giờ và xoá bộ đếm', async () => {
    await hitN(storage, 'a', 5, 3);
    await hitN(storage, 'b', 2, 3);
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    storage.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
    expect(storage.size).toBe(0);
  });

  it('một khoá: chuỗi lượt ngẫu nhiên cho cùng kết quả với ThrottlerStorageService (ngữ nghĩa đếm không đổi)', async () => {
    let seed = 19_03;
    const rand = (n: number) => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed % n;
    };
    for (const [limit, ttl, block] of [
      [3, 10_000, 10_000],
      [2, 10_000, 30_000],
      [4, 20_000, 5_000],
    ] as const) {
      const ours = new PerKeyThrottlerStorage();
      const original = new ThrottlerStorageService();
      try {
        for (let step = 0; step < 400; step++) {
          jest.advanceTimersByTime(rand(4) === 0 ? rand(40_000) : rand(3_000));
          const a = await ours.increment('k', ttl, limit, block, NAME);
          const b = await original.increment('k', ttl, limit, block, NAME);
          const view = (r: typeof a) => ({ ...r, timeToBlockExpire: r.isBlocked ? r.timeToBlockExpire : 'not-blocked' });
          expect({ step, limit, ...view(a) }).toEqual({ step, limit, ...view(b) });
        }
      } finally {
        ours.onModuleDestroy();
        original.onApplicationShutdown();
      }
    }
  });

  it('throttlerRootModule: mỗi app có bộ nhớ PerKeyThrottlerStorage riêng, đóng app thì huỷ hẹn giờ', async () => {
    const compile = () => Test.createTestingModule({ imports: [throttlerRootModule()] }).compile();
    const one = await compile();
    const two = await compile();
    const a = one.get<PerKeyThrottlerStorage>(ThrottlerStorage);
    const b = two.get<PerKeyThrottlerStorage>(ThrottlerStorage);
    expect(a).toBeInstanceOf(PerKeyThrottlerStorage);
    expect(b).toBeInstanceOf(PerKeyThrottlerStorage);
    expect(a).not.toBe(b);
    await hitN(a, 'k', 2);
    expect(b.size).toBe(0);
    expect(jest.getTimerCount()).toBe(2);
    await one.close();
    expect(a.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    await two.close();
  });
});
