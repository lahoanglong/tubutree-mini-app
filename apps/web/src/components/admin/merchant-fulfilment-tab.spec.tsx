// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MerchantFulfilmentTab, pctInputToFraction, storeFeesText } from './merchant-fulfilment-tab';
import { MerchantProductsTab } from './merchant-products-tab';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import { scrollRegionProblems } from '@/test-utils/a11y';

const inputByLabel = (root: ParentNode, label: string) => {
  const l = byText(root, 'label', label) as HTMLLabelElement | null;
  if (!l?.htmlFor) throw new Error(`không thấy nhãn ${label}`);
  return root.querySelector<HTMLInputElement>(`#${CSS.escape(l.htmlFor)}`)!;
};

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const OVERVIEW = {
  slaConfig: { confirmHours: 24, shipHours: 48, deliverDays: 7 },
  defaultCommissionPct: 0.15,
  stores: [
    { storefrontId: 'sf1', title: 'Mật ong Linh', owner: { fullName: 'Linh', phone: '0900000009' }, activeOrders: 3, overdueOrders: 1, settleableLines: 2, settleableAmount: 185000 },
    { storefrontId: 'sf2', title: 'Xà bông Mộc', owner: null, activeOrders: 0, overdueOrders: 0, settleableLines: 0, settleableAmount: 0 },
    {
      storefrontId: 'sf3',
      title: 'Trà Shan giao hộ',
      owner: null,
      activeOrders: 0,
      overdueOrders: 0,
      settleableLines: 2,
      settleableAmount: 123760,
      consignmentLines: 2,
      commissionPct: 0.1,
      consignmentFeePct: 0.02,
      consignmentFeeFixed: 3400,
    },
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
  lines: [
    { id: 'l1', orderId: 'o1', orderCode: 'TF1', kind: 'SALE', refKey: '', goodsAmount: 500000, shippingFee: 0, commissionAmount: 0, codCollected: 0, netAmount: 500000, deliveredAt: null, createdAt: '2026-10-12T03:00:00.000Z' },
    {
      id: 'l2',
      orderId: 'o2',
      orderCode: 'TT2',
      kind: 'SALE',
      refKey: 'ITEM:i2',
      orderItemId: 'i2',
      item: { productName: 'Trà Shan', variationName: null, quantity: 1 },
      goodsAmount: 0,
      shippingFee: 0,
      commissionAmount: 0,
      opsFeeAmount: 0,
      codCollected: 0,
      netAmount: 0,
      deliveredAt: null,
      createdAt: '2026-10-12T03:00:00.000Z',
    },
  ],
  storefront: { id: 'sf1', title: 'Mật ong Linh' },
};
const STATEMENT = {
  holdDays: 7,
  total: 87360,
  upcoming: [],
  consignmentTerms: { commissionPct: 0.1, feePct: 0.02, feeFixed: 3400 },
  lines: [
    {
      orderId: 'o7',
      orderCode: 'TT7',
      kind: 'SALE',
      refKey: 'ITEM:i1',
      orderItemId: 'i1',
      item: { productName: 'Mật ong', variationName: 'Hũ 500g', quantity: 2 },
      goodsAmount: 102000,
      shippingFee: 0,
      commissionAmount: 10200,
      opsFeeAmount: 4440,
      codCollected: 0,
      netAmount: 87360,
      deliveredAt: '2026-10-01T03:00:00.000Z',
    },
  ],
};

function setup(extra: Parameters<typeof mockFetch>[0] = {}) {
  const api = mockFetch({
    '/admin/merchant-fulfilment/overview': { body: OVERVIEW },
    '/admin/merchant-fulfilment/statements/': { body: STATEMENT },
    '/admin/merchant-fulfilment/stores/': { body: {} },
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
    // Một dòng bảng kê có thể là dòng đảo (trả một phần) của đơn đã quyết toán — đếm "khoản", không phải "đơn".
    expect(root.textContent).toContain('2 khoản · 185.000');
    expect(root.textContent).toContain('Quá hạn xác nhận');
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === 'Lập phiếu đối soát');
    expect(buttons.map((b) => b.disabled)).toEqual([false, true, false]);
    click(buttons[0]!);
    await flush();
    const post = api.calls.find((c) => c.url.endsWith('/admin/merchant-fulfilment/payouts') && c.init?.method === 'POST')!;
    expect(JSON.parse(String(post.init!.body))).toEqual({ storefrontId: 'sf1' });
    expect(Array.from(root.querySelectorAll('h2,h3,h4')).map((h) => h.tagName)).toEqual(['H2', 'H3', 'H3', 'H3']);
    expect(scrollRegionProblems(root)).toEqual([]);
  });

  it('Q8: gian hàng chỉ có hàng Tubu giao hộ cũng ở danh sách — số khoản giao hộ, mức phí; xem khoản trước khi lập phiếu', async () => {
    const api = setup();
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    const row = Array.from(r.container.querySelectorAll('tr')).find((tr) => tr.textContent?.includes('Trà Shan giao hộ'))!;
    expect(row.textContent).toContain('2 khoản · 123.760');
    expect(row.textContent).toContain('trong đó 2 khoản Tubu giao hộ');
    expect(row.textContent).toContain('Sàn 10% · Giao hộ 2% + 3.400đ/đơn');
    click(byText(row, 'button', 'Xem khoản'));
    await flush();
    expect(api.calls.some((c) => c.url.includes('/admin/merchant-fulfilment/statements/sf3'))).toBe(true);
    const region = r.container.querySelector('[aria-label="Khoản chờ lập phiếu của Trà Shan giao hộ"]')!;
    expect(region.textContent).toContain('Tubu giao hộ');
    expect(region.textContent).toContain('Mật ong (Hũ 500g) × 2');
    expect(region.textContent).toContain('−4.440đ');
    expect(region.textContent).toContain('COD gian hàng đã thu');
    expect(scrollRegionProblems(r.container)).toEqual([]);
  });

  it('Q8: admin sửa phí sàn riêng và phí Tubu giao hộ — gửi phân số; để trống phí sàn là về mặc định', async () => {
    const api = setup();
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    const row = Array.from(r.container.querySelectorAll('tr')).find((tr) => tr.textContent?.includes('Mật ong Linh'))!;
    expect(row.textContent).toContain('Sàn 15% (mặc định) · Giao hộ không phí');
    click(byText(row, 'button', 'Sửa phí'));
    const form = r.container.querySelector('form')!;
    expect(inputByLabel(form, 'Phí sàn riêng (%)').placeholder).toBe('Mặc định 15%');
    typeInto(inputByLabel(form, 'Phí sàn riêng (%)'), '12');
    typeInto(inputByLabel(form, 'Phí Tubu giao hộ (%)'), '2.5');
    typeInto(inputByLabel(form, 'Phí Tubu giao hộ mỗi đơn (đ)'), '3400');
    click(byText(form, 'button', 'Lưu phí'));
    await flush();
    const patch = api.calls.find((c) => c.url.includes('/admin/merchant-fulfilment/stores/sf1/terms'))!;
    expect(patch.init!.method).toBe('PATCH');
    expect(JSON.parse(String(patch.init!.body))).toEqual({ commissionPct: 0.12, consignmentFeePct: 0.025, consignmentFeeFixed: 3400 });

    click(byText(row, 'button', 'Sửa phí'));
    const again = r.container.querySelector('form')!;
    typeInto(inputByLabel(again, 'Phí sàn riêng (%)'), '');
    click(byText(again, 'button', 'Lưu phí'));
    await flush();
    const last = api.calls.filter((c) => c.url.includes('/stores/sf1/terms')).at(-1)!;
    expect(JSON.parse(String(last.init!.body)).commissionPct).toBeNull();
  });

  it('pctInputToFraction / storeFeesText', () => {
    expect(pctInputToFraction('2,5')).toBe(0.025);
    expect(pctInputToFraction(' 15 ')).toBe(0.15);
    expect(pctInputToFraction('')).toBeNull();
    const base = OVERVIEW.stores[2]!;
    expect(storeFeesText({ ...base, commissionPct: null, consignmentFeePct: 0, consignmentFeeFixed: 5000 }, 0.15)).toBe(
      'Sàn 15% (mặc định) · Giao hộ 5.000đ/đơn',
    );
  });

  it('phiếu chờ chuyển: hiện tài khoản nhận, đánh dấu đã chuyển phải có mã giao dịch; huỷ phiếu gọi đúng API', async () => {
    const api = setup();
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    const root = r.container;
    expect(root.textContent).toContain('Chuyển vào BIDV 0123456789 (NGUYEN LINH)');
    expect(root.textContent).toContain('2 khoản · lập');
    const details = byText(root, 'summary', 'Xem 2 khoản')!;
    expect(details).not.toBeNull();
    expect(root.querySelector('[aria-label^="Các khoản của phiếu Mật ong Linh"]')!.textContent).toContain('Tubu giao hộ');
    typeInto(root.querySelector('input')!, ' FT555 ');
    click(byText(root, 'button', 'Đã chuyển'));
    await flush();
    const paid = api.calls.find((c) => c.url.includes('/payouts/mp1/paid'))!;
    expect(JSON.parse(String(paid.init!.body))).toEqual({ bankRef: 'FT555' });
    click(byText(root, 'button', 'Huỷ phiếu'));
    await flush();
    expect(api.calls.some((c) => c.url.includes('/payouts/mp1/cancel'))).toBe(true);
  });

  it('R2-MERCHANT-4: phiếu âm là tiền đối tác nộp — "Chờ thu", nội dung CK, hạn nộp; nút "Đã thu"', async () => {
    const NEG = { ...PAYOUT, amount: -103500, direction: 'TO_TUBU', transferMemo: 'TUBU DS ABCD1234', dueAt: '2026-10-19T03:00:00.000Z' };
    const api = setup({
      '/admin/merchant-fulfilment/payouts/mp1/paid': { body: { ...NEG, status: 'PAID' } },
      '/admin/merchant-fulfilment/payouts?': { body: { data: [NEG], meta: { page: 1, limit: 20, total: 1 } } },
    });
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    const root = r.container;
    expect(root.textContent).toContain('Chờ thu');
    expect(root.textContent).not.toContain('Chờ chuyển');
    expect(root.textContent).toContain('TUBU DS ABCD1234');
    expect(root.textContent).toContain('hạn 19/10/2026');
    expect(byText(root, 'button', 'Đã chuyển')).toBeNull();
    typeInto(root.querySelector('input')!, 'FT777');
    click(byText(root, 'button', 'Đã thu'));
    await flush();
    expect(api.calls.some((c) => c.url.includes('/payouts/mp1/paid'))).toBe(true);
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
