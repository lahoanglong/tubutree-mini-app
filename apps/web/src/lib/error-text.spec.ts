// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '@/lib/client-api';
import { loadErrorText } from './error-text';

describe('loadErrorText (khớp getErrorMessage của Mini App)', () => {
  it('5xx: máy chủ bận, không lộ lời kỹ thuật', () => {
    expect(loadErrorText(new ApiError('Internal server error', 500))).toBe('Máy chủ đang bận, thử lại nhé.');
  });
  it('4xx: hiện thẳng lời nghiệp vụ; 429: nhắc đợi vài giây', () => {
    expect(loadErrorText(new ApiError('Giỏ hàng trống.', 400))).toBe('Giỏ hàng trống.');
    expect(loadErrorText(new ApiError('ThrottlerException', 429))).toContain('đợi vài giây');
  });
  it('mất mạng / quá hạn / lỗi lạ', () => {
    expect(loadErrorText(new NetworkError(true))).toBe('Mạng chậm, chưa rõ đã xong chưa. Bạn kiểm tra lại rồi thử lại nhé.');
    expect(loadErrorText(new Error('x'))).toBe('Có chút trục trặc, thử lại nhé');
  });
  it('không có phản hồi nhưng máy còn mạng (máy chủ/CORS không đáp): máy chủ bận; thật sự mất mạng: câu mất mạng', () => {
    expect(loadErrorText(new NetworkError(false))).toBe('Máy chủ đang bận, thử lại nhé.');
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
});
