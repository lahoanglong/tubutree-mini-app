// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { RecyclingBadge, RecyclingPanel } from './recycling-panel';
import { ClaimRow } from './dealer-claims-tab';
import { PosScreen } from './pos-screen';
import { GomdonConfigCard } from './gomdon-config-card';
import { LoyaltyConfigCard } from './loyalty-config-card';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminDealerRewardClaim, AdminOrder } from '@/lib/admin-client';

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
  code: 'TB-100',
  status: 'CONFIRMED',
  total: 300000,
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  createdAt: '2026-09-27T00:00:00.000Z',
  hasRecyclingPickup: true,
  recyclingNote: '3 cục pin',
  gomdonStatus: null,
  gomdonOrderId: null,
  gomdonPartnerCode: null,
  gomdonCancelStatus: null,
  ...over,
});

describe('RecyclingPanel (chi tiết đơn admin)', () => {
  it('hiện nhãn tiếng Việt, mã vận đơn, ghi chú khách; đơn không thu gom → không render', () => {
    const { container } = mount(
      <RecyclingPanel order={order({ gomdonStatus: '1', gomdonOrderId: 'g1', gomdonPartnerCode: 'BE123' })} />,
    );
    expect(container.textContent).toContain('Tạo đơn thành công');
    expect(container.textContent).toContain('BE123');
    expect(container.textContent).toContain('3 cục pin');
    const none = mount(<RecyclingPanel order={order({ hasRecyclingPickup: false })} />);
    expect(none.container.textContent).toBe('');
  });

  it('NEEDS_MANUAL_CHECK: cảnh báo vận đơn tay, nút tạo lại KHOÁ tới khi tick; gửi confirmedNoWaybill=true', async () => {
    const api = mockFetch({ '/gomdon/retry': { body: { queued: true, message: 'Đã xếp hàng tạo vận đơn Gomdon.' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<RecyclingPanel order={order({ gomdonStatus: 'NEEDS_MANUAL_CHECK' })} />);
    expect(container.textContent).toContain('Pancake');
    const btn = byText(container, 'button', 'Tạo lại vận đơn Gomdon') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    click(container.querySelector('input[type="checkbox"]'));
    expect(btn.disabled).toBe(false);
    click(btn);
    await flush();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.url).toContain('/admin/orders/o1/gomdon/retry');
    expect(api.calls[0]!.init?.body).toBe(JSON.stringify({ confirmedNoWaybill: true }));
    expect(container.textContent).toContain('Đã xếp hàng tạo vận đơn Gomdon.');
  });

  it('FAILED: vẫn bắt tick xác nhận nhưng KHÔNG gửi confirmedNoWaybill; lỗi BE hiện nguyên văn', async () => {
    const msg = 'Gomdon chưa cấu hình (GOMDON_BASE_URL/GOMDON_PHONE/GOMDON_PASSWORD).';
    const api = mockFetch({ '/gomdon/retry': { status: 400, body: { message: msg } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<RecyclingPanel order={order({ gomdonStatus: 'FAILED' })} />);
    click(container.querySelector('input[type="checkbox"]'));
    click(byText(container, 'button', 'Tạo lại vận đơn Gomdon'));
    await flush();
    expect(api.calls[0]!.init?.body).toBe('{}');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(msg);
  });

  it('huỷ vận đơn: hỏi xác nhận rồi POST cancel-waybill', async () => {
    const api = mockFetch({ '/gomdon/cancel-waybill': { body: { result: 'CANCELLED', message: 'Đã huỷ vận đơn BE1.' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const native = vi.spyOn(window, 'confirm');
    const { container } = mount(
      <RecyclingPanel order={order({ gomdonStatus: '1', gomdonOrderId: 'g1', gomdonPartnerCode: 'BE1' })} />,
    );
    click(byText(container, 'button', 'Huỷ vận đơn Gomdon'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('BE1');
    expect(api.calls).toHaveLength(0);
    answerConfirm(true);
    await flush();
    expect(native).not.toHaveBeenCalled();
    expect(api.calls[0]!.url).toContain('/admin/orders/o1/gomdon/cancel-waybill');
    expect(container.textContent).toContain('Đã huỷ vận đơn BE1.');
  });

  it('badge danh sách: "cần xử lý" khi vận đơn lỗi', () => {
    const { container } = mount(<RecyclingBadge order={order({ gomdonStatus: 'FAILED' })} />);
    expect(container.textContent).toContain('Thu gom: cần xử lý');
  });

  it('badge: đơn đang giao / đã xử lý tay → không còn "cần xử lý"', () => {
    const shipping = mount(<RecyclingBadge order={order({ status: 'SHIPPING', gomdonStatus: 'FAILED' })} />);
    expect(shipping.container.textContent).not.toContain('cần xử lý');
    const handled = mount(<RecyclingBadge order={order({ gomdonStatus: 'MANUAL_HANDLED' })} />);
    expect(handled.container.textContent).not.toContain('cần xử lý');
  });

  it('"Đã xử lý tay": hỏi xác nhận — huỷ thì KHÔNG gọi API; đồng ý thì POST mark-handled kèm ghi chú đã trim', async () => {
    const api = mockFetch({ '/gomdon/mark-handled': { body: { result: 'MANUAL_HANDLED', message: 'Đã đánh dấu "Đã xử lý tay".' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const native = vi.spyOn(window, 'confirm');
    const { container } = mount(<RecyclingPanel order={order({ gomdonStatus: 'NOT_CONFIGURED' })} />);
    const btn = byText(container, 'button', 'Đã xử lý tay') as HTMLButtonElement;
    expect(btn).not.toBeNull();

    click(btn);
    await flush();
    answerConfirm(false);
    await flush();
    expect(api.calls).toHaveLength(0);

    typeInto(container.querySelector('input[aria-label="Ghi chú đã xử lý tay"]'), '  đã tạo vận đơn GHN tay  ');
    click(btn);
    await flush();
    expect(confirmDialog()?.textContent).toContain('TB-100');
    answerConfirm(true);
    await flush();
    expect(native).not.toHaveBeenCalled();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.url).toContain('/admin/orders/o1/gomdon/mark-handled');
    expect(api.calls[0]!.init?.method).toBe('POST');
    expect(api.calls[0]!.init?.body).toBe(JSON.stringify({ note: 'đã tạo vận đơn GHN tay' }));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Đã đánh dấu "Đã xử lý tay".');
  });

  it('"Đã xử lý tay": bấm liên tiếp khi đang gửi → chỉ 1 request (chống double-submit); lỗi BE hiện nguyên văn', async () => {
    const msg = 'Trạng thái vận đơn vừa thay đổi — tải lại trang rồi thử lại.';
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        await gate;
        return new Response(JSON.stringify({ message: msg }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const { container } = mount(<RecyclingPanel order={order({ gomdonStatus: 'FAILED' })} />);
    const btn = byText(container, 'button', 'Đã xử lý tay') as HTMLButtonElement;
    click(btn);
    click(btn);
    click(btn);
    await flush();
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    answerConfirm(true);
    await flush();
    expect(calls).toHaveLength(1);
    expect((byText(container, 'button', /Đang lưu|Đã xử lý tay/) as HTMLButtonElement).disabled).toBe(true);
    release();
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(msg);
  });

  it('đơn đang giao: ẩn "Tạo lại vận đơn", vẫn có "Đã xử lý tay"; vận đơn đang chạy (1) → không có "Đã xử lý tay"', () => {
    const shipping = mount(<RecyclingPanel order={order({ status: 'SHIPPING', gomdonStatus: 'FAILED' })} />);
    expect(byText(shipping.container, 'button', 'Tạo lại vận đơn Gomdon')).toBeNull();
    expect(byText(shipping.container, 'button', 'Đã xử lý tay')).not.toBeNull();
    const live = mount(<RecyclingPanel order={order({ gomdonStatus: '1', gomdonOrderId: 'g1', gomdonPartnerCode: 'BE1' })} />);
    expect(byText(live.container, 'button', 'Đã xử lý tay')).toBeNull();
  });

  it('UAT GOMDON-2: báo động chưa xử lý hiện ngay trong chi tiết đơn; "Đã xử lý" gọi API đóng đúng báo động', async () => {
    const api = mockFetch({ '/admin/gomdon/alerts/': { body: { ok: true } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const alerts = [
      { id: 'a1', message: 'Gomdon CÓ vận đơn BE9 cho đơn đã báo tạo tay — kiểm tra ngay tránh giao trùng 2 vận đơn.', createdAt: '2026-10-13T03:00:00.000Z' },
      { id: 'a2', message: 'Huỷ vận đơn Gomdon thất bại.', createdAt: '2026-10-13T02:00:00.000Z' },
    ];
    const o = order({ gomdonStatus: '1', gomdonOrderId: 'g9', gomdonPartnerCode: 'BE9', gomdonAlerts: alerts });
    const { container } = mount(<RecyclingPanel order={o} />);
    const list = container.querySelector('[aria-label="Báo động Gomdon chưa xử lý"]');
    expect(list?.textContent).toContain('tránh giao trùng 2 vận đơn');
    expect(list?.textContent).toContain('Huỷ vận đơn Gomdon thất bại.');
    const buttons = list!.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    click(buttons[0]!);
    click(buttons[0]!);
    await flush();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.url).toContain('/admin/gomdon/alerts/a1/resolve');
    expect(api.calls[0]!.init?.method).toBe('POST');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Đã đánh dấu báo động là đã xử lý');

    const badge = mount(<RecyclingBadge order={o} />);
    expect(badge.container.textContent).toContain('Thu gom: cần xử lý');
  });

  it('UAT GOMDON-9: đơn đã huỷ mà huỷ vận đơn lỗi → có "Đã xử lý tay"; đã xử lý → nhãn "Đã xử lý huỷ tay", không còn nút', () => {
    const failed = mount(
      <RecyclingPanel order={order({ status: 'CANCELLED', gomdonStatus: '1', gomdonOrderId: 'g1', gomdonCancelStatus: 'FAILED' })} />,
    );
    expect(byText(failed.container, 'button', 'Đã xử lý tay')).not.toBeNull();
    const handled = mount(
      <RecyclingPanel order={order({ status: 'CANCELLED', gomdonStatus: '1', gomdonOrderId: 'g1', gomdonCancelStatus: 'MANUAL_HANDLED' })} />,
    );
    expect(handled.container.textContent).toContain('Đã xử lý huỷ tay');
    expect(byText(handled.container, 'button', 'Đã xử lý tay')).toBeNull();
    expect(byText(handled.container, 'button', 'Huỷ vận đơn Gomdon')).toBeNull();
  });
});

const claim = (over: Partial<AdminDealerRewardClaim> = {}): AdminDealerRewardClaim => ({
  id: 'c1',
  userId: 'u1',
  rewardId: 'r1',
  periodKey: 'Q3/2026',
  rewardTitle: 'Tour Phú Quốc',
  rewardType: 'TOUR',
  rewardPeriod: 'QUARTER',
  threshold: 50_000_000,
  volumeAtClaim: 52_000_000,
  note: null,
  status: 'PENDING',
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  paidBy: null,
  paidAt: null,
  adminNote: null,
  createdAt: '2026-09-20T00:00:00.000Z',
  dealer: { id: 'u1', fullName: 'Nguyễn A', phone: '0901234567', businessName: 'Đại lý Xanh' },
  ...over,
});

describe('ClaimRow (yêu cầu nhận thưởng đại lý)', () => {
  it('nhãn tiếng Việt; từ chối không có lý do → KHÔNG gọi API', () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const { container } = mount(<ClaimRow claim={claim()} />);
    expect(container.textContent).toContain('Đang chờ duyệt');
    click(byText(container, 'button', 'Từ chối'));
    expect(f).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/lý do/);
  });

  it('duyệt bị chặn vì doanh số đã chốt tụt → hiện NGUYÊN VĂN message 400', async () => {
    const msg = 'Doanh số đã chốt Q3/2026 của đại lý hiện chỉ còn 40.000.000đ (mốc 50.000.000đ; lúc yêu cầu 52.000.000đ) — có đơn đã huỷ/trả sau khi gửi yêu cầu. Hãy kiểm tra lại hoặc từ chối kèm lý do.';
    const api = mockFetch({ '/approve': { status: 400, body: { message: msg } }, '/admin/dealer-reward-claims': { body: { data: [], meta: { page: 1, limit: 20, total: 0 } } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<ClaimRow claim={claim()} />);
    click(byText(container, 'button', 'Duyệt'));
    await flush();
    expect(api.calls[0]!.url).toContain('/admin/dealer-reward-claims/c1/approve');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(msg);
  });

  it('"Đã trao thưởng": hộp thoại xác nhận — huỷ thì KHÔNG gọi API, đồng ý thì POST mark-paid', async () => {
    const api = mockFetch({
      '/mark-paid': { body: claim({ status: 'PAID' }) },
      '/admin/dealer-reward-claims': { body: { data: [], meta: { page: 1, limit: 20, total: 0 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const native = vi.spyOn(window, 'confirm');
    const { container } = mount(<ClaimRow claim={claim({ status: 'APPROVED' })} />);
    click(byText(container, 'button', 'Đã trao thưởng'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('Tour Phú Quốc');
    answerConfirm(false);
    await flush();
    expect(api.calls).toHaveLength(0);
    click(byText(container, 'button', 'Đã trao thưởng'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(api.calls[0]!.url).toContain('/admin/dealer-reward-claims/c1/mark-paid');
    expect(native).not.toHaveBeenCalled();
  });

  // Q-09: từ chối là trạng thái cuối với đại lý, nên admin cần nút mở lại khi từ chối nhầm.
  it('REJECTED → có nút "Mở lại" (và chỉ nút đó); các trạng thái khác không có', () => {
    const r = mount(<ClaimRow claim={claim({ status: 'REJECTED', rejectionReason: 'Nhầm kỳ' })} />);
    expect(r.container.textContent).toContain('Nhầm kỳ');
    expect(byText(r.container, 'button', 'Mở lại yêu cầu')).not.toBeNull();
    expect(byText(r.container, 'button', 'Duyệt')).toBeNull();
    expect(byText(r.container, 'button', 'Từ chối')).toBeNull();
    for (const status of ['PENDING', 'APPROVED', 'PAID'] as const) {
      const m = mount(<ClaimRow claim={claim({ status })} />);
      expect(byText(m.container, 'button', 'Mở lại yêu cầu')).toBeNull();
    }
  });

  it('"Mở lại yêu cầu": hộp thoại — huỷ thì KHÔNG gọi API; đồng ý thì POST reopen kèm ghi chú đã trim', async () => {
    const api = mockFetch({
      '/reopen': { body: claim({ status: 'PENDING' }) },
      '/admin/dealer-reward-claims': { body: { data: [], meta: { page: 1, limit: 20, total: 0 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<ClaimRow claim={claim({ status: 'REJECTED', rejectionReason: 'Nhầm kỳ' })} />);
    typeInto(container.querySelector('input[aria-label="Ghi chú / lý do"]'), '  từ chối nhầm, đơn không trả  ');
    click(byText(container, 'button', 'Mở lại yêu cầu'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('Tour Phú Quốc');
    answerConfirm(false);
    await flush();
    expect(api.calls).toHaveLength(0);

    click(byText(container, 'button', 'Mở lại yêu cầu'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(api.calls[0]!.url).toContain('/admin/dealer-reward-claims/c1/reopen');
    expect(api.calls[0]!.init?.method).toBe('POST');
    expect(api.calls[0]!.init?.body).toBe(JSON.stringify({ note: 'từ chối nhầm, đơn không trả' }));
  });

  it('mở lại bị API từ chối (admin khác vừa xử lý) → hiện NGUYÊN VĂN message', async () => {
    const msg = 'Yêu cầu đang ở trạng thái "Đang chờ duyệt" — không thể mở lại.';
    const api = mockFetch({
      '/reopen': { status: 400, body: { message: msg } },
      '/admin/dealer-reward-claims': { body: { data: [], meta: { page: 1, limit: 20, total: 0 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<ClaimRow claim={claim({ status: 'REJECTED', rejectionReason: 'x' })} />);
    click(byText(container, 'button', 'Mở lại yêu cầu'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(msg);
  });

  it('APPROVED → chỉ còn nút "Đã trao thưởng"; PAID → không còn nút nào', () => {
    const a = mount(<ClaimRow claim={claim({ status: 'APPROVED' })} />);
    expect(a.container.textContent).toContain('Đã duyệt, chờ trao thưởng');
    expect(byText(a.container, 'button', 'Đã trao thưởng')).not.toBeNull();
    expect(byText(a.container, 'button', 'Duyệt')).toBeNull();
    const p = mount(<ClaimRow claim={claim({ status: 'PAID' })} />);
    expect(p.container.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('PosScreen (màn thu ngân)', () => {
  const member = { id: 'm1', memberCode: 'TUBUABCD1234', name: 'Trần B', phone: '090****567', tier: 'Mầm Xanh', pointsBalance: 120 };

  async function scanned(routes: Parameters<typeof mockFetch>[0]) {
    const api = mockFetch({
      '/me/loyalty/member-card': { body: { posCreditEnabled: true } },
      '/loyalty/staff/scan-member': { body: { member } },
      ...routes,
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = mount(<PosScreen />);
    await flush();
    typeInto(r.container.querySelector('input[aria-label="Mã thành viên"]'), 'TUBUABCD1234');
    click(byText(r.container, 'button', 'Tra cứu'));
    await flush();
    return { ...r, api };
  }

  it('tra cứu → hiện tên, SĐT che, hạng, điểm', async () => {
    const { container } = await scanned({});
    expect(container.textContent).toContain('Trần B');
    expect(container.textContent).toContain('090****567');
    expect(container.textContent).toContain('Mầm Xanh');
    expect(container.textContent).toContain('120');
  });

  it('PD-3: khách có điểm quy đổi → quầy thấy tổng hai lô và phần không hết hạn', async () => {
    const withConverted = { ...member, pointsBalance: 120, pointsConvertedBalance: 30, pointsTotal: 150 };
    const { container } = await scanned({ '/loyalty/staff/scan-member': { body: { member: withConverted } } });
    expect(container.textContent).toContain('150');
    expect(container.textContent).toContain('trong đó 30 điểm không hết hạn');
  });

  it('404 khi tra cứu → hiện message BE', async () => {
    const { container } = await scanned({ '/loyalty/staff/scan-member': { status: 404, body: { message: 'Không tìm thấy thành viên với mã này.' } } });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Không tìm thấy thành viên với mã này.');
  });

  it('mã hoá đơn bắt buộc (không gọi API khi thiếu)', async () => {
    const { container, api } = await scanned({});
    typeInto(container.querySelector('input[aria-label="Tổng tiền hoá đơn"]'), '250000');
    click(byText(container, 'button', 'Tích điểm'));
    await flush();
    expect(api.calls.some((c) => c.url.includes('/pos-credit'))).toBe(false);
    expect(container.textContent).toMatch(/mã hoá đơn/i);
  });

  it('bấm 2 lần liền → chỉ 1 request; replayed → báo "ĐÃ được tích điểm trước đó", khoá form', async () => {
    let resolve!: (v: Response) => void;
    const pending = new Promise<Response>((r) => (resolve = r));
    const { container, api } = await scanned({});
    const baseFetch = api.fn;
    const creditCalls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url.includes('/pos-credit')) {
          creditCalls.push(String(init?.body));
          return pending;
        }
        return baseFetch(url, init);
      }),
    );
    typeInto(container.querySelector('input[aria-label="Tổng tiền hoá đơn"]'), '250.000');
    typeInto(container.querySelector('input[aria-label="Mã hoá đơn POS"]'), 'HD-001');
    const form = container.querySelectorAll('form')[1]!;
    // 2 lần submit trong cùng một tick (trước khi React kịp render nút disabled).
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    expect(creditCalls).toHaveLength(1);
    expect(creditCalls[0]).toBe(JSON.stringify({ memberCode: 'TUBUABCD1234', orderTotal: 250000, receiptId: 'HD-001' }));
    await act(async () =>
      resolve(
      new Response(
        JSON.stringify({
          replayed: true,
          member: { ...member, pointsBalance: 145 },
          posTransaction: { receiptId: 'HD-001', orderTotal: 250000, pointsEarned: 25, creditedAt: '2026-09-27T01:00:00.000Z' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
      ),
    );
    await flush();
    expect(container.textContent).toContain('ĐÃ được tích điểm trước đó');
    expect((container.querySelector('input[aria-label="Mã hoá đơn POS"]') as HTMLInputElement).disabled).toBe(true);
    expect(byText(container, 'button', 'Khách tiếp theo')).not.toBeNull();
  });

  it('tính năng tắt → banner cảnh báo ngay khi mở màn; 403 khi cộng → thông báo cách bật', async () => {
    const api = mockFetch({
      '/me/loyalty/member-card': { body: { posCreditEnabled: false } },
      '/loyalty/staff/scan-member': { body: { member } },
      '/loyalty/staff/pos-credit': { status: 403, body: { message: 'Tính năng tích điểm tại quầy (POS) đang tắt. Liên hệ quản trị viên.' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<PosScreen />);
    await flush();
    expect(container.textContent).toContain('Tích điểm tại quầy đang TẮT');
    typeInto(container.querySelector('input[aria-label="Mã thành viên"]'), 'TUBUABCD1234');
    click(byText(container, 'button', 'Tra cứu'));
    await flush();
    typeInto(container.querySelector('input[aria-label="Tổng tiền hoá đơn"]'), '250000');
    typeInto(container.querySelector('input[aria-label="Mã hoá đơn POS"]'), 'HD-002');
    click(byText(container, 'button', 'Tích điểm'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('loyalty.pos_credit_enabled');
  });

  it('vượt trần ngày → hiện nguyên văn message BE', async () => {
    const cap = 'Thành viên đã được tích 990/1000 điểm tại quầy hôm nay — vượt trần ngày. Liên hệ quản trị viên.';
    const { container } = await scanned({ '/loyalty/staff/pos-credit': { status: 400, body: { message: cap } } });
    typeInto(container.querySelector('input[aria-label="Tổng tiền hoá đơn"]'), '250000');
    typeInto(container.querySelector('input[aria-label="Mã hoá đơn POS"]'), 'HD-003');
    click(byText(container, 'button', 'Tích điểm'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(cap);
  });
});

describe('GomdonConfigCard', () => {
  it('UAT GOMDON-1: Gomdon từ chối tài khoản → cảnh báo rõ; "Kiểm tra kết nối" gọi API và hiện kết quả nguyên văn', async () => {
    let checks = 0;
    const api = mockFetch({
      '/admin/gomdon/status': {
        body: {
          baseUrlSet: true,
          credentialsSet: true,
          configured: true,
          webhookSecretSet: true,
          recyclingToggle: true,
          recyclingEnabled: false,
          connection: {
            lastOkAt: null,
            lastErrorAt: '2026-10-13T03:00:00.000Z',
            lastError: 'Đăng nhập Gomdon thất bại (HTTP 401): Sai mật khẩu',
            credentialsRejected: true,
            credentialsRejectedAt: '2026-10-13T03:00:00.000Z',
          },
        },
      },
      '/admin/gomdon/check-connection': () => {
        checks += 1;
        return checks === 1
          ? { body: { ok: false, message: 'Đăng nhập Gomdon thất bại (HTTP 401): Sai mật khẩu', checkedAt: '2026-10-13T03:05:00.000Z' } }
          : { body: { ok: true, message: 'Đăng nhập Gomdon thành công.', checkedAt: '2026-10-13T03:06:00.000Z' } };
      },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<GomdonConfigCard rows={[]} />);
    await flush();
    expect(container.textContent).toContain('Gomdon đang từ chối tài khoản');
    expect(container.textContent).toContain('Sai mật khẩu');
    expect(container.textContent).not.toContain('Công tắc đang bật nhưng khách vẫn KHÔNG thấy lựa chọn thu gom vì Gomdon chưa cấu hình đủ');

    click(byText(container, 'button', 'Kiểm tra kết nối'));
    await flush();
    const call = api.calls.find((c) => c.url.includes('/admin/gomdon/check-connection'));
    expect(call?.init?.method).toBe('POST');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('HTTP 401');

    click(byText(container, 'button', 'Kiểm tra kết nối'));
    await flush();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Đăng nhập Gomdon thành công.');
  });

  it('ghi chú tài khoản nằm ở env; không bao giờ hiện mật khẩu; lưu chỉ thay kho + cân nặng', async () => {
    const puts: unknown[] = [];
    const api = mockFetch({
      '/admin/gomdon/status': {
        body: { baseUrlSet: true, credentialsSet: false, configured: false, webhookSecretSet: false, recyclingToggle: true, recyclingEnabled: false },
      },
      '/admin/config': (init) => {
        if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)));
        return { body: { ok: true } };
      },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const rows = [
      {
        key: 'shipping.gomdon.config',
        value: {
          password: '••••••••',
          defaultWarehouse: { name: 'Kho HCM', phone: '0965573541', address: '1 Đường 2', ward: 'P. Long Bình', district: '', province: 'HCM' },
          defaultWeightFallback: 500,
        },
        description: null,
        category: 'shipping',
      },
      { key: 'shipping.gomdon.recycling_enabled', value: true, description: null, category: 'shipping' },
    ];
    const { container } = mount(<GomdonConfigCard rows={rows} />);
    await flush();
    expect(container.textContent).toContain('GOMDON_PASSWORD');
    expect(container.textContent).toContain('KHÔNG thấy');
    expect(container.textContent).toContain('Công tắc đang bật nhưng khách vẫn KHÔNG thấy');
    expect(container.innerHTML).not.toContain('••••••••');
    const weight = byText(container, 'label', 'Cân nặng mặc định')!.querySelector('input');
    typeInto(weight, '800');
    click(byText(container, 'button', 'Lưu kho & cân nặng'));
    await flush();
    expect(puts).toEqual([
      {
        key: 'shipping.gomdon.config',
        value: {
          password: '••••••••',
          defaultWarehouse: { name: 'Kho HCM', phone: '0965573541', address: '1 Đường 2', ward: 'P. Long Bình', district: '', province: 'HCM' },
          defaultWeightFallback: 800,
        },
      },
    ]);
  });
});

describe('LoyaltyConfigCard', () => {
  const rows = [
    { key: 'loyalty.checkin_points', value: [1000, 1000, 1000, 1000, 1000, 1000, 2000], description: null, category: 'loyalty' },
    { key: 'loyalty.pos_credit_enabled', value: false, description: null, category: 'loyalty' },
    { key: 'loyalty.pos_max_order_total', value: 5000000, description: null, category: 'loyalty' },
    { key: 'loyalty.pos_staff_daily_points_cap', value: 3_000_000, description: null, category: 'loyalty' },
    { key: 'loyalty.pos_member_daily_points_cap', value: 1_000_000, description: null, category: 'loyalty' },
  ];

  function setup() {
    const puts: { key: string; value: unknown }[] = [];
    const api = mockFetch({
      '/admin/config': (init) => {
        if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)));
        return { body: { ok: true } };
      },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    return { puts, ...mount(<LoyaltyConfigCard rows={rows} />) };
  }

  it('7 ô điểm danh; ô sai (>100.000) → báo lỗi, KHÔNG gửi PUT', async () => {
    const { container, puts } = setup();
    expect(container.querySelectorAll('input[aria-label^="Điểm ngày"]')).toHaveLength(7);
    expect(container.textContent).toContain('Đang TẮT');
    typeInto(container.querySelector('input[aria-label="Điểm ngày 7"]'), '150000');
    click(byText(container, 'button', 'Lưu tham số tích điểm'));
    await flush();
    expect(puts).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Ngày 7/);
  });

  it('chỉ gửi khoá có thay đổi', async () => {
    const { container, puts } = setup();
    typeInto(container.querySelector('input[aria-label="Điểm ngày 7"]'), '5000');
    click(byText(container, 'button', 'Lưu tham số tích điểm'));
    await flush();
    expect(puts).toEqual([{ key: 'loyalty.checkin_points', value: [1000, 1000, 1000, 1000, 1000, 1000, 5000] }]);
  });

  it('công tắc POS lưu ngay loyalty.pos_credit_enabled=true', async () => {
    const { container, puts } = setup();
    click(container.querySelector('input[role="switch"]'));
    await flush();
    expect(puts).toEqual([{ key: 'loyalty.pos_credit_enabled', value: true }]);
  });
});
