import { describe, it, expect, vi as vitestVi, afterEach } from 'vitest';
import {
  api,
  apiMediaUrl,
  getErrorMessage,
  getLoadErrorMessage,
  HttpError,
  isAnonAuthCall,
  isOutcomeUnknown,
  loginGuest,
  loginZaloMiniApp,
  setAccessToken,
  setUnauthorizedHandler,
} from './api';
import { vi as viCopy } from '../i18n/vi';
import { stubFetch } from '../test/fetch-stub';

vitestVi.mock('../store/auth', () => ({ getDeviceId: async () => 'dev-1' }));

function httpError(o: { code?: string; response?: { status: number; data?: unknown } }): unknown {
  return new HttpError('boom', o.code, o.response);
}

describe('getLoadErrorMessage', () => {
  it('hết thời gian lúc tải nói "tải chậm", nút bấm (getErrorMessage) nói chưa rõ kết quả; lỗi khác giống nhau', () => {
    const timeout = httpError({ code: 'ECONNABORTED' });
    expect(getLoadErrorMessage(timeout)).toBe(viCopy.errors.loadTimeout);
    expect(getErrorMessage(timeout)).toBe(viCopy.errors.timeout);
    const busy = httpError({ response: { status: 503, data: {} } });
    expect(getLoadErrorMessage(busy)).toBe(getErrorMessage(busy));
  });
});

describe('getErrorMessage', () => {
  afterEach(() => {
    vitestVi.unstubAllGlobals();
  });

  it('lỗi 4xx có message backend (string) → hiển thị thẳng message backend', () => {
    const err = httpError({ response: { status: 400, data: { message: 'Giỏ hàng trống.' } } });
    expect(getErrorMessage(err)).toBe('Giỏ hàng trống.');
  });

  it('lỗi 4xx có message backend dạng mảng (class-validator) → lấy phần tử đầu', () => {
    const err = httpError({ response: { status: 400, data: { message: ['SĐT không hợp lệ.', 'khác'] } } });
    expect(getErrorMessage(err)).toBe('SĐT không hợp lệ.');
  });

  it('lỗi 5xx có message backend → KHÔNG lộ message backend, dùng copy lỗi máy chủ chung', () => {
    const err = httpError({ response: { status: 500, data: { message: 'Internal error XYZ' } } });
    expect(getErrorMessage(err)).toBe(viCopy.errors.server);
  });

  it('429 kèm mã nghiệp vụ → giữ lời máy chủ; 429 không mã (bộ giới hạn tốc độ) → câu đợi vài giây', () => {
    const daily = 'Bạn đã gửi quá nhiều tin hôm nay. Cần hỗ trợ, gọi hotline.';
    expect(getErrorMessage(httpError({ response: { status: 429, data: { message: daily, code: 'CHAT_DAILY_LIMIT' } } }))).toBe(daily);
    expect(getErrorMessage(httpError({ response: { status: 429, data: { message: 'ThrottlerException: Too Many Requests' } } }))).toContain('đợi vài giây');
  });

  it('401 mã SESSION_EXPIRED → câu hết phiên của Mini App dù máy chủ viết gì; ACCOUNT_BLOCKED → lời máy chủ', () => {
    expect(getErrorMessage(httpError({ response: { status: 401, data: { code: 'SESSION_EXPIRED', message: 'Phiên đăng nhập không còn hợp lệ.' } } }))).toBe(viCopy.errors.sessionExpired);
    expect(getErrorMessage(httpError({ response: { status: 401, data: { code: 'ACCOUNT_BLOCKED', message: 'Tài khoản đã bị khoá.' } } }))).toBe('Tài khoản đã bị khoá.');
  });

  it('401 → báo hết phiên; 4xx chỉ có chữ tiếng Anh không dấu → câu chung', () => {
    expect(getErrorMessage(httpError({ response: { status: 401, data: { message: 'Unauthorized' } } }))).toBe(viCopy.errors.sessionExpired);
    expect(getErrorMessage(httpError({ response: { status: 401, data: {} } }))).toBe(viCopy.errors.sessionExpired);
    expect(getErrorMessage(httpError({ response: { status: 401, data: { message: 'Tài khoản đã bị khoá.' } } }))).toBe('Tài khoản đã bị khoá.');
    expect(getErrorMessage(httpError({ response: { status: 400, data: { message: 'Bad Gateway from upstream' } } }))).toBe(viCopy.errors.generic);
  });

  it('timeout (ECONNABORTED) → copy timeout', () => {
    const err = httpError({ code: 'ECONNABORTED', response: undefined });
    expect(getErrorMessage(err)).toBe(viCopy.errors.timeout);
  });

  it('không có response + thật sự mất mạng (navigator.onLine=false) → copy offline', () => {
    vitestVi.stubGlobal('navigator', { onLine: false });
    const err = httpError({ response: undefined });
    expect(getErrorMessage(err)).toBe(viCopy.errors.offline);
  });

  it('không có response nhưng vẫn có mạng (sóng yếu, CORS/máy chủ không phản hồi) → câu trung tính, KHÔNG báo mất mạng sai và không đổ lỗi cho máy chủ', () => {
    vitestVi.stubGlobal('navigator', { onLine: true });
    const err = httpError({ response: undefined });
    expect(getErrorMessage(err)).toBe(viCopy.errors.network);
  });

  it('lỗi không phải HttpError (vd throw string/Error thường) → copy generic', () => {
    expect(getErrorMessage(new Error('nope'))).toBe(viCopy.errors.generic);
    expect(getErrorMessage('nope')).toBe(viCopy.errors.generic);
  });
});

describe('đăng nhập mang nguồn chạm đầu (firstTouch)', () => {
  afterEach(() => {
    vitestVi.restoreAllMocks();
  });
  const firstTouch = { source: 'shopee', campaign: 'card-2610', at: '2026-10-18T00:00:00.000Z' };

  it('loginGuest gửi firstTouch trong body', async () => {
    const post = vitestVi.spyOn(api, 'post').mockResolvedValue({ data: { accessToken: 'a' } });
    await loginGuest('d_12345678', 'REF1', firstTouch);
    expect(post).toHaveBeenCalledWith('/auth/guest', { deviceId: 'd_12345678', referralCode: 'REF1', firstTouch });
  });

  it('loginZaloMiniApp gửi firstTouch trong body', async () => {
    const post = vitestVi.spyOn(api, 'post').mockResolvedValue({ data: { accessToken: 'a' } });
    await loginZaloMiniApp('code', 'tok', undefined, 'REF1', firstTouch);
    expect(post).toHaveBeenCalledWith('/auth/zalo-mini-app', {
      code: 'code',
      accessToken: 'tok',
      phoneToken: undefined,
      referralCode: 'REF1',
      firstTouch,
    });
  });
});

describe('apiMediaUrl', () => {
  it('đường dẫn tương đối của API được ghép với gốc API', () => {
    expect(apiMediaUrl('/reviews/r1/images/0?v=abc')).toBe('http://localhost:3001/api/reviews/r1/images/0?v=abc');
  });

  it.each([
    'https://res.cloudinary.com/x/a.jpg',
    'data:image/png;base64,AAAA',
    '//cdn.example.com/a.jpg',
    '',
  ])('giữ nguyên %j', (src) => {
    expect(apiMediaUrl(src)).toBe(src);
  });
});

// R5-CHECKOUT-1: lỗi mà máy chủ có thể đã ghi đơn trước khi trả lời — gửi lại phải cùng Idempotency-Key.
describe('isOutcomeUnknown', () => {
  it.each([
    ['quá thời gian (ECONNABORTED)', httpError({ code: 'ECONNABORTED', response: undefined })],
    ['mất kết nối giữa chừng (ERR_NETWORK)', httpError({ code: 'ERR_NETWORK', response: undefined })],
    ['502 từ proxy', httpError({ response: { status: 502, data: {} } })],
    ['500', httpError({ response: { status: 500, data: {} } })],
  ])('%s → chưa biết kết quả', (_label, err) => {
    expect(isOutcomeUnknown(err)).toBe(true);
  });

  it.each([
    ['400 nghiệp vụ', httpError({ response: { status: 400, data: { message: 'Hết hàng' } } })],
    ['409', httpError({ response: { status: 409, data: {} } })],
    ['lỗi không phải HttpError', new Error('x')],
  ])('%s → đã biết kết quả (máy chủ từ chối)', (_label, err) => {
    expect(isOutcomeUnknown(err)).toBe(false);
  });
});

describe('isAnonAuthCall — chỉ các lệnh /auth/* không cần phiên mới được miễn refresh và chờ phiên', () => {
  it.each(['/auth/zalo-mini-app', '/auth/guest', '/auth/zalo-oauth', '/auth/refresh', '/auth/logout', '/auth/refresh?x=1'])(
    '%s → true',
    (url) => {
      expect(isAnonAuthCall(url)).toBe(true);
    },
  );

  it.each(['/auth/ensure-phone', '/auth/me', '/products', '/orders?next=/auth/guest', '/auth/refresh/extra'])('%s → false', (url) => {
    expect(isAnonAuthCall(url)).toBe(false);
  });
});

describe('401 ở lệnh /auth/* (E-13)', () => {
  afterEach(() => {
    setUnauthorizedHandler(null);
    setAccessToken(null);
    vitestVi.unstubAllGlobals();
  });

  it('401 ở /auth/ensure-phone (cần JWT, token hết hạn sau 15 phút) → gọi refresh rồi gửi lại với token mới', async () => {
    // Handler thật (store/auth.ts) đặt access token mới trước khi trả về; lần gửi lại đọc token từ đó.
    const refresh = vitestVi.fn(async () => {
      setAccessToken('fresh-token');
      return 'fresh-token';
    });
    setUnauthorizedHandler(refresh);
    setAccessToken('stale-token');
    const { calls } = stubFetch((_c, n) =>
      n === 1 ? { status: 401, body: { statusCode: 401, message: 'Unauthorized' } } : { status: 200, body: { accessToken: 'a2' } },
    );

    const res = await api.post('/auth/ensure-phone', { code: 'c', accessToken: 'z' });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer stale-token');
    expect(calls[1]!.headers.get('Authorization')).toBe('Bearer fresh-token');
    expect(res.data).toEqual({ accessToken: 'a2' });
  });

  it('401 ở /auth/refresh → không refresh (tránh deadlock), ném lỗi nguyên văn', async () => {
    const refresh = vitestVi.fn(async () => 'fresh-token');
    setUnauthorizedHandler(refresh);
    const { calls } = stubFetch(() => ({ status: 401, body: { statusCode: 401, message: 'Refresh token không hợp lệ.' } }));

    await expect(api.post('/auth/refresh', { refreshToken: 'x' })).rejects.toMatchObject({ response: { status: 401 } });

    expect(refresh).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('401 ở /auth/zalo-mini-app (đăng nhập khi đang bị khoá) → không refresh', async () => {
    const refresh = vitestVi.fn(async () => 'fresh-token');
    setUnauthorizedHandler(refresh);
    stubFetch(() => ({ status: 401, body: { code: 'ACCOUNT_BLOCKED', message: 'Tài khoản đã bị khoá.' } }));

    await expect(loginZaloMiniApp('c', 'a')).rejects.toMatchObject({ response: { status: 401 } });

    expect(refresh).not.toHaveBeenCalled();
  });
});
