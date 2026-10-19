import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServerHttp, getListOrEmptyAtBuild, ApiNotFoundError } from './core-http-server';
import { ApiUnavailableError } from './api';

function res(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('core-http-server — fetch ISR cho server component', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('get trả JSON, ghép BASE + path + query, mặc định revalidate 300', async () => {
    fetchMock.mockResolvedValue(res(200, { ok: 1 }));
    await expect(createServerHttp().get('/products', { query: { limit: 5, q: null } })).resolves.toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { next: { revalidate: number } }];
    expect(url).toBe('http://localhost:3001/api/products?limit=5');
    expect(init.next).toEqual({ revalidate: 300 });
  });

  it('revalidate truyền vào được dùng', async () => {
    fetchMock.mockResolvedValue(res(200, []));
    await createServerHttp({ revalidate: 600 }).get('/brands');
    expect((fetchMock.mock.calls[0]?.[1] as { next: { revalidate: number } }).next).toEqual({ revalidate: 600 });
  });

  it('có THROTTLE_BYPASS_TOKEN thì gửi x-throttle-bypass; không có thì không gửi header nào', async () => {
    fetchMock.mockResolvedValue(res(200, {}));
    vi.stubEnv('THROTTLE_BYPASS_TOKEN', 'tok');
    await createServerHttp().get('/a');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toEqual({ 'x-throttle-bypass': 'tok' });
    vi.stubEnv('THROTTLE_BYPASS_TOKEN', '');
    await createServerHttp().get('/a');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).toBeUndefined();
  });

  it('headers của người gọi được gộp, không đè header bypass', async () => {
    fetchMock.mockResolvedValue(res(200, {}));
    vi.stubEnv('THROTTLE_BYPASS_TOKEN', 'tok');
    await createServerHttp().get('/a', { headers: { 'X-A': '1' } });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toEqual({ 'X-A': '1', 'x-throttle-bypass': 'tok' });
  });

  it('404 ném ApiNotFoundError để trang gọi notFound()', async () => {
    fetchMock.mockResolvedValue(res(404));
    const err = await createServerHttp().get('/products/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiNotFoundError);
    expect((err as ApiNotFoundError).path).toBe('/products/x');
  });

  it('429/5xx ném ApiUnavailableError có status', async () => {
    fetchMock.mockResolvedValue(res(503));
    const err = await createServerHttp().get('/brands').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiUnavailableError);
    expect((err as ApiUnavailableError).status).toBe(503);
  });

  it('mất kết nối ném ApiUnavailableError status null, giữ cause', async () => {
    const cause = new TypeError('fetch failed');
    fetchMock.mockRejectedValue(cause);
    const err = await createServerHttp().get('/brands').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiUnavailableError);
    expect((err as ApiUnavailableError).status).toBeNull();
    expect((err as ApiUnavailableError).cause).toBe(cause);
  });

  it('method ghi ném lỗi rõ ràng và không gọi mạng', async () => {
    const http = createServerHttp();
    await expect(http.post('/x', {})).rejects.toThrow(/server component/i);
    await expect(http.put('/x', {})).rejects.toThrow(/server component/i);
    await expect(http.patch('/x', {})).rejects.toThrow(/server component/i);
    await expect(http.delete('/x')).rejects.toThrow(/server component/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getListOrEmptyAtBuild — danh sách cho trang ISR tĩnh', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const select = (json: unknown) => (json as { items: string[] }).items;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('API sống: trả đúng phần tử do select chọn', async () => {
    fetchMock.mockResolvedValue(res(200, { items: ['a', 'b'] }));
    await expect(getListOrEmptyAtBuild(createServerHttp(), '/brands', select)).resolves.toEqual(['a', 'b']);
  });

  it('lúc next build: mất kết nối trả [] để build không hỏng', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(getListOrEmptyAtBuild(createServerHttp(), '/brands', select)).resolves.toEqual([]);
  });

  it.each([404, 429, 503])('lúc next build: HTTP %i trả [] như fetchList', async (status) => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    fetchMock.mockResolvedValue(res(status));
    await expect(getListOrEmptyAtBuild(createServerHttp(), '/brands', select)).resolves.toEqual([]);
  });

  it('lúc runtime: mất kết nối vẫn ném để Next giữ bản đã render', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(getListOrEmptyAtBuild(createServerHttp(), '/brands', select)).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it('lúc runtime: 5xx ném ApiUnavailableError, 404 ném ApiNotFoundError', async () => {
    fetchMock.mockResolvedValueOnce(res(503));
    await expect(getListOrEmptyAtBuild(createServerHttp(), '/brands', select)).rejects.toBeInstanceOf(ApiUnavailableError);
    fetchMock.mockResolvedValueOnce(res(404));
    await expect(getListOrEmptyAtBuild(createServerHttp(), '/brands', select)).rejects.toBeInstanceOf(ApiNotFoundError);
  });

  it('lúc next build: lỗi không phải của API (select hỏng) vẫn ném, không nuốt', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    fetchMock.mockResolvedValue(res(200, {}));
    const strict = (json: unknown) => (json as { items: string[] }).items.map((x) => x);
    await expect(getListOrEmptyAtBuild(createServerHttp(), '/brands', strict)).rejects.toBeInstanceOf(TypeError);
  });
});
