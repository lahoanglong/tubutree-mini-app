// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OrderInvoicePanel, OrderShippingAddress, OrderStatusHistory } from './order-detail-extras';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminOrder } from '@/lib/admin-client';

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
  vi.restoreAllMocks();
});

const order = (over: Partial<AdminOrder> = {}): AdminOrder => ({
  id: 'o1',
  code: 'TB-500',
  status: 'DELIVERED',
  total: 300_000,
  paymentMethod: 'COD',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const REQUEST = { taxCode: '0312345678', companyName: 'Công ty ABC', address: '1 Lê Lợi, Q1', email: 'ketoan@abc.vn' };

// C-092 (A1-031): chi tiết đơn admin không hiện shippingAddress nên CSKH không tra được địa chỉ giao.
describe('OrderShippingAddress', () => {
  it('hiện người nhận, SĐT và địa chỉ ghép gọn (bỏ phần rỗng)', () => {
    const { container } = mount(
      <OrderShippingAddress
        order={order({ shippingAddress: { recipient: 'Nguyễn A', phone: '0900000001', street: '12 Lê Lợi', ward: 'Bến Nghé', district: '', province: 'TP. Hồ Chí Minh' } })}
      />,
    );
    const t = container.textContent ?? '';
    expect(t).toContain('Nguyễn A');
    expect(t).toContain('0900000001');
    expect(t).toContain('12 Lê Lợi, Bến Nghé, TP. Hồ Chí Minh');
    expect(t).not.toContain(', ,');
    expect(container.querySelector('section')?.getAttribute('aria-label')).toBe('Địa chỉ giao hàng');
  });

  it('đơn không có địa chỉ → nói rõ "chưa có", không để trống im lặng', () => {
    const { container } = mount(<OrderShippingAddress order={order({ shippingAddress: null })} />);
    expect(container.textContent).toMatch(/chưa có địa chỉ giao/i);
  });
});

describe('OrderStatusHistory', () => {
  const HISTORY = {
    orderCode: 'TB-500',
    history: [
      { id: 'h1', fromStatus: 'PENDING_PAYMENT', toStatus: 'CONFIRMED', actorType: 'ADMIN', actorId: 'a1', note: 'Admin xác nhận · Mã GD FT99', createdAt: '2026-10-01T02:00:00.000Z', actor: { id: 'a1', fullName: 'Thu Hà', phone: '0900000002' } },
      { id: 'h2', fromStatus: 'CONFIRMED', toStatus: 'SHIPPING', actorType: 'PANCAKE', actorId: null, note: null, createdAt: '2026-10-02T02:00:00.000Z', actor: null },
    ],
  };

  it('chỉ tải khi mở (không gọi API lúc render); mở → GET status-history rồi hiện từng dòng: ai, từ đâu sang đâu, ghi chú', async () => {
    const api = mockFetch({ '/status-history': { body: HISTORY } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<OrderStatusHistory order={order()} />);
    await flush();
    expect(api.calls).toHaveLength(0);

    click(byText(container, 'button', 'Lịch sử trạng thái'));
    await flush();
    expect(api.calls[0]!.url).toContain('/admin/orders/o1/status-history');
    const t = container.textContent ?? '';
    expect(t).toContain('Chờ thanh toán');
    expect(t).toContain('Đã xác nhận');
    expect(t).toContain('Admin · Thu Hà');
    expect(t).toContain('Admin xác nhận · Mã GD FT99');
    expect(t).toContain('Pancake');
    expect(t).toContain('Đang vận chuyển');
  });

  it('chưa có dòng nào → "Chưa có lịch sử"; lỗi API → báo lỗi + nút thử lại', async () => {
    const empty = mockFetch({ '/status-history': { body: { orderCode: 'TB-500', history: [] } } });
    vi.stubGlobal('fetch', vi.fn(empty.fn));
    const a = mount(<OrderStatusHistory order={order()} />);
    click(byText(a.container, 'button', 'Lịch sử trạng thái'));
    await flush();
    expect(a.container.textContent).toMatch(/chưa có lịch sử/i);

    const bad = mockFetch({ '/status-history': { status: 500, body: { message: 'Lỗi máy chủ' } } });
    vi.stubGlobal('fetch', vi.fn(bad.fn));
    const b = mount(<OrderStatusHistory order={order({ id: 'o2' })} />);
    click(byText(b.container, 'button', 'Lịch sử trạng thái'));
    await flush();
    expect(b.container.querySelector('[role="alert"]')?.textContent).toContain('Lỗi máy chủ');
    expect(byText(b.container, 'button', 'Thử lại')).not.toBeNull();
  });
});

// C-094 (A1-039): khách gửi yêu cầu VAT lúc thanh toán nhưng không có nơi nào để xử lý nốt.
describe('OrderInvoicePanel', () => {
  it('đơn không yêu cầu VAT → không render gì', () => {
    const { container } = mount(<OrderInvoicePanel order={order({ invoiceStatus: 'NOT_REQUESTED', invoiceRequest: null })} />);
    expect(container.textContent).toBe('');
  });

  it('hiện thông tin xuất hoá đơn (MST, công ty, địa chỉ, email) + nhãn "Chờ xuất hoá đơn"', () => {
    const { container } = mount(<OrderInvoicePanel order={order({ invoiceStatus: 'REQUESTED', invoiceRequest: REQUEST })} />);
    const t = container.textContent ?? '';
    expect(t).toContain('0312345678');
    expect(t).toContain('Công ty ABC');
    expect(t).toContain('1 Lê Lợi, Q1');
    expect(t).toContain('ketoan@abc.vn');
    expect(t).toContain('Chờ xuất hoá đơn');
    expect(byText(container, 'button', 'Đã xuất hoá đơn')).not.toBeNull();
  });

  it('đã xuất: hiện link hoá đơn, KHÔNG còn nút xuất', () => {
    const { container } = mount(
      <OrderInvoicePanel order={order({ invoiceStatus: 'ISSUED', invoiceRequest: REQUEST, invoiceUrl: 'https://hd.example.vn/1' })} />,
    );
    expect(container.textContent).toContain('Đã xuất hoá đơn');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://hd.example.vn/1');
    expect(container.querySelector('a')?.getAttribute('rel')).toContain('noopener');
    expect(container.querySelector('input')).toBeNull();
    expect(byText(container, 'button', 'Đã xuất hoá đơn')).toBeNull();
  });

  // invoiceUrl còn đến từ webhook Pancake (không kiểm giao thức) nên không tin được: chỉ https mới thành link bấm được.
  it.each(['javascript:alert(1)', 'http://hd.example.vn/1', 'data:text/html,<script>1</script>'])(
    'link hoá đơn không phải https (%s): hiện chữ thường, KHÔNG render thẻ <a>',
    (invoiceUrl) => {
      const { container } = mount(<OrderInvoicePanel order={order({ invoiceStatus: 'ISSUED', invoiceRequest: REQUEST, invoiceUrl })} />);
      expect(container.querySelector('a')).toBeNull();
      expect(container.textContent).toContain(invoiceUrl);
    },
  );

  it('đơn đã huỷ/trả: không cho xuất, nói rõ lý do', () => {
    const { container } = mount(<OrderInvoicePanel order={order({ status: 'CANCELLED', invoiceStatus: 'REQUESTED', invoiceRequest: REQUEST })} />);
    expect(container.textContent).toMatch(/huỷ|trả/);
    expect(container.querySelector('input')).toBeNull();
  });

  it('xuất: hộp thoại xác nhận — huỷ thì KHÔNG gọi API; đồng ý thì POST issue-invoice kèm link đã trim, hiện message API', async () => {
    const api = mockFetch({
      '/issue-invoice': { body: { ok: true, message: 'Đã ghi nhận xuất hóa đơn VAT cho đơn TB-500.', order: { id: 'o1', code: 'TB-500', invoiceStatus: 'ISSUED', invoiceUrl: 'https://hd.example.vn/abc' } } },
      '/admin/orders': { body: { data: [], meta: { page: 1, limit: 20, total: 0 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const native = vi.spyOn(window, 'confirm');
    const { container } = mount(<OrderInvoicePanel order={order({ invoiceStatus: 'REQUESTED', invoiceRequest: REQUEST })} />);
    typeInto(container.querySelector('input[aria-label="Link hoá đơn điện tử (tuỳ chọn)"]'), '  https://hd.example.vn/abc  ');
    click(byText(container, 'button', 'Đã xuất hoá đơn'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('TB-500');
    answerConfirm(false);
    await flush();
    expect(api.calls).toHaveLength(0);

    click(byText(container, 'button', 'Đã xuất hoá đơn'));
    await flush();
    answerConfirm(true);
    await flush();
    const post = api.calls.find((c) => c.init?.method === 'POST')!;
    expect(post.url).toContain('/admin/orders/o1/issue-invoice');
    expect(post.init?.body).toBe(JSON.stringify({ invoiceUrl: 'https://hd.example.vn/abc' }));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Đã ghi nhận xuất hóa đơn VAT cho đơn TB-500.');
    expect(native).not.toHaveBeenCalled();
  });

  it('không nhập link → body {}; link sai (http) → báo lỗi tại chỗ, không mở hộp thoại, không gọi API', async () => {
    const api = mockFetch({
      '/issue-invoice': { body: { ok: true, message: 'ok', order: { id: 'o1', code: 'TB-500', invoiceStatus: 'ISSUED', invoiceUrl: null } } },
      '/admin/orders': { body: { data: [], meta: { page: 1, limit: 20, total: 0 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<OrderInvoicePanel order={order({ invoiceStatus: 'REQUESTED', invoiceRequest: REQUEST })} />);
    typeInto(container.querySelector('input[aria-label="Link hoá đơn điện tử (tuỳ chọn)"]'), 'http://khong-an-toan.vn/1');
    click(byText(container, 'button', 'Đã xuất hoá đơn'));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/https/);
    expect(api.calls).toHaveLength(0);

    typeInto(container.querySelector('input[aria-label="Link hoá đơn điện tử (tuỳ chọn)"]'), '');
    click(byText(container, 'button', 'Đã xuất hoá đơn'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(api.calls.find((c) => c.init?.method === 'POST')!.init?.body).toBe('{}');
  });

  it('400 từ API (admin khác vừa xuất) → hiện NGUYÊN VĂN, không báo thành công; bấm dồn chỉ 1 request', async () => {
    const msg = 'Hóa đơn của đơn TB-500 vừa được phát hành bởi người khác — vui lòng tải lại.';
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          calls.push(url);
          await gate;
          return new Response(JSON.stringify({ message: msg }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ data: [], meta: { page: 1, limit: 20, total: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const { container } = mount(<OrderInvoicePanel order={order({ invoiceStatus: 'REQUESTED', invoiceRequest: REQUEST })} />);
    const btn = byText(container, 'button', 'Đã xuất hoá đơn') as HTMLButtonElement;
    click(btn);
    await flush();
    answerConfirm(true);
    await flush();
    click(btn);
    click(btn);
    await flush();
    expect(calls).toHaveLength(1);
    expect(btn.disabled).toBe(true);
    release();
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(msg);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
