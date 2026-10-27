import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/client-api';
import { friendlyError, isAuthError, SESSION_EXPIRED_TEXT, NO_ACCESS_TEXT } from './friendly-error';

describe('friendlyError', () => {
  it('401/403 không bao giờ in message thô của API', () => {
    expect(friendlyError(new ApiError('Unauthorized', 401))).toBe(SESSION_EXPIRED_TEXT);
    expect(friendlyError(new ApiError('Forbidden', 403))).toBe(NO_ACCESS_TEXT);
    expect(friendlyError(new ApiError('', 403))).toBe(NO_ACCESS_TEXT);
  });
  it('403 kèm câu nghiệp vụ tiếng Việt của API giữ nguyên như Mini App', () => {
    const msg = 'Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn, liên hệ CSKH.';
    expect(friendlyError(new ApiError(msg, 403))).toBe(msg);
  });
  it('message trơ trọi Unauthorized/Forbidden (không có status) cũng đổi sang tiếng Việt', () => {
    expect(friendlyError(new Error('Unauthorized'))).toBe(SESSION_EXPIRED_TEXT);
    expect(friendlyError(new Error('forbidden'))).toBe(NO_ACCESS_TEXT);
  });
  it('lỗi khác giữ câu tiếng Việt của API; không có thì câu chung', () => {
    expect(friendlyError(new ApiError('Hết lượt đổi hôm nay', 400))).toBe('Hết lượt đổi hôm nay');
    expect(friendlyError(null)).toBe('Có chút trục trặc, thử lại nhé');
    expect(friendlyError(new ApiError('ECONNRESET', 500))).toBe('Máy chủ đang bận, thử lại nhé.');
  });
  it('429 CHAT_DAILY_LIMIT (ApiError thật): giữ lời máy chủ, không thành "thao tác hơi nhanh"; 429 không mã thì câu đợi vài giây', () => {
    const m = 'Bạn đã gửi quá nhiều tin hôm nay. Cần hỗ trợ, gọi hotline.';
    expect(friendlyError(new ApiError(m, 429, 'CHAT_DAILY_LIMIT'))).toBe(m);
    expect(friendlyError(new ApiError('ThrottlerException', 429))).toContain('đợi vài giây');
  });
  it('401 mang lời nghiệp vụ tiếng Việt giữ lời đó, 401 thô thì câu hết phiên', () => {
    expect(friendlyError(new ApiError('Tài khoản đã bị khoá.', 401))).toBe('Tài khoản đã bị khoá.');
    expect(friendlyError(new ApiError('Unauthorized', 401))).toBe(SESSION_EXPIRED_TEXT);
  });
  it('isAuthError: 401/403 hoặc message thô', () => {
    expect(isAuthError(new ApiError('x', 403))).toBe(true);
    expect(isAuthError(new Error('Unauthorized'))).toBe(true);
    expect(isAuthError(new ApiError('x', 500))).toBe(false);
  });
});
