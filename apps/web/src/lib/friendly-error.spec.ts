import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/client-api';
import { friendlyError, isAuthError, SESSION_EXPIRED_TEXT, NO_ACCESS_TEXT } from './friendly-error';

describe('friendlyError', () => {
  it('401/403 không bao giờ in message thô của API', () => {
    expect(friendlyError(new ApiError('Unauthorized', 401))).toBe(SESSION_EXPIRED_TEXT);
    expect(friendlyError(new ApiError('Bạn không có quyền truy cập tài nguyên này', 403))).toBe(NO_ACCESS_TEXT);
    expect(friendlyError(new ApiError('Forbidden', 403))).toBe(NO_ACCESS_TEXT);
  });
  it('message trơ trọi Unauthorized/Forbidden (không có status) cũng đổi sang tiếng Việt', () => {
    expect(friendlyError(new Error('Unauthorized'))).toBe(SESSION_EXPIRED_TEXT);
    expect(friendlyError(new Error('forbidden'))).toBe(NO_ACCESS_TEXT);
  });
  it('lỗi khác giữ câu tiếng Việt của API; không có thì câu chung', () => {
    expect(friendlyError(new ApiError('Hết lượt đổi hôm nay', 400))).toBe('Hết lượt đổi hôm nay');
    expect(friendlyError(null)).toBe('Đã có lỗi xảy ra — Vui lòng thử lại');
  });
  it('isAuthError: 401/403 hoặc message thô', () => {
    expect(isAuthError(new ApiError('x', 403))).toBe(true);
    expect(isAuthError(new Error('Unauthorized'))).toBe(true);
    expect(isAuthError(new ApiError('x', 500))).toBe(false);
  });
});
