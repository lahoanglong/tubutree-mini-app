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
  refreshSession,
  restoreSession,
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

  it('cờ phiên cũng được ghi thành cookie thường của web để server dựng sẵn Trang chủ, và xoá cùng lúc (cả cookie gợi ý bố cục)', () => {
    document.cookie = 'tubu_home_hint=returning-1; Path=/';
    setSessionMarker();
    expect(document.cookie).toContain('tubu_web_session=1');
    clearSessionMarker();
    expect(document.cookie).not.toContain('tubu_web_session');
    expect(document.cookie).not.toContain('tubu_home_hint');
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

  it('lỗi 4xx giữ cả message lẫn mã nghiệp vụ (code) để trang phân nhánh mà không so chuỗi', async () => {
    fetchMock.mockResolvedValue(jsonRes(400, { message: 'Tổng tiền đơn vừa thay đổi…', code: 'TOTAL_CHANGED' }));
    await expect(apiFetch('/checkout/place-order')).rejects.toMatchObject({
      status: 400,
      message: 'Tổng tiền đơn vừa thay đổi…',
      code: 'TOTAL_CHANGED',
    });
    fetchMock.mockResolvedValue(jsonRes(400, { message: ['phone must match'] }));
    await expect(apiFetch('/me/addresses')).rejects.toMatchObject({ message: 'phone must match', code: null });
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

  // BUYERWEB-2: trước đây MỌI lỗi refresh (mất mạng, 502/503 khi API khởi động lại, 429) đều xoá cờ
  // phiên — cookie refresh vẫn sống nhưng web không bao giờ thử lại, khách phải đăng nhập Zalo lần nữa.
  it.each([
    ['mất mạng', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['API đang khởi động lại (503)', () => Promise.resolve(jsonRes(503, { message: 'unavailable' }))],
    ['bị giới hạn tốc độ (429)', () => Promise.resolve(jsonRes(429, { message: 'too many' }))],
  ])('refresh lỗi tạm thời (%s) → GIỮ cờ phiên', async (_label, refreshRes) => {
    setSessionMarker();
    fetchMock.mockResolvedValueOnce(jsonRes(401, { message: 'hết hạn' })).mockImplementationOnce(refreshRes);
    await expect(apiFetch('/me')).rejects.toThrow();
    expect(hasSessionMarker()).toBe(true);
  });

  it.each([400, 401, 403])('refresh trả %i (phiên chết thật) → xoá cờ phiên', async (status) => {
    setSessionMarker();
    fetchMock.mockResolvedValueOnce(jsonRes(status, { message: 'chết' }));
    await expect(refreshSession()).resolves.toEqual({ kind: 'dead' });
    expect(hasSessionMarker()).toBe(false);
  });

  // BUYERWEB-3: hai tab cùng refresh một cookie từng bị BE coi là token bị đánh cắp. Khoá Web Locks
  // xếp hàng các tab: tab sau gửi cookie tab trước vừa xoay, không còn hai request cùng một token.
  it('refresh chạy trong khoá Web Locks dùng chung giữa các tab', async () => {
    setSessionMarker();
    const request = vi.fn((_name: string, cb: () => Promise<unknown>) => cb());
    vi.stubGlobal('navigator', { locks: { request } });
    fetchMock.mockResolvedValueOnce(jsonRes(200, { accessToken: 'at', user: { id: 'u1' } }));
    await expect(refreshSession()).resolves.toMatchObject({ kind: 'ok' });
    expect(request).toHaveBeenCalledWith('tubu_web_refresh', expect.any(Function));
  });

  it('nhiều lời gọi refresh trong cùng một tab → chỉ một request', async () => {
    setSessionMarker();
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    const all = Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    resolve(jsonRes(200, { accessToken: 'at', user: { id: 'u1' } }));
    const out = await all;
    expect(out.every((o) => o.kind === 'ok')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('khôi phục phiên lúc mở trang: lỗi tạm thời thì thử lại có giãn cách rồi vào được', async () => {
    setSessionMarker();
    const sleep = vi.fn(async () => undefined);
    fetchMock
      .mockResolvedValueOnce(jsonRes(503))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonRes(200, { accessToken: 'at', user: { id: 'u1' } }));
    await expect(restoreSession([1000, 3000], sleep)).resolves.toMatchObject({ kind: 'ok', data: { user: { id: 'u1' } } });
    expect(sleep.mock.calls).toEqual([[1000], [3000]]);
    expect(hasSessionMarker()).toBe(true);
  });

  it('khôi phục phiên: hết lượt thử vẫn lỗi tạm thời → trả transient, GIỮ cờ để lần sau thử tiếp', async () => {
    setSessionMarker();
    fetchMock.mockResolvedValue(jsonRes(502));
    await expect(restoreSession([1, 1], async () => undefined)).resolves.toEqual({ kind: 'transient' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(hasSessionMarker()).toBe(true);
  });

  it('khôi phục phiên: 401 → dừng ngay, không thử lại', async () => {
    setSessionMarker();
    fetchMock.mockResolvedValue(jsonRes(401));
    await expect(restoreSession([1, 1], async () => undefined)).resolves.toEqual({ kind: 'dead' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

describe('client-api — thân rỗng', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  // Content-Length không đọc được qua CORS: chỉ dựa vào nội dung thật của thân (bản sao đọc bằng text()).
  const emptyBody = (status: number, text: string): Response => {
    const res = {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
      text: async () => text,
      clone: () => res,
    };
    return res as unknown as Response;
  };

  it('200 thân rỗng (thân rỗng) là null; 204 cũng là null', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(emptyBody(200, '')).mockResolvedValueOnce(emptyBody(204, ''));
    await expect(apiFetch('/game/season')).resolves.toBeNull();
    await expect(apiFetch('/x', { method: 'DELETE' })).resolves.toBeNull();
  });

  it('200 thân hỏng (có nội dung nhưng không phải JSON) vẫn ném lỗi', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(emptyBody(200, '<html>oops'));
    await expect(apiFetch('/x')).rejects.toBeInstanceOf(SyntaxError);
  });
});
