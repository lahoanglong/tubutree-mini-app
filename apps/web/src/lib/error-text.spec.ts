// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ApiError, GENERIC_ERROR, NetworkError } from '@/lib/client-api';
import { actionErrorText, loadErrorText, SESSION_EXPIRED_TEXT } from './error-text';

describe('loadErrorText (khớp getErrorMessage của Mini App)', () => {
  it('5xx: máy chủ bận, không lộ lời kỹ thuật', () => {
    expect(loadErrorText(new ApiError('Internal server error', 500))).toBe('Máy chủ đang bận, thử lại nhé.');
  });
  it('4xx: hiện thẳng lời nghiệp vụ; 429: nhắc đợi vài giây', () => {
    expect(loadErrorText(new ApiError('Giỏ hàng trống.', 400))).toBe('Giỏ hàng trống.');
    expect(loadErrorText(new ApiError('ThrottlerException', 429))).toContain('đợi vài giây');
  });
  it('mất mạng / quá hạn / lỗi lạ', () => {
    expect(loadErrorText(new NetworkError(true))).toBe('Tải chậm quá, thử lại nhé.');
    expect(actionErrorText(new NetworkError(true))).toBe('Mạng chậm, chưa rõ đã xong chưa. Bạn kiểm tra lại rồi thử lại nhé.');
    expect(loadErrorText(new Error('x'))).toBe('Có chút trục trặc, thử lại nhé');
  });
  it('không có phản hồi nhưng máy còn mạng (máy chủ/CORS không đáp): máy chủ bận; thật sự mất mạng: câu mất mạng', () => {
    expect(loadErrorText(new NetworkError(false))).toBe('Chưa kết nối được tới Tubu Tree. Kiểm tra mạng rồi thử lại nhé.');
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(loadErrorText(new NetworkError(false))).toBe('Có vẻ mất mạng. Kiểm tra kết nối rồi thử lại nhé.');
    online.mockRestore();
  });
  it('lời kỹ thuật tiếng Anh của 4xx không hiện ra; 4xx không có lời thì máy chủ bận', () => {
    expect(loadErrorText(new ApiError('Cannot GET /api/me/loyalty', 404))).toBe('Có chút trục trặc, thử lại nhé');
    expect(loadErrorText(new ApiError('phone must be a string', 400))).toBe('Có chút trục trặc, thử lại nhé');
    for (const m of ['request entity too large', 'Payload Too Large', 'Method Not Allowed', 'Unexpected token < in JSON at position 0', 'Cannot HEAD /api/x', 'Not Acceptable']) {
      expect(loadErrorText(new ApiError(m, 400)), m).toBe('Có chút trục trặc, thử lại nhé');
    }
    expect(loadErrorText(new ApiError('Mã giảm giá không được phép dùng cho đơn này', 400))).toContain('không được phép');
    expect(loadErrorText(new ApiError('', 404))).toBe('Máy chủ đang bận, thử lại nhé.');
  });
  it('lỗi lạ', () => {
    expect(loadErrorText(new Error('x'))).toBe('Có chút trục trặc, thử lại nhé');
  });
  it('429 kèm mã nghiệp vụ giữ lời máy chủ; 429 của bộ giới hạn tốc độ (không mã) vẫn là câu đợi vài giây', () => {
    const daily = 'Bạn đã gửi quá nhiều tin hôm nay. Cần hỗ trợ, gọi hotline.';
    expect(loadErrorText(new ApiError(daily, 429, 'CHAT_DAILY_LIMIT'))).toBe(daily);
    expect(actionErrorText(new ApiError(daily, 429, 'CHAT_DAILY_LIMIT'))).toBe(daily);
    const claim = 'Hôm nay bạn đã nhập mã quá số lần cho phép. Hãy thử lại vào ngày mai.';
    expect(loadErrorText(new ApiError(claim, 429, 'DAILY_ATTEMPTS'))).toBe(claim);
    expect(loadErrorText(new ApiError('Too Many Requests', 429, 'X'))).toContain('đợi vài giây');
    expect(loadErrorText(new ApiError(daily, 429))).toContain('đợi vài giây');
  });
  it('401: báo hết phiên và đăng nhập lại, không phải câu thử lại', () => {
    expect(loadErrorText(new ApiError('Unauthorized', 401))).toBe(SESSION_EXPIRED_TEXT);
    expect(actionErrorText(new ApiError('', 401))).toBe(SESSION_EXPIRED_TEXT);
  });
  it('401 thân rỗng/không phải JSON (apiFetch đặt câu chung GENERIC_ERROR): vẫn là hết phiên, không phải "Có lỗi xảy ra"', () => {
    expect(loadErrorText(new ApiError(GENERIC_ERROR, 401))).toBe(SESSION_EXPIRED_TEXT);
    expect(actionErrorText(new ApiError(GENERIC_ERROR, 401))).toBe(SESSION_EXPIRED_TEXT);
  });
  it('401 mã SESSION_EXPIRED: câu hết phiên của web dù máy chủ viết gì; ACCOUNT_BLOCKED: lời của máy chủ', () => {
    expect(loadErrorText(new ApiError('Phiên đăng nhập không còn hợp lệ.', 401, 'SESSION_EXPIRED'))).toBe(SESSION_EXPIRED_TEXT);
    expect(actionErrorText(new ApiError('Tài khoản đã bị khoá.', 401, 'ACCOUNT_BLOCKED'))).toBe('Tài khoản đã bị khoá.');
  });
  it('401 mang lời nghiệp vụ tiếng Việt (tài khoản bị khoá): giữ lời đó', () => {
    expect(loadErrorText(new ApiError('Tài khoản đã bị khoá.', 401))).toBe('Tài khoản đã bị khoá.');
    expect(actionErrorText(new ApiError('Tài khoản đã bị khoá.', 401))).toBe('Tài khoản đã bị khoá.');
  });
  it('4xx chỉ có chữ tiếng Anh (không dấu): câu chung tiếng Việt', () => {
    expect(loadErrorText(new ApiError('Bad Gateway from upstream', 400))).toBe('Có chút trục trặc, thử lại nhé');
    expect(loadErrorText(new ApiError('Mã giảm giá đã hết hạn', 400))).toBe('Mã giảm giá đã hết hạn');
  });
});
