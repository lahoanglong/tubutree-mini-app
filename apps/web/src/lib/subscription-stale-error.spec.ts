import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from './client-api';
import { isStaleSubscriptionError } from './subscription-stale-error';

describe('isStaleSubscriptionError', () => {
  it.each([400, 404, 409])('ApiError %i: gói đã khác thẻ đang hiện, phải tải lại', (status) => {
    expect(isStaleSubscriptionError(new ApiError('từ chối', status))).toBe(true);
  });

  it.each([401, 403, 408, 422, 429, 500, 502, 503, 504])('ApiError %i: không nói gì về trạng thái thật của gói, không tải lại', (status) => {
    expect(isStaleSubscriptionError(new ApiError('lỗi', status))).toBe(false);
  });

  it('mất mạng / quá hạn (không có status) và giá trị lạ: không tính', () => {
    expect(isStaleSubscriptionError(new NetworkError(false))).toBe(false);
    expect(isStaleSubscriptionError(new NetworkError(true))).toBe(false);
    expect(isStaleSubscriptionError(new Error('boom'))).toBe(false);
    expect(isStaleSubscriptionError(undefined)).toBe(false);
    expect(isStaleSubscriptionError(null)).toBe(false);
    expect(isStaleSubscriptionError('409')).toBe(false);
    expect(isStaleSubscriptionError({ status: '409' })).toBe(false);
  });

  it('lỗi kiểu axios của Mini App (response.status) cũng nhận ra', () => {
    expect(isStaleSubscriptionError({ response: { status: 409 } })).toBe(true);
    expect(isStaleSubscriptionError({ response: { status: 500 } })).toBe(false);
  });
});
