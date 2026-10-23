import { describe, expect, it } from 'vitest';
import { SendQueue } from './send-queue';

function fakeClock() {
  let t = 1_000_000;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('SendQueue', () => {
  it('hai lệnh cách nhau ít nhất 1.500 ms', async () => {
    const c = fakeClock();
    const q = new SendQueue({ now: c.now, sleep: c.sleep, random: () => 0 });
    const times: number[] = [];
    await Promise.all([
      q.enqueue(async () => times.push(c.now())),
      q.enqueue(async () => times.push(c.now())),
    ]);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1500);
  });

  it('cộng thêm ngẫu nhiên tới jitterMs', async () => {
    const c = fakeClock();
    const q = new SendQueue({ now: c.now, sleep: c.sleep, random: () => 0.5 });
    const times: number[] = [];
    await q.enqueue(async () => times.push(c.now()));
    await q.enqueue(async () => times.push(c.now()));
    expect(times[1] - times[0]).toBe(2000);
  });

  it('lệnh thứ 301 trong một giờ chờ tới khi lệnh đầu quá 1 giờ', async () => {
    const c = fakeClock();
    const q = new SendQueue({ spacingMs: 0, jitterMs: 0, now: c.now, sleep: c.sleep, random: () => 0 });
    const start = c.now();
    const times: number[] = [];
    for (let i = 0; i < 301; i++) {
      await q.enqueue(async () => times.push(c.now()));
    }
    expect(times[299] - start).toBeLessThan(3_600_000);
    expect(times[300] - times[0]).toBeGreaterThanOrEqual(3_600_000);
  });

  it('lệnh lỗi không chặn lệnh sau', async () => {
    const c = fakeClock();
    const q = new SendQueue({ now: c.now, sleep: c.sleep, random: () => 0 });
    const failed = q.enqueue(async () => {
      throw new Error('boom');
    });
    const ok = q.enqueue(async () => 'xong');
    await expect(failed).rejects.toThrow('boom');
    await expect(ok).resolves.toBe('xong');
    expect(q.size()).toBe(0);
  });

  it('size đếm lệnh chưa chạy xong', async () => {
    const c = fakeClock();
    const q = new SendQueue({ now: c.now, sleep: c.sleep, random: () => 0 });
    const a = q.enqueue(async () => 1);
    const b = q.enqueue(async () => 2);
    expect(q.size()).toBe(2);
    await Promise.all([a, b]);
    expect(q.size()).toBe(0);
  });
});
