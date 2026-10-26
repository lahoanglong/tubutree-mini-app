import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  role: 'CUSTOMER',
  affiliateMe: { isAffiliate: false, canRegister: false } as { isAffiliate: boolean; canRegister: boolean },
  getPublicConfig: vi.fn(async () => ({})),
  chatSummary: vi.fn(),
}));
vi.mock('../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPublicConfig: mocks.getPublicConfig,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Avatar: () => <span />,
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/support-chat-api', () => ({
  supportChatSummaryQueryOptions: () => ({ queryKey: ['support-chat-summary'], queryFn: mocks.chatSummary }),
}));
vi.mock('../services/account-api', () => ({
  getLoyalty: vi.fn().mockResolvedValue({ pointsBalance: 120, pointsConvertedBalance: 30, tier: { name: 'Mầm Xanh' } }),
  getNotifications: vi.fn(async () => mocks.notifications),
  getWallet: vi.fn().mockResolvedValue({ walletBalance: 50000 }),
  getCoupons: vi.fn().mockResolvedValue([{ code: 'A' }, { code: 'B' }]),
}));
vi.mock('../services/brand-owner-api', () => ({ getOwnedBrand: vi.fn().mockResolvedValue(null), getOwnsBrand: vi.fn().mockResolvedValue(null) }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn(async () => mocks.affiliateMe) }));
vi.mock('../services/dealer-api', () => ({ getDealerMe: vi.fn().mockResolvedValue({ isDealer: false, status: null }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../store/auth', () => {
  const state = () => ({
    status: mocks.authStatus,
    error: null,
    user: { fullName: 'Lan', role: mocks.role, referralCode: 'LAN1', pointsBalance: 100, walletBalance: 40000, avatarUrl: null },
    logout: vi.fn(),
    restore: mocks.restore,
  });
  const useAuthStore = Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(state()) : state()), {
    getState: () => ({ ...state(), login: mocks.login }),
  });
  return { useAuthStore };
});

import ProfilePage from './profile';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ProfilePage /></QueryClientProvider>);
}

describe('Thanh số dư ở hub Cá nhân (C-086)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.notifications = [];
    mocks.role = 'CUSTOMER';
  });

  it('có đúng ba số dư: Điểm Xanh (tổng hai lô), Ví Tubu, Mã giảm giá — không còn ô xu (C-047, PD-3)', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /^Mã giảm giá: 2 mã$/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Điểm Xanh: 150 điểm$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Ví Tubu: 50\.000đ$/ })).toBeInTheDocument();
    const balances = screen.getAllByRole('button').filter((b) => /^[^:]+: .+/.test(b.getAttribute('aria-label') ?? ''));
    expect(balances.map((b) => (b.getAttribute('aria-label') ?? '').split(':')[0])).toEqual(['Điểm Xanh', 'Ví Tubu', 'Mã giảm giá']);
    expect(screen.queryByText(/TubuXu/)).toBeNull();
    expect(screen.queryByRole('button', { name: /(?<![\p{L}_])xu(?![\p{L}_])/iu })).toBeNull();
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
    const tile = await screen.findByRole('button', { name: /^Ví Tubu: 50\.000đ$/ });
    const value = Array.from(tile.querySelectorAll<HTMLElement>('*')).find((el) => el.textContent === '50.000đ' && el.children.length === 0)!;
    expect(value).toBeTruthy();
    expect(value.style.fontFamily).toContain('--font-ui');
    expect(value.style.fontFamily).not.toContain('--font-display');
    expect(value.style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('không còn mục Hoàn tiền sàn ngoài; bấm mục menu điều hướng thật, không báo "đang hoàn thiện"', async () => {
    renderPage();
    expect(screen.queryByText('Hoàn tiền sàn ngoài')).toBeNull();
    fireEvent.click(await screen.findByText('Câu chuyện thương hiệu'));
    expect(mocks.navigate).toHaveBeenCalledWith('/brand-story', undefined);
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
  });
});

describe('Hub Cá nhân theo DS v2 (C-076, C-114)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.notifications = [];
    mocks.copyText.mockResolvedValue(true);
  });

  it('có đúng một h1 "Cá nhân" và các nhóm menu là h2', async () => {
    renderPage();
    await screen.findByText('Câu chuyện thương hiệu');
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Cá nhân']);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['MUA SẮM', 'TÀI SẢN', 'HỢP TÁC', 'KHÁC']);
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
    fireEvent.click(screen.getByRole('button', { name: /Mã giới thiệu: LAN1/ }));
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
    expect(mocks.navigate).toHaveBeenCalledWith('/notifications', undefined);
  });

  it('mục Ví Tubu mang state.from để nút quay lại về hub', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Ví Tubu$/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/wallet', { state: { from: '/profile' } });
  });
});

describe('Lối vào Trợ lý AI ở hub Cá nhân theo công tắc AI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(screen.getByText('Mua chung nhóm')).toBeInTheDocument();
  });
});

describe('Lối vào Tích điểm đơn sàn (nhóm Tài sản)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.notifications = [];
    mocks.getPublicConfig.mockImplementation(async () => ({}));
  });

  it('ẩn khi cờ tích điểm đơn sàn tắt hoặc API cũ chưa trả', async () => {
    renderPage();
    await screen.findByText('Câu chuyện thương hiệu');
    expect(screen.queryByText('Tích điểm đơn sàn')).toBeNull();
  });

  it('hiện và đi tới /points/scan khi cờ bật', async () => {
    mocks.getPublicConfig.mockImplementation(async () => ({ loyalty: { marketplaceClaimEnabled: true, earnPct: 2, vndPerPoint: 50 } }));
    renderPage();
    fireEvent.click(await screen.findByText('Tích điểm đơn sàn'));
    expect(mocks.navigate).toHaveBeenCalledWith('/points/scan', undefined);
  });
});

describe('Lối vào "Chat với Tubu Tree" ở hub Cá nhân', () => {
  const chatCfg = (enabled: boolean) => ({ chat: { enabled, hours: { start: '08:00', end: '21:00' } } });
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(mocks.navigate).toHaveBeenCalledWith('/chat', undefined);
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
