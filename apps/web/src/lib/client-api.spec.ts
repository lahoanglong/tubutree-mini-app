// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { apiFetch, hasSessionMarker, setSessionMarker, clearSessionMarker, setAccessToken } from './client-api';

function jsonRes(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function lastCall(f: ReturnType<typeof vi.fn>, i = 0) {
  const [url, init] = f.mock.calls[i] as [string, RequestInit];
  return { url, init, headers: (init.headers ?? {}) as Record<string, string> };
}

describe('client-api — refresh token nằm ở cookie HttpOnly', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('KHÔNG còn giữ refresh token ở client — localStorage chỉ có cờ "1"', () => {
    setSessionMarker();
    expect(localStorage.getItem('tubu_web_session')).toBe('1');
    // Toàn bộ storage không được chứa gì khác ngoài cờ này.
    expect(Object.keys(localStorage)).toEqual(['tubu_web_session']);
  });

  it('cờ phiên bật/tắt được, và storage bị chặn thì coi như không có cờ', () => {
    expect(hasSessionMarker()).toBe(false);
    setSessionMarker();
    expect(hasSessionMarker()).toBe(true);
    clearSessionMarker();
    expect(hasSessionMarker()).toBe(false);

    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage bị chặn (chế độ riêng tư)');
    });
    expect(() => hasSessionMarker()).not.toThrow();
    expect(hasSessionMarker()).toBe(false);
    spy.mockRestore();
  });

  it('mọi request gửi kèm cookie (credentials: include)', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { ok: true }));
    await apiFetch('/catalog/products');
    expect(lastCall(fetchMock).init.credentials).toBe('include');
  });

  it('header x-client chỉ gắn cho /auth/* — request thường không bị ép preflight', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, {}));
    await apiFetch('/catalog/products');
    expect(lastCall(fetchMock).headers['x-client']).toBeUndefined();

    fetchMock.mockClear();
    await apiFetch('/auth/logout', { method: 'POST', body: {}, auth: false });
    expect(lastCall(fetchMock).headers['x-client']).toBe('web');
  });

  it('401 mà chưa từng đăng nhập (không có cờ) → không gọi refresh, ném lỗi luôn', async () => {
    fetchMock.mockResolvedValue(jsonRes(401, { message: 'Unauthorized' }));
    await expect(apiFetch('/me')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('401 khi có cờ phiên → refresh bằng cookie rồi thử lại đúng 1 lần', async () => {
    setSessionMarker();
    fetchMock
      .mockResolvedValueOnce(jsonRes(401, { message: 'hết hạn' }))
      .mockResolvedValueOnce(jsonRes(200, { accessToken: 'new-at' }))
      .mockResolvedValueOnce(jsonRes(200, { id: 'u1' }));

    await expect(apiFetch('/me')).resolves.toEqual({ id: 'u1' });

    const refresh = lastCall(fetchMock, 1);
    expect(refresh.url).toContain('/auth/refresh');
    // Thân request KHÔNG chứa token — trình duyệt tự đính cookie.
    expect(refresh.init.body).toBe('{}');
    expect(refresh.headers['x-client']).toBe('web');
    expect(refresh.init.credentials).toBe('include');
    // Lượt thử lại dùng access token mới.
    expect(lastCall(fetchMock, 2).headers['Authorization']).toBe('Bearer new-at');
  });

  it('refresh thất bại → xoá cờ phiên để không thử lại vô hạn', async () => {
    setSessionMarker();
    fetchMock
      .mockResolvedValueOnce(jsonRes(401, { message: 'hết hạn' }))
      .mockResolvedValueOnce(jsonRes(401, { message: 'token chết' }));
    await expect(apiFetch('/me')).rejects.toThrow();
    expect(hasSessionMarker()).toBe(false);
  });
});
