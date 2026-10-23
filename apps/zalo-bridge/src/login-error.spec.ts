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
});
