// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PayoutAdminTab, PayoutRow } from './payout-admin-tab';
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

const LIST = { '/admin/payouts': { body: { data: [], meta: { page: 1, limit: 20, total: 0 } } } };

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
    expect(container.querySelector('input[aria-label="Mã giao dịch ngân hàng"]')?.className).toContain('flex-1');
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
    expect(api.calls[0]!.url).toContain('status=REQUESTED');
  });
});
