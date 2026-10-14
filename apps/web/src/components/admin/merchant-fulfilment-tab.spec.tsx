// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MerchantFulfilmentTab } from './merchant-fulfilment-tab';
import { MerchantProductsTab } from './merchant-products-tab';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import { scrollRegionProblems } from '@/test-utils/a11y';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const OVERVIEW = {
  slaConfig: { confirmHours: 24, shipHours: 48, deliverDays: 7 },
  stores: [
    { storefrontId: 'sf1', title: 'Mật ong Linh', owner: { fullName: 'Linh', phone: '0900000009' }, activeOrders: 3, overdueOrders: 1, settleableLines: 2, settleableAmount: 185000 },
    { storefrontId: 'sf2', title: 'Xà bông Mộc', owner: null, activeOrders: 0, overdueOrders: 0, settleableLines: 0, settleableAmount: 0 },
  ],
  overdue: [
    {
      id: 'o9',
      code: 'TF9',
      status: 'CONFIRMED',
      total: 230000,
      createdAt: '2026-10-10T03:00:00.000Z',
      fulfillerStorefront: { title: 'Mật ong Linh', owner: { phone: '0900000009' } },
      sla: { state: 'CONFIRM_OVERDUE', dueAt: '2026-10-11T03:00:00.000Z' },
    },
  ],
};
const PAYOUT = {
  id: 'mp1',
  storefrontId: 'sf1',
  amount: 500000,
  status: 'PENDING',
  bankInfo: { bankName: 'BIDV', accountNo: '0123456789', accountName: 'NGUYEN LINH' },
  createdAt: '2026-10-12T03:00:00.000Z',
  lines: [{ id: 'l1' }, { id: 'l2' }],
  storefront: { id: 'sf1', title: 'Mật ong Linh' },
};

function setup(extra: Parameters<typeof mockFetch>[0] = {}) {
  const api = mockFetch({
    '/admin/merchant-fulfilment/overview': { body: OVERVIEW },
    '/admin/merchant-fulfilment/payouts/mp1/paid': { body: { ...PAYOUT, status: 'PAID' } },
    '/admin/merchant-fulfilment/payouts/mp1/cancel': { body: { ...PAYOUT, status: 'CANCELLED' } },
    '/admin/merchant-fulfilment/payouts?': { body: { data: [PAYOUT], meta: { page: 1, limit: 20, total: 1 } } },
    '/admin/merchant-fulfilment/payouts': { body: { ...PAYOUT, id: 'mp2' } },
    ...extra,
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  return api;
}

describe('MerchantFulfilmentTab (admin, D4)', () => {
  it('liệt kê gian hàng tự giao kèm quá hạn và tiền chờ đối soát; lập phiếu gửi đúng gian hàng; gian hàng không có đơn đủ hạn thì nút khoá', async () => {
    const api = setup();
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    const root = r.container;
    expect(root.textContent).toContain('Hạn SLA: xác nhận 24 giờ, gửi hàng 48 giờ, giao xong 7 ngày');
    expect(root.textContent).toContain('2 đơn · 185.000');
    expect(root.textContent).toContain('Quá hạn xác nhận');
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === 'Lập phiếu đối soát');
    expect(buttons.map((b) => b.disabled)).toEqual([false, true]);
    click(buttons[0]!);
    await flush();
    const post = api.calls.find((c) => c.url.endsWith('/admin/merchant-fulfilment/payouts') && c.init?.method === 'POST')!;
    expect(JSON.parse(String(post.init!.body))).toEqual({ storefrontId: 'sf1' });
    expect(Array.from(root.querySelectorAll('h2,h3,h4')).map((h) => h.tagName)).toEqual(['H2', 'H3', 'H3', 'H3']);
    expect(scrollRegionProblems(root)).toEqual([]);
  });

  it('phiếu chờ chuyển: hiện tài khoản nhận, đánh dấu đã chuyển phải có mã giao dịch; huỷ phiếu gọi đúng API', async () => {
    const api = setup();
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    const root = r.container;
    expect(root.textContent).toContain('Chuyển vào BIDV 0123456789 (NGUYEN LINH)');
    typeInto(root.querySelector('input')!, ' FT555 ');
    click(byText(root, 'button', 'Đã chuyển'));
    await flush();
    const paid = api.calls.find((c) => c.url.includes('/payouts/mp1/paid'))!;
    expect(JSON.parse(String(paid.init!.body))).toEqual({ bankRef: 'FT555' });
    click(byText(root, 'button', 'Huỷ phiếu'));
    await flush();
    expect(api.calls.some((c) => c.url.includes('/payouts/mp1/cancel'))).toBe(true);
  });

  it('lỗi API (ví dụ phiếu trùng) hiện thông báo danger role alert', async () => {
    setup({ '/admin/merchant-fulfilment/payouts': { status: 409, body: { message: 'Một phiếu đối soát khác vừa được lập cho các đơn này.' } } });
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    click(Array.from(r.container.querySelectorAll('button')).find((b) => b.textContent === 'Lập phiếu đối soát')!);
    await flush();
    expect(r.container.querySelector('[role="alert"]')!.textContent).toContain('Một phiếu đối soát khác');
  });
});

describe('MerchantProductsTab: hiện cách giao để admin biết duyệt sẽ chuyển biến thể Pancake', () => {
  it('sản phẩm xin "Tubu giao hộ" hiện mã Pancake; sản phẩm tự giao ghi rõ', async () => {
    const base = {
      slug: 's',
      basePrice: 1000,
      salePrice: null,
      thumbnail: null,
      brand: 'X',
      category: 'Y',
      description: null,
      ingredients: null,
      certifications: [],
      ecoBadges: [],
      approvalStatus: 'PENDING_REVIEW',
      createdAt: '2026-10-01T00:00:00.000Z',
    };
    const api = mockFetch({
      '/admin/merchant-products/pending': {
        body: {
          data: [
            { ...base, id: 'a', name: 'Bột giặt', pancakeLinkCode: 'PCK-77' },
            { ...base, id: 'b', name: 'Mật ong', pancakeLinkCode: null },
          ],
          meta: { page: 1, limit: 100, total: 2 },
        },
      },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<MerchantProductsTab />);
    mounted.push(r);
    await flush();
    expect(r.container.textContent).toContain('Tubu giao hộ · mã Pancake PCK-77');
    expect(r.container.textContent).toContain('Gian hàng tự giao');
  });
});
