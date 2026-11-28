import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  badges: null as unknown,
  recycleOpen: false,
  recycleHook: vi.fn(),
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
      if (path === '/game/badges' && mocks.badges) return Promise.resolve(mocks.badges);
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
// Hook thật hỏi /waste/me/open-count; ở đây chỉ cần biết trang truyền đúng (đã đăng nhập, chương trình tạm dừng) và nhận kết quả giả.
vi.mock('../hooks/use-recycle-open-requests', () => ({
  useRecycleOpenRequests: (authed: boolean, paused: boolean) => {
    mocks.recycleHook(authed, paused);
    return authed && paused && mocks.recycleOpen;
  },
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Avatar: () => <span />,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/profile', search: mocks.search }),
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
import { getLoyalty, getWallet } from '../services/account-api';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ProfilePage /></QueryClientProvider>);
}

const REFERRAL = { referralCode: 'LAN1', successCount: 0, earnedPoints: 0, minOrderAmount: 200_000, windowDays: 30, referrerRewardPoints: 5000 };
function arrangeDefaults() {
  mocks.guest = false;
  mocks.orderCounts.mockResolvedValue({ pending_payment: 2, processing: 0, shipping: 1, delivered: 0, closed: 0 });
  mocks.deskPoints.mockResolvedValue([]);
  mocks.authMeFlags.mockResolvedValue({ ownsBrand: null, hasDeskPoint: false });
  mocks.search = '';
  mocks.getReferral.mockResolvedValue(REFERRAL);
  mocks.getSubscriptions.mockResolvedValue([{ status: 'ACTIVE' }, { status: 'CANCELLED' }]);
  mocks.recycleOpen = false;
}

// Dòng accordion mở một lần: bấm lại khi đã mở sẽ đóng, nên chỉ bấm khi đang đóng.
async function openRow(name: RegExp) {
  const row = await screen.findByRole('button', { name });
  if (row.getAttribute('aria-expanded') !== 'true') fireEvent.click(row);
  expect(row).toHaveAttribute('aria-expanded', 'true');
  return row;
}
const openInvite = () => openRow(/^Mời bạn nhận quà/);
const openSupport = () => openRow(/^Hỗ trợ/);
const openPartner = () => openRow(/^Dành cho đối tác/);

describe('Thanh số dư ở hub Cá nhân (C-086)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrangeDefaults();
    mocks.authStatus = 'authenticated';
    mocks.notifications = [];
    mocks.role = 'CUSTOMER';
    mocks.cashback = false;
  });

  it.each([true, false])('cờ CASHBACK_ENABLED %s: Cá nhân không có dòng Hoàn tiền sàn ngoài (trang không đọc cờ này)', async (flag) => {
    mocks.cashback = flag;
    renderPage();
    await screen.findByText('Cài đặt');
    expect(screen.queryByText('Hoàn tiền sàn ngoài')).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalledWith('/cashback');
  });

  it('có đúng hai số dư: Điểm Xanh (tổng hai lô), Ví Tubu — không còn ô Mã giảm giá, không ô xu (C-047, PD-3)', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /^150 điểm\s*Điểm Xanh$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^50\.000đ\s*Ví Tubu$/ })).toBeInTheDocument();
    const balances = ['Điểm Xanh', 'Ví Tubu'].map((label) => screen.getAllByRole('button').find((b) => b.getAttribute('aria-label') === null && (b.textContent ?? '').endsWith(label)));
    expect(balances.every(Boolean)).toBe(true);
    expect(screen.queryByRole('button', { name: /Mã giảm giá$/ })).toBeNull();
    expect(screen.queryByText(/TubuXu/)).toBeNull();
    expect(screen.queryByRole('button', { name: /(?<![\p{L}_])xu(?![\p{L}_])/iu })).toBeNull();
  });

  it('hàng số dư là lưới hai cột chỉ có hai ô: Điểm Xanh rồi Ví Tubu', async () => {
    renderPage();
    const points = await screen.findByRole('button', { name: /Điểm Xanh$/ });
    const grid = points.parentElement as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    const tiles = within(grid).getAllByRole('button');
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toBe(points);
    expect(tiles[1]).toHaveTextContent(/Ví Tubu$/);
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

  it('khách thường không còn lời mời CTV ở Cá nhân; chỉ khi có việc đối tác (điểm nhận hàng) mới thấy "Mở gian hàng Cộng tác viên" (không nhắc hoa hồng); CTV thấy "Cộng tác viên"', async () => {
    const plain = renderPage();
    await screen.findByText('Cài đặt');
    await waitFor(() => expect(mocks.authMeFlags).toHaveBeenCalled());
    expect(screen.queryByText('Mở gian hàng Cộng tác viên')).toBeNull();
    plain.unmount();

    mocks.authMeFlags.mockResolvedValue({ ownsBrand: false, hasDeskPoint: true });
    mocks.deskPoints.mockResolvedValue([{ id: 'p2', name: 'Đại lý An Phát', kind: 'PARTNER' }]);
    mocks.getPublicConfig.mockResolvedValue({ waste: { enabled: true } });
    const withDesk = renderPage();
    await openPartner();
    expect(await screen.findByRole('button', { name: /^Mở gian hàng Cộng tác viên/ })).toBeInTheDocument();
    expect(screen.queryByText(/hoa hồng/i)).toBeNull();
    withDesk.unmount();

    mocks.role = 'AFFILIATE';
    mocks.getPublicConfig.mockResolvedValue({});
    renderPage();
    await openPartner();
    expect(await screen.findByRole('button', { name: /^Cộng tác viên/ })).toBeInTheDocument();
    expect(screen.queryByText('Mở gian hàng Cộng tác viên')).toBeNull();
  });

  it('đại lý thuần không thấy mục Cộng tác viên; đại lý còn quyền CTV thì thấy', async () => {
    mocks.role = 'DEALER';
    mocks.affiliateMe = { isAffiliate: false, canRegister: false };
    const { unmount } = renderPage();
    await openPartner();
    await waitFor(() => expect(screen.queryByText('Cộng tác viên')).toBeNull());
    expect(screen.queryByText('Mở gian hàng Cộng tác viên')).toBeNull();
    unmount();
    mocks.affiliateMe = { isAffiliate: true, canRegister: false };
    renderPage();
    await openPartner();
    expect(await screen.findByRole('button', { name: /^Cộng tác viên/ })).toBeInTheDocument();
  });

  it('số ở hai ô số dư dùng font sans tabular, không phải serif của tiêu đề (D6-13)', async () => {
    renderPage();
    const tile = await screen.findByRole('button', { name: /^50\.000đ\s*Ví Tubu$/ });
    const value = Array.from(tile.querySelectorAll<HTMLElement>('*')).find((el) => el.textContent === '50.000đ' && el.children.length === 0)!.parentElement!;
    expect(value).toBeTruthy();
    expect(value.style.fontFamily).toContain('--font-ui');
    expect(value.style.fontFamily).not.toContain('--font-display');
    expect(value.style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('không còn mục Hoàn tiền sàn ngoài; mở Hỗ trợ rồi bấm mục con điều hướng thật, không báo "đang hoàn thiện"', async () => {
    renderPage();
    expect(screen.queryByText('Hoàn tiền sàn ngoài')).toBeNull();
    await openSupport();
    fireEvent.click(await screen.findByRole('button', { name: /^Câu chuyện thương hiệu/ }));
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

  it('có đúng một h1 "Cá nhân"; thẻ danh sách không có tiêu đề nhóm nên h2 duy nhất là "Đơn của tôi"', async () => {
    renderPage();
    await screen.findByText('Cài đặt');
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Cá nhân']);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Đơn của tôi']);
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

  it('nút sao chép link mời bạn là nút thật (bàn phím + đọc màn hình) sau khi mở dòng Mời bạn nhận quà', async () => {
    renderPage();
    await openInvite();
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép link mời bạn' }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith(miniAppLink('/?ref=LAN1')));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã sao chép link mời bạn', type: 'success' }));
  });

  it('có tin chưa đọc: dòng Thông báo đầu danh sách kèm số tin, mở /notifications; dòng menu là hàng cao >= 44px', async () => {
    mocks.notifications = [{ status: 'UNREAD' }, { status: 'UNREAD' }, { status: 'READ' }];
    renderPage();
    const settings = await screen.findByRole('button', { name: /^Cài đặt/ });
    expect(settings.style.minHeight).toBe('44px');
    expect((await openSupport()).style.minHeight).toBe('44px');
    const row = await screen.findByRole('button', { name: /^Thông báo/ });
    expect(row).toHaveTextContent('2 thông báo chưa đọc');
    expect(row.style.minHeight).toBe('44px');
  });

  it('đọc hết thông báo: không có dòng Thông báo (lối vào là chuông ở Trang chủ)', async () => {
    mocks.notifications = [{ status: 'READ' }];
    renderPage();
    await screen.findByRole('button', { name: /^Cài đặt/ });
    expect(screen.queryByRole('button', { name: /^Thông báo/ })).toBeNull();
  });

  it('số đơn đi qua /me/summary đúng một lời gọi; trang không tải danh sách tin chưa đọc', async () => {
    mocks.notifications = [{ status: 'UNREAD' }];
    renderPage();
    await screen.findByRole('button', { name: 'Chờ thanh toán, 2 đơn' });
    const paths = mocks.coreGet.mock.calls.map(([p]) => p);
    expect(paths.filter((p) => p === '/me/summary')).toHaveLength(1);
    expect(paths).not.toContain('/me/notifications/unread-count');
    expect(paths).not.toContain('/me/notifications');
  });

  it('ô Điểm Xanh mở /loyalty, ô Ví Tubu mang state.from để nút quay lại về hub; dòng Ưu đãi & quà nêu số mã và mở tab Ưu đãi', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Điểm Xanh$/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/loyalty');
    fireEvent.click(await screen.findByRole('button', { name: /Ví Tubu$/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/wallet', { state: { from: '/profile' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Ưu đãi & quà\s*2 mã giảm giá đang có$/ }));
    // Hồ sơ → Ưu đãi là tab gốc sang tab gốc: thay mục hiện tại, tránh lịch sử [/, /profile, /offers] mà BottomNav sau đó nhân bản.
    expect(mocks.navigate).toHaveBeenLastCalledWith('/offers', { replace: true });
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
    await openSupport();
    expect(await screen.findByRole('button', { name: /^Trợ lý AI 24\/7/ })).toBeInTheDocument();
  });

  it.each([
    ['server báo tắt', () => mocks.getPublicConfig.mockResolvedValue({ aiAdvisorEnabled: false })],
    ['không tải được cấu hình', () => mocks.getPublicConfig.mockRejectedValue(new Error('mạng'))],
  ])('%s → ẩn mục Trợ lý AI, các mục khác vẫn còn', async (_name, arrange) => {
    arrange();
    renderPage();
    await openSupport();
    expect(await screen.findByRole('button', { name: /^Về Tubu Tree & Hỗ trợ/ })).toBeInTheDocument();
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

  it('4 ô: Chờ thanh toán, Đang xử lý, Đang giao, Đã giao; số đếm từ API, Đã giao không có số', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Chờ thanh toán, 2 đơn' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đang giao, 1 đơn' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đang xử lý' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đã giao' })).toBeInTheDocument();
  });

  // Trang không đọc cờ SUBSCRIPTIONS_IN_MINIAPP: gói định kỳ mở từ tab Định kỳ của trang đơn và từ Trang chủ.
  it.each([true, false])('cờ giao định kỳ %s: vẫn đúng 4 ô đơn trong lưới 4 cột, không ô Định kỳ, không gọi danh sách định kỳ', async (flag) => {
    mocks.subscriptions = flag;
    try {
      renderPage();
      const delivered = await screen.findByRole('button', { name: 'Đã giao' });
      await screen.findByRole('button', { name: 'Chờ thanh toán, 2 đơn' });
      const grid = delivered.parentElement as HTMLElement;
      expect(grid.style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
      expect(within(grid).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Chờ thanh toán, 2 đơn', 'Đang xử lý', 'Đang giao, 1 đơn', 'Đã giao']);
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
    fireEvent.click(screen.getByRole('button', { name: 'Đã giao' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/orders?tab=delivered');
    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả đơn hàng' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/orders');
  });

  it('đếm đơn lỗi → ô vẫn bấm được, hiện dấu chấm thay vì số bịa', async () => {
    mocks.orderCounts.mockRejectedValue(new Error('boom'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đang giao' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/orders?tab=shipping');
  });

  it('summary lỗi: không hiện số sai ở bất kỳ ô đơn nào, các ô vẫn bấm được', async () => {
    mocks.orderCounts.mockRejectedValue(new Error('boom'));
    mocks.notifications = [{ status: 'UNREAD' }, { status: 'UNREAD' }];
    renderPage();
    await screen.findByRole('button', { name: 'Đang giao' });
    await waitFor(() => expect(mocks.orderCounts).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /đơn$/ })).toBeNull();
    expect(screen.queryAllByTestId('order-count-badge')).toHaveLength(0);
  });
});

describe('Khối mời bạn bè nói đúng thưởng thật (KP-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrangeDefaults();
    mocks.authStatus = 'authenticated';
    mocks.notifications = [];
    mocks.role = 'CUSTOMER';
    mocks.getPublicConfig.mockImplementation(async () => ({}));
  });

  it('lấy điều kiện từ /me/referral: đơn thứ hai từ mức tối thiểu trong số ngày', async () => {
    renderPage();
    expect(await screen.findByText(/hoàn tất đơn thứ hai từ 200k trong 30 ngày/)).toBeInTheDocument();
  });

  const statTiles = async () =>
    Array.from((await screen.findByTestId('invite-share-stats')).querySelectorAll(':scope > div')).map((d) => `${d.querySelector('dt')!.textContent}: ${d.querySelector('dd')!.textContent}`);

  it('đã có bạn thành công: ô số bạn và điểm đã nhận, mốc kế tiếp (chuyển từ trang Ví sang đây)', async () => {
    mocks.getReferral.mockResolvedValue({ ...REFERRAL, successCount: 2, earnedPoints: 1200, nextMilestone: { count: 5, bonusPoints: 50 } });
    renderPage();
    expect(await statTiles()).toEqual(['Bạn mời thành công: 2', 'Điểm Xanh đã nhận: 1.200']);
    expect(screen.getByText('Mời thêm 3 bạn để nhận 50 điểm')).toBeInTheDocument();
  });

  it('chưa có ai: không có ô số; đã đủ hoặc vượt mốc: không in "Mời thêm -2 bạn"', async () => {
    mocks.getReferral.mockResolvedValue({ ...REFERRAL, successCount: 7, earnedPoints: 70, nextMilestone: { count: 5, bonusPoints: 50 } });
    const { unmount } = renderPage();
    expect(await statTiles()).toEqual(['Bạn mời thành công: 7', 'Điểm Xanh đã nhận: 70']);
    expect(screen.queryByText(/Mời thêm/)).toBeNull();
    unmount();
    mocks.getReferral.mockResolvedValue(REFERRAL);
    renderPage();
    await screen.findByText(/hoàn tất đơn thứ hai từ 200k/);
    expect(screen.queryByTestId('invite-share-stats')).toBeNull();
  });

  it('"Chia sẻ" gọi shareLink với đường dẫn ?ref=; Zalo từ chối thì chép liên kết kèm mã và báo qua snackbar', async () => {
    mocks.shareLink.mockRejectedValueOnce(new Error('no share'));
    mocks.copyText.mockResolvedValueOnce(true);
    renderPage();
    await openInvite();
    fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ qua Zalo' }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledWith(expect.objectContaining({ path: '/?ref=LAN1' })));
    // R-67: link chép là link Mini App, không phải link web.
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith(expect.stringContaining(miniAppLink('/?ref=LAN1'))));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', text: expect.stringContaining('đã chép liên kết') })),
    );
  });

  it('người dùng huỷ hộp thoại chia sẻ Zalo: không snackbar, không ghi đè clipboard', async () => {
    mocks.shareLink.mockRejectedValueOnce({ code: -2003 });
    renderPage();
    await openInvite();
    fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ qua Zalo' }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
    expect(mocks.copyText).not.toHaveBeenCalled();
  });

  it('lời mời bạn: có mã chào mừng thật thì thẻ chia sẻ nêu đúng mã đó, thưởng là Điểm Xanh, không hứa "cả hai nhận xu"', async () => {
    mocks.getPublicConfig.mockImplementation(async () => ({ newCustomer: { welcomeVoucher: { amount: 30000, minOrder: 199000 } } }));
    mocks.shareLink.mockResolvedValue(undefined);
    renderPage();
    await openInvite();
    expect(await screen.findByText(/Bạn mới nhận mã 30\.000đ cho đơn đầu từ 199k\. Bạn nhận 5\.000 Điểm Xanh/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ qua Zalo' }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(1));
    const arg = mocks.shareLink.mock.calls[0]![0] as { title: string; description: string; path: string };
    expect(arg.description).toBe('Tubu Tree tặng khách mới mã 30.000đ cho đơn đầu từ 199k');
    expect(arg.path).toBe('/?ref=LAN1');
    expect(`${arg.title} ${arg.description}`).not.toMatch(/(?<![\p{L}_])xu(?![\p{L}_])|TubuXu/iu);
  });

  it('chưa có mã chào mừng ở cấu hình công khai: thẻ chia sẻ dùng câu không số, không bịa mệnh giá', async () => {
    mocks.shareLink.mockResolvedValue(undefined);
    renderPage();
    await openInvite();
    fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ qua Zalo' }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(1));
    expect((mocks.shareLink.mock.calls[0]![0] as { description: string }).description).toBe('Tubu Tree tặng khách mới mã giảm giá cho đơn đầu');
  });

  it('CTV (AFFILIATE) không thấy thống kê Điểm Xanh giới thiệu', async () => {
    mocks.role = 'AFFILIATE';
    mocks.getReferral.mockResolvedValue({ ...REFERRAL, successCount: 2, earnedPoints: 20 });
    renderPage();
    await openInvite();
    // CTV: chỉ ô bạn bè, không có ô Điểm Xanh giới thiệu.
    expect(await statTiles()).toEqual(['Bạn mời thành công: 2']);
    // CTV chỉ hưởng hoa hồng: khối không hứa Điểm Xanh giới thiệu mà máy chủ sẽ không trả.
    expect(screen.queryByText(/hoàn tất đơn thứ hai/)).toBeNull();
    expect(screen.getByText('Bạn mới nhận mã giảm giá cho đơn đầu.')).toBeInTheDocument();
  });

  it('chưa có số liệu (API lỗi) → nói chung, không hứa con số', async () => {
    mocks.getReferral.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText('Bạn mới nhận mã giảm giá cho đơn đầu. Bạn nhận Điểm Xanh khi bạn ấy hoàn tất đơn thứ hai.')).toBeInTheDocument();
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
    await screen.findByText('Cài đặt');
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
    await openSupport();
    expect(await screen.findByRole('button', { name: /^Về Tubu Tree & Hỗ trợ/ })).toBeInTheDocument();
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    expect(screen.queryByText('Chat với Tubu Tree')).toBeNull();
    expect(mocks.chatSummary).not.toHaveBeenCalled();
  });

  it('chat bật: mở Hỗ trợ thấy dòng Chat mở /chat; chấm đỏ chỉ hiện khi có tin chưa đọc', async () => {
    mocks.getPublicConfig.mockResolvedValue(chatCfg(true));
    renderPage();
    await openSupport();
    fireEvent.click(await screen.findByRole('button', { name: /^Chat với Tubu Tree/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/chat');
    await waitFor(() => expect(mocks.chatSummary).toHaveBeenCalled());
    expect(screen.queryByTestId('chat-unread-dot')).toBeNull();
    expect(screen.queryByTestId('support-unread-dot')).toBeNull();
  });

  it('có tin chưa đọc → mở Hỗ trợ thấy chấm đỏ ở dòng Chat', async () => {
    mocks.getPublicConfig.mockResolvedValue(chatCfg(true));
    mocks.chatSummary.mockResolvedValue({ unreadCount: 3 });
    renderPage();
    await openSupport();
    expect(await screen.findByRole('img', { name: 'Có tin nhắn mới' })).toBe(screen.getByTestId('chat-unread-dot'));
  });
});

describe('Cá nhân: hàng đơn, chat trong Hỗ trợ, Học viện theo vai, không Đăng xuất (R-33, R-34, R-53, R-111)', () => {
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
    await waitFor(() => expect(screen.getAllByTestId('order-count-badge').map((b) => b.textContent)).toEqual(['2', '1']));
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

  it('chat bật có tin chưa đọc: không còn nút chat ở đầu trang; tin mới báo ở dòng Hỗ trợ, chat tắt thì không báo gì', async () => {
    mocks.getPublicConfig.mockResolvedValue({ chat: { enabled: true, hours: { start: '08:00', end: '21:00' } } });
    mocks.chatSummary.mockResolvedValue({ unreadCount: 2 });
    const { unmount } = renderPage();
    await screen.findByRole('button', { name: 'Hỗ trợ, có tin mới' });
    expect(await screen.findByTestId('support-unread-dot')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Chat với Tubu Tree/ })).toBeNull();
    expect(screen.queryByTestId('profile-chat-dot')).toBeNull();
    unmount();
    mocks.getPublicConfig.mockResolvedValue({});
    mocks.chatSummary.mockClear();
    renderPage();
    await screen.findByRole('button', { name: 'Hỗ trợ' });
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /^Chat với Tubu Tree/ })).toBeNull();
    expect(screen.queryByTestId('support-unread-dot')).toBeNull();
    expect(mocks.chatSummary).not.toHaveBeenCalled();
  });

  it('Học viện chỉ hiện cho CTV, đại lý, nhân viên, quản trị; khách thường không có dòng đối tác nên không thấy', async () => {
    const { unmount } = renderPage();
    await screen.findByText('Cài đặt');
    expect(screen.queryByText('Học viện Tubu')).toBeNull();
    unmount();
    mocks.role = 'AFFILIATE';
    renderPage();
    await openPartner();
    expect(await screen.findByRole('button', { name: /^Học viện Tubu/ })).toBeInTheDocument();
  });

  it('không còn nút Đăng xuất ở cuối trang Cá nhân', async () => {
    renderPage();
    await screen.findByText('Cài đặt');
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
    await screen.findByText(/hoàn tất đơn thứ hai từ 200k trong 30 ngày/);
    await waitFor(() => expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled());
    const target = (window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts[0] as HTMLElement;
    expect(target.id).toBe('referral');
    expect(within(target).getByRole('button', { name: /^Mời bạn nhận quà/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('không có ?section=referral thì không cuộn', async () => {
    renderPage();
    await screen.findByText(/hoàn tất đơn thứ hai từ 200k trong 30 ngày/);
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
    await openPartner();
    expect(await screen.findByText('Kho Tubu HCMC, Đại lý An Phát')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Nhận hàng tại điểm/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle/desk');
  });

  it('nhân viên không có điểm nào: không có hàng', async () => {
    mocks.role = 'STAFF';
    renderPage();
    await openPartner();
    await waitFor(() => expect(mocks.deskPoints).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: /^Ca làm & chấm công/ })).toBeInTheDocument();
    expect(screen.queryByText('Nhận hàng tại điểm')).toBeNull();
  });

  it('đại lý có điểm đối tác: hiện hàng; chương trình đổi rác tắt thì không hỏi điểm', async () => {
    mocks.role = 'DEALER';
    mocks.deskPoints.mockResolvedValue([POINTS[1]]);
    mocks.getPublicConfig.mockResolvedValue({ waste: { enabled: true } });
    const { unmount } = renderPage();
    await openPartner();
    expect(await screen.findByRole('button', { name: /^Nhận hàng tại điểm/ })).toBeInTheDocument();
    unmount();
    mocks.deskPoints.mockClear();
    mocks.getPublicConfig.mockResolvedValue({ waste: { enabled: false } });
    renderPage();
    await screen.findByText('Cài đặt');
    await waitFor(() => expect(screen.queryByText('Nhận hàng tại điểm')).toBeNull());
    expect(mocks.deskPoints).not.toHaveBeenCalled();
  });

  it('nhân viên điểm đối tác mang vai CUSTOMER: cờ hasDeskPoint của /auth/me mở hàng; chương trình đổi rác tắt thì không hỏi điểm', async () => {
    mocks.authMeFlags.mockResolvedValue({ ownsBrand: false, hasDeskPoint: true });
    mocks.deskPoints.mockResolvedValue([POINTS[1]]);
    mocks.getPublicConfig.mockResolvedValue({ waste: { enabled: true } });
    const { unmount } = renderPage();
    await openPartner();
    expect(await screen.findByRole('button', { name: /^Nhận hàng tại điểm/ })).toBeInTheDocument();
    unmount();
    mocks.deskPoints.mockClear();
    mocks.getPublicConfig.mockResolvedValue({ waste: { enabled: false } });
    renderPage();
    await screen.findByText('Cài đặt');
    await waitFor(() => expect(screen.queryByText('Nhận hàng tại điểm')).toBeNull());
    expect(mocks.deskPoints).not.toHaveBeenCalled();
  });

  it('bản API cũ không có cờ hasDeskPoint: khách thường chạy như trước, không hỏi điểm', async () => {
    mocks.authMeFlags.mockResolvedValue({ ownsBrand: null, hasDeskPoint: false });
    mocks.getPublicConfig.mockResolvedValue({ waste: { enabled: true } });
    renderPage();
    await screen.findByText('Cài đặt');
    await waitFor(() => expect(mocks.orderCounts).toHaveBeenCalled());
    expect(mocks.deskPoints).not.toHaveBeenCalled();
  });

  it('khách thường không phát sinh lời gọi điểm nhận hàng', async () => {
    mocks.deskPoints.mockResolvedValue(POINTS);
    renderPage();
    await screen.findByText('Cài đặt');
    await waitFor(() => expect(mocks.orderCounts).toHaveBeenCalled());
    expect(mocks.deskPoints).not.toHaveBeenCalled();
    expect(screen.queryByText('Nhận hàng tại điểm')).toBeNull();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Cá nhân: chạm đúp cùng nhịp không gọi lặp (W78A)', () => {
  const COUNTS = { pending_payment: 3, processing: 3, shipping: 3, delivered: 3, closed: 3 };
  const copyRef = async () => {
    await openInvite();
    return screen.findByRole('button', { name: /Sao chép link mời bạn/ });
  };
  const shareRef = async () => {
    await openInvite();
    return screen.findByRole('button', { name: 'Chia sẻ qua Zalo' });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    arrangeDefaults();
    mocks.authStatus = 'authenticated';
    mocks.notifications = [];
    mocks.role = 'CUSTOMER';
    mocks.getPublicConfig.mockImplementation(async () => ({}));
    mocks.copyText.mockResolvedValue(true);
    mocks.shareLink.mockResolvedValue(undefined);
  });

  it('chạm đúp cùng nhịp vào ô chép mã giới thiệu: chỉ chép một lần, báo một thông báo', async () => {
    const d = deferred<boolean>();
    mocks.copyText.mockReturnValue(d.promise);
    renderPage();
    const btn = await copyRef();
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mocks.copyText).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
    await act(async () => {
      d.resolve(true);
    });
    await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
    expect(mocks.copyText).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã sao chép link mời bạn', type: 'success' });
  });

  it('chép mã không được thì nhả khoá: bấm lại chép lần nữa', async () => {
    mocks.copyText.mockResolvedValueOnce(false).mockResolvedValue(true);
    renderPage();
    const btn = await copyRef();
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' })));
    await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã sao chép link mời bạn', type: 'success' }));
  });

  it('chạm đúp cùng nhịp vào Chia sẻ: chỉ mở hộp chia sẻ một lần, nút báo bận tới khi xong', async () => {
    const d = deferred<void>();
    mocks.shareLink.mockReturnValue(d.promise);
    renderPage();
    const share = await shareRef();
    await act(async () => {
      fireEvent.click(share);
      fireEvent.click(share);
    });
    expect(mocks.shareLink).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(share).toHaveAttribute('aria-busy', 'true'));
    await act(async () => {
      d.resolve();
    });
    await waitFor(() => expect(share).not.toHaveAttribute('aria-busy'));
    expect(mocks.shareLink).toHaveBeenCalledTimes(1);
  });

  it('Chia sẻ rồi chép mã cùng nhịp (cùng một mã): chỉ việc đầu chạy, việc sau bị bỏ', async () => {
    const d = deferred<void>();
    mocks.shareLink.mockReturnValue(d.promise);
    renderPage();
    const share = await shareRef();
    const copy = await copyRef();
    await act(async () => {
      fireEvent.click(share);
      fireEvent.click(copy);
    });
    expect(mocks.shareLink).toHaveBeenCalledTimes(1);
    expect(mocks.copyText).not.toHaveBeenCalled();
    await act(async () => {
      d.resolve();
    });
    await waitFor(() => expect(share).not.toHaveAttribute('aria-busy'));
    fireEvent.click(copy);
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
  });

  it('khách đóng hộp chia sẻ (huỷ) thì nhả khoá: bấm Chia sẻ lại gọi lần nữa', async () => {
    mocks.shareLink.mockRejectedValueOnce({ code: -2003 }).mockResolvedValue(undefined);
    renderPage();
    const share = await shareRef();
    fireEvent.click(share);
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(share).not.toHaveAttribute('aria-busy'));
    fireEvent.click(share);
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(2));
  });

  // refetch() mặc định huỷ lần đang chạy rồi gọi lại khi truy vấn đã có số cũ, nên chạm đúp ở dòng báo lỗi sau một lần tải lỗi sẽ bắn hai lời gọi.
  it('chạm đúp cùng nhịp vào Thử lại số đơn (đã có số cũ): chỉ tải lại một lần, nút báo bận tới khi xong', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><ProfilePage /></QueryClientProvider>);
    await waitFor(() => expect(screen.getAllByTestId('order-count-badge').length).toBeGreaterThan(0));
    mocks.orderCounts.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['me-summary'] });
    });
    expect(await screen.findByText('Không tải được số đơn.')).toBeInTheDocument();
    const before = mocks.orderCounts.mock.calls.length;
    const d = deferred<typeof COUNTS>();
    mocks.orderCounts.mockReturnValueOnce(d.promise);
    const retry = screen.getByRole('button', { name: 'Thử lại' });
    await act(async () => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(mocks.orderCounts.mock.calls.length).toBe(before + 1);
    await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
    await act(async () => {
      d.resolve(COUNTS);
    });
    await waitFor(() => expect(screen.queryByText('Không tải được số đơn.')).toBeNull());
    expect(mocks.orderCounts.mock.calls.length).toBe(before + 1);
  });

  it('Thử lại số đơn vẫn lỗi thì nhả khoá: bấm lại tải thêm lần nữa', async () => {
    mocks.orderCounts.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText('Không tải được số đơn.')).toBeInTheDocument();
    const before = mocks.orderCounts.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(mocks.orderCounts.mock.calls.length).toBe(before + 1));
    expect(await screen.findByText('Không tải được số đơn.')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(mocks.orderCounts.mock.calls.length).toBe(before + 2));
  });

  it('chạm đúp cùng nhịp vào Thử lại ở dòng hạng và điểm: tải lại hạng và số đếm đúng một lần', async () => {
    vi.mocked(getLoyalty).mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByText('Chưa tải được hạng và điểm')).toBeInTheDocument();
    await waitFor(() => expect(mocks.orderCounts).toHaveBeenCalled());
    const loyaltyBefore = vi.mocked(getLoyalty).mock.calls.length;
    const summaryBefore = mocks.orderCounts.mock.calls.length;
    const d = deferred<{ pointsBalance: number; pointsConvertedBalance: number; tier: { name: string } }>();
    vi.mocked(getLoyalty).mockReturnValueOnce(d.promise as never);
    const retry = within(screen.getByRole('alert')).getByRole('button', { name: 'Thử lại' });
    await act(async () => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(vi.mocked(getLoyalty).mock.calls.length).toBe(loyaltyBefore + 1);
    expect(mocks.orderCounts.mock.calls.length).toBe(summaryBefore + 1);
    await act(async () => {
      d.resolve({ pointsBalance: 120, pointsConvertedBalance: 30, tier: { name: 'Mầm Xanh' } });
    });
    await waitFor(() => expect(screen.queryByText('Chưa tải được hạng và điểm')).toBeNull());
    expect(vi.mocked(getLoyalty).mock.calls.length).toBe(loyaltyBefore + 1);
    expect(mocks.orderCounts.mock.calls.length).toBe(summaryBefore + 1);
  });
});

describe('ProfilePage: hàng huy hiệu (cờ engagement.badges_enabled)', () => {
  afterEach(() => {
    mocks.badges = null;
  });

  it('cờ bật: hàng huy hiệu thay dòng Câu chuyện thương hiệu, các dòng khác giữ nguyên', async () => {
    mocks.badges = { enabled: true, badges: [{ id: 'FIRST_ORDER', earned: true, earnedAt: '2026-11-17T00:00:00.000Z' }] };
    renderPage();
    expect(await screen.findByTestId('badge-row')).toBeInTheDocument();
    expect(screen.getByText('1/8')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đơn đầu tiên, đã đạt' })).toBeInTheDocument();
    await openSupport();
    expect(screen.getByRole('button', { name: /^Về Tubu Tree & Hỗ trợ/ })).toBeInTheDocument();
    expect(screen.queryByText('Câu chuyện thương hiệu')).toBeNull();
  });

  it('cờ tắt: không có hàng huy hiệu, dòng Câu chuyện thương hiệu còn', async () => {
    mocks.badges = { enabled: false, badges: [] };
    renderPage();
    await openSupport();
    expect(await screen.findByRole('button', { name: /^Câu chuyện thương hiệu/ })).toBeInTheDocument();
    await waitFor(() => expect(mocks.coreGet).toHaveBeenCalledWith('/game/badges'));
    expect(screen.queryByTestId('badge-row')).toBeNull();
  });
});

describe('Cá nhân: thẻ danh tính không bấm được', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrangeDefaults();
    mocks.authStatus = 'authenticated';
    mocks.role = 'CUSTOMER';
    mocks.getPublicConfig.mockImplementation(async () => ({ chat: { enabled: true, hours: { start: '08:00', end: '21:00' } } }));
    mocks.chatSummary.mockResolvedValue({ unreadCount: 0 });
  });

  it('không nút nào mang tên Lan, không "Sửa hồ sơ", bấm vào tên không điều hướng; chat bật mà Hỗ trợ đóng thì không có nút Chat', async () => {
    renderPage();
    const name = await screen.findByText('Lan');
    expect(screen.queryByRole('button', { name: /Lan/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Sửa hồ sơ/ })).toBeNull();
    expect(name.closest('button, [role="button"], a')).toBeNull();
    fireEvent.click(name);
    expect(mocks.navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.chatSummary).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /^Chat với Tubu Tree/ })).toBeNull();
    await openSupport();
    expect(await screen.findByRole('button', { name: /^Chat với Tubu Tree/ })).toBeInTheDocument();
  });
});

describe('Cá nhân: thẻ danh sách một khối (buildProfileMenu)', () => {
  const SEVEN = ['Ưu đãi & quà', 'Mời bạn nhận quà', 'Sổ địa chỉ', 'Sản phẩm yêu thích', 'Đổi rác lấy quà', 'Hỗ trợ', 'Cài đặt'];
  const FULL_CFG = { chat: { enabled: true, hours: { start: '08:00', end: '21:00' } }, aiAdvisorEnabled: true, waste: { enabled: true } };

  beforeEach(() => {
    vi.clearAllMocks();
    arrangeDefaults();
    mocks.authStatus = 'authenticated';
    mocks.role = 'CUSTOMER';
    mocks.getPublicConfig.mockImplementation(async () => FULL_CFG);
    mocks.chatSummary.mockResolvedValue({ unreadCount: 0 });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('khách thường (chat, AI, đổi rác bật) có đúng bảy dòng theo thứ tự, không có "Dành cho đối tác"', async () => {
    renderPage();
    await screen.findByRole('button', { name: /^Đổi rác lấy quà/ });
    await waitFor(() => expect(mocks.authMeFlags).toHaveBeenCalled());
    const list = screen.getByRole('button', { name: /^Cài đặt/ }).parentElement as HTMLElement;
    const rows = Array.from(list.children).map((row) => SEVEN.find((label) => row.textContent?.startsWith(label)));
    expect(rows).toEqual(SEVEN);
    expect(screen.queryByRole('button', { name: /^Dành cho đối tác/ })).toBeNull();
    expect(screen.queryByText('Dành cho đối tác')).toBeNull();
  });

  describe('accordion Mời bạn nhận quà', () => {
    it('mặc định đóng và nút Chia sẻ không truy cập được; bấm mở thì nút hiện, bấm lại thì đóng', async () => {
      renderPage();
      const toggle = await screen.findByRole('button', { name: /^Mời bạn nhận quà/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toHaveAttribute('hidden');
      expect(screen.queryByRole('button', { name: 'Chia sẻ qua Zalo' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Sao chép link mời bạn' })).toBeNull();

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: 'Chia sẻ qua Zalo' })).toBeInTheDocument();
      expect(screen.getByText(/Mã của bạn:/)).toHaveTextContent('Mã của bạn: LAN1');

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('button', { name: 'Chia sẻ qua Zalo' })).toBeNull();
    });
  });

  describe('accordion Hỗ trợ', () => {
    it('mở ra có đủ bốn mục, mỗi mục điều hướng đúng', async () => {
      renderPage();
      const toggle = await screen.findByRole('button', { name: /^Hỗ trợ/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('button', { name: /^Về Tubu Tree & Hỗ trợ/ })).toBeNull();
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const targets: [RegExp, string][] = [
        [/^Chat với Tubu Tree/, '/chat'],
        [/^Trợ lý AI 24\/7/, '/ai-advisor'],
        [/^Về Tubu Tree & Hỗ trợ/, '/about'],
        [/^Câu chuyện thương hiệu/, '/brand-story'],
      ];
      for (const [name, path] of targets) {
        fireEvent.click(await screen.findByRole('button', { name }));
        expect(mocks.navigate).toHaveBeenLastCalledWith(path);
      }
    });

    it('tin chưa đọc: dòng Hỗ trợ đóng có chấm và tên "Hỗ trợ, có tin mới"; mở ra thì chấm nằm ở dòng Chat', async () => {
      mocks.chatSummary.mockResolvedValue({ unreadCount: 2 });
      renderPage();
      const closed = await screen.findByRole('button', { name: 'Hỗ trợ, có tin mới' });
      expect(await screen.findByTestId('support-unread-dot')).toBeInTheDocument();
      expect(screen.queryByRole('img', { name: 'Có tin nhắn mới' })).toBeNull();

      fireEvent.click(closed);
      expect(closed).toHaveAttribute('aria-expanded', 'true');
      expect(closed).toHaveAccessibleName('Hỗ trợ');
      expect(screen.queryByTestId('support-unread-dot')).toBeNull();
      const chat = screen.getByRole('button', { name: /^Chat với Tubu Tree/ });
      expect(within(chat).getByRole('img', { name: 'Có tin nhắn mới' })).toBe(screen.getByTestId('chat-unread-dot'));
    });
  });

  describe('dòng Dành cho đối tác chỉ có khi có vai trò hoặc việc đối tác', () => {
    it('AFFILIATE có dòng, đóng thì mục con không truy cập được, mở ra thấy Cộng tác viên và Học viện Tubu', async () => {
      mocks.role = 'AFFILIATE';
      renderPage();
      const toggle = await screen.findByRole('button', { name: /^Dành cho đối tác/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('button', { name: /^Cộng tác viên/ })).toBeNull();
      fireEvent.click(toggle);
      fireEvent.click(await screen.findByRole('button', { name: /^Cộng tác viên/ }));
      expect(mocks.navigate).toHaveBeenLastCalledWith('/affiliate');
      fireEvent.click(screen.getByRole('button', { name: /^Học viện Tubu/ }));
      expect(mocks.navigate).toHaveBeenLastCalledWith('/academy');
    });

    it('STAFF có điểm nhận hàng: mở ra thấy ca làm, lương và Nhận hàng tại điểm mở /recycle/desk', async () => {
      mocks.role = 'STAFF';
      mocks.deskPoints.mockResolvedValue([{ id: 'p1', name: 'Kho Tubu HCMC', kind: 'WAREHOUSE' }]);
      renderPage();
      await openPartner();
      expect(await screen.findByRole('button', { name: /^Ca làm & chấm công/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Lương của tôi/ })).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: /^Nhận hàng tại điểm/ }));
      expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle/desk');
    });
  });

  describe('dòng đổi rác theo cờ chương trình', () => {
    it('chương trình bật: "Đổi rác lấy quà" mở /recycle, không hỏi yêu cầu đang mở', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: /^Đổi rác lấy quà/ }));
      expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle');
      expect(mocks.recycleHook).not.toHaveBeenCalledWith(true, true);
    });

    it('chương trình tắt mà còn yêu cầu mở: dòng "Yêu cầu của tôi" kèm gợi ý tạm dừng, mở /recycle', async () => {
      mocks.getPublicConfig.mockImplementation(async () => ({ waste: { enabled: false } }));
      mocks.recycleOpen = true;
      renderPage();
      const row = await screen.findByRole('button', { name: /^Yêu cầu của tôi/ });
      expect(row).toHaveTextContent('Chương trình đang tạm dừng, xem yêu cầu còn mở');
      expect(screen.queryByText('Đổi rác lấy quà')).toBeNull();
      fireEvent.click(row);
      expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle');
    });

    it('chương trình tắt và không còn yêu cầu mở: không có dòng đổi rác', async () => {
      mocks.getPublicConfig.mockImplementation(async () => ({ waste: { enabled: false } }));
      renderPage();
      await screen.findByText('Cài đặt');
      await waitFor(() => expect(mocks.recycleHook).toHaveBeenCalledWith(true, true));
      expect(screen.queryByText('Đổi rác lấy quà')).toBeNull();
      expect(screen.queryByText('Yêu cầu của tôi')).toBeNull();
    });
  });
});
