import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/features', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), SUBSCRIPTIONS_IN_MINIAPP: true }));

import { ORDERS_TABS, ordersTabs, parseOrdersTab } from './orders-tabs';

describe('orders-tabs', () => {
  it('7 tab theo thứ tự, gồm Đang đóng gói (trong Đang xử lý), Đã hoàn (trong Đã huỷ/hoàn) và Định kỳ', () => {
    expect(ORDERS_TABS.map((t) => t.label)).toEqual([
      'Tất cả', 'Chờ thanh toán', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã huỷ/hoàn', 'Định kỳ',
    ]);
    expect(ORDERS_TABS.find((t) => t.key === 'processing')!.filter).toEqual({ group: 'processing' });
    expect(ORDERS_TABS.find((t) => t.key === 'closed')!.filter).toEqual({ group: 'closed' });
    expect(ORDERS_TABS.find((t) => t.key === 'subscriptions')!.filter).toBeUndefined();
  });
  it('cờ bật: tab Định kỳ luôn có, dù khách có gói hay chưa', () => {
    expect(ordersTabs(false).map((t) => t.key)).toContain('subscriptions');
    expect(ordersTabs(true).map((t) => t.key)).toContain('subscriptions');
    expect(ORDERS_TABS).toEqual(ordersTabs(false));
  });
  it('parseOrdersTab đọc ?tab=, giá trị lạ → all', () => {
    expect(parseOrdersTab('?tab=subscriptions')).toBe('subscriptions');
    expect(parseOrdersTab('?tab=processing&x=1')).toBe('processing');
    expect(parseOrdersTab('?tab=hack')).toBe('all');
    expect(parseOrdersTab('')).toBe('all');
  });
});
