import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  shareLink: vi.fn(),
  copyText: vi.fn(),
  getAffiliateMe: vi.fn(),
  registerAffiliate: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? <div data-testid="sheet">{children}</div> : null,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/affiliate', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'authenticated' }),
}));
vi.mock('../services/zmp-bridge', () => ({ shareLink: mocks.shareLink }));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../components/qr-code', () => ({ QrCode: () => null }));
vi.mock('../components/affiliate/ctv-order-sheet', () => ({
  CtvOrderSheet: () => <div data-testid="ctv-order-sheet" />,
}));
vi.mock('../services/affiliate-api', () => ({
  getAffiliateMe: mocks.getAffiliateMe,
  registerAffiliate: mocks.registerAffiliate,
  getAffiliateDashboard: vi.fn().mockResolvedValue({
    todayCommission: 0, monthCommission: 125_000, pendingCommission: 0, withdrawableCommission: 0,
    totalClicks: 4, totalConversions: 1, monthRevenue: 0,
    tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
  }),
  getAffiliateLinks: vi.fn().mockResolvedValue([]),
  createAffiliateLink: vi.fn(),
  getCommissions: vi.fn().mockResolvedValue([]),
  requestPayout: vi.fn(),
  getStorefrontAnalytics: vi.fn().mockResolvedValue({ storefronts: [] }),
  getProductBreakdown: vi.fn().mockResolvedValue([]),
  getCtvTiers: vi.fn().mockResolvedValue({ allTiers: [] }),
  getCtvMilestones: vi.fn().mockResolvedValue({ milestones: [], previousMonth: null }),
  claimCtvMilestone: vi.fn(),
}));
vi.mock('../hooks/use-public-config', () => ({
  usePublicConfig: () => ({ affiliateMinWithdrawBank: 50_000, isLoaded: true }),
}));

import AffiliatePage from './affiliate';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AffiliatePage /></QueryClientProvider>);
}

describe('Dashboard CTV — chia sẻ mã giới thiệu (C-067)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 });
    mocks.copyText.mockResolvedValue(true);
  });

  it('shareLink reject: sao chép lời mời kèm liên kết có mã và báo snackbar, không im lặng', async () => {
    mocks.shareLink.mockRejectedValue(new Error('zalo từ chối'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    expect(mocks.copyText).toHaveBeenCalledWith(expect.stringContaining('/?ref=TUBU88'));
    expect(mocks.copyText).toHaveBeenCalledWith(expect.stringContaining('dùng mã TUBU88'));
    expect((mocks.openSnackbar.mock.calls[0]![0] as { text: string }).text).toMatch(/Chưa chia sẻ được qua Zalo/);
  });

  it('chia sẻ được thì không báo gì thêm', async () => {
    mocks.shareLink.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ' }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(1));
    expect(mocks.shareLink.mock.calls[0]![0].path).toBe('/?ref=TUBU88');
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
  });
});

describe('Đăng ký CTV — đồng ý điều khoản hoa hồng & thuế (C-117)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: false, referralCode: 'TUBU88', walletBalance: 0 });
    mocks.registerAffiliate.mockResolvedValue({ ok: true, referralCode: 'TUBU88' });
  });

  it('hiện điều khoản ngắn về hoa hồng và thuế trước nút đăng ký', async () => {
    renderPage();
    expect(await screen.findByText('Điều khoản hoa hồng & thuế')).toBeInTheDocument();
    expect(screen.getByText(/hết thời gian đổi\/trả/)).toBeInTheDocument();
    expect(screen.getByText(/tự kê khai và nộp thuế/)).toBeInTheDocument();
  });

  it('chưa tick đồng ý: nút đăng ký bị khoá, có lời nhắc, không gọi API', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Đăng ký miễn phí ngay' });
    expect(btn).toBeDisabled();
    expect(screen.getByText('Tick đồng ý điều khoản để đăng ký')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(mocks.registerAffiliate).not.toHaveBeenCalled();
  });

  it('tick đồng ý rồi đăng ký: gửi kèm phiên bản điều khoản, bỏ lời nhắc', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Đăng ký miễn phí ngay' });
    fireEvent.click(screen.getByRole('checkbox', { name: /đồng ý với điều khoản hoa hồng/ }));
    expect(btn).toBeEnabled();
    expect(screen.queryByText('Tick đồng ý điều khoản để đăng ký')).toBeNull();
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.registerAffiliate).toHaveBeenCalledTimes(1));
    expect(mocks.registerAffiliate).toHaveBeenCalledWith('2026-10');
  });

  it('đang gửi đăng ký: nút hiện spinner (không bị disabled), bấm lại không gửi lần 2', async () => {
    mocks.registerAffiliate.mockReturnValue(new Promise(() => {}));
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Đăng ký miễn phí ngay' });
    fireEvent.click(screen.getByRole('checkbox', { name: /đồng ý với điều khoản hoa hồng/ }));
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveClass('zaui-btn-loading'));
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(mocks.registerAffiliate).toHaveBeenCalledTimes(1);
  });

  it('bỏ tick lại thì khoá nút trở lại', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Đăng ký miễn phí ngay' });
    const box = screen.getByRole('checkbox', { name: /đồng ý với điều khoản hoa hồng/ });
    fireEvent.click(box);
    fireEvent.click(box);
    expect(btn).toBeDisabled();
  });
});

describe('Dashboard CTV — lối tắt Lên đơn hộ ở đầu trang (C-064)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 });
  });

  it('nút Lên đơn hộ khách nằm trước nút Rút hoa hồng và trước lịch sử hoa hồng, đủ cao 44px', async () => {
    renderPage();
    const entry = await screen.findByRole('button', { name: /Lên đơn hộ khách/ });
    const withdraw = screen.getByRole('button', { name: 'Rút hoa hồng' });
    const history = screen.getByText('Lịch sử hoa hồng');
    expect(entry.compareDocumentPosition(withdraw) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(entry.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(entry.style.minHeight).toBe('44px');
  });

  it('chạm lối tắt mở form lên đơn hộ', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Lên đơn hộ khách/ }));
    expect(await screen.findByTestId('ctv-order-sheet')).toBeInTheDocument();
  });
});

describe('Trang CTV — đúng một h1 ở mọi trạng thái (C-114)', () => {
  const h1s = () => screen.queryAllByRole('heading', { level: 1 });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('đang tải', () => {
    mocks.getAffiliateMe.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(h1s().map((h) => h.textContent)).toEqual(['Cộng tác viên']);
  });

  it('lỗi tải: có h1 và nút Thử lại gọi lại API', async () => {
    mocks.getAffiliateMe.mockRejectedValueOnce(new Error('mạng lỗi'));
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 });
    renderPage();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(h1s().map((h) => h.textContent)).toEqual(['Cộng tác viên']);
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.getAffiliateMe).toHaveBeenCalledTimes(2));
  });

  it('chưa là CTV (form đăng ký)', async () => {
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: false, referralCode: '', walletBalance: 0 });
    renderPage();
    await screen.findByRole('button', { name: 'Đăng ký miễn phí ngay' });
    expect(h1s().map((h) => h.textContent)).toEqual(['Cộng tác viên']);
  });

  it('dashboard CTV', async () => {
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 });
    renderPage();
    await screen.findByRole('button', { name: /Lên đơn hộ khách/ });
    expect(h1s().map((h) => h.textContent)).toEqual(['Cộng tác viên']);
  });
});
