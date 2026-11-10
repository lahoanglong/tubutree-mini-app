import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withDeadline } from './with-deadline';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('withDeadline', () => {
  it('hết hạn thì huỷ yêu cầu đang chờ', async () => {
    let signal!: AbortSignal;
    const pending = withDeadline(1000, (s) => {
      signal = s;
      return new Promise<string>((_res, rej) => s.addEventListener('abort', () => rej(new Error('aborted'))));
    });
    const settled = expect(pending).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    await settled;
  });

  it('xong trước hạn: trả kết quả, không huỷ, không để lại bộ hẹn giờ', async () => {
    let signal!: AbortSignal;
    await expect(withDeadline(1000, async (s) => { signal = s; return 'ok'; })).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(signal.aborted).toBe(false);
  });

  it('lỗi trước hạn: ném lại đúng lỗi đó và vẫn dọn bộ hẹn giờ', async () => {
    const boom = new Error('boom');
    await expect(withDeadline(1000, async () => { throw boom; })).rejects.toBe(boom);
    expect(vi.getTimerCount()).toBe(0);
  });
});
