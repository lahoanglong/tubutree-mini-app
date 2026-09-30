import { describe, it, expect } from 'vitest';
import { ORDERS_TABS, parseOrdersTab } from './orders-tabs';

describe('orders-tabs', () => {
  it('7 tab theo thứ tự, gồm Đang đóng gói (trong Đang xử lý), Đã hoàn (trong Đã hủy/hoàn) và Định kỳ', () => {
    expect(ORDERS_TABS.map((t) => t.label)).toEqual([
      'Tất cả', 'Chờ thanh toán', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã hủy/hoàn', 'Định kỳ',
    ]);
    expect(ORDERS_TABS.find((t) => t.key === 'processing')!.filter).toEqual({ group: 'processing' });
    expect(ORDERS_TABS.find((t) => t.key === 'closed')!.filter).toEqual({ group: 'closed' });
    expect(ORDERS_TABS.find((t) => t.key === 'subscriptions')!.filter).toBeUndefined();
  });
  it('parseOrdersTab đọc ?tab=, giá trị lạ → all', () => {
    expect(parseOrdersTab('?tab=subscriptions')).toBe('subscriptions');
    expect(parseOrdersTab('?tab=processing&x=1')).toBe('processing');
    expect(parseOrdersTab('?tab=hack')).toBe('all');
    expect(parseOrdersTab('')).toBe('all');
  });
});
