// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CustomerRefundsTab } from './customer-refunds-tab';
import { byText, click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import type { AdminCustomerRefund } from '@/lib/admin-client';

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

const refund = (over: Partial<AdminCustomerRefund> = {}): AdminCustomerRefund => ({
  id: 'r1',
  orderId: 'o1',
  orderCode: 'TT-20261001-0001',
  amount: 1_250_000,
  phone: '0912345678',
  recipientName: 'Trần Thị B',
  customerUserId: null,
  method: 'MANUAL_TRANSFER',
  status: 'PENDING',
  reason: 'CANCELLED',
  completedAt: null,
  completedBy: null,
  bankRef: null,
  adminNote: null,
  createdAt: '2026-10-01T03:00:00.000Z',
  ...over,
});

const page = (data: AdminCustomerRefund[], total = data.length, p = 1) => ({ data, meta: { page: p, limit: 20, total } });
const LIST = (data: AdminCustomerRefund[], total = data.length) => ({
  '/admin/customer-refunds': { body: page(data, total) },
});
const fmt = (iso: string) => new Date(iso).toLocaleString('vi-VN');

// Q-01 (PA-1): khoản hoàn MANUAL_TRANSFER PENDING là tiền Tubu đang nợ khách cuối không có tài khoản. Màn này
// chỉ đọc sổ (admin chuyển khoản tay ngoài hệ thống), nên phải hiển thị đủ để admin chuyển đúng người, đúng số tiền.
describe('CustomerRefundsTab — danh sách', () => {
  it('mặc định lọc PENDING, gọi đúng endpoint admin, có khung chờ khi đang tải', async () => {
    const api = mockFetch(LIST([refund()]));
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<CustomerRefundsTab />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await flush();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.url).toContain('/admin/customer-refunds?');
    expect(api.calls[0]!.url).toContain('status=PENDING');
    expect(api.calls[0]!.url).toContain('page=1');
    expect(api.calls[0]!.url).toContain('limit=20');
  });

  it('dòng chờ chuyển khoản: mã đơn, tên, SĐT, số tiền, lý do, ngày tạo, nút chép SĐT', async () => {
    const api = mockFetch(LIST([refund()]));
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('TT-20261001-0001');
    expect(text).toContain('Trần Thị B');
    expect(text).toContain('0912345678');
    expect(text).toContain('1.250.000đ');
    expect(text).toContain('Đơn bị huỷ');
    expect(text).toContain('Chuyển khoản thủ công');
    expect(text).toContain(fmt('2026-10-01T03:00:00.000Z'));
    expect(container.querySelector('[data-refund-status="PENDING"]')?.textContent).toContain('Chờ chuyển khoản');
    const copy = container.querySelector('button[aria-label*="0912345678"]');
    expect(copy).not.toBeNull();
    // Mục sau (nút "Đã chuyển khoản" + hộp xác nhận) chưa có trong lượt này.
    expect(byText(container, 'button', 'Đã chuyển khoản')).toBeNull();
  });

  it('lý do RETURNED hiển thị "Đơn trả hàng"; lý do lạ hiển thị nguyên văn, không rỗng', async () => {
    const api = mockFetch(
      LIST([refund({ id: 'r1', reason: 'RETURNED' }), refund({ id: 'r2', orderId: 'o2', orderCode: 'TT-2', reason: 'WEIRD' })]),
    );
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('Đơn trả hàng');
    expect(text).toContain('WEIRD');
  });

  it('thiếu SĐT/tên: báo rõ thay vì để trống, không có nút chép', async () => {
    const api = mockFetch(LIST([refund({ phone: null, recipientName: null })]));
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('Chưa có SĐT');
    expect(text).toContain('Chưa có tên');
    expect(container.querySelector('button[aria-label*="Chép SĐT"]')).toBeNull();
  });

  it('dòng WALLET: "Đã hoàn vào ví", không có thao tác chuyển khoản', async () => {
    const api = mockFetch(
      LIST([refund({ method: 'WALLET', status: 'COMPLETED', customerUserId: 'u9', completedAt: '2026-10-01T03:00:05.000Z' })]),
    );
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const card = container.querySelector('[data-refund-id="r1"]') as HTMLElement;
    expect(card.querySelector('[data-refund-status="WALLET"]')?.textContent).toContain('Đã hoàn vào ví');
    expect(card.textContent).not.toContain('Chuyển khoản thủ công');
    expect(card.textContent).not.toContain('Chờ chuyển khoản');
    expect(byText(card, 'button', 'Đã chuyển khoản')).toBeNull();
  });

  it('dòng COMPLETED chuyển khoản: ngày chuyển, mã tham chiếu, ghi chú, admin xác nhận', async () => {
    const api = mockFetch(
      LIST([
        refund({
          status: 'COMPLETED',
          completedAt: '2026-10-02T08:30:00.000Z',
          completedBy: 'admin_cuid_1',
          bankRef: 'FT26275123456',
          adminNote: 'Chuyển qua VCB lúc 15h',
        }),
      ]),
    );
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const text = container.textContent ?? '';
    expect(container.querySelector('[data-refund-status="COMPLETED"]')?.textContent).toContain('Đã chuyển khoản');
    expect(text).toContain(fmt('2026-10-02T08:30:00.000Z'));
    expect(text).toContain('FT26275123456');
    expect(text).toContain('Chuyển qua VCB lúc 15h');
    expect(text).toContain('admin_cuid_1');
    expect(byText(container, 'button', 'Đã chuyển khoản')).toBeNull();
  });

  it('COMPLETED không có mã tham chiếu/ghi chú: không in nhãn trống', async () => {
    const api = mockFetch(LIST([refund({ status: 'COMPLETED', completedAt: '2026-10-02T08:30:00.000Z', completedBy: 'a1' })]));
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const text = container.querySelector('[data-refund-id="r1"]')?.textContent ?? '';
    expect(text).toContain('Đã chuyển lúc');
    expect(text).not.toContain('Mã tham chiếu');
    expect(text).not.toContain('Ghi chú');
  });
});

describe('CustomerRefundsTab — bộ lọc, phân trang, trạng thái', () => {
  it('thanh lọc: "Chờ chuyển khoản" đang chọn, chip 44px; bấm "Đã chuyển" gọi status=COMPLETED trang 1', async () => {
    const api = mockFetch(LIST([]));
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLElement[];
    expect(tabs.map((t) => t.textContent)).toEqual(['Chờ chuyển khoản', 'Đã chuyển']);
    for (const t of tabs) expect(t.className).toContain('min-h-[44px]');
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]!.className).toContain('bg-forest-600');
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('false');

    click(tabs[1]!);
    await flush();
    const last = api.calls[api.calls.length - 1]!.url;
    expect(last).toContain('status=COMPLETED');
    expect(last).toContain('page=1');
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
  });

  it('trạng thái rỗng: nói rõ không có khoản nào đang chờ (PENDING) hoặc chưa có khoản đã xử lý (COMPLETED)', async () => {
    const api = mockFetch(LIST([]));
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    expect(container.textContent).toContain('Không có khoản hoàn nào đang chờ');
    click(byText(container, '[role="tab"]', 'Đã chuyển'));
    await flush();
    expect(container.textContent).toContain('Chưa có khoản hoàn nào đã xử lý');
    expect(container.textContent).not.toContain('Không có khoản hoàn nào đang chờ');
  });

  it('lỗi tải: báo bằng role=alert, "Thử lại" gọi lại (hiện khung chờ) rồi hiện danh sách', async () => {
    let fail = true;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (fail) return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
        await gate;
        return new Response(JSON.stringify(page([refund()])), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Không tải được/);
    expect(container.textContent).not.toContain('Không có khoản hoàn nào đang chờ');
    fail = false;
    click(byText(container, 'button', 'Thử lại'));
    await flush(1);
    // Đang gọi lại: thay thông báo lỗi bằng khung chờ, không để admin bấm lặp hay nhìn thông báo cũ.
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    release();
    await flush();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('TT-20261001-0001');
  });

  it('phân trang: Trang 1/3, "Sau →" gọi page=2, "← Trước" tắt ở trang 1; đổi bộ lọc về trang 1', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        const p = Number(/page=(\d+)/.exec(url)?.[1] ?? 1);
        return new Response(JSON.stringify(page([refund({ id: `r${p}`, orderCode: `TT-P${p}` })], 45, p)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    expect(container.textContent).toContain('Trang 1/3');
    expect(container.textContent).toContain('45');
    expect((byText(container, 'button', 'Trước') as HTMLButtonElement).disabled).toBe(true);

    click(byText(container, 'button', 'Sau'));
    await flush();
    expect(calls[calls.length - 1]).toContain('page=2');
    expect(container.textContent).toContain('Trang 2/3');
    expect(container.textContent).toContain('TT-P2');

    click(byText(container, '[role="tab"]', 'Đã chuyển'));
    await flush();
    expect(calls[calls.length - 1]).toContain('status=COMPLETED');
    expect(calls[calls.length - 1]).toContain('page=1');
  });

  it('không hiện thanh phân trang khi chỉ có một trang', async () => {
    const api = mockFetch(LIST([refund()], 1));
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    expect(byText(container, 'button', 'Sau')).toBeNull();
    expect(container.textContent).toMatch(/Tổng:\s*1/);
  });

  it('trang hiện tại vượt quá số trang (dòng cuối vừa xử lý xong): tự lùi về trang cuối, không kẹt ở màn rỗng', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        const p = Number(/page=(\d+)/.exec(url)?.[1] ?? 1);
        const body = p === 1 ? page([refund()], 21, 1) : page([], 20, p);
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    click(byText(container, 'button', 'Sau'));
    await flush(8);
    expect(calls.filter((u) => u.includes('page=2'))).toHaveLength(1);
    expect(calls[calls.length - 1]).toContain('page=1');
    expect(container.textContent).toContain('TT-20261001-0001');
  });
});

describe('CustomerRefundsTab — an toàn dữ liệu', () => {
  it('chỉ gọi endpoint admin/customer-refunds bằng GET; không ghi, không log SĐT ra console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const api = mockFetch(LIST([refund(), refund({ id: 'r2', orderId: 'o2', status: 'COMPLETED', completedAt: '2026-10-02T08:30:00.000Z' })]));
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    click(byText(container, '[role="tab"]', 'Đã chuyển'));
    await flush();
    for (const c of api.calls) {
      expect(c.url).toContain('/admin/customer-refunds');
      expect(c.init?.method ?? 'GET').toBe('GET');
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it('tên/ghi chú chứa HTML hiển thị như chữ thuần, không dựng phần tử', async () => {
    const api = mockFetch(
      LIST([
        refund({
          status: 'COMPLETED',
          completedAt: '2026-10-02T08:30:00.000Z',
          recipientName: '<img src=x onerror=alert(1)>',
          adminNote: '<script>alert(1)</script>',
        }),
      ]),
    );
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });
});

// C-097 (Q-25): layout xếp dọc theo thẻ nên 390px không tràn ngang; chữ dài (mã đơn, mã tham chiếu) được ngắt.
describe('CustomerRefundsTab — DS v2 / 390px', () => {
  it('thẻ dòng dùng token DS v2; mã đơn/mã tham chiếu/ghi chú ngắt dòng được', async () => {
    const api = mockFetch(
      LIST([refund({ status: 'COMPLETED', completedAt: '2026-10-02T08:30:00.000Z', bankRef: 'FT26275123456', adminNote: 'x'.repeat(300) })]),
    );
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const card = container.querySelector('[data-refund-id="r1"]') as HTMLElement;
    expect(card.className).toContain('border-stone-200');
    expect(card.className).toContain('bg-stone-0');
    expect(card.className).toContain('min-w-0');
    expect(byText(card, 'span', 'TT-20261001-0001')?.className).toContain('break-all');
    expect(byText(card, 'span', 'FT26275123456')?.className).toContain('break-all');
    expect(byText(card, 'span', 'xxxxxxxxxx')?.className).toContain('break-words');
    expect(container.querySelector('span.bg-warning-bg, span.bg-success-bg')).not.toBeNull();
  });
});
