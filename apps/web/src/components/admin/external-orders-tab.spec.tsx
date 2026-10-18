// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { ExternalOrdersTab } from './external-orders-tab';
import { click, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const ORDER = {
  id: 'x1',
  pancakeOrderId: '910001',
  source: 'MARKETPLACE',
  channel: 'shopee',
  sourceKey: '-3|shopee_gian_hang|-3',
  trackingCode: 'SPXVN0123456789',
  trackingCodes: ['SPXVN0123456789'],
  marketplaceOrderSn: '2410101ABCDEF',
  phone: '091****678',
  goodsValue: 320000,
  pancakeStatus: 3,
  status: 'DELIVERED',
  pancakeUpdatedAt: '2026-10-13T08:30:00.000Z',
  deliveredAt: '2026-10-13T08:30:00.000Z',
  firstSeenAt: '2026-10-13T08:31:00.000Z',
};

const SOURCES = {
  sources: [
    { sourceKey: '-3|shopee_gian_hang|-3', orderSources: '-3', account: 'shopee_gian_hang', marketplaceId: '-3', total: 5, bySource: { MARKETPLACE: 5 }, lastSeenAt: '2026-10-13T08:31:00.000Z', currentKind: 'MARKETPLACE', currentChannel: 'shopee' },
    { sourceKey: '-1|fanpage_mau|', orderSources: '-1', account: 'fanpage_mau', marketplaceId: '', total: 2, bySource: { UNKNOWN: 2 }, lastSeenAt: null, currentKind: 'UNKNOWN', currentChannel: null },
  ],
  truncated: false,
};

function stub(over: { orders?: unknown[]; total?: number; detail?: unknown } = {}) {
  const orders = over.orders ?? [ORDER];
  const m = mockFetch({
    '/admin/external-orders/sources': { body: SOURCES },
    '/admin/external-orders/x1': { body: over.detail ?? { ...ORDER, lastPayload: { id: 910001, bill_phone_number: '0912345678' } } },
    '/admin/external-orders?': { body: { data: orders, meta: { page: 1, limit: 20, total: over.total ?? orders.length } } },
  });
  vi.stubGlobal('fetch', vi.fn(m.fn));
  return m;
}

describe('ExternalOrdersTab (Đơn ngoài app)', () => {
  it('mỗi đơn: mã vận đơn, sàn, trạng thái, SĐT che, tiền hàng, khoá nguồn', async () => {
    stub();
    const { container } = mount(<ExternalOrdersTab isAdmin />);
    await flush();
    const rows = container.querySelectorAll<HTMLElement>('[data-external-order]');
    expect(rows).toHaveLength(1);
    const t = rows[0]!.textContent ?? '';
    expect(t).toContain('SPXVN0123456789');
    expect(t).toContain('Đơn sàn · shopee');
    expect(t).toContain('Đã giao');
    expect(t).toContain('091****678');
    expect(t).toContain('320.000');
    expect(t).toContain('2410101ABCDEF');
    expect(t).toContain('-3|shopee_gian_hang|-3');
    expect(container.textContent).toContain('1 đơn');
    expect(container.textContent).not.toContain('0912345678');
  });

  it('bảng Nguồn đã thấy: khoá, số đơn và loại đang xếp; nguồn chưa biết nổi bật', async () => {
    stub();
    const { container } = mount(<ExternalOrdersTab isAdmin={false} />);
    await flush();
    const keys = container.querySelectorAll<HTMLElement>('[data-source-key]');
    expect(keys).toHaveLength(2);
    expect(keys[0]!.textContent).toContain('-3|shopee_gian_hang|-3');
    expect(keys[0]!.textContent).toContain('5');
    expect(keys[0]!.textContent).toContain('Đơn sàn · shopee');
    expect(keys[1]!.textContent).toContain('-1|fanpage_mau|');
    expect(keys[1]!.textContent).toContain('Chưa biết nguồn');
    expect(keys[1]!.querySelector('span')!.className).toContain('bg-warning-bg');
  });

  it('tìm kiếm và bộ lọc gửi lên API; bỏ khoảng trắng đầu cuối', async () => {
    const m = stub();
    const { container } = mount(<ExternalOrdersTab isAdmin={false} />);
    await flush();
    typeInto(container.querySelector('input[type="search"]'), '  spx-123 ');
    selectValue(container.querySelector('select[aria-label="Lọc theo nguồn"]'), 'CHAT');
    selectValue(container.querySelector('select[aria-label="Lọc theo trạng thái"]'), 'OPEN');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    await flush();
    const url = m.calls.map((c) => c.url).reverse().find((u) => u.includes('/admin/external-orders?'))!;
    expect(url).toContain('q=spx-123');
    expect(url).toContain('source=CHAT');
    expect(url).toContain('status=OPEN');
  });

  it('chưa có đơn: nói rõ, có bộ lọc mà không khớp: nói khác', async () => {
    stub({ orders: [] });
    const { container } = mount(<ExternalOrdersTab isAdmin={false} />);
    await flush();
    expect(container.textContent).toContain('Chưa nhận được đơn ngoài app nào từ Pancake.');
    selectValue(container.querySelector('select[aria-label="Lọc theo nguồn"]'), 'CHAT');
    await flush();
    expect(container.textContent).toContain('Không có đơn nào khớp bộ lọc.');
  });

  it('ADMIN xem được payload Pancake, nhân viên thì không có nút', async () => {
    stub();
    const admin = mount(<ExternalOrdersTab isAdmin />);
    await flush();
    const btn = [...admin.container.querySelectorAll('button')].find((b) => b.textContent === 'Xem payload Pancake')!;
    click(btn);
    await flush();
    expect(admin.container.querySelector('[data-raw-payload]')!.textContent).toContain('"id": 910001');

    const staff = mount(<ExternalOrdersTab isAdmin={false} />);
    await flush();
    expect([...staff.container.querySelectorAll('button')].some((b) => b.textContent?.includes('payload'))).toBe(false);
  });

  it('còn trang sau thì có nút Tải thêm', async () => {
    stub({ orders: [ORDER], total: 45 });
    const { container } = mount(<ExternalOrdersTab isAdmin={false} />);
    await flush();
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Tải thêm')).toBe(true);
  });
});
