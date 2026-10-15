import { describe, it, expect, vi as vitestVi, afterEach } from 'vitest';
import { apiMediaUrl, getErrorMessage, isOutcomeUnknown } from './api';
import { vi as viCopy } from '../i18n/vi';

function axiosError(overrides: Record<string, unknown>): unknown {
  return { isAxiosError: true, message: 'boom', ...overrides };
}

describe('getErrorMessage', () => {
  afterEach(() => {
    vitestVi.unstubAllGlobals();
  });

  it('lỗi 4xx có message backend (string) → hiển thị thẳng message backend', () => {
    const err = axiosError({ response: { status: 400, data: { message: 'Giỏ hàng trống.' } } });
    expect(getErrorMessage(err)).toBe('Giỏ hàng trống.');
  });

  it('lỗi 4xx có message backend dạng mảng (class-validator) → lấy phần tử đầu', () => {
    const err = axiosError({ response: { status: 400, data: { message: ['SĐT không hợp lệ.', 'khác'] } } });
    expect(getErrorMessage(err)).toBe('SĐT không hợp lệ.');
  });

  it('lỗi 5xx có message backend → KHÔNG lộ message backend, dùng copy lỗi máy chủ chung', () => {
    const err = axiosError({ response: { status: 500, data: { message: 'Internal error XYZ' } } });
    expect(getErrorMessage(err)).toBe(viCopy.errors.server);
  });

  it('timeout (ECONNABORTED) → copy timeout', () => {
    const err = axiosError({ code: 'ECONNABORTED', response: undefined });
    expect(getErrorMessage(err)).toBe(viCopy.errors.timeout);
  });

  it('không có response + thật sự mất mạng (navigator.onLine=false) → copy offline', () => {
    vitestVi.stubGlobal('navigator', { onLine: false });
    const err = axiosError({ response: undefined });
    expect(getErrorMessage(err)).toBe(viCopy.errors.offline);
  });

  it('không có response nhưng vẫn có mạng (CORS/server không phản hồi) → copy server, KHÔNG báo mất mạng sai', () => {
    vitestVi.stubGlobal('navigator', { onLine: true });
    const err = axiosError({ response: undefined });
    expect(getErrorMessage(err)).toBe(viCopy.errors.server);
  });

  it('lỗi không phải AxiosError (vd throw string/Error thường) → copy generic', () => {
    expect(getErrorMessage(new Error('nope'))).toBe(viCopy.errors.generic);
    expect(getErrorMessage('nope')).toBe(viCopy.errors.generic);
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
    ['quá thời gian (ECONNABORTED)', axiosError({ code: 'ECONNABORTED', response: undefined })],
    ['mất kết nối giữa chừng (ERR_NETWORK)', axiosError({ code: 'ERR_NETWORK', response: undefined })],
    ['502 từ proxy', axiosError({ response: { status: 502, data: {} } })],
    ['500', axiosError({ response: { status: 500, data: {} } })],
  ])('%s → chưa biết kết quả', (_label, err) => {
    expect(isOutcomeUnknown(err)).toBe(true);
  });

  it.each([
    ['400 nghiệp vụ', axiosError({ response: { status: 400, data: { message: 'Hết hàng' } } })],
    ['409', axiosError({ response: { status: 409, data: {} } })],
    ['lỗi không phải axios', new Error('x')],
  ])('%s → đã biết kết quả (máy chủ từ chối)', (_label, err) => {
    expect(isOutcomeUnknown(err)).toBe(false);
  });
});
