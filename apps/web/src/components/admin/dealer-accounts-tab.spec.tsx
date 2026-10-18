// @vitest-environment jsdom
import { act } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DealerAccountsTab } from './dealer-accounts-tab';
import { answerConfirm, byText, click, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import type { DealerAccountRow, DealerAccountsPage, DealerTiersView } from '@/lib/dealer-accounts-client';

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

const row = (over: Partial<DealerAccountRow> = {}): DealerAccountRow => ({
  userId: 'u1',
  fullName: 'Đại lý Hoa',
  phone: '0911222333',
  tier: { id: 'DEALER_2', name: 'Đại lý Cấp 2' },
  creditLimit: 5_000_000,
  debt: 4_000_000,
  overLimit: false,
  monthSales: 13_500_000,
  monthPending: 3_000_000,
  monthOrders: 5,
  ...over,
});
const ROWS = [
  row({ userId: 'u-over', fullName: 'Đại lý Quá Hạn', debt: 6_000_000, overLimit: true, monthSales: 0, monthPending: 0, monthOrders: 0 }),
  row(),
  row({ userId: 'u-clean', fullName: 'Đại lý Sạch', phone: null, tier: null, creditLimit: 0, debt: 0 }),
];
const page = (data: DealerAccountRow[], total = data.length, pageNo = 1): DealerAccountsPage => ({
  data,
  meta: { page: pageNo, limit: 20, total },
  month: '2026-10',
  summary: { totalDebt: 10_000_000, debtors: 2 },
});
const TIERS: DealerTiersView = {
  tiers: [
    { id: 'DEALER_2', name: 'Đại lý Cấp 2', minOrderVolume: 30_000_000, discountPct: 30, creditLimit: 5_000_000, paymentTerms: 'NET 15', dealerCount: 2 },
  ],
  maxDiscountPct: 45,
  dealersWithoutTier: 1,
};

function stub(accounts: DealerAccountsPage | ((url: string) => DealerAccountsPage) = page(ROWS)) {
  const rest = mockFetch({
    '/admin/dealer-tiers/manage': { body: TIERS },
    '/admin/dealer-tiers/history': { body: [] },
    '/credit-ledger': { body: { balance: 4_000_000, entries: [] } },
    '/credit-payment': { body: { balance: 2_000_000, entries: [] } },
  });
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (!url.includes('/admin/dealers/accounts')) return rest.fn(url, init);
    const body = typeof accounts === 'function' ? accounts(url) : accounts;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  vi.stubGlobal('fetch', vi.fn(fn));
  return { calls };
}
const accountCalls = (api: ReturnType<typeof stub>) => api.calls.filter((c) => c.url.includes('/admin/dealers/accounts'));

describe('DealerAccountsTab — danh sách đại lý đã duyệt (D1-06)', () => {
  it('hiện bậc, dư nợ / hạn mức, doanh số tháng, tổng nợ; đại lý vượt hạn mức có nhãn', async () => {
    const api = stub();
    const { container } = mount(<DealerAccountsTab />);
    expect(container.textContent).toContain('Đang tải danh sách đại lý…');
    await flush();
    expect(accountCalls(api)[0]!.url).toContain('page=1');
    const rows = container.querySelectorAll<HTMLElement>('[data-dealer-account]');
    expect(rows).toHaveLength(3);
    const over = rows[0]!.textContent!;
    expect(over).toContain('Đại lý Quá Hạn');
    expect(over).toContain('6.000.000');
    expect(over).toContain('Vượt hạn mức');
    const ok = rows[1]!.textContent!;
    expect(ok).toContain('0911222333');
    expect(ok).toContain('Đại lý Cấp 2');
    expect(ok).toContain('4.000.000');
    expect(ok).toContain('5.000.000');
    expect(ok).toContain('13.500.000');
    expect(ok).toContain('chờ chốt 3.000.000');
    expect(ok).not.toContain('Vượt hạn mức');
    expect(rows[2]!.textContent).toContain('Chưa gán bậc');
    const t = container.textContent!;
    expect(t).toContain('2 đại lý còn nợ');
    expect(t).toContain('10.000.000');
    expect(t).toContain('10/2026');
  });

  it('KE_TOAN (isAdmin=false): vẫn ghi nhận được tiền trả nợ nhưng không gọi API bậc đại lý, không có lọc bậc và phần sửa bậc (chỉ ADMIN)', async () => {
    const api = stub();
    const { container } = mount(<DealerAccountsTab isAdmin={false} />);
    await flush();
    expect(container.querySelectorAll('[data-dealer-account]')).toHaveLength(3);
    expect(api.calls.some((c) => c.url.includes('/admin/dealer-tiers'))).toBe(false);
    expect(container.querySelector('select[aria-label="Lọc đại lý theo bậc"]')).toBeNull();
    expect(byText(container, 'button', 'Ghi nhận thanh toán')).not.toBeNull();
  });

  it('nút "Ghi nhận thanh toán" mở sổ công nợ của đúng đại lý và dùng API ghi nhận tiền sẵn có; ghi xong thì tải lại danh sách', async () => {
    const api = stub();
    const { container } = mount(<DealerAccountsTab />);
    await flush();
    const target = container.querySelectorAll<HTMLElement>('[data-dealer-account]')[1]!;
    click(byText(target, 'button', 'Ghi nhận thanh toán'));
    await flush();
    expect(api.calls.some((c) => c.url.includes('/admin/dealers/u1/credit-ledger'))).toBe(true);
    typeInto(target.querySelector('input[aria-label="Số tiền đã nhận (đ)"]'), '2000000');
    click(byText(target, 'button', 'Xác nhận đã nhận, giảm nợ'));
    await flush();
    answerConfirm(true);
    await flush();
    const post = api.calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toContain('/admin/dealers/u1/credit-payment');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ amount: 2_000_000 });
    expect(accountCalls(api).length).toBeGreaterThanOrEqual(2);
  });

  it('đại lý hết nợ: nút ghi nhận khoá kèm lý do; bấm lần nữa đóng sổ', async () => {
    stub();
    const { container } = mount(<DealerAccountsTab />);
    await flush();
    const clean = container.querySelectorAll<HTMLElement>('[data-dealer-account]')[2]!;
    const btn = byText(clean, 'button', 'Ghi nhận thanh toán') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/không còn nợ/i);
    const owing = container.querySelectorAll<HTMLElement>('[data-dealer-account]')[1]!;
    const open = byText(owing, 'button', 'Ghi nhận thanh toán')!;
    click(open);
    await flush();
    expect(owing.querySelector('input[aria-label="Số tiền đã nhận (đ)"]')).not.toBeNull();
    expect(open.getAttribute('aria-expanded')).toBe('true');
    click(open);
    expect(owing.querySelector('input[aria-label="Số tiền đã nhận (đ)"]')).toBeNull();
  });

  it('bộ lọc: tìm theo tên/SĐT, theo bậc, chỉ còn nợ → gửi đúng tham số và về trang 1', async () => {
    const api = stub();
    const { container } = mount(<DealerAccountsTab />);
    await flush();
    typeInto(container.querySelector('input[aria-label="Tìm đại lý theo tên hoặc SĐT"]'), 'Hoa');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    await flush();
    expect(accountCalls(api).at(-1)!.url).toContain('search=Hoa');
    selectValue(container.querySelector('select[aria-label="Lọc đại lý theo bậc"]'), 'DEALER_2');
    await flush();
    expect(accountCalls(api).at(-1)!.url).toContain('tierId=DEALER_2');
    click(byText(container, 'button', 'Chỉ đại lý còn nợ'));
    await flush();
    const last = accountCalls(api).at(-1)!.url;
    expect(last).toContain('debtOnly=1');
    expect(last).toContain('page=1');
  });

  it('phân trang: tổng > 20 hiện "Trang 1/2", bấm Sau tải trang 2; trang đầu khoá nút Trước', async () => {
    const api = stub((url) => (url.includes('page=2') ? page([row({ userId: 'u21', fullName: 'Đại lý 21' })], 21, 2) : page(ROWS, 21)));
    const { container } = mount(<DealerAccountsTab />);
    await flush();
    expect(container.textContent).toContain('Trang 1/2');
    expect((byText(container, 'button', 'Trước') as HTMLButtonElement).disabled).toBe(true);
    click(byText(container, 'button', 'Sau'));
    await flush();
    expect(accountCalls(api).at(-1)!.url).toContain('page=2');
    expect(container.textContent).toContain('Đại lý 21');
  });

  it('chưa có đại lý nào: hiện EmptyState hướng dẫn; có lọc mà không khớp: nói rõ do bộ lọc', async () => {
    stub(page([], 0));
    const { container } = mount(<DealerAccountsTab />);
    await flush();
    expect(container.querySelector('[data-dealer-accounts-empty]')?.textContent).toContain('Chưa có đại lý nào được duyệt');
    typeInto(container.querySelector('input[aria-label="Tìm đại lý theo tên hoặc SĐT"]'), 'zzz');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    await flush();
    expect(container.querySelector('[data-dealer-accounts-empty]')?.textContent).toContain('Không có đại lý khớp bộ lọc');
  });

  it('lỗi tải: báo lỗi và có nút Thử lại gọi lại API', async () => {
    let fail = true;
    const api = mockFetch({
      '/admin/dealers/accounts': () => (fail ? { status: 500, body: { message: 'boom' } } : { body: page(ROWS) }),
      '/admin/dealer-tiers/manage': { body: TIERS },
      '/admin/dealer-tiers/history': { body: [] },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<DealerAccountsTab />);
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Không tải được danh sách đại lý');
    fail = false;
    click(byText(container, 'button', 'Thử lại'));
    await flush();
    expect(container.querySelectorAll('[data-dealer-account]')).toHaveLength(3);
  });

  it('vùng chạm ≥ 44px trên điện thoại cho nút, ô nhập, ô chọn của danh sách', async () => {
    stub();
    const { container } = mount(<DealerAccountsTab />);
    await flush();
    const list = container.querySelector('[data-dealer-account-list]')!;
    list.parentElement!.querySelectorAll('button, select, input').forEach((el) => {
      if ((el as HTMLInputElement).type === 'checkbox') return;
      expect(el.className).toContain('min-h-[44px]');
    });
  });
});
