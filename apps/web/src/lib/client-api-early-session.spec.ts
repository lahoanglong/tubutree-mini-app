// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { earlySessionScript } from './early-session';

/**
 * client-api nhận kết quả của script khôi phục phiên sớm thật (lib/early-session.ts, tubu-w8-01): lượt khôi phục phiên dùng đúng lượt refresh của script
 * (không refresh lần hai, cookie không bị xoay hai lần) và GET đầu trang lấy phản hồi đã về. Script có fetch riêng (lượt gọi lúc đọc HTML), client-api
 * dùng fetch toàn cục: đếm được lượt nào đi mạng sau khi JS chạy. Mỗi ca nạp lại module vì trạng thái là của module.
 */
type ClientApi = typeof import('./client-api');
type Res = { status: number; ok: boolean; text: () => Promise<string> };

const res = (status: number, body: unknown = ''): Res => ({ status, ok: status >= 200 && status < 300, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
function jsonRes(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}
const settle = () => new Promise((r) => setTimeout(r, 0));

let fetchMock: ReturnType<typeof vi.fn>;
let scriptFetch: ReturnType<typeof vi.fn>;

/** Chạy script như lúc đọc HTML (refresh + GET mồi qua `scriptFetch`), rồi nạp client-api như JS của trang. */
async function boot(opts: { refresh?: () => Promise<Res>; get?: (path: string) => Promise<Res> } = {}): Promise<ClientApi> {
  scriptFetch = vi.fn((url: string) => {
    const path = url.replace('http://localhost:3001/api', '');
    if (path === '/auth/refresh') return (opts.refresh ?? (async () => res(200, { accessToken: 'tok-early', user: { id: 'u1' } })))();
    return (opts.get ?? (async (p: string) => res(200, { primed: p })))(path);
  });
  new Function('fetch', 'localStorage', 'navigator', 'window', earlySessionScript('http://localhost:3001/api', ['/cart', '/me/coupons', '/game/mini/today']))(
    scriptFetch,
    localStorage,
    {},
    window,
  );
  await settle();
  vi.resetModules();
  return import('./client-api');
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('tubu_web_session', '1');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (window as unknown as Record<string, unknown>).__tubuEarlySession;
});

describe('client-api — lượt refresh sớm', () => {
  it('lượt khôi phục phiên đầu dùng lượt refresh của script: không gọi mạng lần nữa, access token gắn cho request sau', async () => {
    const api = await boot();
    await expect(api.refreshSession()).resolves.toEqual({ kind: 'ok', data: { accessToken: 'tok-early', user: { id: 'u1' } } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(scriptFetch.mock.calls.filter((c) => String(c[0]).endsWith('/auth/refresh'))).toHaveLength(1);
    fetchMock.mockResolvedValue(jsonRes(200, { ok: true }));
    await api.apiFetch('/orders');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok-early' });
  });

  it('chỉ nhận một lần: lượt refresh sau đi mạng như thường', async () => {
    const api = await boot();
    await api.refreshSession();
    fetchMock.mockResolvedValue(jsonRes(200, { accessToken: 'tok-2' }));
    await expect(api.refreshSession()).resolves.toMatchObject({ kind: 'ok', data: { accessToken: 'tok-2' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/auth\/refresh$/);
  });

  it('các lời gọi trùng trong lúc lượt sớm chưa về dùng chung một lượt', async () => {
    let resolve!: (r: Res) => void;
    const api = await boot({ refresh: () => new Promise<Res>((r) => (resolve = r)) });
    const a = api.refreshSession();
    const b = api.refreshSession();
    resolve(res(200, { accessToken: 'tok-early' }));
    expect(await a).toEqual(await b);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lượt sớm 401: phiên chết như lượt thường (xoá cờ, không thử lại)', async () => {
    const api = await boot({ refresh: async () => res(401, { message: 'x' }) });
    await expect(api.restoreSession([0], async () => undefined)).resolves.toEqual({ kind: 'dead' });
    expect(api.hasSessionMarker()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lượt sớm 429: lỗi tạm có rateLimited như lượt thường', async () => {
    const api = await boot({ refresh: async () => res(429) });
    await expect(api.refreshSession()).resolves.toEqual({ kind: 'transient', rateLimited: true });
    expect(api.hasSessionMarker()).toBe(true);
  });

  it('lượt sớm mất mạng: lỗi tạm, restoreSession thử lại bằng mạng', async () => {
    const api = await boot({ refresh: () => Promise.reject(new TypeError('Failed to fetch')) });
    fetchMock.mockResolvedValue(jsonRes(200, { accessToken: 'tok-net' }));
    await expect(api.restoreSession([0], async () => undefined)).resolves.toMatchObject({ kind: 'ok', data: { accessToken: 'tok-net' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(api.hasSessionMarker()).toBe(true);
  });

  it('lượt sớm quá 60 giây thì bỏ, refresh bằng mạng', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const api = await boot();
    vi.setSystemTime(Date.now() + 60_001);
    fetchMock.mockResolvedValue(jsonRes(200, { accessToken: 'tok-net' }));
    await expect(api.refreshSession()).resolves.toMatchObject({ data: { accessToken: 'tok-net' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('không có script (trang khác, khách chưa có cờ phiên lúc đọc HTML) thì như cũ', async () => {
    vi.resetModules();
    const api = await import('./client-api');
    fetchMock.mockResolvedValue(jsonRes(200, { accessToken: 'tok-net' }));
    await expect(api.refreshSession()).resolves.toMatchObject({ kind: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('client-api — GET mồi', () => {
  it('GET đầu trang lấy phản hồi script đã gọi, đúng một lần; lần sau gọi mạng', async () => {
    const api = await boot();
    await api.refreshSession();
    await expect(api.apiFetch('/cart')).resolves.toEqual({ primed: '/cart' });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(jsonRes(200, { net: true }));
    await expect(api.apiFetch('/cart')).resolves.toEqual({ net: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('qua coreHttp (game, Điểm Xanh) cũng lấy phản hồi mồi: method GET truyền tường minh vẫn tính là GET thường', async () => {
    const api = await boot();
    await api.refreshSession();
    await expect(api.apiFetch('/me/coupons', { method: 'GET' })).resolves.toEqual({ primed: '/me/coupons' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ảnh do API phục vụ trong phản hồi mồi được ghép gốc API như phản hồi thường', async () => {
    const api = await boot({ get: async () => res(200, { img: '/returns/r1/images/0?v=1' }) });
    await api.refreshSession();
    const primed = await api.apiFetch('/me/coupons');
    fetchMock.mockResolvedValue(jsonRes(200, { img: '/returns/r1/images/0?v=1' }));
    expect(primed).toEqual(await api.apiFetch('/me/coupons'));
  });

  it('phản hồi lỗi của script được xử lý như phản hồi mạng: 404 thành ApiError, không gọi lại', async () => {
    const api = await boot({ get: async () => res(404, { message: 'Not Found', code: 'GAME_DISABLED' }) });
    await api.refreshSession();
    await expect(api.apiFetch('/game/mini/today')).rejects.toMatchObject({ status: 404, code: 'GAME_DISABLED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('phản hồi mồi 401: làm mới phiên rồi gọi lại bằng mạng như thường', async () => {
    const api = await boot({ get: async () => res(401, {}) });
    await api.refreshSession();
    fetchMock.mockResolvedValueOnce(jsonRes(200, { accessToken: 'tok-2' })).mockResolvedValueOnce(jsonRes(200, { items: [] }));
    await expect(api.apiFetch('/cart')).resolves.toEqual({ items: [] });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([expect.stringMatching(/\/auth\/refresh$/), expect.stringMatching(/\/cart$/)]);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok-2' });
  });

  it('lượt gọi của script hỏng (thân 2xx không phải JSON, mất mạng): gọi mạng', async () => {
    const api = await boot({ get: async (p) => (p === '/cart' ? res(200, '{oops') : Promise.reject(new TypeError('x'))) });
    await api.refreshSession();
    fetchMock.mockResolvedValue(jsonRes(200, { net: true }));
    await expect(api.apiFetch('/cart')).resolves.toEqual({ net: true });
    await expect(api.apiFetch('/me/coupons')).resolves.toEqual({ net: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('chưa khôi phục phiên thì gọi mạng (phản hồi mồi để dành); phiên khác (đăng xuất rồi đăng nhập tài khoản khác) thì không dùng', async () => {
    const api = await boot();
    fetchMock.mockResolvedValue(jsonRes(200, { net: true }));
    await expect(api.apiFetch('/cart')).resolves.toEqual({ net: true });
    await api.refreshSession();
    await expect(api.apiFetch('/cart')).resolves.toEqual({ primed: '/cart' });
    api.setAccessToken('tok-other-user');
    await expect(api.apiFetch('/me/coupons')).resolves.toEqual({ net: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('chỉ GET thường: POST, auth: false, header hay cache riêng đều gọi mạng', async () => {
    const api = await boot();
    await api.refreshSession();
    fetchMock.mockResolvedValue(jsonRes(200, { net: true }));
    await api.apiFetch('/cart', { method: 'POST', body: {} });
    await api.apiFetch('/cart', { auth: false });
    await api.apiFetch('/cart', { headers: { 'Idempotency-Key': 'k' } });
    await api.apiFetch('/cart', { cache: 'no-store' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await expect(api.apiFetch('/cart')).resolves.toEqual({ primed: '/cart' });
  });

  it('quá 30 giây sau khi script chạy thì không dùng phản hồi mồi', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const api = await boot();
    await api.refreshSession();
    vi.setSystemTime(Date.now() + 30_001);
    fetchMock.mockResolvedValue(jsonRes(200, { net: true }));
    await expect(api.apiFetch('/cart')).resolves.toEqual({ net: true });
  });
});
