// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';

vi.mock('@/lib/shop-client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/shop-client')>()) }));

import { FulfilOrderCard } from './fulfil-orders-tab';

// "Hàng cần gửi" là danh sách đối tác đọc để đóng gói: tên phân loại trống hoặc "[object Object]" không được để lại "()" treo hay lộ chuỗi đó.
const item = (id: string, productName: string, variationName: string | null) => ({ id, productName, variationName, quantity: 2, unitPrice: 100000, total: 200000 });
const order = (items: ReturnType<typeof item>[]) =>
  ({
    id: 'o1', code: 'TUBU1', status: 'CONFIRMED', merchantAcceptedAt: null, shippingCode: null, shippingPartner: null, trackingLink: null,
    sla: { state: null, dueAt: null }, items, total: 100000, createdAt: '2026-11-01T00:00:00Z', paymentMethod: 'COD', paymentStatus: 'PENDING',
    recipient: 'An', phone: '0912345678', address: 'Hà Nội', cod: 100000,
  }) as unknown as Parameters<typeof FulfilOrderCard>[0]['order'];

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('FulfilOrderCard: dòng "Hàng cần gửi"', () => {
  it('phân loại thật hiện trong ngoặc; "Mặc định", trống, null, "[object Object]" thì ẩn; chuỗi lẫn sau tên thật được gỡ', () => {
    mounted = render(
      <FulfilOrderCard
        order={order([
          item('a', 'Mật ong', '500g'),
          item('b', 'Trà Shan', 'Mặc định'),
          item('c', 'Bột sắn', '   '),
          item('d', 'Nghệ', null),
          item('e', 'Tiêu', '[object Object]'),
          item('f', 'Dầu dừa', 'Can 5L [object Object]'),
        ])}
      />,
    );
    const lines = Array.from(mounted.container.querySelectorAll('li')).map((li) => (li.textContent ?? '').replace(/\s+/g, ' ').trim());
    expect(lines).toEqual(['Mật ong (500g) x2', 'Trà Shan x2', 'Bột sắn x2', 'Nghệ x2', 'Tiêu x2', 'Dầu dừa (Can 5L) x2']);
    expect(mounted.container.textContent).not.toContain('[object Object]');
  });
});
