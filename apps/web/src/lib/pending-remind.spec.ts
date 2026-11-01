// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PENDING_REMIND_KEY, PENDING_REMIND_TTL_MS, clearPendingRemind, rememberPendingRemind, takePendingRemind } from './pending-remind';

const INTENT = { itemId: 'fi-21', startAt: '2026-11-01T13:00:00.000Z' };

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('pending-remind — nhắc Giờ vàng khách bấm lúc chưa đăng nhập', () => {
  it('ghi rồi đọc trả đúng ý định và xoá luôn (dùng đúng một lần)', () => {
    rememberPendingRemind(INTENT, 1_000);
    expect(takePendingRemind(2_000)).toEqual(INTENT);
    expect(takePendingRemind(2_000)).toBeNull();
    expect(sessionStorage.getItem(PENDING_REMIND_KEY)).toBeNull();
  });

  it('quá hạn thì bỏ và xoá: khách bỏ dở đăng nhập, lần đăng nhập sau không tự đặt nhắc', () => {
    rememberPendingRemind(INTENT, 1_000);
    expect(takePendingRemind(1_000 + PENDING_REMIND_TTL_MS + 1)).toBeNull();
    expect(sessionStorage.getItem(PENDING_REMIND_KEY)).toBeNull();
  });

  it('còn trong hạn đúng mốc thì vẫn nhận', () => {
    rememberPendingRemind(INTENT, 1_000);
    expect(takePendingRemind(1_000 + PENDING_REMIND_TTL_MS)).toEqual(INTENT);
  });

  it('dữ liệu hỏng, thiếu trường hay sai kiểu: coi như không có và xoá', () => {
    for (const raw of ['không phải JSON', '{"itemId":"fi-1"}', '{"itemId":5,"startAt":"x","at":1}', 'null']) {
      sessionStorage.setItem(PENDING_REMIND_KEY, raw);
      expect(takePendingRemind(1_000)).toBeNull();
      expect(sessionStorage.getItem(PENDING_REMIND_KEY)).toBeNull();
    }
  });

  it('clearPendingRemind xoá ý định đang chờ', () => {
    rememberPendingRemind(INTENT, 1_000);
    clearPendingRemind();
    expect(takePendingRemind(1_001)).toBeNull();
  });

  it('kho bị chặn (chế độ riêng tư): không ném lỗi, chỉ mất việc tự đặt nhắc', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => rememberPendingRemind(INTENT)).not.toThrow();
    expect(takePendingRemind()).toBeNull();
    expect(() => clearPendingRemind()).not.toThrow();
  });
});
