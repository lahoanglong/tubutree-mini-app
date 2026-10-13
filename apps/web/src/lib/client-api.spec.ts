// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  apiFetch,
  ApiError,
  NetworkError,
  REQUEST_TIMEOUT_MS,
  hasSessionMarker,
  setSessionMarker,
  clearSessionMarker,
  setAccessToken,
} from './client-api';

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

describe('client-api — mạng yếu / mất mạng (BUYERWEB-12)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('mất mạng: ném NetworkError với câu tiếng Việt, không lộ "Failed to fetch"', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await apiFetch('/cart').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as Error).message).toBe('Mất kết nối. Vui lòng kiểm tra mạng rồi thử lại.');
    expect((err as NetworkError).timedOut).toBe(false);
  });

  it('máy chủ treo: ngắt sau REQUEST_TIMEOUT_MS và báo hết thời gian chờ', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const pending = apiFetch('/checkout/place-order', { method: 'POST', body: {} }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    const err = await pending;
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).timedOut).toBe(true);
    expect((err as Error).message).toBe('Máy chủ phản hồi quá lâu. Vui lòng thử lại.');
  });

  it('thân phản hồi treo sau khi đã có header cũng bị ngắt (không kẹt ở "Đang đặt hàng…")', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            }),
        } as unknown as Response),
    );
    const pending = apiFetch('/cart').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    expect(await pending).toBeInstanceOf(NetworkError);
  });

  it('lỗi HTTP vẫn là ApiError mang status, kể cả khi thân không phải JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    } as unknown as Response);
    const err = await apiFetch('/cart').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
    expect((err as Error).message).toBe('Có lỗi xảy ra. Vui lòng thử lại.');
  });

  it('refresh gặp lỗi mạng KHÔNG xoá cờ phiên (cookie vẫn sống)', async () => {
    setSessionMarker();
    fetchMock
      .mockResolvedValueOnce(jsonRes(401, { message: 'hết hạn' }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(apiFetch('/me')).rejects.toThrow();
    expect(hasSessionMarker()).toBe(true);
  });

  it('timer timeout được gỡ khi gọi xong (không để timer treo)', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonRes(200, { ok: 1 }));
    await apiFetch('/cart');
    expect(vi.getTimerCount()).toBe(0);
  });
});
