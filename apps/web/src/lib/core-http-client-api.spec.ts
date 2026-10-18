// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiError, setAccessToken, setSessionMarker } from './client-api';
import { coreHttp } from './core-http';

function jsonRes(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function call(f: ReturnType<typeof vi.fn>, i: number) {
  const [url, init] = f.mock.calls[i] as [string, RequestInit];
  return { url, init, headers: (init.headers ?? {}) as Record<string, string> };
}

// Spec này đi qua apiFetch thật (chỉ giả fetch) để chắc adapter không làm rơi token, refresh 401 hay Content-Type.
describe('core-http (web client) — qua apiFetch thật', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('post không body: gửi Bearer và Idempotency-Key, không có Content-Type, không có body', async () => {
    setAccessToken('t');
    fetchMock.mockResolvedValue(jsonRes(200, { ok: 1 }));
    await expect(coreHttp.post('/x', undefined, { headers: { 'Idempotency-Key': 'k' } })).resolves.toEqual({ ok: 1 });
    const { url, init, headers } = call(fetchMock, 0);
    expect(url).toMatch(/\/x$/);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(headers['Authorization']).toBe('Bearer t');
    expect(headers['Idempotency-Key']).toBe('k');
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('post có body: gửi JSON kèm Content-Type và Idempotency-Key', async () => {
    setAccessToken('t');
    fetchMock.mockResolvedValue(jsonRes(200, {}));
    await coreHttp.post('/x', { a: 1 }, { headers: { 'Idempotency-Key': 'k' } });
    const { init, headers } = call(fetchMock, 0);
    expect(init.body).toBe('{"a":1}');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe('Bearer t');
    expect(headers['Idempotency-Key']).toBe('k');
  });

  it('get có query: dựng chuỗi vào URL gửi đi', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, []));
    await coreHttp.get('/waste/points', { query: { provinceCode: '79', x: null } });
    expect(call(fetchMock, 0).url).toMatch(/\/waste\/points\?provinceCode=79$/);
  });

  it('401 khi có cờ phiên: refresh một lần rồi thử lại với cùng Idempotency-Key và token mới', async () => {
    setAccessToken('cu');
    setSessionMarker();
    fetchMock
      .mockResolvedValueOnce(jsonRes(401, { message: 'hết hạn' }))
      .mockResolvedValueOnce(jsonRes(200, { accessToken: 'moi' }))
      .mockResolvedValueOnce(jsonRes(200, { done: true }));
    await expect(coreHttp.post('/x', { a: 1 }, { headers: { 'Idempotency-Key': 'k' } })).resolves.toEqual({ done: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(call(fetchMock, 1).url).toMatch(/\/auth\/refresh$/);
    const retry = call(fetchMock, 2);
    expect(retry.headers['Idempotency-Key']).toBe('k');
    expect(retry.headers['Authorization']).toBe('Bearer moi');
    expect(retry.init.body).toBe('{"a":1}');
  });

  it('lỗi 4xx ném ApiError có status và code', async () => {
    fetchMock.mockResolvedValue(jsonRes(409, { message: 'đổi tổng', code: 'TOTAL_CHANGED' }));
    const err = await coreHttp.post('/x', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).code).toBe('TOTAL_CHANGED');
  });
});
