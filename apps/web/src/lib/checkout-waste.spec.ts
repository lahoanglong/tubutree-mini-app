import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from './client-api';
import { isOutcomeUnknown } from './checkout-waste';

describe('isOutcomeUnknown', () => {
  it('mất mạng/quá thời gian và 5xx: máy chủ có thể đã làm xong; 4xx thì không', () => {
    expect(isOutcomeUnknown(new NetworkError(false))).toBe(true);
    expect(isOutcomeUnknown(new NetworkError(true))).toBe(true);
    expect(isOutcomeUnknown(new ApiError('lỗi', 502))).toBe(true);
    expect(isOutcomeUnknown(new ApiError('đã huỷ', 409))).toBe(false);
    expect(isOutcomeUnknown(new Error('khác'))).toBe(false);
  });
});
