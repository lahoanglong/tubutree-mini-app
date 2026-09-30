import { describe, it, expect, vi } from 'vitest';

vi.mock('./analytics', () => ({ trackEvent: vi.fn() }));

import { trackEvent } from './analytics';
import { trackReorderClicked, trackReorderCompleted, trackReorderReminderCta } from './buy-flow-events';

describe('buy-flow-events (spec §3.4)', () => {
  it('reorder_clicked mang source + mã đơn/variation', () => {
    trackReorderClicked({ source: 'order_card', orderCode: 'TUBU1' });
    expect(trackEvent).toHaveBeenLastCalledWith('reorder_clicked', 'miniapp', { source: 'order_card', orderCode: 'TUBU1' });
  });
  it('reorder_completed mang số dòng thêm/bỏ qua', () => {
    trackReorderCompleted({ source: 'home_rail', added: 1, skipped: 0 });
    expect(trackEvent).toHaveBeenLastCalledWith('reorder_completed', 'miniapp', { source: 'home_rail', added: 1, skipped: 0 });
  });
  it('reorder_reminder_cta gắn notificationId cả ở props lẫn cột notificationId', () => {
    trackReorderReminderCta('n1');
    expect(trackEvent).toHaveBeenLastCalledWith('reorder_reminder_cta', 'miniapp', { notificationId: 'n1' }, { notificationId: 'n1' });
  });
});
