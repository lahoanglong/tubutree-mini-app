import { describe, it, expect } from 'vitest';
import { ORDERS_TABS, parseOrdersTab } from './orders-tabs';

describe('orders-tabs khi giao định kỳ tạm ẩn ở Mini App (R-30)', () => {
  it('không có tab Định kỳ và ?tab=subscriptions về Tất cả', () => {
    expect(ORDERS_TABS.map((t) => t.key)).not.toContain('subscriptions');
    expect(parseOrdersTab('?tab=subscriptions')).toBe('all');
  });
});
