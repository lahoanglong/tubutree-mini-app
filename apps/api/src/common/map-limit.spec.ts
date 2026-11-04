import { mapLimit } from './map-limit';

describe('mapLimit', () => {
  it('giữ thứ tự kết quả và không chạy quá giới hạn song song', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5 * ((n % 3) + 1)));
      running -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(peak).toBe(4);
  });

  it('một việc lỗi thì ném lỗi đó và không bắt đầu việc mới', async () => {
    const started: number[] = [];
    await expect(
      mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
        started.push(n);
        if (n === 2) throw new Error('boom');
        await new Promise((r) => setTimeout(r, 5));
        return n;
      }),
    ).rejects.toThrow('boom');
    expect(started.length).toBeLessThan(6);
  });

  it('danh sách rỗng và giới hạn không hợp lệ vẫn chạy được (tối thiểu 1)', async () => {
    expect(await mapLimit([], 4, async (n: number) => n)).toEqual([]);
    expect(await mapLimit([1, 2], 0, async (n) => n + 1)).toEqual([2, 3]);
  });
});
