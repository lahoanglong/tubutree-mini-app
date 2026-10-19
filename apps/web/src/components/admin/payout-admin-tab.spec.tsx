// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PayoutAdminTab, PayoutRow } from './payout-admin-tab';
import { OpsInboxTab } from './ops-inbox-tab';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminPayout } from '@/lib/admin-client';

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

const payout = (over: Partial<AdminPayout> = {}): AdminPayout => ({
  id: 'p1',
  userId: 'u1',
  amount: 1_500_000,
  fee: 3_000,
  method: 'BANK',
  bankInfo: { bankName: 'VCB', accountNumber: '0123456789', accountName: 'NGUYEN A' },
  status: 'REQUESTED',
  requestedAt: '2026-10-01T00:00:00.000Z',
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  paidBy: null,
  paidAt: null,
  bankRef: null,
  adminNote: null,
  user: { id: 'u1', fullName: 'Nguyễn A', phone: '0900000001', referralCode: 'AAAA1111' },
  ...over,
});

const EMPTY_PIT = { month: '2026-10', rows: [], totals: { recipients: 0, withheldRecipients: 0, grossAmount: 0, taxWithheld: 0, netAmount: 0 } };
const LIST = {
  '/pit-report': { body: EMPTY_PIT },
  '/admin/payouts': { body: { data: [], meta: { page: 1, limit: 20, total: 0 } } },
};

// C-122: từ chối lệnh rút (hoàn tiền cho CTV) và xác nhận đã chuyển khoản là thao tác tiền, hỏi bằng hộp thoại thống nhất.
describe('PayoutRow — hộp thoại xác nhận', () => {
  it('từ chối: thiếu lý do → báo tại chỗ, không mở hộp thoại; có lý do → hộp thoại tông đỏ, "Không từ chối" thì không gọi API', async () => {
    const api = mockFetch({ '/reject': { body: payout({ status: 'REJECTED' }) }, ...LIST });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const native = vi.spyOn(window, 'confirm');
    const { container } = mount(<PayoutRow payout={payout()} />);

    click(byText(container, 'button', 'Từ chối'));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/lý do/i);

    typeInto(container.querySelector('input[aria-label="Ghi chú / lý do"]'), 'Sai số tài khoản');
    click(byText(container, 'button', 'Từ chối'));
    await flush();
    const d = confirmDialog()!;
    expect(d.textContent).toMatch(/1\.500\.000/);
    expect(d.textContent).toMatch(/HOÀN LẠI/);
    expect(d.querySelector('[data-confirm="accept"]')?.className).toContain('bg-danger-fg');
    answerConfirm(false);
    await flush();
    expect(api.calls).toHaveLength(0);

    click(byText(container, 'button', 'Từ chối'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(api.calls[0]!.url).toContain('/admin/payouts/p1/reject');
    expect(JSON.parse(String(api.calls[0]!.init?.body))).toEqual({ reason: 'Sai số tài khoản' });
    expect(native).not.toHaveBeenCalled();
  });

  it('"Đã chuyển khoản": hộp thoại nêu số tiền; đồng ý mới POST mark-paid', async () => {
    const api = mockFetch({ '/mark-paid': { body: payout({ status: 'PAID' }) }, ...LIST });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<PayoutRow payout={payout({ status: 'APPROVED' })} />);
    click(byText(container, 'button', 'Đã chuyển khoản'));
    await flush();
    expect(confirmDialog()?.textContent).toMatch(/1\.500\.000/);
    expect(api.calls).toHaveLength(0);
    answerConfirm(true);
    await flush();
    expect(api.calls[0]!.url).toContain('/admin/payouts/p1/mark-paid');
  });
});

// D7-01, D7-16: duyệt rút tiền không còn đường từ chối trên giao diện, nên "Duyệt" và "Đã chuyển khoản" phải hỏi lại, nêu rõ
// ai nhận, số tiền, ngân hàng, STK và dùng tông danger.
describe('PayoutRow — hỏi lại khi duyệt và khi chi (D7-01, D7-16)', () => {
  it('"Duyệt": hộp thoại danger nêu CTV, số tiền, ngân hàng, STK; Huỷ thì không gọi API; đồng ý gọi đúng một lần', async () => {
    const api = mockFetch({ '/approve': { body: payout({ status: 'APPROVED' }) }, ...LIST });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<PayoutRow payout={payout()} />);

    click(byText(container, 'button', 'Duyệt'));
    await flush();
    const d = confirmDialog()!;
    expect(d).not.toBeNull();
    const text = d.textContent ?? '';
    expect(text).toContain('Nguyễn A');
    expect(text).toContain('1.500.000');
    expect(text).toContain('VCB');
    expect(text).toContain('0123456789');
    expect(d.querySelector('[data-confirm="accept"]')?.className).toContain('bg-danger-fg');
    expect(api.calls).toHaveLength(0);
    answerConfirm(false);
    await flush();
    expect(api.calls).toHaveLength(0);

    click(byText(container, 'button', 'Duyệt'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(api.calls.filter((c) => c.url.includes('/admin/payouts/p1/approve'))).toHaveLength(1);
  });

  it('"Đã chuyển khoản": hộp thoại danger nêu CTV, ngân hàng, STK và mã giao dịch đã gõ', async () => {
    const api = mockFetch({ '/mark-paid': { body: payout({ status: 'PAID' }) }, ...LIST });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<PayoutRow payout={payout({ status: 'APPROVED' })} />);
    typeInto(container.querySelector('input[aria-label="Mã giao dịch ngân hàng"]'), 'FT26100001');
    click(byText(container, 'button', 'Đã chuyển khoản'));
    await flush();
    const d = confirmDialog()!;
    const text = d.textContent ?? '';
    expect(text).toContain('Nguyễn A');
    expect(text).toContain('VCB');
    expect(text).toContain('0123456789');
    expect(text).toContain('FT26100001');
    expect(d.querySelector('[data-confirm="accept"]')?.className).toContain('bg-danger-fg');
    answerConfirm(false);
    await flush();
    expect(api.calls).toHaveLength(0);
  });
});

// C-097 (Q-29): màn duyệt/chi tiền chỉ đổi giao diện sang DS v2; nút thao tác tiền chạm được ở 390px.
describe('PayoutRow / PayoutAdminTab — DS v2', () => {
  it('lệnh REQUESTED: "Duyệt" là nút chính forest, "Từ chối (hoàn tiền)" viền danger, cả hai cao 44px', () => {
    const { container } = mount(<PayoutRow payout={payout()} />);
    const approve = byText(container, 'button', 'Duyệt');
    const reject = byText(container, 'button', 'Từ chối (hoàn tiền)');
    expect(approve?.className).toContain('bg-forest-600');
    expect(approve?.className).toContain('min-h-[44px]');
    expect(reject?.className).toContain('border-danger-fg');
    expect(reject?.className).toContain('min-h-[44px]');
  });

  it('lệnh APPROVED: "Đã chuyển khoản" cao 44px, ô ghi chú/mã giao dịch chịu xuống dòng', () => {
    const { container } = mount(<PayoutRow payout={payout({ status: 'APPROVED' })} />);
    expect(byText(container, 'button', 'Đã chuyển khoản')?.className).toContain('min-h-[44px]');
    expect(container.querySelector('input[aria-label="Mã giao dịch ngân hàng"]')?.closest('label')?.className).toContain('flex-1');
  });

  it('huy hiệu trạng thái và lý do từ chối theo token danger', () => {
    const { container } = mount(
      <PayoutRow payout={payout({ status: 'REJECTED', rejectionReason: 'Sai số tài khoản', reviewedAt: '2026-10-02T00:00:00.000Z' })} />,
    );
    expect(byText(container, 'span', 'Sai số tài khoản')?.className).toContain('text-danger-fg');
    expect(container.querySelector('span.bg-danger-bg')).not.toBeNull();
  });

  it('thanh lọc trạng thái: chip 44px, chip đang chọn nền forest, mặc định lọc REQUESTED', async () => {
    const api = mockFetch(LIST);
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<PayoutAdminTab />);
    await flush();
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLElement[];
    expect(tabs.length).toBeGreaterThan(1);
    for (const t of tabs) expect(t.className).toContain('min-h-[44px]');
    const selected = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]!.className).toContain('bg-forest-600');
    expect(api.calls.find((c) => !c.url.includes('/pit-report'))!.url).toContain('status=REQUESTED');
  });
});

// SELLER-11: lệnh rút hoa hồng hiện số khấu trừ và MST/CCCD; báo cáo khấu trừ theo tháng cho kế toán kê khai.
describe('Thuế TNCN trên lệnh rút và báo cáo tháng (SELLER-11)', () => {
  it('lệnh rút có khấu trừ: hoa hồng gốc, thuế đã khấu trừ và MST/CCCD người nhận', () => {
    const { container } = mount(
      <PayoutRow payout={payout({ amount: 2_250_000, grossAmount: 2_500_000, taxWithheld: 250_000, taxId: '079201001234' })} />,
    );
    expect(container.textContent).toContain('Hoa hồng 2.500.000');
    expect(container.textContent).toContain('khấu trừ thuế TNCN 250.000');
    expect(container.textContent).toContain('MST/CCCD 079201001234');
  });

  it('báo cáo tháng: gọi đúng tháng, bảng theo người nhận cuộn ngang, tổng tháng, người bị khấu trừ thiếu MST được tô cảnh báo', async () => {
    const report = {
      month: '2026-10',
      rows: [
        { userId: 'u1', fullName: 'Nguyễn An', phone: '0901234567', taxId: '079201001234', payoutCount: 2, grossAmount: 5_500_000, taxWithheld: 550_000, netAmount: 4_950_000 },
        { userId: 'u2', fullName: 'Trần Bình', phone: null, taxId: null, payoutCount: 1, grossAmount: 2_100_000, taxWithheld: 210_000, netAmount: 1_890_000 },
      ],
      totals: { recipients: 2, withheldRecipients: 2, grossAmount: 7_600_000, taxWithheld: 760_000, netAmount: 6_840_000 },
    };
    const api = mockFetch({ ...LIST, '/pit-report': { body: report } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<PayoutAdminTab />);
    await flush();
    const monthInput = container.querySelector<HTMLInputElement>('input[aria-label="Tháng báo cáo"]')!;
    expect(monthInput.type).toBe('month');
    typeInto(monthInput, '2026-10');
    await flush();
    expect(api.calls.some((c) => c.url.includes('/admin/payouts/pit-report?month=2026-10'))).toBe(true);
    const region = container.querySelector('[aria-label="Báo cáo khấu trừ thuế TNCN theo người nhận"]')!;
    expect(region.className).toContain('overflow-x-auto');
    expect(region.textContent).toContain('Nguyễn An');
    expect(region.textContent).toContain('079201001234');
    expect(region.textContent).toContain('550.000');
    expect(byText(region as HTMLElement, 'span', 'Thiếu MST/CCCD')?.className).toContain('text-danger-fg');
    expect(container.textContent).toContain('Tổng tháng 10/2026: 2 người nhận · thu nhập 7.600.000');
    expect(container.textContent).toContain('thuế đã khấu trừ 760.000');
  });
});

// D1-05: kế toán chi lệnh đã duyệt; duyệt/từ chối là việc của ADMIN (API chặn 403, màn không hiện nút).
describe('PayoutAdminTab — nhân viên kế toán (canReview=false)', () => {
  it('lệnh REQUESTED: không có nút Duyệt/Từ chối, ghi rõ chờ quản trị viên duyệt', () => {
    const { container } = mount(<PayoutRow payout={payout()} canReview={false} />);
    expect(byText(container, 'button', 'Duyệt')).toBeNull();
    expect(byText(container, 'button', 'Từ chối')).toBeNull();
    expect(container.querySelector('input[aria-label="Ghi chú / lý do"]')).toBeNull();
    expect(container.textContent).toContain('Chờ quản trị viên duyệt');
  });

  it('lệnh APPROVED: vẫn bấm được "Đã chuyển khoản" kèm mã giao dịch', () => {
    const { container } = mount(<PayoutRow payout={payout({ status: 'APPROVED' })} canReview={false} />);
    expect(byText(container, 'button', 'Đã chuyển khoản')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Mã giao dịch ngân hàng"]')).not.toBeNull();
  });

  it('mặc định lọc lệnh đã duyệt chờ chuyển khoản (APPROVED), không phải hàng chờ duyệt', async () => {
    const api = mockFetch(LIST);
    vi.stubGlobal('fetch', vi.fn(api.fn));
    mount(<PayoutAdminTab canReview={false} />);
    await flush();
    expect(api.calls.find((c) => !c.url.includes('/pit-report'))!.url).toContain('status=APPROVED');
  });
});

// Số trên thẻ trang chủ phải khớp số dòng khi bấm vào (quy ước ops-inbox.service). ADMIN thấy cả hai thẻ rút tiền nhưng tab
// mở mặc định ở hàng chờ duyệt, nên bấm thẻ "chờ chi" (đếm APPROVED) từng ra danh sách khác với số trên thẻ.
describe('PayoutAdminTab — mở từ thẻ ở Việc cần xử lý (ADMIN)', () => {
  const inbox = { '/admin/ops/inbox': { body: { generatedAt: '2026-10-14T03:00:00.000Z', items: [{ key: 'payouts', count: 2 }, { key: 'payoutsToPay', count: 5 }] } } };
  const listUrl = (api: ReturnType<typeof mockFetch>) => api.calls.filter((c) => c.url.includes('/admin/payouts?')).at(-1)!.url;

  async function openFromCard(key: string) {
    const api = mockFetch({ ...inbox, ...LIST });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const inboxView = mount(<OpsInboxTab onOpen={() => undefined} />);
    await flush();
    click(inboxView.container.querySelector<HTMLButtonElement>(`[data-inbox="${key}"]`));
    mount(<PayoutAdminTab canReview />);
    await flush();
    return api;
  }

  it('thẻ "Lệnh rút tiền chờ chi" mở danh sách lọc APPROVED', async () => {
    expect(listUrl(await openFromCard('payoutsToPay'))).toContain('status=APPROVED');
  });

  it('thẻ "Lệnh rút tiền chờ duyệt" vẫn mở danh sách lọc REQUESTED', async () => {
    expect(listUrl(await openFromCard('payouts'))).toContain('status=REQUESTED');
  });

  it('mở tab từ thanh menu (không qua thẻ) sau đó vẫn mặc định REQUESTED, không dính lần bấm thẻ trước', async () => {
    await openFromCard('payoutsToPay');
    const api = mockFetch(LIST);
    vi.stubGlobal('fetch', vi.fn(api.fn));
    mount(<PayoutAdminTab canReview />);
    await flush();
    expect(listUrl(api)).toContain('status=REQUESTED');
  });
});
