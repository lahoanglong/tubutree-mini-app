import { describe, expect, it } from 'vitest';
import type { WasteMeDTO, WasteRequestSummaryDTO } from '@tubutree/shared-types';
import { ApiError, NetworkError } from './client-api';
import { attachablePickup, isOutcomeUnknown } from './checkout-waste';

const req = (over: Partial<WasteRequestSummaryDTO> = {}) =>
  ({ id: 'req-p', code: 'TR-PICK1', method: 'PICKUP', status: 'OPEN', orderCode: null, ...over }) as WasteRequestSummaryDTO;
const me = (over: Partial<WasteMeDTO> = {}) =>
  ({ blocked: false, shipLockedAt: null, openRequests: [req()], ...over }) as WasteMeDTO;

describe('attachablePickup (như Mini App)', () => {
  it('ẩn mục (undefined) khi cờ pickup tắt, chưa có dữ liệu, bị khoá hoặc khoá đường kho', () => {
    expect(attachablePickup(me(), false)).toBeUndefined();
    expect(attachablePickup(undefined, true)).toBeUndefined();
    expect(attachablePickup(me({ blocked: true }), true)).toBeUndefined();
    expect(attachablePickup(me({ shipLockedAt: '2026-10-01T00:00:00.000Z' }), true)).toBeUndefined();
  });

  it('chưa có yêu cầu PICKUP mở chưa gắn đơn → null (hiện dòng tạo yêu cầu)', () => {
    expect(attachablePickup(me({ openRequests: [] }), true)).toBeNull();
    expect(attachablePickup(me({ openRequests: [req({ orderCode: 'TUBU999' })] }), true)).toBeNull();
    expect(attachablePickup(me({ openRequests: [req({ method: 'DROP_OFF' })] }), true)).toBeNull();
  });

  it('có yêu cầu PICKUP OPEN chưa gắn đơn → trả yêu cầu đó', () => {
    expect(attachablePickup(me(), true)?.id).toBe('req-p');
  });
});

describe('isOutcomeUnknown', () => {
  it('mất mạng/quá thời gian và 5xx: máy chủ có thể đã làm xong; 4xx thì không', () => {
    expect(isOutcomeUnknown(new NetworkError(false))).toBe(true);
    expect(isOutcomeUnknown(new NetworkError(true))).toBe(true);
    expect(isOutcomeUnknown(new ApiError('lỗi', 502))).toBe(true);
    expect(isOutcomeUnknown(new ApiError('đã huỷ', 409))).toBe(false);
    expect(isOutcomeUnknown(new Error('khác'))).toBe(false);
  });
});
