import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCK_REFRESH_WAIT_MS, closeAfterFresh, settleWithin } from './settle-within';

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

  it('việc bị từ chối cũng coi là xong, không ném', async () => {
    await expect(settleWithin(Promise.reject(new Error('mạng')), 1_000)).resolves.toBeUndefined();
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

describe('closeAfterFresh (W115A)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('không có lần tải lại để chờ: đóng ngay và không trả Promise (khoá nhả ngay)', () => {
    const close = vi.fn();
    expect(closeAfterFresh(undefined, close)).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('có lần tải lại: chưa đóng khi dữ liệu còn đang về, đóng đúng một lần ngay sau khi về, rồi Promise mới xong', async () => {
    let finish!: () => void;
    const fresh = new Promise<void>((r) => {
      finish = r;
    });
    const close = vi.fn();
    const done = vi.fn();
    void closeAfterFresh(settleWithin(fresh, 1_000), close)!.then(done);
    await vi.advanceTimersByTimeAsync(500);
    expect(close).not.toHaveBeenCalled();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('tải lại treo mãi: đóng đúng ở hạn chờ, không sớm hơn', async () => {
    const close = vi.fn();
    void closeAfterFresh(settleWithin(new Promise<void>(() => undefined), 1_000), close);
    await vi.advanceTimersByTimeAsync(999);
    expect(close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('tải lại bị từ chối cũng vẫn đóng (settleWithin không ném)', async () => {
    const close = vi.fn();
    const result = closeAfterFresh(settleWithin(Promise.reject(new Error('mạng')), 1_000), close);
    await vi.advanceTimersByTimeAsync(0);
    await result;
    expect(close).toHaveBeenCalledTimes(1);
  });
});
