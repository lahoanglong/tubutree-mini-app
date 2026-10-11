// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { CustomerRefundsPendingBadge, CustomerRefundsTab } from './customer-refunds-tab';
import { byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
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
    expect(byText(container, 'button', 'Đã chuyển khoản')).not.toBeNull();
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


// Q-01: ghi nhận admin ĐÃ chuyển khoản tay. Đây là thao tác ghi sổ tiền một lần (PENDING -> COMPLETED, thua race trả
// 400) nên phải có hộp xác nhận nêu rõ số tiền/SĐT/tên, chống bấm lặp, và không đóng hộp khi lỗi mạng.
describe('CustomerRefundsTab — Đã chuyển khoản', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const STALE = 'Khoản hoàn không còn chờ chuyển khoản hoặc vừa được xử lý — vui lòng tải lại.';

  /** GET trả `list()` hiện tại (đổi được sau khi ghi); POST mark-paid đi qua `pay`. */
  function stub(opts: { list: () => AdminCustomerRefund[]; pay?: (init?: RequestInit) => Response | Promise<Response> }) {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.includes('/mark-paid')) return opts.pay ? opts.pay(init) : json({ id: 'r1', status: 'COMPLETED' });
        return json(page(opts.list()));
      }),
    );
    return {
      calls,
      pays: () => calls.filter((c) => c.url.includes('/mark-paid')),
      lists: () => calls.filter((c) => !c.url.includes('/mark-paid')),
    };
  }
  const openDialog = async (container: HTMLElement) => {
    click(byText(container, 'button', 'Đã chuyển khoản'));
    await flush(1);
    return confirmDialog()!;
  };
  const field = (d: HTMLElement, name: 'bankRef' | 'note') => d.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement;
  const accept = (d: HTMLElement) => d.querySelector('[data-confirm="accept"]') as HTMLButtonElement;
  const cancel = (d: HTMLElement) => d.querySelector('[data-confirm="cancel"]') as HTMLButtonElement;
  const esc = () =>
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

  it('chỉ dòng MANUAL_TRANSFER + PENDING có nút; nút cao 44px ở điện thoại', async () => {
    const api = mockFetch(
      LIST([
        refund({ id: 'r1' }),
        refund({ id: 'r2', orderId: 'o2', method: 'WALLET', status: 'COMPLETED', customerUserId: 'u9' }),
        refund({ id: 'r3', orderId: 'o3', status: 'COMPLETED', completedAt: '2026-10-02T08:30:00.000Z' }),
      ]),
    );
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const btn = (id: string) => byText(container.querySelector(`[data-refund-id="${id}"]`) as HTMLElement, 'button', 'Đã chuyển khoản');
    expect(btn('r1')).not.toBeNull();
    expect(btn('r1')!.className).toContain('min-h-[44px]');
    expect(btn('r2')).toBeNull();
    expect(btn('r3')).toBeNull();
  });

  it('bấm nút mở hộp xác nhận nêu số tiền, tên, SĐT, mã đơn; chưa gửi gì; có ô mã giao dịch (<=100) và ghi chú (<=500)', async () => {
    const api = stub({ list: () => [refund()] });
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const d = await openDialog(container);
    expect(d).not.toBeNull();
    expect(d.getAttribute('role')).toBe('alertdialog');
    const text = d.textContent ?? '';
    expect(text).toContain('1.250.000đ');
    expect(text).toContain('Trần Thị B');
    expect(text).toContain('0912345678');
    expect(text).toContain('TT-20261001-0001');
    expect(text).toContain('không tự chuyển tiền');
    expect(field(d, 'bankRef').maxLength).toBe(100);
    expect(field(d, 'note').maxLength).toBe(500);
    expect(d.textContent).toContain('Mã giao dịch ngân hàng');
    expect(d.textContent).toContain('Ghi chú');
    expect(document.activeElement).toBe(field(d, 'bankRef'));
    expect(api.pays()).toHaveLength(0);
  });

  it('Huỷ / Escape / bấm nền: đóng hộp, không gửi gì, mở lại thì ô nhập trống', async () => {
    const api = stub({ list: () => [refund()] });
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    let d = await openDialog(container);
    typeInto(field(d, 'bankRef'), 'FT999');
    click(cancel(d));
    await flush(1);
    expect(confirmDialog()).toBeNull();
    d = await openDialog(container);
    expect(field(d, 'bankRef').value).toBe('');
    esc();
    await flush(1);
    expect(confirmDialog()).toBeNull();
    d = await openDialog(container);
    click(document.querySelector('[data-confirm-backdrop]'));
    await flush(1);
    expect(confirmDialog()).toBeNull();
    expect(api.pays()).toHaveLength(0);
  });

  it('xác nhận: POST đúng id với mã tham chiếu + ghi chú đã cắt khoảng trắng, đóng hộp, tải lại danh sách, báo thành công', async () => {
    let paid = false;
    const api = stub({
      list: () => (paid ? [] : [refund()]),
      pay: () => {
        paid = true;
        return json({ id: 'r1', status: 'COMPLETED' });
      },
    });
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const d = await openDialog(container);
    typeInto(field(d, 'bankRef'), '  FT26275123456  ');
    typeInto(field(d, 'note'), ' Chuyển VCB 15h ');
    click(accept(d));
    await flush();
    const pays = api.pays();
    expect(pays).toHaveLength(1);
    expect(pays[0]!.url).toContain('/admin/customer-refunds/r1/mark-paid');
    expect(pays[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(pays[0]!.init?.body))).toEqual({ bankRef: 'FT26275123456', note: 'Chuyển VCB 15h' });
    expect(confirmDialog()).toBeNull();
    // Danh sách tải lại sau khi ghi (lần đầu + lần sau mark-paid).
    expect(api.lists().length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('[data-refund-id="r1"]')).toBeNull();
    const ok = container.querySelector('[role="status"]:not([aria-busy])');
    expect(ok?.textContent).toContain('Đã ghi nhận chuyển khoản');
    expect(ok?.textContent).toContain('1.250.000đ');
    expect(container.textContent).toContain('Không có khoản hoàn nào đang chờ');
  });

  it('để trống hai ô (hoặc chỉ khoảng trắng): gửi body {} — không gửi chuỗi rỗng', async () => {
    const api = stub({ list: () => [refund()] });
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const d = await openDialog(container);
    typeInto(field(d, 'note'), '   ');
    click(accept(d));
    await flush();
    expect(JSON.parse(String(api.pays()[0]!.init?.body))).toEqual({});
  });

  it('chống bấm lặp: đang gửi thì nút xác nhận/huỷ/ô nhập bị khoá, bấm thêm vẫn chỉ một POST, Escape/nền không đóng hộp', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const api = stub({
      list: () => [refund()],
      pay: async () => {
        await gate;
        return json({ id: 'r1', status: 'COMPLETED' });
      },
    });
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const d = await openDialog(container);
    click(accept(d));
    await flush(1);
    expect(accept(d).disabled).toBe(true);
    expect(cancel(d).disabled).toBe(true);
    expect(field(d, 'bankRef').disabled).toBe(true);
    expect(accept(d).textContent).toContain('Đang lưu');
    click(accept(d));
    click(accept(d));
    esc();
    click(document.querySelector('[data-confirm-backdrop]'));
    await flush(1);
    expect(confirmDialog()).not.toBeNull();
    expect(api.pays()).toHaveLength(1);
    release();
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(api.pays()).toHaveLength(1);
  });

  it('thua race (400 "không còn chờ"): hiện đúng thông báo của API, đóng hộp, tải lại danh sách', async () => {
    let stale = false;
    const api = stub({
      list: () => (stale ? [] : [refund()]),
      pay: () => {
        stale = true;
        return json({ statusCode: 400, message: STALE }, 400);
      },
    });
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const before = api.lists().length;
    const d = await openDialog(container);
    click(accept(d));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(STALE);
    expect(api.lists().length).toBeGreaterThan(before);
    expect(container.querySelector('[data-refund-id="r1"]')).toBeNull();
    expect(container.textContent).not.toContain('Đã ghi nhận chuyển khoản');
  });

  it('lỗi mạng: KHÔNG đóng hộp, báo thử lại bằng tiếng Việt, mở khoá nút; bấm lại thành công thì mới đóng', async () => {
    let offline = true;
    let paid = false;
    const api = stub({
      list: () => (paid ? [] : [refund()]),
      pay: () => {
        if (offline) throw new TypeError('Failed to fetch');
        paid = true;
        return json({ id: 'r1', status: 'COMPLETED' });
      },
    });
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const d = await openDialog(container);
    typeInto(field(d, 'bankRef'), 'FT1');
    click(accept(d));
    await flush();
    expect(confirmDialog()).toBe(d);
    expect(d.querySelector('[role="alert"]')?.textContent).toContain('Không kết nối được');
    expect(d.querySelector('[role="alert"]')?.textContent).toContain('thử lại');
    expect(accept(d).disabled).toBe(false);
    expect(field(d, 'bankRef').value).toBe('FT1');
    expect(container.querySelector('[data-refund-id="r1"]')).not.toBeNull();

    offline = false;
    click(accept(d));
    await flush();
    expect(api.pays()).toHaveLength(2);
    expect(confirmDialog()).toBeNull();
    expect(container.querySelector('[data-refund-id="r1"]')).toBeNull();
  });

  it('lỗi 5xx: giữ hộp, báo tiếng Việt (không lộ "Internal server error"), cho thử lại', async () => {
    stub({ list: () => [refund()], pay: () => json({ statusCode: 500, message: 'Internal server error' }, 500) });
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const d = await openDialog(container);
    click(accept(d));
    await flush();
    expect(confirmDialog()).toBe(d);
    const alert = d.querySelector('[role="alert"]')?.textContent ?? '';
    expect(alert).toContain('Máy chủ');
    expect(alert).not.toContain('Internal server error');
    expect(accept(d).disabled).toBe(false);
  });

  it('403: giữ hộp, báo không có quyền bằng tiếng Việt', async () => {
    stub({ list: () => [refund()], pay: () => json({ statusCode: 403, message: 'Forbidden resource' }, 403) });
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const d = await openDialog(container);
    click(accept(d));
    await flush();
    expect(confirmDialog()).toBe(d);
    expect(d.querySelector('[role="alert"]')?.textContent).toContain('quyền');
    expect(d.textContent).not.toContain('Forbidden resource');
  });

  it('ghi xong rồi bấm lại không được: dòng vừa ghi không còn nút trong lúc chờ danh sách tải lại', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let listCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/mark-paid')) return json({ id: 'r1', status: 'COMPLETED' });
        listCalls++;
        if (listCalls > 1) await gate;
        return json(page([refund()]));
      }),
    );
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const d = await openDialog(container);
    click(accept(d));
    await flush();
    const card = container.querySelector('[data-refund-id="r1"]') as HTMLElement;
    expect(confirmDialog()).toBeNull();
    expect(byText(card, 'button', 'Đã chuyển khoản')).toBeNull();
    expect(card.textContent).toContain('Đã ghi nhận');
    release();
    await flush();
  });

  it('huy hiệu số khoản chờ: lấy meta.total bằng một lần gọi limit=1, tự giảm sau khi ghi xong; lỗi tải thì không hiện gì', async () => {
    let paid = false;
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes('/mark-paid')) {
          paid = true;
          return json({ id: 'r1', status: 'COMPLETED' });
        }
        const limit = Number(new URL(url, 'http://x').searchParams.get('limit'));
        const rows = paid ? [] : [refund()];
        return json({ data: rows.slice(0, limit), meta: { page: 1, limit, total: rows.length } });
      }),
    );
    const { container } = mount(
      <>
        <span id="badge-slot">
          <CustomerRefundsPendingBadge />
        </span>
        <CustomerRefundsTab />
      </>,
    );
    await flush();
    const badge = () => container.querySelector('[data-refunds-pending]');
    expect(badge()?.textContent).toContain('1');
    expect(urls.some((u) => u.includes('status=PENDING') && u.includes('limit=1'))).toBe(true);
    const d = await openDialog(container);
    click(accept(d));
    await flush();
    expect(badge()).toBeNull();
  });

  it('huy hiệu: lỗi tải số đếm thì ẩn, không ném lỗi ra thanh tab', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ statusCode: 500, message: 'x' }, 500)));
    const { container } = mount(<CustomerRefundsPendingBadge />);
    await flush();
    expect(container.querySelector('[data-refunds-pending]')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('an toàn: id đi qua encodeURIComponent, body không chứa SĐT/tên, không log console, tên chứa HTML hiện như chữ', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const api = stub({ list: () => [refund({ id: 'r/1?x', recipientName: '<img src=x onerror=alert(1)>' })] });
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const d = await openDialog(container);
    expect(d.querySelector('img')).toBeNull();
    expect(d.textContent).toContain('<img src=x onerror=alert(1)>');
    click(accept(d));
    await flush();
    const pay = api.pays()[0]!;
    expect(pay.url).toContain('/admin/customer-refunds/r%2F1%3Fx/mark-paid');
    expect(String(pay.init?.body)).not.toContain('0912345678');
    expect(String(pay.init?.body)).not.toContain('Trần');
    for (const c of api.calls) expect(c.url).toContain('/admin/customer-refunds');
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it('thiếu SĐT/tên: hộp xác nhận báo rõ "Chưa có SĐT"/"Chưa có tên" thay vì để trống', async () => {
    stub({ list: () => [refund({ phone: null, recipientName: null })] });
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const d = await openDialog(container);
    expect(d.textContent).toContain('Chưa có SĐT');
    expect(d.textContent).toContain('Chưa có tên');
  });

  it('hộp xác nhận dùng token DS v2 (nút cảnh báo, ô nhập 44px chạm), không palette stock', async () => {
    stub({ list: () => [refund()] });
    const { container } = mount(<CustomerRefundsTab />);
    await flush();
    const d = await openDialog(container);
    expect(d.className).toContain('bg-stone-0');
    expect(accept(d).className).toContain('bg-warning-fg');
    expect(accept(d).className).toContain('min-h-[44px]');
    expect(cancel(d).className).toContain('min-h-[44px]');
    expect(d.parentElement!.className).toContain('z-[100]');
  });

  // Đụng tiền: hộp xác nhận và lời gọi ghi phải thuộc ĐÚNG dòng được bấm, kể cả khi danh sách tải lại lúc hộp đang mở.
  describe('dòng được chọn', () => {
    const rowA = () => refund({ id: 'r1', orderId: 'o1', orderCode: 'TT-A', amount: 1_250_000, phone: '0912345678', recipientName: 'Trần Thị B' });
    const rowB = () => refund({ id: 'r2', orderId: 'o2', orderCode: 'TT-B', amount: 777_000, phone: '0987654321', recipientName: 'Lê Văn C' });
    const rowC = () => refund({ id: 'r3', orderId: 'o3', orderCode: 'TT-C', amount: 55_000, phone: '0900000003', recipientName: 'Phạm D' });
    const openRow = async (container: HTMLElement, id: string) => {
      click(byText(container.querySelector(`[data-refund-id="${id}"]`) as HTMLElement, 'button', 'Đã chuyển khoản'));
      await flush(1);
      return confirmDialog()!;
    };
    const expectDialogIsRowB = (d: HTMLElement) => {
      const text = d.textContent ?? '';
      expect(text).toContain('777.000đ');
      expect(text).toContain('Lê Văn C');
      expect(text).toContain('0987654321');
      expect(text).toContain('TT-B');
      expect(text).not.toContain('1.250.000đ');
      expect(text).not.toContain('Trần Thị B');
      expect(text).not.toContain('0912345678');
    };

    it('nhiều dòng chờ: bấm nút ở dòng thứ hai thì hộp nêu số tiền/tên/SĐT của dòng đó và POST đúng id của nó', async () => {
      const api = stub({ list: () => [rowA(), rowB()] });
      const { container } = mount(<CustomerRefundsTab />);
      await flush();
      const d = await openRow(container, 'r2');
      expectDialogIsRowB(d);
      click(accept(d));
      await flush();
      expect(api.pays()).toHaveLength(1);
      expect(api.pays()[0]!.url).toContain('/admin/customer-refunds/r2/mark-paid');
      expect(api.pays()[0]!.url).not.toContain('/r1/');
      expect(container.querySelector('[role="status"]:not([aria-busy])')?.textContent).toContain('777.000đ');
    });

    it('danh sách tải lại lúc hộp đang mở (dòng đầu biến mất, thứ tự đổi): hộp vẫn là dòng đã bấm và POST vẫn đúng id đó', async () => {
      let rows = [rowA(), rowB()];
      const holder: { qc?: QueryClient } = {};
      const Grab = () => {
        holder.qc = useQueryClient();
        return null;
      };
      const api = stub({ list: () => rows });
      const { container } = mount(
        <>
          <Grab />
          <CustomerRefundsTab />
        </>,
      );
      await flush();
      const d = await openRow(container, 'r2');
      expectDialogIsRowB(d);

      rows = [rowC()];
      const before = api.lists().length;
      await act(async () => {
        await holder.qc!.invalidateQueries();
      });
      await flush();
      expect(api.lists().length).toBeGreaterThan(before);
      expect(container.querySelector('[data-refund-id="r2"]')).toBeNull();
      expect(confirmDialog()).toBe(d);
      expectDialogIsRowB(d);

      click(accept(d));
      await flush();
      expect(api.pays()).toHaveLength(1);
      expect(api.pays()[0]!.url).toContain('/admin/customer-refunds/r2/mark-paid');
    });
  });
});
