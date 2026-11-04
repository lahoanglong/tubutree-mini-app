// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';

vi.mock('@/lib/shop-client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/shop-client')>()) }));

import { FulfilOrderCard } from './fulfil-orders-tab';

// M-sec: link tra cứu vận đơn do đối tác vận chuyển trả về, hiện nguyên văn thì `javascript:` chạy được khi bấm.
const order = (trackingLink: string | null) =>
  ({
    id: 'o1', code: 'TUBU1', status: 'SHIPPING', merchantAcceptedAt: '2026-11-01T00:00:00Z', shippingCode: 'VD123', shippingPartner: 'GHN', trackingLink,
    sla: { state: null, dueAt: null }, items: [], total: 100000, createdAt: '2026-11-01T00:00:00Z', paymentMethod: 'COD', paymentStatus: 'PENDING',
    recipient: 'An', phone: '0912345678', address: 'Hà Nội', cod: 100000,
  }) as unknown as Parameters<typeof FulfilOrderCard>[0]['order'];

let mounted: Rendered | null = null;
const mount = (link: string | null) => {
  mounted = render(<FulfilOrderCard order={order(link)} />);
  return mounted.container;
};
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('FulfilOrderCard — link tra cứu vận đơn', () => {
  it('https/http: dựng liên kết "Tra cứu" mở tab mới', () => {
    const a = mount('https://ghn.vn/tra-cuu?code=VD123').querySelector<HTMLAnchorElement>('a[href^="https://ghn.vn"]')!;
    expect(a.textContent).toBe('Tra cứu');
    expect(a.rel).toContain('noreferrer');
  });

  it.each(['javascript:alert(document.cookie)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'không phải url'])('"%s": không dựng liên kết nào', (bad) => {
    const c = mount(bad);
    expect(c.querySelector('a')).toBeNull();
    expect(c.innerHTML).not.toContain('javascript:');
    expect(c.textContent).toContain('VD123');
  });

  it('không có link: không dựng liên kết', () => {
    expect(mount(null).querySelector('a')).toBeNull();
  });
});
