// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

type Call = { method: string; path: string; body?: unknown };

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  me: null as Record<string, unknown> | null,
  dash: null as Record<string, unknown> | null,
  links: [] as unknown[],
  commissions: [] as unknown[],
  payouts: [] as unknown[],
  tax: { year: 2026, fullName: null, taxId: null, items: [], totals: { grossAmount: 0, taxWithheld: 0, netAmount: 0 } } as Record<string, unknown>,
  fail: new Set<string>(),
  calls: [] as Call[],
  share: vi.fn(),
  copied: [] as string[],
  registerGate: null as null | Promise<unknown>,
  routeReady: { gianHang: true },
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/platform-bridge', () => ({ platformBridge: { share: (...a: unknown[]) => state.share(...a) } }));
vi.mock('@/lib/route-map', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/route-map')>()),
  isWebRouteReady: (p: string) => p === '/hoc-vien' || (p === '/ctv/gian-hang' && state.routeReady.gianHang),
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push({ method: 'get', path });
      if (state.fail.has(path)) throw new Error('mất mạng');
      if (path === '/affiliate/me') return state.me;
      if (path === '/affiliate/dashboard') return state.dash;
      if (path === '/affiliate/links') return state.links;
      if (path === '/affiliate/commissions') return state.commissions;
      if (path === '/affiliate/payouts') return state.payouts;
      if (path === '/config/public') return { affiliateMinWithdrawBank: 70_000 };
      return state.tax;
    },
    post: async (path: string, body?: unknown) => {
      state.calls.push({ method: 'post', path, body });
      if (path === '/affiliate/register') await state.registerGate;
      return { ok: true, referralCode: 'TUBU88', shortCode: 'x' };
    },
  },
}));

import AffiliatePage from './page';

let mounted: Rendered[] = [];
const mount = () => {
  const r = render(<AffiliatePage />);
  mounted.push(r);
  return r;
};
const posts = () => state.calls.filter((c) => c.method === 'post');

const DASH = {
  todayCommission: 5_000,
  monthCommission: 125_000,
  pendingCommission: 30_000,
  withdrawableCommission: 80_000,
  withdrawingCommission: 20_000,
  totalClicks: 4,
  totalConversions: 1,
  monthRevenue: 0,
  tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
};

beforeEach(() => {
  state.phase = 'authenticated';
  state.me = { isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 };
  state.dash = DASH;
  state.links = [];
  state.commissions = [];
  state.payouts = [];
  state.fail = new Set();
  state.calls = [];
  state.share = vi.fn(async () => 'shared');
  state.registerGate = null;
  state.routeReady.gianHang = true;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void state.copied.push(t) } });
  state.copied = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/ctv — cổng vào theo phiên', () => {
  it('khách: nút đăng nhập mang returnTo=/ctv và không gọi API CTV', async () => {
    state.phase = 'guest';
    const { container } = mount();
    await flush();
    expect(container.querySelector('a[href="/dang-nhap?returnTo=%2Fctv"]')).not.toBeNull();
    expect(state.calls).toEqual([]);
  });

  it('đang khôi phục phiên: hiện "Đang tải…", chưa gọi API', async () => {
    state.phase = 'loading';
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Đang tải…');
    expect(state.calls).toEqual([]);
  });

  it('mất kết nối lúc khôi phục: nói đúng chuyện đó, không mời đăng nhập', async () => {
    state.phase = 'unavailable';
    const { container } = mount();
    await flush();
    expect(container.querySelector('a[href^="/dang-nhap"]')).toBeNull();
    expect(container.textContent).toMatch(/kết nối/i);
  });

  it('lỗi tải /affiliate/me: có nút Thử lại gọi lại API', async () => {
    state.fail.add('/affiliate/me');
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('mất mạng');
    state.fail.clear();
    click(byText(container, 'button', 'Thử lại'));
    await flush();
    expect(container.textContent).toContain('Hoa hồng tháng này');
  });

  it('đúng một h1 ở trạng thái đăng ký và bảng điều khiển', async () => {
    state.me = { isAffiliate: false, referralCode: '', walletBalance: 0 };
    const a = mount();
    await flush();
    expect(a.container.querySelectorAll('h1')).toHaveLength(1);
    state.me = { isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 };
    const b = mount();
    await flush();
    expect(b.container.querySelectorAll('h1')).toHaveLength(1);
  });
});

describe('/ctv — đăng ký CTV (điều khoản hoa hồng & thuế)', () => {
  beforeEach(() => {
    state.me = { isAffiliate: false, referralCode: '', walletBalance: 0 };
  });

  it('hiện điều khoản, mức rút tối thiểu lấy từ cấu hình, nút bị khoá tới khi tick đồng ý, không gọi API', async () => {
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Điều khoản hoa hồng & thuế');
    expect(container.textContent).toContain('hết thời gian đổi/trả');
    expect(container.textContent).toContain('tối thiểu 70k');
    const btn = byText(container, 'button', 'Đăng ký miễn phí ngay') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(container.textContent).toContain('Chọn ô đồng ý điều khoản để đăng ký');
    click(btn);
    await flush();
    expect(posts()).toEqual([]);
  });

  it('tick đồng ý rồi đăng ký: POST /affiliate/register {termsVersion} đúng một lần, rồi vào bảng điều khiển', async () => {
    const { container } = mount();
    await flush();
    click(container.querySelector('input[type="checkbox"]'));
    state.me = { isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 };
    click(byText(container, 'button', 'Đăng ký miễn phí ngay'));
    await flush();
    expect(posts()).toEqual([{ method: 'post', path: '/affiliate/register', body: { termsVersion: '2026-10' } }]);
    expect(container.textContent).toContain('Hoa hồng tháng này');
  });

  it('bấm đăng ký hai lần trong lúc đang gửi: chỉ một POST', async () => {
    let release!: () => void;
    state.registerGate = new Promise<void>((r) => (release = r));
    const { container } = mount();
    await flush();
    click(container.querySelector('input[type="checkbox"]'));
    const btn = byText(container, 'button', 'Đăng ký miễn phí ngay');
    click(btn);
    click(btn);
    await flush();
    expect(posts()).toHaveLength(1);
    release();
    await flush();
  });

  it('đại lý/nhân viên không đăng ký được (canRegister=false): không có form, có đường về hồ sơ', async () => {
    state.me = { isAffiliate: false, canRegister: false, referralCode: '', walletBalance: 0 };
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Tài khoản này không đăng ký CTV được');
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container.querySelector('a[href="/tai-khoan"]')).not.toBeNull();
  });
});

describe('/ctv — bảng điều khiển', () => {
  it('thẻ hoa hồng tháng, số đang chờ, có thể rút và dòng đang rút đúng số', async () => {
    const { container } = mount();
    await flush();
    const t = container.textContent ?? '';
    expect(t).toContain('125.000đ');
    expect(t).toContain('30.000đ');
    expect(t).toContain('80.000đ');
    expect(t).toContain('Đang rút 20.000đ về ngân hàng');
  });

  it('lỗi tải dashboard: không hiện 0đ giả, thẻ số liệu hiện — và có Thử lại', async () => {
    state.fail.add('/affiliate/dashboard');
    const { container } = mount();
    await flush();
    expect(container.textContent).not.toContain('Hoa hồng tháng này');
    expect(container.textContent).toContain('—');
    expect(byText(container, 'button', 'Thử lại')).not.toBeNull();
  });

  it('lối tắt: Chia sẻ, Gian hàng (link /ctv/gian-hang), Lên đơn hộ, Rút tiền theo cờ của /affiliate/me', async () => {
    const { container } = mount();
    await flush();
    const group = container.querySelector('[role="group"]')!;
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Chia sẻ', 'Lên đơn hộ', 'Rút tiền']);
    expect(group.querySelector('a[href="/ctv/gian-hang"]')?.textContent).toContain('Gian hàng');
  });

  it('đại lý chưa có gian hàng và chưa được lên đơn hộ: chỉ còn Chia sẻ và Rút tiền', async () => {
    state.me = { isAffiliate: true, canOpenStorefront: false, canOrderForCustomer: false, referralCode: 'TUBU88', walletBalance: 0 };
    const { container } = mount();
    await flush();
    const group = container.querySelector('[role="group"]')!;
    expect(group.querySelector('a')).toBeNull();
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Chia sẻ', 'Rút tiền']);
  });

  it('trang Gian hàng web chưa làm xong thì không có lối tắt Gian hàng', async () => {
    state.routeReady.gianHang = false;
    const { container } = mount();
    await flush();
    expect(container.querySelector('a[href="/ctv/gian-hang"]')).toBeNull();
  });

  it('Rút tiền khoá khi chưa có hoa hồng rút được', async () => {
    state.dash = { ...DASH, withdrawableCommission: 0 };
    const { container } = mount();
    await flush();
    expect((byText(container, '[role="group"] button', 'Rút tiền') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Rút tiền và Lên đơn hộ chưa làm: bấm không gọi API nào', async () => {
    const { container } = mount();
    await flush();
    const before = state.calls.length;
    click(byText(container, '[role="group"] button', 'Rút tiền'));
    click(byText(container, '[role="group"] button', 'Lên đơn hộ'));
    await flush();
    expect(state.calls.length).toBe(before);
    expect(posts()).toEqual([]);
  });

  it('Chia sẻ qua bridge với đường dẫn có mã; chép link thì báo đã chép; thất bại thì báo gửi mã thủ công', async () => {
    const { container } = mount();
    await flush();
    state.share = vi.fn(async () => 'copied');
    click(byText(container, '[role="group"] button', 'Chia sẻ'));
    await flush();
    expect(state.share).toHaveBeenCalledWith(expect.objectContaining({ path: '/?ref=TUBU88', text: expect.stringContaining('dùng mã TUBU88') }));
    expect(container.textContent).toContain('Đã chép liên kết giới thiệu');
    state.share = vi.fn(async () => 'failed');
    click(byText(container, '[role="group"] button', 'Chia sẻ'));
    await flush();
    expect(container.textContent).toContain('Bạn gửi mã TUBU88 cho bạn bè nhé');
  });

  it('danh sách link: rỗng có lời mời; có link thì sao chép đúng URL kèm ref và l', async () => {
    const empty = mount();
    await flush();
    expect(empty.container.textContent).toContain('Chưa có link');
    state.links = [{ id: 'l1', shortCode: 'abc123', targetType: 'HOMEPAGE', targetId: null, clicks: 3, conversions: 1, revenue: 0, createdAt: '2026-10-01T00:00:00Z' }];
    const full = mount();
    await flush();
    expect(full.container.textContent).toContain('Trang chủ');
    expect(full.container.textContent).toContain('3 click · 1 đơn');
    click(byText(full.container, 'button', 'Sao chép'));
    await flush();
    expect(state.copied[0]).toMatch(/\/\?ref=TUBU88&l=abc123$/);
  });

  it('+ Tạo link: POST /affiliate/links {targetType: HOMEPAGE} đúng một lần dù bấm hai lần', async () => {
    const { container } = mount();
    await flush();
    const btn = byText(container, 'button', '+ Tạo link');
    click(btn);
    click(btn);
    await flush();
    expect(posts()).toEqual([{ method: 'post', path: '/affiliate/links', body: { targetType: 'HOMEPAGE', targetId: undefined } }]);
  });

  it('lịch sử hoa hồng: số, mã đơn, trạng thái đơn và nhãn như Mini App; khoản đang rút không bị ghi "Đã trả"', async () => {
    state.commissions = [
      { id: 'c1', orderId: 'o1', orderCode: 'TB1', orderTotal: 500_000, rate: '0.1', amount: 50_000, status: 'APPROVED', createdAt: '2026-10-02T03:00:00Z', orderStatus: 'DELIVERED' },
      { id: 'c2', orderId: 'o2', orderTotal: 100_000, rate: '0.1', amount: 10_000, status: 'APPROVED', createdAt: '2026-10-03T03:00:00Z', withdrawing: true },
      { id: 'c3', orderId: 'o3', orderTotal: 100_000, rate: '0.1', amount: 10_000, status: 'LOCKED', createdAt: '2026-10-03T03:00:00Z' },
    ];
    const { container } = mount();
    await flush();
    const t = container.textContent ?? '';
    expect(t).toContain('+50.000đ');
    expect(t).toContain('Đơn TB1 · 500.000đ');
    expect(t).toContain('Giao thành công');
    expect(t).toContain('Có thể rút');
    expect(t).toContain('Đang rút');
    expect(t).toContain('Đang chờ · đang giữ');
  });

  it('lịch sử hoa hồng: rỗng có lời mời, lỗi tải có Thử lại', async () => {
    const a = mount();
    await flush();
    expect(a.container.textContent).toContain('Chưa có hoa hồng');
    state.fail.add('/affiliate/commissions');
    const b = mount();
    await flush();
    expect(b.container.textContent).toContain('mất mạng');
  });

  it('lệnh rút: trạng thái, phương thức, thuế đã khấu trừ, lý do từ chối, mã giao dịch; năm có khấu trừ thì có tổng thuế', async () => {
    state.payouts = [
      { id: 'p1', amount: 90_000, grossAmount: 100_000, taxWithheld: 10_000, fee: 0, method: 'BANK', status: 'PAID', rejectionReason: null, bankRef: 'FT123', requestedAt: '2026-10-01T03:00:00Z', reviewedAt: null, paidAt: null },
      { id: 'p2', amount: 50_000, grossAmount: 50_000, taxWithheld: 0, fee: 0, method: 'WALLET_BALANCE', status: 'REJECTED', rejectionReason: 'Sai tài khoản', bankRef: null, requestedAt: '2026-10-02T03:00:00Z', reviewedAt: null, paidAt: null },
    ];
    state.tax = { year: 2026, fullName: null, taxId: null, items: [], totals: { grossAmount: 100_000, taxWithheld: 10_000, netAmount: 90_000 } };
    const { container } = mount();
    await flush();
    const t = container.textContent ?? '';
    expect(t).toContain('Đã chuyển');
    expect(t).toContain('Về ngân hàng');
    expect(t).toContain('đã khấu trừ thuế TNCN 10.000đ');
    expect(t).toContain('Mã giao dịch: FT123');
    expect(t).toContain('Bị từ chối');
    expect(t).toContain('Về Ví Tubu');
    expect(t).toContain('Lý do: Sai tài khoản');
    expect(t).toContain('Năm 2026: thu nhập hoa hồng 100.000đ');
  });

  it('lệnh rút rỗng: "Chưa có lệnh rút nào."', async () => {
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Chưa có lệnh rút nào.');
  });

  it('lối sang /hoc-vien chỉ hiện khi route web đã sẵn sàng', async () => {
    const { container } = mount();
    await flush();
    expect(container.querySelector('a[href="/hoc-vien"]')).not.toBeNull();
  });
});
