import { describe, expect, it } from 'vitest';
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
    expect(loadErrorText(new NetworkError(true))).toBe('Hơi chậm tí, bạn đợi nhé');
    expect(loadErrorText(new NetworkError(false))).toContain('Mất kết nối');
    expect(loadErrorText(new Error('x'))).toBe('Có chút trục trặc, thử lại nhé');
  });
});
