import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  api,
  getErrorCode,
  getErrorMessage,
  HttpError,
  isHttpError,
  isNotFoundError,
  isOutcomeUnknown,
  setAccessToken,
  setAuthReady,
  setUnauthorizedHandler,
} from './api';
import { vi as copy } from '../i18n/vi';
import { stubFetch, stubHangingFetch } from '../test/fetch-stub';

vi.mock('../store/auth', () => ({ getDeviceId: async () => 'dev-1' }));

const BASE = 'http://localhost:3001/api';

/** Việc nạp động '../store/auth' không đi qua setTimeout nên đồng hồ giả không đẩy được: nhường vòng lặp thật. */
async function until(cond: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!cond() && performance.now() < deadline) await new Promise((r) => setImmediate(r));
  if (!cond()) throw new Error('điều kiện không xảy ra');
}

beforeEach(() => {
  setAccessToken(null);
  setAuthReady(null);
  setUnauthorizedHandler(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('api trên fetch: yêu cầu', () => {
  it('GET ghép baseURL + params (bỏ undefined/null), gắn header chuẩn và token, trả { data, status }', async () => {
    setAccessToken('tok-1');
    const { calls } = stubFetch(() => ({ status: 200, body: { ok: true } }));
    const res = await api.get('/products', { params: { q: 'a b', page: 2, skip: undefined, none: null, flag: true } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE}/products?q=a+b&page=2&flag=true`);
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer tok-1');
    expect(calls[0]!.headers.get('X-Device-Id')).toBe('dev-1');
    expect(calls[0]!.headers.get('X-Client-Platform')).toBe('miniapp');
    expect(calls[0]!.headers.get('Accept')).toBe('application/json, text/plain, */*');
    expect(res.data).toEqual({ ok: true });
    expect(res.status).toBe(200);
  });

  it('không có token → không gắn Authorization', async () => {
    const { calls } = stubFetch(() => ({ status: 200, body: {} }));
    await api.get('/products');
    expect(calls[0]!.headers.has('Authorization')).toBe(false);
  });

  it('URL đã có query: params nối thêm bằng "&"', async () => {
    const { calls } = stubFetch(() => ({ status: 200, body: {} }));
    await api.get('/products?sort=new', { params: { page: 1 } });
    expect(calls[0]!.url).toBe(`${BASE}/products?sort=new&page=1`);
  });

  it('params dạng mảng → khoá[] lặp lại (cách axios 1.x đang gửi, API đã quen)', async () => {
    const { calls } = stubFetch(() => ({ status: 200, body: {} }));
    await api.get('/x', { params: { ids: ['a', 'b'] } });
    expect(calls[0]!.url).toBe(`${BASE}/x?ids[]=a&ids[]=b`);
  });

  it('POST gửi body JSON kèm Content-Type và giữ header do người gọi truyền (Idempotency-Key)', async () => {
    const { calls } = stubFetch(() => ({ status: 201, body: { id: 'o1' } }));
    const res = await api.post('/orders', { a: 1 }, { headers: { 'Idempotency-Key': 'k-1' } });
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.body).toBe('{"a":1}');
    expect(calls[0]!.headers.get('Content-Type')).toBe('application/json');
    expect(calls[0]!.headers.get('Idempotency-Key')).toBe('k-1');
    expect(res.data).toEqual({ id: 'o1' });
  });

  it.each([['put'], ['patch']] as const)('%s dùng đúng phương thức HTTP', async (verb) => {
    const { calls } = stubFetch(() => ({ status: 200, body: {} }));
    await api[verb]('/x/1', { a: 1 });
    expect(calls[0]!.init.method).toBe(verb.toUpperCase());
  });

  it('DELETE không gửi body', async () => {
    const { calls } = stubFetch(() => ({ status: 200, body: {} }));
    await api.delete('/x/1');
    expect(calls[0]!.init.method).toBe('DELETE');
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it('POST không body → không gửi body, không đặt Content-Type', async () => {
    const { calls } = stubFetch(() => ({ status: 200, body: {} }));
    await api.post('/orders/1/cancel');
    expect(calls[0]!.init.body).toBeUndefined();
    expect(calls[0]!.headers.has('Content-Type')).toBe(false);
  });

  it('FormData: giữ nguyên và để trình duyệt tự đặt Content-Type kèm boundary', async () => {
    const { calls } = stubFetch(() => ({ status: 200, body: {} }));
    const form = new FormData();
    form.append('file', new Blob(['x']), 'a.png');
    await api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
    expect(calls[0]!.init.body).toBe(form);
    expect(calls[0]!.headers.has('Content-Type')).toBe(false);
  });
});

describe('api trên fetch: phản hồi', () => {
  it('thân không phải JSON giữ nguyên chuỗi; 204 → chuỗi rỗng', async () => {
    stubFetch((_c, n) => (n === 1 ? { status: 200, body: 'plain text' } : { status: 204 }));
    expect((await api.get('/a')).data).toBe('plain text');
    expect((await api.get('/b')).data).toBe('');
  });

  it('4xx → HttpError mang status + data (body JSON của API), không mang message thô của trình duyệt', async () => {
    stubFetch(() => ({ status: 400, body: { statusCode: 400, code: 'TOTAL_CHANGED', message: 'Giỏ hàng đã đổi giá.' } }));
    const err = await api.post('/checkout', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(isHttpError(err)).toBe(true);
    expect((err as HttpError).response?.status).toBe(400);
    expect((err as HttpError).response?.data).toEqual({ statusCode: 400, code: 'TOTAL_CHANGED', message: 'Giỏ hàng đã đổi giá.' });
    expect(getErrorMessage(err)).toBe('Giỏ hàng đã đổi giá.');
    expect(getErrorCode(err)).toBe('TOTAL_CHANGED');
    expect(isOutcomeUnknown(err)).toBe(false);
  });

  it('message dạng mảng (class-validator) → lấy phần tử đầu', async () => {
    stubFetch(() => ({ status: 400, body: { message: ['SĐT không hợp lệ.', 'khác'] } }));
    const err = await api.post('/x', {}).catch((e: unknown) => e);
    expect(getErrorMessage(err)).toBe('SĐT không hợp lệ.');
  });

  it('4xx kèm lời kỹ thuật tiếng Anh (Cannot GET…, class-validator) → câu lỗi chung, không lộ cho khách', async () => {
    stubFetch(() => ({ status: 404, body: { statusCode: 404, message: 'Cannot GET /api/me/loyalty' } }));
    const err = await api.get('/me/loyalty').catch((e: unknown) => e);
    expect(getErrorMessage(err)).toBe(copy.errors.generic);
    stubFetch(() => ({ status: 400, body: { message: ['phone must be a string'] } }));
    expect(getErrorMessage(await api.post('/x', {}).catch((e: unknown) => e))).toBe(copy.errors.generic);
  });

  it('5xx kèm message backend → KHÔNG lộ, dùng câu lỗi máy chủ chung; chưa biết kết quả', async () => {
    stubFetch(() => ({ status: 500, body: { message: 'Internal error XYZ' } }));
    const err = await api.post('/x', {}).catch((e: unknown) => e);
    expect(getErrorMessage(err)).toBe(copy.errors.server);
    expect(isOutcomeUnknown(err)).toBe(true);
  });

  it('502 trang HTML của proxy (không phải JSON) → câu lỗi máy chủ chung', async () => {
    stubFetch(() => ({ status: 502, body: '<html>Bad Gateway</html>', headers: { 'content-type': 'text/html' } }));
    const err = await api.get('/x').catch((e: unknown) => e);
    expect(isHttpError(err)).toBe(true);
    expect(getErrorMessage(err)).toBe(copy.errors.server);
    expect(isOutcomeUnknown(err)).toBe(true);
  });

  it('404 → isNotFoundError', async () => {
    stubFetch(() => ({ status: 404, body: { message: 'Không tìm thấy' } }));
    const err = await api.get('/products/x').catch((e: unknown) => e);
    expect(isNotFoundError(err)).toBe(true);
  });

  it('mất mạng (fetch ném TypeError) → HttpError ERR_NETWORK không có response; báo offline/server theo navigator.onLine', async () => {
    stubFetch(() => new TypeError('Failed to fetch'));
    const err = (await api.get('/x').catch((e: unknown) => e)) as HttpError;
    expect(isHttpError(err)).toBe(true);
    expect(err.code).toBe('ERR_NETWORK');
    expect(err.message).toBe('Network Error');
    expect(err.response).toBeUndefined();
    expect(isOutcomeUnknown(err)).toBe(true);
    vi.stubGlobal('navigator', { onLine: false });
    expect(getErrorMessage(err)).toBe(copy.errors.offline);
    vi.stubGlobal('navigator', { onLine: true });
    expect(getErrorMessage(err)).toBe(copy.errors.server);
  });
});

describe('api trên fetch: timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  it('quá 15s → abort, HttpError ECONNABORTED, câu "hơi chậm", chưa biết kết quả', async () => {
    const { calls, fn } = stubHangingFetch();
    const settled = api.get('/slow').catch((e: unknown) => e);
    await until(() => fn.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(calls[0]!.init.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = (await settled) as HttpError;
    expect(calls[0]!.init.signal?.aborted).toBe(true);
    expect(isHttpError(err)).toBe(true);
    expect(err.code).toBe('ECONNABORTED');
    expect(err.message).toBe('timeout of 15000ms exceeded');
    expect(getErrorMessage(err)).toBe(copy.errors.timeout);
    expect(isOutcomeUnknown(err)).toBe(true);
  });

  it('timeout riêng của từng request thay cho mặc định', async () => {
    const { fn } = stubHangingFetch();
    const settled = api.get('/feed', { timeout: 500 }).catch((e: unknown) => e);
    await until(() => fn.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(500);
    const err = (await settled) as HttpError;
    expect(err.code).toBe('ECONNABORTED');
    expect(err.message).toBe('timeout of 500ms exceeded');
  });

  it('phản hồi kịp giờ → không abort, không còn bộ hẹn giờ treo', async () => {
    stubFetch(() => ({ status: 200, body: { ok: 1 } }));
    await api.get('/fast');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('api trên fetch: làm mới token khi 401', () => {
  const unauthorizedUnlessNew = (call: { headers: Headers }) =>
    call.headers.get('Authorization') === 'Bearer new' ? { status: 200, body: { ok: true } } : { status: 401, body: { message: 'Unauthorized' } };

  it('2 request song song cùng 401 → chỉ làm mới MỘT lần, cả hai được gửi lại với token mới', async () => {
    setAccessToken('old');
    let refreshes = 0;
    setUnauthorizedHandler(async () => {
      refreshes += 1;
      await new Promise((r) => setTimeout(r, 5));
      setAccessToken('new');
      return 'new';
    });
    const { calls } = stubFetch(unauthorizedUnlessNew);
    const [a, b] = await Promise.all([api.get('/me'), api.post('/cart', { x: 1 })]);
    expect(refreshes).toBe(1);
    expect(calls).toHaveLength(4);
    expect(a.data).toEqual({ ok: true });
    expect(b.data).toEqual({ ok: true });
    expect(calls.slice(2).every((c) => c.headers.get('Authorization') === 'Bearer new')).toBe(true);
    expect(calls[3]!.init.body).toBe('{"x":1}');
  });

  it('handler trả token mà không setAccessToken → request gửi lại vẫn dùng token đó', async () => {
    setUnauthorizedHandler(async () => 'new');
    const { calls } = stubFetch(unauthorizedUnlessNew);
    await api.get('/me');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers.get('Authorization')).toBe('Bearer new');
  });

  it('chỉ gửi lại MỘT lần: vẫn 401 sau khi làm mới → trả lỗi 401', async () => {
    setAccessToken('old');
    setUnauthorizedHandler(async () => 'still-bad');
    const { calls } = stubFetch(() => ({ status: 401, body: { message: 'Unauthorized' } }));
    const err = (await api.get('/me').catch((e: unknown) => e)) as HttpError;
    expect(calls).toHaveLength(2);
    expect(err.response?.status).toBe(401);
  });

  it('handler trả null (hết phiên) → không gửi lại, trả lỗi 401', async () => {
    setUnauthorizedHandler(async () => null);
    const { calls } = stubFetch(() => ({ status: 401, body: {} }));
    const err = (await api.get('/me').catch((e: unknown) => e)) as HttpError;
    expect(calls).toHaveLength(1);
    expect(err.response?.status).toBe(401);
  });

  it('401 từ chính /auth/* → KHÔNG làm mới (tránh chờ chính nó)', async () => {
    const handler = vi.fn(async () => 'new');
    setUnauthorizedHandler(handler);
    const { calls } = stubFetch(() => ({ status: 401, body: {} }));
    const err = (await api.post('/auth/refresh', {}).catch((e: unknown) => e)) as HttpError;
    expect(handler).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(err.response?.status).toBe(401);
  });

  it('sau khi xong, lần 401 kế tiếp làm mới lại (không dính promise cũ)', async () => {
    let refreshes = 0;
    setUnauthorizedHandler(async () => {
      refreshes += 1;
      return 'new';
    });
    stubFetch((c) => (c.headers.get('Authorization') === 'Bearer new' ? { status: 200, body: {} } : { status: 401, body: {} }));
    await api.get('/a');
    setAccessToken(null);
    await api.get('/b');
    expect(refreshes).toBe(2);
  });
});
