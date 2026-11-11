import { describe, it, expect, vi as vitestVi, beforeEach, afterEach } from 'vitest';
import { api, getErrorMessage, HttpError, RATE_LIMITED_MESSAGE, setDeviceIdProvider } from './api';
import { stubFetch, type Reply } from '../test/fetch-stub';

/** fetch giả trả lần lượt các phản hồi trong `replies` (lần cuối lặp lại), ghi thời điểm từng lần gọi. */
function scripted(replies: Reply[]) {
  const { calls } = stubFetch((_c, n) => replies[Math.min(n - 1, replies.length - 1)]!);
  return { calls };
}

/**
 * Nhường vòng lặp thật (setImmediate) cho tới khi fetch được gọi khi đồng hồ setTimeout đang làm giả.
 */
async function until(cond: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!cond() && performance.now() < deadline) await new Promise((r) => setImmediate(r));
  if (!cond()) throw new Error('điều kiện không xảy ra');
}

const tooMany = (headers: Record<string, string> = {}): Reply => ({
  status: 429,
  headers,
  body: { statusCode: 429, message: 'ThrottlerException: Too Many Requests' },
});

describe('xử lý 429 ở client miniapp', () => {
  beforeEach(() => {
    setDeviceIdProvider(async () => 'dev-1');
    vitestVi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });
  afterEach(() => {
    setDeviceIdProvider(null);
    vitestVi.useRealTimers();
    vitestVi.unstubAllGlobals();
  });

  it('GET bị 429 → chờ theo Retry-After rồi thử lại đúng 1 lần, thành công', async () => {
    const { calls } = scripted([tooMany({ 'retry-after': '2' }), { status: 200, body: { ok: true } }]);
    const p = api.get('/products');
    await until(() => calls.length === 1);
    await vitestVi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(1);
    await vitestVi.advanceTimersByTimeAsync(1);
    await until(() => calls.length === 2);
    const res = await p;
    expect(res.data).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(2000);
  });

  it('GET bị 429 không có Retry-After → vẫn chờ một khoảng backoff trước khi thử lại', async () => {
    const { calls } = scripted([tooMany(), { status: 200 }]);
    const p = api.get('/products');
    await until(() => calls.length === 1);
    await vitestVi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(1);
    await vitestVi.advanceTimersByTimeAsync(5000);
    await until(() => calls.length === 2);
    await p;
    expect(calls).toHaveLength(2);
  });

  it('GET bị 429 hai lần → chỉ thử lại 1 lần rồi trả lỗi với thông báo thân thiện', async () => {
    const { calls } = scripted([tooMany({ 'retry-after': '1' })]);
    const p = api.get('/products');
    const settled = p.catch((e: unknown) => e);
    await until(() => calls.length === 1);
    await vitestVi.advanceTimersByTimeAsync(10_000);
    await until(() => calls.length === 2);
    const err = await settled;
    expect(calls).toHaveLength(2);
    expect(getErrorMessage(err)).toBe(RATE_LIMITED_MESSAGE);
  });

  it('Retry-After quá dài → không giữ màn hình chờ, trả lỗi ngay', async () => {
    const { calls } = scripted([tooMany({ 'retry-after': '45' }), { status: 200 }]);
    const settled = api.get('/products').catch((e: unknown) => e);
    await until(() => calls.length === 1);
    const err = await settled;
    expect(calls).toHaveLength(1);
    expect(getErrorMessage(err)).toBe(RATE_LIMITED_MESSAGE);
  });

  it('Retry-After 60 như server thật gửi (blockDuration mặc định = ttl 60s) → không thử lại, báo thân thiện ngay', async () => {
    const { calls } = scripted([tooMany({ 'retry-after': '60' }), { status: 200 }]);
    const settled = api.get('/products').catch((e: unknown) => e);
    await until(() => calls.length === 1);
    const err = await settled;
    expect(calls).toHaveLength(1);
    expect(getErrorMessage(err)).toBe(RATE_LIMITED_MESSAGE);
  });

  it('POST bị 429 → KHÔNG thử lại (tránh tạo đơn/ghi trùng)', async () => {
    const { calls } = scripted([tooMany({ 'retry-after': '1' }), { status: 200 }]);
    const settled = api.post('/orders', {}).catch((e: unknown) => e);
    await until(() => calls.length === 1);
    await vitestVi.advanceTimersByTimeAsync(10_000);
    const err = await settled;
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe('POST');
    expect(getErrorMessage(err)).toBe(RATE_LIMITED_MESSAGE);
  });
});

describe('getErrorMessage với 429', () => {
  it('không lộ message tiếng Anh của throttler, dùng câu tiếng Việt thân thiện', () => {
    const err = new HttpError('x', 'ERR_BAD_REQUEST', {
      status: 429,
      data: { message: 'ThrottlerException: Too Many Requests' },
    });
    expect(getErrorMessage(err)).toBe(RATE_LIMITED_MESSAGE);
    expect(RATE_LIMITED_MESSAGE).not.toMatch(/Too Many|Throttler/);
  });
});
