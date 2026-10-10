// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PayoutRow } from './payout-admin-tab';
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
    expect(d.querySelector('[data-confirm="accept"]')?.className).toContain('bg-red-600');
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
