import { describe, expect, it } from 'vitest';
import { classifyLoginError } from './login-error';

class ZaloApiError extends Error {}
class ZaloApiLoginQRDeclined extends ZaloApiError {}

describe('classifyLoginError', () => {
  it('Zalo trả lời và từ chối phiên thì cần QR (kể cả lớp con)', () => {
    expect(classifyLoginError(new ZaloApiError('Đăng nhập thất bại'))).toBe('need-qr');
    expect(classifyLoginError(new ZaloApiLoginQRDeclined('x'))).toBe('need-qr');
  });

  it('lỗi mạng, DNS, hết giờ thì thử lại', () => {
    expect(classifyLoginError(new TypeError('fetch failed'))).toBe('retry');
    expect(classifyLoginError(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }))).toBe('retry');
    expect(classifyLoginError(new Error('Đăng nhập Zalo quá 60s'))).toBe('retry');
    expect(classifyLoginError('lạ')).toBe('retry');
  });

  it('ZaloApiError do HTTP 5xx (qua statusText hay mã trong thông điệp) là tạm thời, thử lại', () => {
    expect(classifyLoginError(new ZaloApiError('Failed to fetch login info: Internal Server Error'))).toBe('retry');
    expect(classifyLoginError(new ZaloApiError('Failed to fetch server info: Bad Gateway'))).toBe('retry');
    expect(classifyLoginError(new ZaloApiError('Failed to fetch server info: Service Unavailable'))).toBe('retry');
    expect(classifyLoginError(new ZaloApiError('Failed to fetch server info: Gateway Timeout'))).toBe('retry');
    expect(classifyLoginError(Object.assign(new ZaloApiError('x'), { status: 502 }))).toBe('retry');
  });

  it('ZaloApiError do 4xx hay mã lỗi Zalo vẫn là phiên bị từ chối, cần QR', () => {
    expect(classifyLoginError(new ZaloApiError('Failed to fetch login info: Unauthorized'))).toBe('need-qr');
    expect(classifyLoginError(new ZaloApiError('Đăng nhập thất bại'))).toBe('need-qr');
    expect(classifyLoginError(Object.assign(new ZaloApiError('cookie sai'), { code: 114 }))).toBe('need-qr');
  });
});
