import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  copyText: vi.fn(),
  login: vi.fn(),
  restore: vi.fn(),
  authStatus: 'authenticated' as 'authenticated' | 'idle' | 'error' | 'loading',
  notifications: [] as { status: string }[],
  coreGet: vi.fn(),
  role: 'CUSTOMER',
  affiliateMe: { isAffiliate: false, canRegister: false } as { isAffiliate: boolean; canRegister: boolean },
  getPublicConfig: vi.fn(async () => ({})),
  chatSummary: vi.fn(),
  guest: false,
  orderCounts: vi.fn(),
  search: '',
  deskPoints: vi.fn(),
  authMeFlags: vi.fn(),
  getReferral: vi.fn(),
  getSubscriptions: vi.fn(),
  shareLink: vi.fn(),
  cashback: false,
  subscriptions: true,
  activeSubs: 1,
}));
vi.mock('../utils/features', () => ({
  get CASHBACK_ENABLED() {
    return mocks.cashback;
  },
  SEASON_PASS_ENABLED: false,
  get SUBSCRIPTIONS_IN_MINIAPP() {
    return mocks.subscriptions;
  },
}));
vi.mock('../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPublicConfig: mocks.getPublicConfig,
}));
// Số đơn, tin chưa đọc và gói định kỳ đi qua MỘT lời gọi /me/summary của coreHttp; mọi đường khác ở đây là lời gọi lạ.
vi.mock('../services/core-http', () => ({
  coreHttp: {
    get: (path: string) => {
      mocks.coreGet(path);
      if (path === '/me/summary') {
        return Promise.resolve(mocks.orderCounts()).then((counts: Record<string, number>) => ({
          orders: { ...counts, active: (counts.pending_payment ?? 0) + (counts.processing ?? 0) + (counts.shipping ?? 0) },
          unreadNotifications: mocks.notifications.filter((n) => n.status !== 'READ').length,
          activeSubscriptions: mocks.activeSubs,
        }));
      }
      return Promise.reject(new Error(`không mock ${path}`));
    },
  },
}));
vi.mock('../services/waste-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDeskPoints: mocks.deskPoints,
}));
vi.mock('../services/zmp-bridge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  shareLink: mocks.shareLink,
}));
vi.mock('../services/subscriptions-api', () => ({ getSubscriptions: mocks.getSubscriptions }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Avatar: () => <span />,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ search: mocks.search }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/support-chat-api', () => ({
  supportChatSummaryQueryOptions: () => ({ queryKey: ['support-chat-summary'], queryFn: mocks.chatSummary }),
}));
vi.mock('../services/account-api', () => ({
  getLoyalty: vi.fn().mockResolvedValue({ pointsBalance: 120, pointsConvertedBalance: 30, tier: { name: 'Mầm Xanh' } }),
  getWallet: vi.fn().mockResolvedValue({ walletBalance: 50000 }),
  getCoupons: vi.fn().mockResolvedValue([{ code: 'A' }, { code: 'B' }]),
  getReferral: mocks.getReferral,
}));
vi.mock('../services/brand-owner-api', () => ({ getOwnedBrand: vi.fn().mockResolvedValue(null), getAuthMeFlags: mocks.authMeFlags }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn(async () => mocks.affiliateMe) }));
vi.mock('../services/dealer-api', () => ({ getDealerMe: vi.fn().mockResolvedValue({ isDealer: false, status: null }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../store/auth', () => {
  const state = () => ({
    status: mocks.authStatus,
    error: null,
    user: { fullName: 'Lan', role: mocks.role, referralCode: 'LAN1', pointsBalance: 100, walletBalance: 40000, avatarUrl: null, phone: mocks.guest ? null : '0901234567', zaloId: mocks.guest ? 'guest_1' : 'z1' },
    logout: vi.fn(),
    ensurePhone: vi.fn(),
    restore: mocks.restore,
  });
  const useAuthStore = Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(state()) : state()), {
    getState: () => ({ ...state(), login: mocks.login }),
  });
  return { useAuthStore };
});

import ProfilePage from './profile';
import { miniAppLink } from '../utils/miniapp-link';
import { getWallet } from '../services/account-api';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ProfilePage /></QueryClientProvider>);
}

const REFERRAL = { referralCode: 'LAN1', successCount: 0, earnedPoints: 0, minOrderAmount: 200_000, windowDays: 30 };
function arrangeDefaults() {
  mocks.guest = false;
  mocks.orderCounts.mockResolvedValue({ pending_payment: 2, processing: 0, shipping: 1, delivered: 0, closed: 0 });
  mocks.deskPoints.mockResolvedValue([]);
  mocks.authMeFlags.mockResolvedValue({ ownsBrand: null, hasDeskPoint: false });
  mocks.search = '';
  mocks.getReferral.mockResolvedValue(REFERRAL);
  mocks.getSubscriptions.mockResolvedValue([{ status: 'ACTIVE' }, { status: 'CANCELLED' }]);
}

describe('Thanh số dư ở hub Cá nhân (C-086)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrangeDefaults();
    mocks.authStatus = 'authenticated';
    mocks.notifications = [];
    mocks.role = 'CUSTOMER';
    mocks.cashback = false;
  });

  it('cờ CASHBACK_ENABLED bật: Hoàn tiền sàn ngoài có lối vào ở nhóm Tài khoản và mở /cashback; tắt thì ẩn', async () => {
    mocks.cashback = true;
    const { unmount } = renderPage();
    fireEvent.click(await screen.findByText('Hoàn tiền sàn ngoài'));
    expect(mocks.navigate).toHaveBeenCalledWith('/cashback');
    unmount();
    mocks.cashback = false;
    renderPage();
    await screen.findByText('Câu chuyện thương hiệu');
    expect(screen.queryByText('Hoàn tiền sàn ngoài')).toBeNull();
  });

  it('có đúng ba số dư: Điểm Xanh (tổng hai lô), Ví Tubu, Mã giảm giá — không còn ô xu (C-047, PD-3)', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /^2 mã\s*Mã giảm giá$/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^150 điểm\s*Điểm Xanh$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^50\.000đ\s*Ví Tubu$/ })).toBeInTheDocument();
    const balances = ['Điểm Xanh', 'Ví Tubu', 'Mã giảm giá'].map((label) => screen.getAllByRole('button').find((b) => b.getAttribute('aria-label') === null && (b.textContent ?? '').endsWith(label)));
    expect(balances.every(Boolean)).toBe(true);
    expect(screen.queryByText(/TubuXu/)).toBeNull();
    expect(screen.queryByRole('button', { name: /(?<![\p{L}_])xu(?![\p{L}_])/iu })).toBeNull();
  });

  it('ví từ một triệu xuống price-sm để số không tràn ô ở 320px; ví nhỏ giữ price-md', async () => {
    vi.mocked(getWallet).mockResolvedValue({ walletBalance: 1_234_567 } as never);
    try {
      const { unmount } = renderPage();
      const big = await screen.findByRole('button', { name: /^1\.234\.567đ\s*Ví Tubu$/ });
      expect(within(big).getByText('1.234.567đ').parentElement!.style.fontSize).toBe('var(--type-price-sm-size)');
      expect(within(big).getByText('1.234.567đ').parentElement!.style.lineHeight).toBe('calc(var(--type-price-md-size) * var(--type-price-md-lh))');
      unmount();
    } finally {
      vi.mocked(getWallet).mockResolvedValue({ walletBalance: 50000 } as never);
    }
    renderPage();
    const small = await screen.findByRole('button', { name: /^50\.000đ\s*Ví Tubu$/ });
    expect(within(small).getByText('50.000đ').parentElement!.style.fontSize).toBe('var(--type-price-md-size)');
  });

  // jsdom không dựng chữ: giả bề ngang ô 93,33px (màn 320px) và bề ngang chữ theo cỡ đang vẽ.
  const fakeWidths = (chars: (size: string) => number) => {
    const real = Element.prototype.getBoundingClientRect;
    return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const box = (width: number) => ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) }) as DOMRect;
      if (this.getAttribute('role') === 'button' && this.textContent?.endsWith('Ví Tubu')) return box(93.33);
      if (this.tagName === 'SPAN' && this.textContent === '50.000đ') return box(chars((this.parentElement as HTMLElement).style.fontSize));
      return real.call(this);
    });
  };

  it('đo chữ thật: chữ không vừa ô (cách mép dưới 6px) thì lùi một cỡ, vừa rồi thì dừng', async () => {
    const rect = fakeWidths((size) => (size === 'var(--type-price-md-size)' ? 90 : 70));
    try {
      renderPage();
      const tile = await screen.findByRole('button', { name: /^50\.000đ\s*Ví Tubu$/ });
      await waitFor(() => expect(within(tile).getByText('50.000đ').parentElement!.style.fontSize).toBe('var(--type-price-sm-size)'));
      expect(within(tile).getByText('50.000đ').style.whiteSpace).toBe('nowrap');
    } finally {
      rect.mockRestore();
    }
  });

  it('đo chữ thật: tới cỡ nhỏ nhất vẫn không vừa thì khít -0,04em và cho xuống dòng trong ô, không tràn ngang', async () => {
    const rect = fakeWidths(() => 100);
    try {
      renderPage();
      const tile = await screen.findByRole('button', { name: /^50\.000đ\s*Ví Tubu$/ });
      await waitFor(() => expect(within(tile).getByText('50.000đ').parentElement!.style.letterSpacing).toBe('-0.04em'));
      const value = within(tile).getByText('50.000đ');
      expect(value.parentElement!.style.fontSize).toBe('var(--type-label-size)');
      expect(value.style.whiteSpace).toBe('');
      expect(value.parentElement!.style.overflowWrap).toBe('anywhere');
    } finally {
      rect.mockRestore();
    }
  });

  it('ví 10 triệu tới 100 triệu xuống cỡ label 12px, giữ dòng 22px, xuống dòng trong ô thay vì tràn ngang', async () => {
    vi.mocked(getWallet).mockResolvedValue({ walletBalance: 100_000_000 } as never);
    try {
      renderPage();
      const big = await screen.findByRole('button', { name: /^100\.000\.000đ\s*Ví Tubu$/ });
      const value = within(big).getByText('100.000.000đ').parentElement!;
      expect(value.style.fontSize).toBe('var(--type-label-size)');
      expect(value.style.lineHeight).toBe('calc(var(--type-price-md-size) * var(--type-price-md-lh))');
      expect(value.style.overflowWrap).toBe('anywhere');
    } finally {
      vi.mocked(getWallet).mockResolvedValue({ walletBalance: 50000 } as never);
    }
  });

  it('khách thường thấy lời mời "Mở gian hàng Cộng tác viên" (không nhắc hoa hồng); CTV thấy "Cộng tác viên"', async () => {
    const { unmount } = renderPage();
    expect(await screen.findByText('Mở gian hàng Cộng tác viên')).toBeInTheDocument();
    expect(screen.queryByText(/hoa hồng/i)).toBeNull();
    unmount();
    mocks.role = 'AFFILIATE';
    renderPage();
    expect(await screen.findByText('Cộng tác viên')).toBeInTheDocument();
    expect(screen.queryByText('Mở gian hàng Cộng tác viên')).toBeNull();
  });

  it('đại lý thuần không thấy mục Cộng tác viên; đại lý còn quyền CTV thì thấy', async () => {
    mocks.role = 'DEALER';
    mocks.affiliateMe = { isAffiliate: false, canRegister: false };
    const { unmount } = renderPage();
    await screen.findByText('Câu chuyện thương hiệu');
    await waitFor(() => expect(screen.queryByText('Cộng tác viên')).toBeNull());
    expect(screen.queryByText('Mở gian hàng Cộng tác viên')).toBeNull();
    unmount();
    mocks.affiliateMe = { isAffiliate: true, canRegister: false };
    renderPage();
    expect(await screen.findByText('Cộng tác viên')).toBeInTheDocument();
  });

  it('số ở ba ô số dư dùng font sans tabular, không phải serif của tiêu đề (D6-13)', async () => {
    renderPage();
    const tile = await screen.findByRole('button', { name: /^50\.000đ\s*Ví Tubu$/ });
    const value = Array.from(tile.querySelectorAll<HTMLElement>('*')).find((el) => el.textContent === '50.000đ' && el.children.length === 0)!.parentElement!;
    expect(value).toBeTruthy();
    expect(value.style.fontFamily).toContain('--font-ui');
    expect(value.style.fontFamily).not.toContain('--font-display');
    expect(value.style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('không còn mục Hoàn tiền sàn ngoài; bấm mục menu điều hướng thật, không báo "đang hoàn thiện"', async () => {
    renderPage();
    expect(screen.queryByText('Hoàn tiền sàn ngoài')).toBeNull();
    fireEvent.click(await screen.findByText('Câu chuyện thương hiệu'));
    expect(mocks.navigate).toHaveBeenCalledWith('/brand-story');
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
  });
});

describe('Hub Cá nhân theo DS v2 (C-076, C-114)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrangeDefaults();
    mocks.authStatus = 'authenticated';
    mocks.notifications = [];
    mocks.copyText.mockResolvedValue(true);
  });

  it('có đúng một h1 "Cá nhân" và các nhóm menu là h2', async () => {
    renderPage();
    await screen.findByText('Câu chuyện thương hiệu');
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Cá nhân']);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Đơn của tôi', 'Mời bạn bè mua hàng', 'KIẾM TIỀN CÙNG TUBU', 'TÀI KHOẢN', 'HỖ TRỢ']);
  });

  it('chưa đăng nhập vẫn có đúng một h1 và nút Đăng nhập ngay gọi login', async () => {
    mocks.authStatus = 'idle';
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Đã đăng xuất')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập ngay' }));
    expect(mocks.login).toHaveBeenCalled();
  });

  it('lỗi đăng nhập: có nút Thử lại gọi restore', async () => {
    mocks.authStatus = 'error';
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(mocks.restore).toHaveBeenCalled();
  });

  it('hàng hồ sơ và ô mã giới thiệu là nút thật (bàn phím + đọc màn hình)', async () => {
    renderPage();
    const edit = await screen.findByRole('button', { name: /Sửa hồ sơ/ });
    fireEvent.click(edit);
    expect(mocks.navigate).toHaveBeenCalledWith('/edit-profile');
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép mã LAN1' }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('LAN1'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã sao chép mã giới thiệu', type: 'success' }));
  });

  it('mục menu là hàng cao >= 44px; mục Thông báo hiện số chưa đọc', async () => {
    mocks.notifications = [{ status: 'UNREAD' }, { status: 'UNREAD' }, { status: 'READ' }];
    renderPage();
    const row = await screen.findByRole('button', { name: /Thông báo/ });
    expect(row.style.minHeight).toBe('44px');
    await waitFor(() => expect(row).toHaveTextContent('2'));
    fireEvent.click(row);
    expect(mocks.navigate).toHaveBeenCalledWith('/notifications');
  });

  it('tin chưa đọc lấy từ /me/summary (một lời gọi, cùng lời gọi với số đơn), không tải danh sách tin', async () => {
    mocks.notifications = [{ status: 'UNREAD' }];
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /Thông báo/ })).toHaveTextContent('1'));
    const paths = mocks.coreGet.mock.calls.map(([p]) => p);
    expect(paths.filter((p) => p === '/me/summary')).toHaveLength(1);
    expect(paths).not.toContain('/me/notifications/unread-count');
    expect(paths).not.toContain('/me/notifications');
  });

  it('ô Ví Tubu mang state.from để nút quay lại về hub; ô Mã giảm giá mở tab Ưu đãi ở phần mã', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^2 mã\s*Mã giảm giá$/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/offers?section=coupons');
    fireEvent.click(await screen.findByRole('button', { name: /Ví Tubu$/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/wallet', { state: { from: '/profile' } });
  });
});

describe('Lối vào Trợ lý AI ở hub Cá nhân theo công tắc AI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrangeDefaults();
    mocks.authStatus = 'authenticated';
    mocks.notifications = [];
  });

  it('server báo bật → có mục Trợ lý AI 24/7', async () => {
    mocks.getPublicConfig.mockResolvedValue({ aiAdvisorEnabled: true });
    renderPage();
    expect(await screen.findByText('Trợ lý AI 24/7')).toBeInTheDocument();
  });

  it.each([
    ['server báo tắt', () => mocks.getPublicConfig.mockResolvedValue({ aiAdvisorEnabled: false })],
    ['không tải được cấu hình', () => mocks.getPublicConfig.mockRejectedValue(new Error('mạng'))],
  ])('%s → ẩn mục Trợ lý AI, các mục khác vẫn còn', async (_name, arrange) => {
    arrange();
    renderPage();
    expect(await screen.findByText('Câu chuyện thương hiệu')).toBeInTheDocument();
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    expect(screen.queryByText('Trợ lý AI 24/7')).toBeNull();
    expect(screen.getByText('Cài đặt')).toBeInTheDocument();
  });
});

describe('Hàng trạng thái đơn ở đầu trang Cá nhân', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrangeDefaults();
    mocks.authStatus = 'authenticated';
    mocks.notifications = [];
    mocks.getPublicConfig.mockImplementation(async () => ({}));
  });

  it('5 ô: Chờ thanh toán, Đang xử lý, Đang giao, Đã giao, Định kỳ; số đếm từ API, Đã giao không có số', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Chờ thanh toán, 2 đơn' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đang giao, 1 đơn' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đang xử lý' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đã giao' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Định kỳ, 1 đơn' })).toBeInTheDocument();
  });

  it('Mini App tắt giao định kỳ: 4 ô, không có ô Định kỳ và không gọi danh sách định kỳ', async () => {
    mocks.subscriptions = false;
    try {
      renderPage();
      expect(await screen.findByRole('button', { name: 'Chờ thanh toán, 2 đơn' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Đã giao' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Định kỳ/ })).not.toBeInTheDocument();
      expect(mocks.getSubscriptions).not.toHaveBeenCalled();
    } finally {
      mocks.subscriptions = true;
    }
  });

  it('bấm ô mở danh sách đơn đã lọc; "Xem tất cả" mở /orders', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Chờ thanh toán, 2 đơn' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/orders?tab=pending_payment');
    fireEvent.click(await screen.findByRole('button', { name: 'Định kỳ, 1 đơn' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/orders?tab=subscriptions');
    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả đơn hàng' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/orders');
  });

  it('đếm đơn lỗi → ô vẫn bấm được, hiện dấu chấm thay vì số bịa', async () => {
    mocks.orderCounts.mockRejectedValue(new Error('boom'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đang giao' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/orders?tab=shipping');
  });

  it('summary lỗi: không hiện số sai ở bất kỳ ô nào (đơn, định kỳ, tin chưa đọc), các ô vẫn bấm được', async () => {
    mocks.orderCounts.mockRejectedValue(new Error('boom'));
    mocks.notifications = [{ status: 'UNREAD' }, { status: 'UNREAD' }];
    renderPage();
    await screen.findByRole('button', { name: 'Đang giao' });
    await waitFor(() => expect(mocks.orderCounts).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /đơn$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Định kỳ, / })).toBeNull();
    expect(screen.getByRole('button', { name: /Thông báo/ })).not.toHaveTextContent(/\d/);
  });
});

describe('Khối mời bạn bè nói đúng thưởng thật (KP-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrangeDefaults();
    mocks.authStatus = 'authenticated';
    mocks.notifications = [];
    mocks.getPublicConfig.mockImplementation(async () => ({}));
  });

  it('lấy điều kiện từ /me/referral: đơn thứ hai từ mức tối thiểu trong số ngày', async () => {
    renderPage();
    expect(await screen.findByText(/có đơn thứ hai từ 200\.000đ trong 30 ngày/)).toBeInTheDocument();
  });

  it('đã có bạn thành công: nêu số bạn, số điểm đã nhận và mốc kế tiếp (chuyển từ trang Ví sang đây)', async () => {
    mocks.getReferral.mockResolvedValue({ ...REFERRAL, successCount: 2, earnedPoints: 20, nextMilestone: { count: 5, bonusPoints: 50 } });
    renderPage();
    expect(await screen.findByText('Đã mời thành công 2 bạn, nhận 20 điểm.')).toBeInTheDocument();
    expect(screen.getByText('Mời thêm 3 bạn để nhận 50 điểm')).toBeInTheDocument();
  });

  it('chưa có ai: không hiện dòng thống kê; đã đủ hoặc vượt mốc: không in "Mời thêm -2 bạn"', async () => {
    mocks.getReferral.mockResolvedValue({ ...REFERRAL, successCount: 7, earnedPoints: 70, nextMilestone: { count: 5, bonusPoints: 50 } });
    const { unmount } = renderPage();
    await screen.findByText('Đã mời thành công 7 bạn, nhận 70 điểm.');
    expect(screen.queryByText(/Mời thêm/)).toBeNull();
    unmount();
    mocks.getReferral.mockResolvedValue(REFERRAL);
    renderPage();
    await screen.findByText(/có đơn thứ hai từ 200\.000đ/);
    expect(screen.queryByText(/Đã mời thành công/)).toBeNull();
  });

  it('"Chia sẻ" gọi shareLink với đường dẫn ?ref=; Zalo từ chối thì chép liên kết kèm mã và báo qua snackbar', async () => {
    mocks.shareLink.mockRejectedValueOnce(new Error('no share'));
    mocks.copyText.mockResolvedValueOnce(true);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ' }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledWith(expect.objectContaining({ path: '/?ref=LAN1' })));
    // R-67: link chép là link Mini App, không phải link web.
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith(expect.stringContaining(miniAppLink('/?ref=LAN1'))));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', text: expect.stringContaining('đã sao chép liên kết') })),
    );
  });

  it('người dùng huỷ hộp thoại chia sẻ Zalo: không snackbar, không ghi đè clipboard', async () => {
    mocks.shareLink.mockRejectedValueOnce({ code: -2003 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ' }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
    expect(mocks.copyText).not.toHaveBeenCalled();
  });

  it('lời mời bạn: thưởng là Điểm Xanh, chia sẻ không hứa "cả hai nhận xu"', async () => {
    mocks.shareLink.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ' }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(1));
    const arg = mocks.shareLink.mock.calls[0]![0] as { description: string };
    expect(arg.description).toContain('LAN1');
    expect(arg.description).not.toMatch(/(?<![\p{L}_])xu(?![\p{L}_])|TubuXu/iu);
  });

  it('CTV (AFFILIATE) không thấy thống kê Điểm Xanh giới thiệu', async () => {
    mocks.role = 'AFFILIATE';
    mocks.getReferral.mockResolvedValue({ ...REFERRAL, successCount: 2, earnedPoints: 20 });
    renderPage();
    await screen.findByText('Mời bạn bè mua hàng');
    expect(screen.queryByText(/Đã mời thành công/)).toBeNull();
  });

  it('chưa có số liệu (API lỗi) → nói chung, không hứa con số', async () => {
    mocks.getReferral.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText('Bạn nhận Điểm Xanh khi bạn bè vào app bằng mã của bạn và mua hàng.')).toBeInTheDocument();
  });
});

describe('Tài khoản khách Mini App ở trang Cá nhân (KP-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrangeDefaults();
    mocks.authStatus = 'authenticated';
    mocks.notifications = [];
    mocks.getPublicConfig.mockImplementation(async () => ({}));
  });

  it('khách thật không thấy thẻ liên kết Zalo', async () => {
    renderPage();
    await screen.findByText('Câu chuyện thương hiệu');
    expect(screen.queryByText('Liên kết Zalo để giữ điểm và nhận quà')).toBeNull();
  });

  it('tài khoản khách thấy thẻ "Liên kết Zalo để giữ điểm và nhận quà"', async () => {
    mocks.guest = true;
    renderPage();
    expect(await screen.findByText('Liên kết Zalo để giữ điểm và nhận quà')).toBeInTheDocument();
  });
});

describe('Lối vào "Chat với Tubu Tree" ở hub Cá nhân', () => {
  const chatCfg = (enabled: boolean) => ({ chat: { enabled, hours: { start: '08:00', end: '21:00' } } });
  beforeEach(() => {
    vi.clearAllMocks();
    arrangeDefaults();
    mocks.authStatus = 'authenticated';
    mocks.notifications = [];
    mocks.chatSummary.mockResolvedValue({ unreadCount: 0 });
  });

  it('chat tắt: không có dòng menu và không hỏi số chưa đọc', async () => {
    mocks.getPublicConfig.mockResolvedValue(chatCfg(false));
    renderPage();
    await screen.findByText('Câu chuyện thương hiệu');
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    expect(screen.queryByText('Chat với Tubu Tree')).toBeNull();
    expect(mocks.chatSummary).not.toHaveBeenCalled();
  });

  it('chat bật: có dòng menu mở /chat; chấm đỏ chỉ hiện khi có tin chưa đọc', async () => {
    mocks.getPublicConfig.mockResolvedValue(chatCfg(true));
    renderPage();
    fireEvent.click(await screen.findByText('Chat với Tubu Tree'));
    expect(mocks.navigate).toHaveBeenCalledWith('/chat');
    await waitFor(() => expect(mocks.chatSummary).toHaveBeenCalled());
    expect(screen.queryByTestId('chat-unread-dot')).toBeNull();
  });

  it('có tin chưa đọc → hiện chấm đỏ', async () => {
    mocks.getPublicConfig.mockResolvedValue(chatCfg(true));
    mocks.chatSummary.mockResolvedValue({ unreadCount: 3 });
    renderPage();
    expect(await screen.findByTestId('chat-unread-dot')).toBeInTheDocument();
  });
});

describe('Cá nhân: hàng đơn, chat ở đầu trang, Học viện theo vai, không Đăng xuất (R-33, R-34, R-53, R-111)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrangeDefaults();
    mocks.authStatus = 'authenticated';
    mocks.notifications = [];
    mocks.role = 'CUSTOMER';
    mocks.getPublicConfig.mockImplementation(async () => ({}));
  });

  it('số đơn là chấm ở góc biểu tượng, chỉ hiện khi lớn hơn 0; không còn dấu "·"', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Chờ thanh toán, 2 đơn' });
    await waitFor(() => expect(screen.getAllByTestId('order-count-badge').map((b) => b.textContent)).toEqual(['2', '1', '1']));
    expect(screen.queryByText('·')).toBeNull();
  });

  it('Mini App tắt giao định kỳ: lưới 4 cột, Thử lại số đơn không gọi danh sách định kỳ', async () => {
    mocks.subscriptions = false;
    try {
      mocks.orderCounts.mockRejectedValue(new Error('boom'));
      renderPage();
      expect(await screen.findByText('Không tải được số đơn.')).toBeInTheDocument();
      const cell = screen.getByRole('button', { name: 'Đã giao' });
      expect((cell.parentElement as HTMLElement).style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
      mocks.orderCounts.mockResolvedValue({ pending_payment: 3, processing: 3, shipping: 3, delivered: 3, closed: 3 });
      fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
      await waitFor(() => expect(screen.queryByText('Không tải được số đơn.')).toBeNull());
      expect(mocks.getSubscriptions).not.toHaveBeenCalled();
    } finally {
      mocks.subscriptions = true;
    }
  });

  it('đếm đơn lỗi: có dòng báo và nút Thử lại tải lại số đơn', async () => {
    mocks.orderCounts.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText('Không tải được số đơn.')).toBeInTheDocument();
    const before = mocks.orderCounts.mock.calls.length;
    mocks.orderCounts.mockResolvedValue({ pending_payment: 3, processing: 3, shipping: 3, delivered: 3, closed: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(mocks.orderCounts.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByText('Không tải được số đơn.')).toBeNull());
  });

  it('chat bật: biểu tượng chat ở đầu trang mở /chat, có chấm khi có tin chưa đọc; chat tắt thì không có', async () => {
    mocks.getPublicConfig.mockResolvedValue({ chat: { enabled: true, hours: { start: '08:00', end: '21:00' } } });
    mocks.chatSummary.mockResolvedValue({ unreadCount: 2 });
    const { unmount } = renderPage();
    const btn = await screen.findByRole('button', { name: 'Chat với Tubu Tree, có tin mới' });
    expect(await screen.findByTestId('profile-chat-dot')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(mocks.navigate).toHaveBeenCalledWith('/chat');
    unmount();
    mocks.getPublicConfig.mockResolvedValue({});
    renderPage();
    await screen.findByText('Câu chuyện thương hiệu');
    expect(screen.queryByRole('button', { name: /^Chat với Tubu Tree/ })).toBeNull();
  });

  it('Học viện chỉ hiện cho CTV, đại lý, nhân viên, quản trị; khách thường không thấy', async () => {
    const { unmount } = renderPage();
    await screen.findByText('Câu chuyện thương hiệu');
    expect(screen.queryByText('Học viện Tubu')).toBeNull();
    unmount();
    mocks.role = 'AFFILIATE';
    renderPage();
    expect(await screen.findByText('Học viện Tubu')).toBeInTheDocument();
  });

  it('không còn nút Đăng xuất ở cuối trang Cá nhân', async () => {
    renderPage();
    await screen.findByText('Câu chuyện thương hiệu');
    expect(screen.queryByRole('button', { name: 'Đăng xuất' })).toBeNull();
  });
});

describe('Số đếm đơn một lời gọi (E-91)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrangeDefaults();
    mocks.authStatus = 'authenticated';
    mocks.notifications = [];
    mocks.role = 'CUSTOMER';
    mocks.getPublicConfig.mockImplementation(async () => ({}));
  });

  it('một lời gọi đếm cho cả ba ô đơn, không còn mỗi ô một lời gọi danh sách', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Chờ thanh toán, 2 đơn' });
    expect(screen.getByRole('button', { name: 'Đang giao, 1 đơn' })).toBeInTheDocument();
    expect(mocks.orderCounts).toHaveBeenCalledTimes(1);
  });
});

describe('Lối vào khối mã giới thiệu (E-21)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrangeDefaults();
    mocks.authStatus = 'authenticated';
    mocks.notifications = [];
    mocks.role = 'CUSTOMER';
    mocks.getPublicConfig.mockImplementation(async () => ({}));
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('?section=referral cuộn tới khối mã giới thiệu khi dữ liệu mời bạn đã về', async () => {
    mocks.search = '?section=referral';
    renderPage();
    await screen.findByText(/có đơn thứ hai từ 200\.000đ trong 30 ngày/);
    await waitFor(() => expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled());
    const target = (window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts[0] as HTMLElement;
    expect(target.id).toBe('referral');
  });

  it('không có ?section=referral thì không cuộn', async () => {
    renderPage();
    await screen.findByText(/có đơn thứ hai từ 200\.000đ trong 30 ngày/);
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('Lối vào quầy Nhận hàng tại điểm (E-39)', () => {
  const POINTS = [{ id: 'p1', name: 'Kho Tubu HCMC', kind: 'WAREHOUSE' }, { id: 'p2', name: 'Đại lý An Phát', kind: 'PARTNER' }];
  beforeEach(() => {
    vi.clearAllMocks();
    arrangeDefaults();
    mocks.authStatus = 'authenticated';
    mocks.notifications = [];
    mocks.role = 'CUSTOMER';
    mocks.getPublicConfig.mockImplementation(async () => ({}));
  });

  it('nhân viên có điểm: hiện hàng, ghi tên điểm, mở /recycle/desk', async () => {
    mocks.role = 'STAFF';
    mocks.deskPoints.mockResolvedValue(POINTS);
    renderPage();
    expect(await screen.findByText('Kho Tubu HCMC, Đại lý An Phát')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Nhận hàng tại điểm'));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle/desk');
  });

  it('nhân viên không có điểm nào: không có hàng', async () => {
    mocks.role = 'STAFF';
    renderPage();
    await screen.findByText('Câu chuyện thương hiệu');
    await waitFor(() => expect(mocks.deskPoints).toHaveBeenCalled());
    expect(screen.queryByText('Nhận hàng tại điểm')).toBeNull();
  });

  it('đại lý có điểm đối tác: hiện hàng; chương trình đổi rác tắt thì không hỏi điểm', async () => {
    mocks.role = 'DEALER';
    mocks.deskPoints.mockResolvedValue([POINTS[1]]);
    mocks.getPublicConfig.mockResolvedValue({ waste: { enabled: true } });
    const { unmount } = renderPage();
    expect(await screen.findByText('Nhận hàng tại điểm')).toBeInTheDocument();
    unmount();
    mocks.deskPoints.mockClear();
    mocks.getPublicConfig.mockResolvedValue({ waste: { enabled: false } });
    renderPage();
    await screen.findByText('Câu chuyện thương hiệu');
    await waitFor(() => expect(screen.queryByText('Nhận hàng tại điểm')).toBeNull());
    expect(mocks.deskPoints).not.toHaveBeenCalled();
  });

  it('nhân viên điểm đối tác mang vai CUSTOMER: cờ hasDeskPoint của /auth/me mở hàng; chương trình đổi rác tắt thì không hỏi điểm', async () => {
    mocks.authMeFlags.mockResolvedValue({ ownsBrand: false, hasDeskPoint: true });
    mocks.deskPoints.mockResolvedValue([POINTS[1]]);
    mocks.getPublicConfig.mockResolvedValue({ waste: { enabled: true } });
    const { unmount } = renderPage();
    expect(await screen.findByText('Nhận hàng tại điểm')).toBeInTheDocument();
    unmount();
    mocks.deskPoints.mockClear();
    mocks.getPublicConfig.mockResolvedValue({ waste: { enabled: false } });
    renderPage();
    await screen.findByText('Câu chuyện thương hiệu');
    await waitFor(() => expect(screen.queryByText('Nhận hàng tại điểm')).toBeNull());
    expect(mocks.deskPoints).not.toHaveBeenCalled();
  });

  it('bản API cũ không có cờ hasDeskPoint: khách thường chạy như trước, không hỏi điểm', async () => {
    mocks.authMeFlags.mockResolvedValue({ ownsBrand: null, hasDeskPoint: false });
    mocks.getPublicConfig.mockResolvedValue({ waste: { enabled: true } });
    renderPage();
    await screen.findByText('Câu chuyện thương hiệu');
    await waitFor(() => expect(mocks.orderCounts).toHaveBeenCalled());
    expect(mocks.deskPoints).not.toHaveBeenCalled();
  });

  it('khách thường không phát sinh lời gọi điểm nhận hàng', async () => {
    mocks.deskPoints.mockResolvedValue(POINTS);
    renderPage();
    await screen.findByText('Câu chuyện thương hiệu');
    await waitFor(() => expect(mocks.orderCounts).toHaveBeenCalled());
    expect(mocks.deskPoints).not.toHaveBeenCalled();
    expect(screen.queryByText('Nhận hàng tại điểm')).toBeNull();
  });
});
