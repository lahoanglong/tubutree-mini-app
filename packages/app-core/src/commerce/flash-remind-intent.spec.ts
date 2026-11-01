import { describe, expect, it } from 'vitest';
import { remindIntentAction } from './flash-remind-intent';

const INTENT = { itemId: 'fi-21', startAt: '2026-11-01T13:00:00.000Z' };

describe('remindIntentAction', () => {
  it('món sắp diễn ra chưa được nhắc: đặt nhắc', () => {
    expect(remindIntentAction(INTENT, [{ itemId: 'fi-21', reminded: false }, { itemId: 'fi-22', reminded: true }])).toBe('remind');
  });

  it('món đã được nhắc từ trước (máy khác, lần trước): bỏ, vì bấm bật lại sẽ HUỶ nhắc', () => {
    expect(remindIntentAction(INTENT, [{ itemId: 'fi-21', reminded: true }])).toBe('drop');
  });

  it('món không còn trong danh sách sắp diễn ra (khung đã mở, món bị gỡ): bỏ', () => {
    expect(remindIntentAction(INTENT, [{ itemId: 'fi-22', reminded: false }])).toBe('drop');
    expect(remindIntentAction(INTENT, [])).toBe('drop');
  });
});
