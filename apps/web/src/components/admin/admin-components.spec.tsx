// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { RecyclingBadge, RecyclingPanel } from './recycling-panel';
import { ClaimRow } from './dealer-claims-tab';
import { PosScreen } from './pos-screen';
import { GomdonConfigCard } from './gomdon-config-card';
import { LoyaltyConfigCard } from './loyalty-config-card';
import { RecyclingCheckoutSection } from '../recycling-checkout';
import { RecyclingStatus } from '../recycling-status';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
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
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = mount(
      <RecyclingPanel order={order({ gomdonStatus: '1', gomdonOrderId: 'g1', gomdonPartnerCode: 'BE1' })} />,
    );
    click(byText(container, 'button', 'Huỷ vận đơn Gomdon'));
    await flush();
    expect(confirm).toHaveBeenCalled();
    expect(api.calls[0]!.url).toContain('/admin/orders/o1/gomdon/cancel-waybill');
    expect(container.textContent).toContain('Đã huỷ vận đơn BE1.');
  });

  it('badge danh sách: "cần xử lý" khi vận đơn lỗi', () => {
    const { container } = mount(<RecyclingBadge order={order({ gomdonStatus: 'FAILED' })} />);
    expect(container.textContent).toContain('Thu gom: cần xử lý');
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

describe('Web shop — thu gom ở checkout & đơn của tôi', () => {
  it('chuyển khoản → nói rõ lịch thu gom đặt SAU khi thanh toán; COD thì không', () => {
    const props = { selected: true, onSelectedChange: () => {}, note: '', onNoteChange: () => {} };
    const bank = mount(<RecyclingCheckoutSection {...props} paymentMethod="BANK_TRANSFER" />);
    expect(bank.container.textContent).toContain('Lịch thu gom được đặt sau khi Tubu nhận được thanh toán của đơn.');
    const cod = mount(<RecyclingCheckoutSection {...props} paymentMethod="COD" />);
    expect(cod.container.textContent).not.toContain('sau khi Tubu nhận được thanh toán');
  });

  it('chưa bật → không hiện ô ghi chú; bật → ô ghi chú giới hạn 500 ký tự', () => {
    const off = mount(
      <RecyclingCheckoutSection selected={false} onSelectedChange={() => {}} note="" onNoteChange={() => {}} paymentMethod="COD" />,
    );
    expect(off.container.querySelector('textarea')).toBeNull();
    const on = mount(<RecyclingCheckoutSection selected onSelectedChange={() => {}} note="" onNoteChange={() => {}} paymentMethod="COD" />);
    expect(on.container.querySelector('textarea')?.getAttribute('maxlength')).toBe('500');
  });

  it('đơn của tôi: trạng thái thu gom trung thực', () => {
    const o = {
      code: 'TB-1',
      status: 'PENDING_PAYMENT',
      subtotal: 0,
      discount: 0,
      shippingFee: 0,
      total: 0,
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      createdAt: '2026-09-27T00:00:00.000Z',
      items: [],
      hasRecyclingPickup: true,
    };
    const { container } = mount(<RecyclingStatus order={o} />);
    expect(container.textContent).toContain('Chờ thanh toán');
    const none = mount(<RecyclingStatus order={{ ...o, hasRecyclingPickup: false }} />);
    expect(none.container.textContent).toBe('');
  });
});

describe('LoyaltyConfigCard', () => {
  const rows = [
    { key: 'loyalty.checkin_points', value: [1, 1, 1, 1, 1, 1, 2], description: null, category: 'loyalty' },
    { key: 'loyalty.pos_credit_enabled', value: false, description: null, category: 'loyalty' },
    { key: 'loyalty.pos_max_order_total', value: 5000000, description: null, category: 'loyalty' },
    { key: 'loyalty.pos_staff_daily_points_cap', value: 3000, description: null, category: 'loyalty' },
    { key: 'loyalty.pos_member_daily_points_cap', value: 1000, description: null, category: 'loyalty' },
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

  it('7 ô điểm danh; ô sai (>100) → báo lỗi, KHÔNG gửi PUT', async () => {
    const { container, puts } = setup();
    expect(container.querySelectorAll('input[aria-label^="Điểm ngày"]')).toHaveLength(7);
    expect(container.textContent).toContain('Đang TẮT');
    typeInto(container.querySelector('input[aria-label="Điểm ngày 7"]'), '150');
    click(byText(container, 'button', 'Lưu tham số tích điểm'));
    await flush();
    expect(puts).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Ngày 7/);
  });

  it('chỉ gửi khoá có thay đổi', async () => {
    const { container, puts } = setup();
    typeInto(container.querySelector('input[aria-label="Điểm ngày 7"]'), '5');
    click(byText(container, 'button', 'Lưu tham số tích điểm'));
    await flush();
    expect(puts).toEqual([{ key: 'loyalty.checkin_points', value: [1, 1, 1, 1, 1, 1, 5] }]);
  });

  it('công tắc POS lưu ngay loyalty.pos_credit_enabled=true', async () => {
    const { container, puts } = setup();
    click(container.querySelector('input[role="switch"]'));
    await flush();
    expect(puts).toEqual([{ key: 'loyalty.pos_credit_enabled', value: true }]);
  });
});
