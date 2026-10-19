// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { MerchantFulfilmentTab, pctInputToFraction, storeFeesText } from './merchant-fulfilment-tab';
import { MerchantProductsTab } from './merchant-products-tab';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
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
    { storefrontId: 'sf1', title: 'Mật ong Linh', type: 'CTV' as const, isPartner: true, owner: { fullName: 'Linh', phone: '0900000009' }, activeOrders: 3, overdueOrders: 1, settleableLines: 2, settleableAmount: 185000 },
    { storefrontId: 'sf2', title: 'Xà bông Mộc', type: 'MERCHANT' as const, isPartner: false, owner: null, activeOrders: 0, overdueOrders: 0, settleableLines: 0, settleableAmount: 0 },
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
    // Tổng admin đang nhìn đi kèm: server tính lại khác số này thì từ chối lập phiếu.
    expect(JSON.parse(String(post.init!.body))).toEqual({ storefrontId: 'sf1', expectedTotal: 185_000 });
    expect(Array.from(root.querySelectorAll('h2,h3,h4')).map((h) => h.tagName)).toEqual(['H2', 'H3', 'H3', 'H3']);
    expect(scrollRegionProblems(root)).toEqual([]);
  });

  it('R5-PARTNER-7: đơn quá hạn xác nhận ghi "Chờ gian hàng xác nhận", không ghi "Đã xác nhận" cạnh "Quá hạn xác nhận"; đơn quá hạn gửi hàng giữ nhãn trạng thái chung', async () => {
    const shipLate = {
      ...OVERVIEW.overdue[0]!,
      id: 'o10',
      code: 'TF10',
      status: 'PACKED',
      sla: { state: 'SHIP_OVERDUE', dueAt: '2026-10-12T03:00:00.000Z' },
    };
    setup({ '/admin/merchant-fulfilment/overview': { body: { ...OVERVIEW, overdue: [OVERVIEW.overdue[0]!, shipLate] } } });
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    const rows = Array.from(r.container.querySelectorAll('section ul li')).filter((li) => li.textContent?.includes('TF9') || li.textContent?.includes('TF10'));
    const confirmLate = rows.find((li) => li.textContent?.includes('TF9'))!;
    const shipLateRow = rows.find((li) => li.textContent?.includes('TF10'))!;
    expect(confirmLate.textContent).toContain('Quá hạn xác nhận');
    expect(confirmLate.textContent).toContain('Chờ gian hàng xác nhận');
    expect(confirmLate.textContent).not.toContain('Đã xác nhận');
    expect(shipLateRow.textContent).toContain('Quá hạn gửi hàng');
    expect(shipLateRow.textContent).toContain('Đã đóng gói');
    expect(shipLateRow.textContent).not.toContain('Chờ gian hàng xác nhận');
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

  it('Q8 review S5: bảng kê của gian hàng kèm món giao hộ chưa vào đối soát tự động (chỉ đọc, kèm lý do), kể cả khi không còn khoản chờ lập phiếu', async () => {
    const excluded = {
      settleFrom: '2026-10-01T00:00:00.000Z',
      total: 2,
      lines: [
        { orderId: 'o5', orderCode: 'TT5', orderItemId: 'i5', productName: 'Mật ong', variationName: null, quantity: 1, goodsAmount: 90000, createdAt: '2026-10-05T03:00:00.000Z', deliveredAt: null, reason: 'TAKEOVER_UNCONFIRMED' },
        { orderId: 'o6', orderCode: 'TT6', orderItemId: 'i6', productName: 'Mật ong', variationName: null, quantity: 1, goodsAmount: 95000, createdAt: '2026-10-06T03:00:00.000Z', deliveredAt: null, reason: 'TAKEOVER_BEFORE_CONFIRM', confirmedAt: '2026-10-09T03:00:00.000Z' },
      ],
    };
    setup({ '/admin/merchant-fulfilment/statements/': { body: { ...STATEMENT, lines: [], total: 0, consignmentExcluded: excluded } } });
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    const row = Array.from(r.container.querySelectorAll('tr')).find((tr) => tr.textContent?.includes('Trà Shan giao hộ'))!;
    click(byText(row, 'button', 'Xem khoản'));
    await flush();
    expect(r.container.textContent).toContain('Không còn khoản nào chờ lập phiếu.');
    expect(r.container.textContent).toContain('Hàng Tubu giao hộ chưa vào đối soát tự động (2 món)');
    const region = r.container.querySelector('[aria-label="Hàng Tubu giao hộ chưa vào đối soát tự động của Trà Shan giao hộ"]')!;
    expect(region.textContent).toContain('TT5');
    expect(region.textContent).toContain('Liên kết nhận lại chưa xác nhận hàng ký gửi lúc đặt');
    expect(region.textContent).toContain('Đặt trước lúc xác nhận hàng ký gửi (09/10/2026) — đối soát riêng ngoài phiếu');
    expect(scrollRegionProblems(r.container)).toEqual([]);
  });

  it('Q8: admin sửa phí sàn riêng và phí Tubu giao hộ — gửi phân số; để trống phí sàn là về mặc định', async () => {
    const api = setup();
    const r = render(<MerchantFulfilmentTab isAdmin />);
    mounted.push(r);
    await flush();
    const row = Array.from(r.container.querySelectorAll('tr')).find((tr) => tr.textContent?.includes('Mật ong Linh'))!;
    expect(row.textContent).toContain('Sàn 15% (mặc định) · Giao hộ không phí');
    click(byText(row, 'button', 'Sửa phí'));
    const form = r.container.querySelector('form')!;
    expect(inputByLabel(form, 'Phí sàn riêng (%)').placeholder).toBe('Mặc định 15%');
    expect(form.textContent).toContain('Mức mới chỉ áp cho đơn đặt từ lúc lưu');
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
    answerConfirm(true);
    await flush();
    const paid = api.calls.find((c) => c.url.includes('/payouts/mp1/paid'))!;
    expect(JSON.parse(String(paid.init!.body))).toEqual({ bankRef: 'FT555' });
    click(byText(root, 'button', 'Huỷ phiếu'));
    await flush(1);
    typeInto(confirmDialog()!.querySelector('textarea'), ' Sai tài khoản nhận ');
    answerConfirm(true);
    await flush();
    const cancel = api.calls.find((c) => c.url.includes('/payouts/mp1/cancel'))!;
    expect(JSON.parse(String(cancel.init!.body))).toEqual({ reason: 'Sai tài khoản nhận' });
  });

  it('R4-PARTNER-4: huỷ phiếu có hộp xác nhận bắt buộc nhập lý do; bấm Huỷ/Bỏ thì không gọi API', async () => {
    const api = setup();
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    const root = r.container;
    click(byText(root, 'button', 'Huỷ phiếu'));
    await flush(1);
    const dialog = confirmDialog()!;
    expect(dialog.textContent).toContain('Huỷ phiếu đối soát?');
    expect(dialog.textContent).toContain('Gian hàng đã được báo có phiếu sẽ nhận thông báo huỷ kèm lý do');
    const accept = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Huỷ phiếu')!;
    expect(accept.disabled).toBe(true);
    typeInto(dialog.querySelector('textarea'), '   ');
    expect(accept.disabled).toBe(true);
    answerConfirm(false);
    await flush();
    expect(api.calls.some((c) => c.url.includes('/payouts/mp1/cancel'))).toBe(false);
  });

  it('R4-PARTNER-4: phiếu đã huỷ hiện lý do, ghi chú lúc lập, số khoản lúc huỷ và các khoản; không còn nút huỷ/đã chuyển', async () => {
    const CANCELLED = {
      ...PAYOUT,
      status: 'CANCELLED',
      note: 'Kỳ đầu tháng 10',
      cancelledAt: '2026-10-13T03:00:00.000Z',
      cancelledBy: 'adm1',
      cancelReason: 'Sai tài khoản nhận',
      cancelledLineCount: 2,
    };
    setup({ '/admin/merchant-fulfilment/payouts?': { body: { data: [CANCELLED], meta: { page: 1, limit: 20, total: 1 } } } });
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    const root = r.container;
    expect(root.textContent).toContain('Đã huỷ');
    expect(root.textContent).toContain('2 khoản lúc huỷ · lập 12/10/2026');
    expect(root.textContent).toContain('Ghi chú lúc lập: Kỳ đầu tháng 10');
    expect(root.textContent).toContain('Huỷ 13/10/2026 bởi adm1: Sai tài khoản nhận');
    expect(byText(root, 'summary', 'Xem 2 khoản lúc huỷ')).not.toBeNull();
    expect(byText(root, 'button', 'Huỷ phiếu')).toBeNull();
    expect(byText(root, 'button', 'Đã chuyển')).toBeNull();
  });

  it('R2-MERCHANT-4: phiếu âm là tiền đối tác nộp — "Chờ thu", nội dung CK, hạn nộp; nút "Đã thu"', async () => {
    const NEG = { ...PAYOUT, amount: -103500, direction: 'TO_TUBU', transferMemo: 'TUBU DS ABCD1234', dueAt: '2026-10-19T03:00:00.000Z' };
    const api = setup({
      '/admin/merchant-fulfilment/payouts/mp1/paid': { body: { ...NEG, status: 'PAID' } },
      '/admin/merchant-fulfilment/payouts?': { body: { data: [NEG], meta: { page: 1, limit: 20, total: 1 } } },
    });
    const r = render(<MerchantFulfilmentTab isAdmin />);
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
    answerConfirm(true);
    await flush();
    expect(api.calls.some((c) => c.url.includes('/payouts/mp1/paid'))).toBe(true);
  });

  // D7-02: "Đã chuyển"/"Đã thu" ghi sổ đối soát; Enter trong ô mã giao dịch từng gửi thẳng không qua bước hỏi.
  it('D7-02: "Đã chuyển" hỏi lại (danger) nêu số tiền, đối tác, tài khoản và mã GD; Huỷ thì không gọi API', async () => {
    const api = setup();
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    const root = r.container;
    typeInto(root.querySelector('input')!, 'FT555');
    click(byText(root, 'button', 'Đã chuyển'));
    await flush();
    const d = confirmDialog()!;
    expect(d).not.toBeNull();
    const text = d.textContent ?? '';
    expect(text).toContain('Mật ong Linh');
    expect(text).toContain('500.000');
    expect(text).toContain('FT555');
    expect(d.querySelector('[data-confirm="accept"]')?.className).toContain('bg-danger-fg');
    answerConfirm(false);
    await flush();
    expect(api.calls.some((c) => c.url.includes('/payouts/mp1/paid'))).toBe(false);
  });

  it('D7-02: Enter trong ô mã giao dịch (gửi form) chỉ mở hộp xác nhận, không gọi API; "Đã thu" cũng hỏi lại', async () => {
    const NEG = { ...PAYOUT, amount: -103500, direction: 'TO_TUBU', transferMemo: 'TUBU DS ABCD1234', dueAt: '2026-10-19T03:00:00.000Z' };
    const api = setup({
      '/admin/merchant-fulfilment/payouts?': { body: { data: [NEG], meta: { page: 1, limit: 20, total: 1 } } },
    });
    const r = render(<MerchantFulfilmentTab isAdmin />);
    mounted.push(r);
    await flush();
    const root = r.container;
    const input = root.querySelector('input')!;
    typeInto(input, 'FT777');
    act(() => input.form!.requestSubmit());
    await flush();
    const d = confirmDialog()!;
    expect(d).not.toBeNull();
    expect(d.textContent).toContain('103.500');
    expect(d.textContent).toContain('FT777');
    expect(api.calls.some((c) => c.url.includes('/payouts/mp1/paid'))).toBe(false);
    answerConfirm(true);
    await flush();
    expect(api.calls.filter((c) => c.url.includes('/payouts/mp1/paid'))).toHaveLength(1);
  });

  it('R4-ADMIN-7: ở màn hẹp mỗi gian hàng một thẻ có nút "Lập phiếu đối soát" ngay trong tầm nhìn (không phải vuốt ngang bảng 760px)', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const api = setup();
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    const root = r.container;
    expect(root.querySelector('[role="region"][aria-label="Gian hàng đối tác"]')).toBeNull();
    const cards = Array.from(root.querySelectorAll('ul[aria-label="Gian hàng đối tác"] > li'));
    expect(cards).toHaveLength(3);
    const first = cards[0]!;
    expect(first.textContent).toContain('Mật ong Linh');
    expect(first.textContent).toContain('Đang xử lý');
    expect(first.textContent).toContain('2 khoản · 185.000');
    expect(first.textContent).toContain('Quá hạn');
    const buttons = cards.map((c) => byText(c, 'button', 'Lập phiếu đối soát') as HTMLButtonElement);
    expect(buttons.map((b) => b.disabled)).toEqual([false, true, false]);
    click(buttons[0]!);
    await flush();
    const post = api.calls.find((c) => c.url.endsWith('/admin/merchant-fulfilment/payouts') && c.init?.method === 'POST')!;
    expect(JSON.parse(String(post.init!.body))).toEqual({ storefrontId: 'sf1', expectedTotal: 185_000 });
    click(byText(cards[2]!, 'button', 'Xem khoản'));
    await flush();
    expect(r.container.textContent).toContain('Khoản chờ lập phiếu · Trà Shan giao hộ');
  });

  it('R4-ADMIN-7: phiếu đối soát mặc định chỉ lấy phiếu chờ chuyển/thu (không bị đẩy khỏi trang đầu bởi phiếu đã xong); chip "Tất cả" bỏ lọc', async () => {
    const PAID = { ...PAYOUT, id: 'mp0', status: 'PAID', paidAt: '2026-10-13T03:00:00.000Z', bankRef: 'FT1', lines: [] };
    const api = setup({
      '/admin/merchant-fulfilment/payouts?': { body: { data: [PAYOUT, PAID], meta: { page: 1, limit: 20, total: 2 } } },
    });
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    const root = r.container;
    const listCalls = () => api.calls.filter((c) => c.url.includes('/admin/merchant-fulfilment/payouts?'));
    expect(listCalls()[0]!.url).toContain('status=PENDING');
    const pendingChip = byText(root, 'button', 'Chờ xử lý')!;
    const allChip = byText(root, 'button', 'Tất cả')!;
    expect(pendingChip.getAttribute('aria-pressed')).toBe('true');
    expect(allChip.getAttribute('aria-pressed')).toBe('false');

    click(allChip);
    await flush();
    expect(listCalls().at(-1)!.url).not.toContain('status=');
    expect(allChip.getAttribute('aria-pressed')).toBe('true');
  });

  it('còn phiếu chờ cũ hơn trang đầu → "Tải thêm" lấy trang kế và phiếu cũ nhất bấm được "Đã chuyển"', async () => {
    const OLD = { ...PAYOUT, id: 'mp-old', amount: 321000, createdAt: '2026-09-01T03:00:00.000Z' };
    const api = setup({
      '/admin/merchant-fulfilment/payouts?': (): { body: unknown } => ({ body: { data: [PAYOUT], meta: { page: 1, limit: 20, total: 21 } } }),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/admin/merchant-fulfilment/payouts?') && url.includes('page=2')) {
          api.calls.push({ url, init });
          return new Response(JSON.stringify({ data: [OLD], meta: { page: 2, limit: 20, total: 21 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return api.fn(url, init);
      }),
    );
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    const root = r.container;
    expect(root.textContent).toContain('Đang hiện 1/21 phiếu, còn 20 phiếu cũ hơn.');
    expect(root.textContent).not.toContain('321.000');

    click(byText(root, 'button', 'Tải thêm')!);
    await flush();
    const pageCalls = api.calls.filter((c) => c.url.includes('/admin/merchant-fulfilment/payouts?'));
    expect(pageCalls.at(-1)!.url).toContain('page=2');
    expect(pageCalls.at(-1)!.url).toContain('status=PENDING');
    expect(root.textContent).toContain('321.000');
    expect(root.querySelectorAll('ul > li button[type="submit"]')).toHaveLength(2);
    expect(byText(root, 'button', 'Tải thêm')).toBeNull();
  });

  it('R4-ADMIN-7: không có phiếu nào chờ thì nói rõ, không phải "Chưa có phiếu nào"', async () => {
    setup({ '/admin/merchant-fulfilment/payouts?': { body: { data: [], meta: { page: 1, limit: 20, total: 0 } } } });
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    expect(r.container.textContent).toContain('Không có phiếu nào đang chờ chuyển hoặc chờ thu.');
  });

  it('R4-ADMIN-7: món chờ xác nhận hàng ký gửi có nút mở màn xác nhận; món đặt trước mốc đối soát thì không (không có gì để xác nhận)', async () => {
    const line = (orderItemId: string, reason: string) => ({
      orderId: `o-${orderItemId}`,
      orderCode: `TT-${orderItemId}`,
      orderItemId,
      productName: 'Bột sắn dây',
      variationName: null,
      quantity: 1,
      goodsAmount: 90000,
      createdAt: '2026-10-05T03:00:00.000Z',
      deliveredAt: null,
      reason,
    });
    const excluded = (lines: ReturnType<typeof line>[]) => ({
      settleFrom: '2026-10-01T00:00:00.000Z',
      total: lines.length,
      lines,
    });
    setup({
      '/admin/merchant-fulfilment/statements/': {
        body: { ...STATEMENT, lines: [], total: 0, consignmentExcluded: excluded([line('i1', 'TAKEOVER_UNCONFIRMED')]) },
      },
    });
    const onOpenConsignmentConfirm = vi.fn();
    const r = render(<MerchantFulfilmentTab isAdmin onOpenConsignmentConfirm={onOpenConsignmentConfirm} />);
    mounted.push(r);
    await flush();
    const row = Array.from(r.container.querySelectorAll('tr')).find((tr) => tr.textContent?.includes('Trà Shan giao hộ'))!;
    click(byText(row, 'button', 'Xem khoản'));
    await flush();
    const open = byText(r.container, 'button', 'Xác nhận hàng ký gửi')!;
    expect(open).not.toBeNull();
    click(open);
    expect(onOpenConsignmentConfirm).toHaveBeenCalledTimes(1);
    mounted.pop()!.unmount();

    setup({
      '/admin/merchant-fulfilment/statements/': {
        body: { ...STATEMENT, lines: [], total: 0, consignmentExcluded: excluded([line('i2', 'BEFORE_SETTLE_FROM')]) },
      },
    });
    const r2 = render(<MerchantFulfilmentTab isAdmin onOpenConsignmentConfirm={onOpenConsignmentConfirm} />);
    mounted.push(r2);
    await flush();
    const row2 = Array.from(r2.container.querySelectorAll('tr')).find((tr) => tr.textContent?.includes('Trà Shan giao hộ'))!;
    click(byText(row2, 'button', 'Xem khoản'));
    await flush();
    expect(byText(r2.container, 'button', 'Xác nhận hàng ký gửi')).toBeNull();
  });

  it('R4-ADMIN-7 review R1: món đặt trước lúc xác nhận hàng ký gửi mà liên kết nay đã xác nhận không còn lời mời xác nhận, không có nút; món liên kết vẫn chờ thì còn', async () => {
    const line = (orderItemId: string, linkPending?: boolean) => ({
      orderId: `o-${orderItemId}`,
      orderCode: `TT-${orderItemId}`,
      orderItemId,
      productName: 'Bột sắn dây',
      variationName: null,
      quantity: 1,
      goodsAmount: 90000,
      createdAt: '2026-10-05T03:00:00.000Z',
      deliveredAt: null,
      reason: 'TAKEOVER_UNCONFIRMED',
      ...(linkPending === undefined ? {} : { linkPending }),
    });
    const open = async (lines: ReturnType<typeof line>[]) => {
      setup({
        '/admin/merchant-fulfilment/statements/': {
          body: { ...STATEMENT, lines: [], total: 0, consignmentExcluded: { settleFrom: null, total: lines.length, lines } },
        },
      });
      const r = render(<MerchantFulfilmentTab isAdmin onOpenConsignmentConfirm={vi.fn()} />);
      mounted.push(r);
      await flush();
      const row = Array.from(r.container.querySelectorAll('tr')).find((tr) => tr.textContent?.includes('Trà Shan giao hộ'))!;
      click(byText(row, 'button', 'Xem khoản'));
      await flush();
      return r;
    };

    const confirmed = await open([line('i1', false)]);
    expect(byText(confirmed.container, 'button', 'Xác nhận hàng ký gửi')).toBeNull();
    expect(confirmed.container.textContent).not.toContain('đang chờ xác nhận hàng ký gửi');
    expect(confirmed.container.textContent).not.toContain('Liên kết nhận lại chưa xác nhận hàng ký gửi lúc đặt');
    expect(confirmed.container.textContent).toContain('Đặt lúc chưa xác nhận hàng ký gửi — xử lý ngoài phiếu');
    mounted.pop()!.unmount();

    const mixed = await open([line('i2', false), line('i3', true)]);
    expect(mixed.container.textContent).toContain('1 món đang chờ xác nhận hàng ký gửi');
    expect(byText(mixed.container, 'button', 'Xác nhận hàng ký gửi')).not.toBeNull();
    expect(mixed.container.textContent).toContain('Liên kết nhận lại chưa xác nhận hàng ký gửi lúc đặt');
    expect(mixed.container.textContent).toContain('Đặt lúc chưa xác nhận hàng ký gửi — xử lý ngoài phiếu');
    mounted.pop()!.unmount();

    const beforeConfirm = { ...line('i4', false), reason: 'TAKEOVER_BEFORE_CONFIRM', confirmedAt: '2026-10-09T03:00:00.000Z' };
    const withConfirmed = await open([beforeConfirm, line('i5', true)]);
    expect(withConfirmed.container.textContent).toContain('1 món đang chờ xác nhận hàng ký gửi');
    expect(withConfirmed.container.textContent).toContain('Đặt trước lúc xác nhận hàng ký gửi (09/10/2026) — đối soát riêng ngoài phiếu');
  });

  it('R4-ADMIN-7: phiếu chờ thu đã quá hạn nộp hiện nhãn "Quá hạn nộp"; chưa tới hạn thì không', async () => {
    const lateNeg = (dueAt: string) => ({ ...PAYOUT, amount: -103500, direction: 'TO_TUBU', transferMemo: 'TUBU DS ABCD1234', dueAt });
    for (const [dueAt, late] of [['2020-01-05T03:00:00.000Z', true], ['2099-01-05T03:00:00.000Z', false]] as const) {
      setup({ '/admin/merchant-fulfilment/payouts?': { body: { data: [lateNeg(dueAt)], meta: { page: 1, limit: 20, total: 1 } } } });
      const r = render(<MerchantFulfilmentTab />);
      mounted.push(r);
      await flush();
      expect(r.container.textContent?.includes('Quá hạn nộp'), dueAt).toBe(late);
      mounted.pop()!.unmount();
    }
    setup({ '/admin/merchant-fulfilment/payouts?': { body: { data: [{ ...PAYOUT, dueAt: '2020-01-05T03:00:00.000Z' }], meta: { page: 1, limit: 20, total: 1 } } } });
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    expect(r.container.textContent).not.toContain('Quá hạn nộp');
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

// D1-05: kế toán (không phải ADMIN) đối soát được — lập phiếu, xem khoản, đã chuyển/huỷ — nhưng không sửa phí sàn
// (PATCH terms chỉ ADMIN) và không có lối sang màn xác nhận hàng ký gửi (tab Duyệt SP đối tác chỉ ADMIN).
describe('MerchantFulfilmentTab — nhân viên kế toán (isAdmin=false)', () => {
  it('phiếu âm (đối tác nộp Tubu): không có "Đã thu" — quản trị viên xác nhận sau khi đối chiếu sao kê; vẫn huỷ được phiếu', async () => {
    const NEG = { ...PAYOUT, amount: -103500, direction: 'TO_TUBU', transferMemo: 'TUBU DS ABCD1234', dueAt: '2026-10-19T03:00:00.000Z' };
    setup({ '/admin/merchant-fulfilment/payouts?': { body: { data: [NEG], meta: { page: 1, limit: 20, total: 1 } } } });
    const r = render(<MerchantFulfilmentTab />);
    mounted.push(r);
    await flush();
    const root = r.container;
    expect(root.textContent).toContain('TUBU DS ABCD1234');
    expect(byText(root, 'button', 'Đã thu')).toBeNull();
    expect(root.textContent).toContain('Quản trị viên xác nhận "Đã thu"');
    expect(byText(root, 'button', 'Huỷ phiếu')).not.toBeNull();
  });

  it('có "Lập phiếu đối soát", "Xem khoản" và nút xử lý phiếu; không có "Sửa phí" và "Xác nhận hàng ký gửi"', async () => {
    setup({
      '/admin/merchant-fulfilment/statements/': {
        body: {
          ...STATEMENT,
          lines: [],
          total: 0,
          consignmentExcluded: {
            settleFrom: '2026-10-01T00:00:00.000Z',
            total: 1,
            lines: [
              { orderId: 'o-i1', orderCode: 'TT-i1', orderItemId: 'i1', productName: 'Bột sắn dây', variationName: null, quantity: 1, goodsAmount: 90000, createdAt: '2026-10-05T03:00:00.000Z', deliveredAt: null, reason: 'TAKEOVER_UNCONFIRMED' },
            ],
          },
        },
      },
    });
    const r = render(<MerchantFulfilmentTab onOpenConsignmentConfirm={vi.fn()} />);
    mounted.push(r);
    await flush();
    const root = r.container;
    expect(byText(root, 'button', 'Lập phiếu đối soát')).not.toBeNull();
    expect(byText(root, 'button', 'Sửa phí')).toBeNull();
    expect(byText(root, 'button', 'Đã chuyển')).not.toBeNull();
    const row = Array.from(root.querySelectorAll('tr')).find((tr) => tr.textContent?.includes('Trà Shan giao hộ'))!;
    click(byText(row, 'button', 'Xem khoản'));
    await flush();
    expect(root.textContent).toContain('Bột sắn dây');
    expect(byText(root, 'button', 'Xác nhận hàng ký gửi')).toBeNull();
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

describe('MerchantProductsTab: liên kết ký gửi chờ xác nhận (R4-ADMIN-7)', () => {
  const link = (id: string, name: string, confirmed: boolean) => ({
    id,
    linkedAt: '2026-10-01T00:00:00.000Z',
    takeover: true,
    stockAtLink: 12,
    consignmentConfirmedAt: confirmed ? '2026-10-05T00:00:00.000Z' : null,
    originProductId: 'orig',
    product: { id: `p-${id}`, name, slug: id, thumbnail: null, isActive: true, approvalStatus: 'APPROVED', storefront: { id: 'sf1', title: 'Trà Việt', subdomain: null } },
    variation: { pancakeId: `PCK-${id}`, name: 'Hũ', stock: 12 },
    originProduct: { id: 'orig', name: 'Bột sắn dây Tubu', slug: 'bot-san-day', brand: 'Tubu', isActive: true },
  });
  const ALL = [link('l1', 'Bột sắn dây', false), link('l2', 'Trà shan', true)];
  const PENDING = [ALL[0]!];

  function stub() {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        let body: unknown = { data: [], meta: { page: 1, limit: 100, total: 0 } };
        if (url.includes('/admin/merchant-products/linked')) {
          const pendingOnly = url.includes('consignment=PENDING');
          const rows = pendingOnly ? PENDING : ALL;
          body = { data: rows, meta: { page: 1, limit: 100, total: rows.length } };
        }
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    return calls;
  }

  it('hiện số liên kết chờ xác nhận ngay trên chip lọc; mặc định xem tất cả, bấm chip chỉ còn liên kết chờ xác nhận', async () => {
    const calls = stub();
    const r = render(<MerchantProductsTab />);
    mounted.push(r);
    await flush();
    const root = r.container;
    const pendingChip = byText(root, 'button', 'Chờ xác nhận ký gửi')!;
    expect(pendingChip.textContent).toContain('(1)');
    expect(pendingChip.getAttribute('aria-pressed')).toBe('false');
    expect(root.textContent).toContain('Bột sắn dây');
    expect(root.textContent).toContain('Trà shan');

    click(pendingChip);
    await flush();
    expect(calls.some((u) => u.includes('/linked') && u.includes('consignment=PENDING') && u.includes('limit=100'))).toBe(true);
    expect(pendingChip.getAttribute('aria-pressed')).toBe('true');
    expect(root.textContent).toContain('Bột sắn dây');
    expect(root.textContent).not.toContain('Trà shan');
    expect(byText(root, 'button', 'Xác nhận hàng ký gửi')).not.toBeNull();
  });

  it('mở từ "Việc cần xử lý" (focusConsignment) thì vào thẳng bộ lọc chờ xác nhận', async () => {
    const calls = stub();
    const r = render(<MerchantProductsTab focusConsignment />);
    mounted.push(r);
    await flush();
    expect(byText(r.container, 'button', 'Chờ xác nhận ký gửi')!.getAttribute('aria-pressed')).toBe('true');
    expect(r.container.textContent).not.toContain('Trà shan');
    expect(calls.some((u) => u.includes('/linked') && u.includes('consignment=PENDING'))).toBe(true);
  });

  it('hết liên kết chờ xác nhận thì nói rõ thay vì "Chưa có sản phẩm đối tác nào liên kết"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = url.includes('/linked') && !url.includes('consignment=PENDING')
          ? { data: [ALL[1]], meta: { page: 1, limit: 100, total: 1 } }
          : { data: [], meta: { page: 1, limit: 100, total: 0 } };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const r = render(<MerchantProductsTab focusConsignment />);
    mounted.push(r);
    await flush();
    expect(r.container.textContent).toContain('Không còn liên kết nào chờ xác nhận hàng ký gửi.');
  });
});

describe('Bật/tắt cờ đối tác (admin)', () => {
  const partnerBtn = (root: ParentNode) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter((b) => /^(Tắt|Bật) đối tác$/.test(b.textContent ?? ''));

  it('chỉ ADMIN thấy nút, và chỉ ở gian hàng CTV', async () => {
    setup();
    const staff = render(<MerchantFulfilmentTab />);
    mounted.push(staff);
    await flush();
    expect(partnerBtn(staff.container)).toHaveLength(0);
    staff.unmount();
    mounted = [];

    setup();
    const admin = render(<MerchantFulfilmentTab isAdmin />);
    mounted.push(admin);
    await flush();
    expect(partnerBtn(admin.container).map((b) => b.textContent)).toEqual(['Tắt đối tác']);
  });

  it('hộp xác nhận: "Đóng" không gọi API; đồng ý → POST isPartner=false rồi tải lại tổng quan', async () => {
    const api = setup({ '/admin/storefronts/sf1/partner': { body: { id: 'sf1', isPartner: false } } });
    const r = render(<MerchantFulfilmentTab isAdmin />);
    mounted.push(r);
    await flush();
    click(partnerBtn(r.container)[0]!);
    await flush();
    expect(confirmDialog()?.textContent).toContain('Tắt cờ đối tác của "Mật ong Linh"');
    answerConfirm(false);
    await flush();
    expect(api.calls.some((c) => c.url.includes('/partner'))).toBe(false);

    const before = api.calls.filter((c) => c.url.endsWith('/admin/merchant-fulfilment/overview')).length;
    click(partnerBtn(r.container)[0]!);
    await flush();
    answerConfirm(true);
    await flush();
    const post = api.calls.find((c) => c.url.endsWith('/admin/storefronts/sf1/partner'))!;
    expect(post.init?.method).toBe('POST');
    expect(JSON.parse(String(post.init!.body))).toEqual({ isPartner: false });
    expect(api.calls.filter((c) => c.url.endsWith('/admin/merchant-fulfilment/overview')).length).toBe(before + 1);
  });

  it('409: hiện nguyên văn câu của máy chủ (kèm mã đơn) và không tải lại dữ liệu', async () => {
    const message = 'Chưa thể tắt gian hàng đối tác: còn 2 đơn tự giao chưa xong (TB-1, TB-2). Xử lý xong rồi thử lại.';
    const api = setup({ '/admin/storefronts/sf1/partner': { status: 409, body: { message } } });
    const r = render(<MerchantFulfilmentTab isAdmin />);
    mounted.push(r);
    await flush();
    const before = api.calls.filter((c) => c.url.endsWith('/admin/merchant-fulfilment/overview')).length;
    click(partnerBtn(r.container)[0]!);
    await flush();
    answerConfirm(true);
    await flush();
    expect(r.container.querySelector('[role="alert"]')?.textContent).toBe(message);
    expect(api.calls.filter((c) => c.url.endsWith('/admin/merchant-fulfilment/overview')).length).toBe(before);
  });

  it('gian hàng CTV vừa bật cờ, chưa có đơn/khoản: hiện hàng với "—", nút lập phiếu và xem khoản khoá, nút Tắt đối tác chạy', async () => {
    const empty = { storefrontId: 'sf9', title: 'Vườn mới', type: 'CTV' as const, isPartner: true, owner: { fullName: 'Mai', phone: '0900000099' }, activeOrders: 0, overdueOrders: 0, settleableLines: 0, settleableAmount: 0, consignmentLines: 0, commissionPct: null, consignmentFeePct: 0, consignmentFeeFixed: 0 };
    const api = setup({
      '/admin/merchant-fulfilment/overview': { body: { ...OVERVIEW, stores: [empty], overdue: [] } },
      '/admin/storefronts/sf9/partner': { body: { id: 'sf9', isPartner: false } },
    });
    const r = render(<MerchantFulfilmentTab isAdmin />);
    mounted.push(r);
    await flush();
    const root = r.container;
    expect(root.textContent).toContain('Vườn mới');
    expect(root.textContent).toContain('Gian hàng đối tác (1)');
    expect((byText(root, 'button', 'Lập phiếu đối soát') as HTMLButtonElement).disabled).toBe(true);
    expect((byText(root, 'button', 'Xem khoản') as HTMLButtonElement).disabled).toBe(true);
    click(byText(root, 'button', 'Tắt đối tác')!);
    await flush();
    answerConfirm(true);
    await flush();
    const post = api.calls.find((c) => c.url.endsWith('/admin/storefronts/sf9/partner'))!;
    expect(JSON.parse(String(post.init!.body))).toEqual({ isPartner: false });
  });

  it('gian hàng CTV đã tắt cờ còn khoản REVERSAL: không có nút "Sửa phí" (API 404); MERCHANT dù cột isPartner=false vẫn sửa được phí', async () => {
    const off = { storefrontId: 'sf8', title: 'Vườn đã tắt', type: 'CTV' as const, isPartner: false, owner: { fullName: 'Hoa', phone: '0900000088' }, activeOrders: 0, overdueOrders: 0, settleableLines: 1, settleableAmount: -42500, consignmentLines: 0, commissionPct: null, consignmentFeePct: 0, consignmentFeeFixed: 0 };
    const merchant = { ...off, storefrontId: 'sf7', title: 'Xưởng cũ', type: 'MERCHANT' as const };
    setup({ '/admin/merchant-fulfilment/overview': { body: { ...OVERVIEW, stores: [off, merchant], overdue: [] } } });
    const r = render(<MerchantFulfilmentTab isAdmin />);
    mounted.push(r);
    await flush();
    const rowOf = (title: string) => Array.from(r.container.querySelectorAll('tr')).find((tr) => tr.textContent?.includes(title))!;
    expect(byText(rowOf('Vườn đã tắt'), 'button', 'Lập phiếu đối soát')).not.toBeNull();
    expect(byText(rowOf('Vườn đã tắt'), 'button', 'Sửa phí')).toBeNull();
    expect(byText(rowOf('Xưởng cũ'), 'button', 'Sửa phí')).not.toBeNull();
  });
});
