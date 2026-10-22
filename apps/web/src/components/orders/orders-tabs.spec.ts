import { describe, expect, it } from 'vitest';
import { ORDERS_TABS, ORDERS_TAB_KEYS } from './orders-tabs';

describe('orders-tabs (Mini App orders-tabs.spec.ts)', () => {
  it('7 tab theo thứ tự, gồm Đang đóng gói (trong Đang xử lý), Đã hoàn (trong Đã huỷ/hoàn) và Định kỳ', () => {
    expect(ORDERS_TABS.map((t) => t.key)).toEqual(['all', 'pending_payment', 'processing', 'shipping', 'delivered', 'closed', 'subscriptions']);
    expect(ORDERS_TABS.map((t) => t.label)).toEqual(['Tất cả', 'Chờ thanh toán', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã huỷ/hoàn', 'Định kỳ']);
    expect(ORDERS_TABS.map((t) => t.filter)).toEqual([
      {}, { status: 'PENDING_PAYMENT' }, { group: 'processing' }, { status: 'SHIPPING' }, { status: 'DELIVERED' }, { group: 'closed' }, undefined,
    ]);
  });

  it('khoá tab dùng cho ?tab= khớp danh sách tab', () => {
    expect(ORDERS_TAB_KEYS).toEqual(ORDERS_TABS.map((t) => t.key));
  });
});
