import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStaleWriteRejection, reloadWhenStale } from './stale-write-rejection';

afterEach(() => vi.useRealTimers());

describe('isStaleWriteRejection', () => {
  it.each([400, 404, 409])('mã %i là từ chối vì dữ liệu cũ (ApiError của web mang status, AxiosError mang response.status)', (status) => {
    expect(isStaleWriteRejection({ status })).toBe(true);
    expect(isStaleWriteRejection({ response: { status } })).toBe(true);
  });

  it.each([401, 403, 408, 422, 429, 500, 502, 503])('mã %i không phải: không nói gì về trạng thái thật', (status) => {
    expect(isStaleWriteRejection({ status })).toBe(false);
  });

  it('mất mạng hoặc giá trị lạ không phải', () => {
    expect(isStaleWriteRejection(new TypeError('Failed to fetch'))).toBe(false);
    expect(isStaleWriteRejection(null)).toBe(false);
    expect(isStaleWriteRejection('400')).toBe(false);
  });
});

describe('reloadWhenStale', () => {
  it('từ chối vì dữ liệu cũ: tải lại và chỉ xong khi lần tải lại xong', async () => {
    let done!: () => void;
    const reload = vi.fn(() => new Promise<void>((r) => (done = r)));
    let finished = false;
    const p = reloadWhenStale({ status: 409 }, reload);
    expect(p).toBeInstanceOf(Promise);
    void p!.then(() => (finished = true));
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    done();
    await p;
    expect(finished).toBe(true);
  });

  it('lần tải lại treo: nhả sau hạn 4 giây, không sớm hơn', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let finished = false;
    void reloadWhenStale({ status: 404 }, () => new Promise(() => {}))!.then(() => (finished = true));
    await vi.advanceTimersByTimeAsync(3_900);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(finished).toBe(true);
  });

  it('lần tải lại hỏng: không ném, vẫn xong', async () => {
    await expect(reloadWhenStale({ status: 400 }, () => Promise.reject(new Error('boom')))).resolves.toBeUndefined();
  });

  it('lỗi khác (500, 403, mất mạng): không tải lại, trả undefined để khoá nhả ngay', () => {
    const reload = vi.fn();
    expect(reloadWhenStale({ status: 500 }, reload)).toBeUndefined();
    expect(reloadWhenStale({ status: 403 }, reload)).toBeUndefined();
    expect(reloadWhenStale(new TypeError('Failed to fetch'), reload)).toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
  });
});
