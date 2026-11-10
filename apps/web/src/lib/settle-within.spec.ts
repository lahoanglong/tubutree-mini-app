import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCK_REFRESH_WAIT_MS, settleWithin } from './settle-within';

describe('settleWithin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('xong ngay khi việc xong, trước hạn, và dọn bộ đếm giờ', async () => {
    let finish!: () => void;
    const work = new Promise<void>((r) => {
      finish = r;
    });
    const settled = vi.fn();
    void settleWithin(work, 1_000).then(settled);
    await vi.advanceTimersByTimeAsync(500);
    expect(settled).not.toHaveBeenCalled();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('việc treo mãi thì nhả đúng ở hạn, không sớm hơn', async () => {
    const settled = vi.fn();
    void settleWithin(new Promise<void>(() => undefined), 1_000).then(settled);
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('việc bị từ chối cũng coi là xong, không ném và không để lại lời từ chối chưa xử lý', async () => {
    await expect(settleWithin(Promise.reject(new Error('mạng')), 1_000)).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('giá trị không phải Promise (hàm gọi trả undefined) coi là xong ngay, không ném', async () => {
    await expect(settleWithin(undefined, 1_000)).resolves.toBeUndefined();
  });

  it('không truyền hạn thì dùng LOCK_REFRESH_WAIT_MS', async () => {
    const settled = vi.fn();
    void settleWithin(new Promise<void>(() => undefined)).then(settled);
    await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledTimes(1);
  });
});
