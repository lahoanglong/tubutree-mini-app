import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from './client-api';
import { isTransientLoginFailure, loginFailureMessage, oauthErrorMessage } from './login-errors';

describe('oauthErrorMessage — lỗi Zalo trả về qua ?error=', () => {
  it('khách bấm từ chối: nói rõ và chỉ cách làm tiếp', () => {
    expect(oauthErrorMessage('access_denied')).toContain('từ chối cấp quyền');
    expect(oauthErrorMessage('ACCESS_DENIED')).toContain('từ chối cấp quyền');
  });

  it('mã lạ/không có mã: câu chung tiếng Việt, không in mã tiếng Anh', () => {
    for (const code of ['weird_code', '', null, undefined]) {
      const m = oauthErrorMessage(code);
      expect(m).toMatch(/Zalo chưa hoàn tất/);
      expect(m).not.toMatch(/weird_code/);
    }
  });

  it('lỗi cấu hình app Zalo → hướng khách sang hotline, không đổ lỗi cho khách', () => {
    expect(oauthErrorMessage('redirect_uri_mismatch')).toContain('hotline');
  });
});

describe('loginFailureMessage — lỗi khi đổi mã lấy phiên', () => {
  it('lỗi mạng giữ câu tiếng Việt của NetworkError, không phải "Failed to fetch"', () => {
    expect(loginFailureMessage(new NetworkError(false))).toBe('Mất kết nối. Vui lòng kiểm tra mạng rồi thử lại.');
    expect(loginFailureMessage(new NetworkError(true))).toContain('quá lâu');
  });

  it('câu tiếng Việt của chính web/API (state sai, mã đã dùng) được giữ nguyên', () => {
    const m = 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.';
    expect(loginFailureMessage(new Error(m))).toBe(m);
    expect(loginFailureMessage(new ApiError('Mã đăng nhập Zalo không hợp lệ hoặc đã hết hạn.', 401))).toContain('Zalo');
  });

  it('thông báo tiếng Anh/kỹ thuật bị thay bằng câu chung', () => {
    for (const e of [new Error('Failed to fetch'), new ApiError('Unauthorized', 401), new ApiError('invalid_grant', 400), 'x', null]) {
      expect(loginFailureMessage(e)).toMatch(/Không đăng nhập được lúc này/);
    }
  });

  it('API cũ còn ghép chuỗi thô của Zalo sau tiền tố tiếng Việt ("Zalo OAuth thất bại: invalid code") → câu sạch (BUYERWEB-19)', () => {
    for (const raw of ['Zalo OAuth thất bại: invalid code', 'Zalo verify thất bại: Access token is invalid', 'Zalo OAuth thất bại: unknown']) {
      const m = loginFailureMessage(new ApiError(raw, 401));
      expect(m).not.toMatch(/invalid|unknown|Access token/i);
      expect(m).toBe('Mã đăng nhập Zalo không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.');
    }
  });

  it('429: nói rõ đợi rồi thử lại', () => {
    expect(loginFailureMessage(new ApiError('ThrottlerException: Too Many Requests', 429))).toContain('đợi ít phút');
  });
});

describe('Zalo tạm bận khi đổi mã (R3-UI-8)', () => {
  it('503 của API giữ nguyên câu "Zalo đang bận" và được coi là lỗi tạm', () => {
    const e = new ApiError('Zalo đang bận, vui lòng thử lại sau ít phút.', 503);
    expect(loginFailureMessage(e)).toBe('Zalo đang bận, vui lòng thử lại sau ít phút.');
    expect(isTransientLoginFailure(e)).toBe(true);
  });

  it('mất mạng, 429, 5xx là lỗi tạm; mã sai (401) và lỗi khác thì không', () => {
    expect(isTransientLoginFailure(new NetworkError(false))).toBe(true);
    expect(isTransientLoginFailure(new ApiError('x', 429))).toBe(true);
    expect(isTransientLoginFailure(new ApiError('x', 502))).toBe(true);
    expect(isTransientLoginFailure(new ApiError('Mã đăng nhập Zalo không hợp lệ.', 401))).toBe(false);
    expect(isTransientLoginFailure(new Error('x'))).toBe(false);
    expect(isTransientLoginFailure(null)).toBe(false);
  });
});
