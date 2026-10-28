import { describe, it, expect } from 'vitest';
import { ORDERS_TABS, ordersTabs, parseOrdersTab } from './orders-tabs';

describe('orders-tabs khi giao định kỳ tạm ẩn ở Mini App (R-30)', () => {
  it('khách không có gói: không có tab Định kỳ và ?tab=subscriptions về Tất cả', () => {
    expect(ORDERS_TABS.map((t) => t.key)).not.toContain('subscriptions');
    expect(ordersTabs(false).map((t) => t.key)).not.toContain('subscriptions');
    expect(parseOrdersTab('?tab=subscriptions')).toBe('all');
    expect(parseOrdersTab('?tab=subscriptions', ordersTabs(false))).toBe('all');
  });

  it('khách đã có gói (đặt trên web): có tab Định kỳ ở cuối và ?tab=subscriptions mở đúng tab đó', () => {
    const tabs = ordersTabs(true);
    expect(tabs.map((t) => t.key)).toEqual(['all', 'pending_payment', 'processing', 'shipping', 'delivered', 'closed', 'subscriptions']);
    expect(tabs.find((t) => t.key === 'subscriptions')!.filter).toBeUndefined();
    expect(parseOrdersTab('?tab=subscriptions', tabs)).toBe('subscriptions');
    expect(parseOrdersTab('?tab=hack', tabs)).toBe('all');
  });

  it('các tab trạng thái giữ nguyên dù có gói hay không', () => {
    expect(ordersTabs(true).slice(0, 6)).toEqual(ordersTabs(false));
  });
});
