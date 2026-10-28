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
  fetchCourses: vi.fn(),
}));
vi.mock('../services/academy-api', () => ({ fetchCourses: mocks.fetchCourses }));
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
vi.mock('../services/account-api', () => ({ getWallet: vi.fn().mockResolvedValue({ walletBalance: 75_000 }) }));
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
  getMyPayouts: vi.fn().mockResolvedValue([]),
  requestPayout: vi.fn(),
  getTaxStatement: vi.fn().mockResolvedValue({
    year: 2026, fullName: null, taxId: null, items: [], totals: { grossAmount: 0, taxWithheld: 0, netAmount: 0 },
  }),
  getStorefrontAnalytics: vi.fn().mockResolvedValue({ storefronts: [] }),
  getProductBreakdown: vi.fn().mockResolvedValue([]),
  getCtvTiers: vi.fn().mockResolvedValue({ allTiers: [] }),
  getCtvMilestones: vi.fn().mockResolvedValue({ milestones: [], previousMonth: null }),
  claimCtvMilestone: vi.fn(),
}));
vi.mock('../hooks/use-public-config', () => ({
  usePublicConfig: () => ({
    affiliatePitWithhold: { pct: 0.1, threshold: 2_000_000 },
    isLoaded: true,
  }),
}));

import AffiliatePage from './affiliate';
import {
  claimCtvMilestone,
  getAffiliateDashboard,
  getAffiliateLinks,
  getCommissions,
  getCtvMilestones,
  getMyPayouts,
  getCtvTiers,
  getTaxStatement,
  requestPayout,
} from '../services/affiliate-api';

/** Dữ liệu từng tab chỉ tải khi mở tab đó. */
const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

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

  it('lối tắt Chia sẻ mở bảng chia sẻ có QR, Zalo, sao chép link và lời đăng, link là link Mini App', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ link và mã giới thiệu/ }));
    expect(await screen.findByText('Chia sẻ mã giới thiệu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Sao chép link/ }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
    expect(mocks.copyText).toHaveBeenCalledWith('https://zalo.me/s/2070857098114207963/?ref=TUBU88');
  });

  it('shareLink reject: sao chép link kèm mã và báo snackbar, không im lặng', async () => {
    mocks.shareLink.mockRejectedValue(new Error('zalo từ chối'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ link và mã giới thiệu/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ qua Zalo/ }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    expect(mocks.copyText).toHaveBeenCalledWith(expect.stringContaining('/?ref=TUBU88'));
    expect((mocks.openSnackbar.mock.calls[0]![0] as { text: string }).text).toMatch(/Chưa chia sẻ được qua Zalo/);
  });

  it('chia sẻ được thì không báo gì thêm', async () => {
    mocks.shareLink.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ link và mã giới thiệu/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ qua Zalo/ }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(1));
    expect(mocks.shareLink.mock.calls[0]![0].path).toBe('/?ref=TUBU88');
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
  });

  it('tab Chia sẻ: nút trong thẻ mã là "Sao chép mã" và chép đúng mã', async () => {
    renderPage();
    await screen.findByRole('tab', { name: 'Chia sẻ' });
    openTab('Chia sẻ');
    fireEvent.click(await screen.findByRole('button', { name: 'Sao chép mã' }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('TUBU88'));
  });

  it('tab Chia sẻ: sao chép link đã tạo dùng link Mini App kèm mã và mã link', async () => {
    vi.mocked(getAffiliateLinks).mockResolvedValue([{ id: 'l1', targetType: 'HOMEPAGE', shortCode: 'abc', clicks: 3 }] as Awaited<ReturnType<typeof getAffiliateLinks>>);
    renderPage();
    await screen.findByRole('tab', { name: 'Chia sẻ' });
    openTab('Chia sẻ');
    fireEvent.click(await screen.findByRole('button', { name: 'Sao chép' }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('https://zalo.me/s/2070857098114207963/?ref=TUBU88&l=abc'));
  });
});

describe('Dashboard CTV — lối vào Học viện chỉ hiện khi có khoá học (B-37)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 });
  });

  it('chưa có khoá nào: không có nút Học viện', async () => {
    mocks.fetchCourses.mockResolvedValue([]);
    renderPage();
    await screen.findByRole('button', { name: /Lên đơn hộ khách/ });
    await waitFor(() => expect(mocks.fetchCourses).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Học viện CTV' })).not.toBeInTheDocument();
  });

  it('có khoá: hiện nút Học viện và mở /academy', async () => {
    mocks.fetchCourses.mockResolvedValue([{ id: 'c1', title: 'Bắt đầu làm CTV' }]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Học viện CTV' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/academy');
  });
});

describe('Đăng ký CTV — đồng ý điều khoản hoa hồng & thuế (C-117)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: false, referralCode: 'TUBU88', walletBalance: 0 });
    mocks.registerAffiliate.mockResolvedValue({ ok: true, referralCode: 'TUBU88' });
  });

  it('lợi ích đầu tiên nói về gian hàng riêng', async () => {
    renderPage();
    expect(await screen.findByText('Gian hàng riêng với đường dẫn mang tên bạn để gửi cho khách')).toBeInTheDocument();
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
    expect(screen.getByText('Chọn ô đồng ý điều khoản để đăng ký')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(mocks.registerAffiliate).not.toHaveBeenCalled();
  });

  it('tick đồng ý rồi đăng ký: gửi kèm phiên bản điều khoản, bỏ lời nhắc', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Đăng ký miễn phí ngay' });
    fireEvent.click(screen.getByRole('checkbox', { name: /đồng ý với điều khoản hoa hồng/ }));
    expect(btn).toBeEnabled();
    expect(screen.queryByText('Chọn ô đồng ý điều khoản để đăng ký')).toBeNull();
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

  it('nút Lên đơn hộ khách nằm trước nút Chuyển vào Ví và trước các tab, đủ cao 44px', async () => {
    renderPage();
    const entry = await screen.findByRole('button', { name: /Lên đơn hộ khách/ });
    const withdraw = screen.getByRole('button', { name: 'Chuyển vào Ví Tubu' });
    const tabs = screen.getByRole('tablist');
    expect(entry.compareDocumentPosition(withdraw) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(entry.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(parseInt(entry.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });

  it('chạm lối tắt mở form lên đơn hộ', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Lên đơn hộ khách/ }));
    expect(await screen.findByTestId('ctv-order-sheet')).toBeInTheDocument();
  });
});

describe('Dashboard CTV — nút mở bảng 5 bậc báo trạng thái mở/đóng', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 });
  });

  it('aria-expanded đổi theo lần chạm, vùng chạm cao 44px', async () => {
    renderPage();
    const toggle = await screen.findByRole('button', { name: /Bảng 5 bậc CTV/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(parseInt(toggle.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
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

describe('Dashboard CTV — số tiền hiển thị giữ nguyên khi đổi giao diện', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 });
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      todayCommission: 15_000, monthCommission: 125_000, pendingCommission: 30_000, withdrawableCommission: 200_000,
      totalClicks: 4, totalConversions: 1, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
    vi.mocked(getCommissions).mockResolvedValue([
      { id: 'c1', amount: 25_000, orderTotal: 500_000, status: 'APPROVED', createdAt: '2026-10-01T03:00:00.000Z' },
      { id: 'c2', amount: 9_000, orderTotal: 90_000, status: 'PENDING', createdAt: '2026-10-02T03:00:00.000Z' },
      { id: 'c3', amount: 4_000, orderTotal: 40_000, status: 'LOCKED', createdAt: '2026-10-03T03:00:00.000Z' },
      { id: 'c4', amount: 2_000, orderTotal: 20_000, status: 'PAID', createdAt: '2026-10-04T03:00:00.000Z' },
      { id: 'c5', amount: 1_000, orderTotal: 10_000, status: 'REJECTED', createdAt: '2026-10-05T03:00:00.000Z' },
    ] as Awaited<ReturnType<typeof getCommissions>>);
  });

  it('thẻ đầu trang (số dùng được, đang chờ, tạm tính tháng) và từng dòng lịch sử đúng số và đúng nhãn trạng thái', async () => {
    renderPage();
    // Số to là tiền dùng được ngay; hoa hồng đang chờ và số tạm tính là dòng phụ.
    expect(await screen.findByText('200.000đ')).toBeInTheDocument();
    expect(screen.getAllByText('Có thể chuyển vào Ví')).toHaveLength(1);
    expect(screen.getByText(/Đang chờ: 30\.000đ/)).toBeInTheDocument();
    expect(screen.getByText('Tạm tính tháng này')).toBeInTheDocument();
    expect(screen.getByText('125.000đ')).toBeInTheDocument();
    openTab('Hoa hồng');
    expect(await screen.findByText('+25.000đ')).toBeInTheDocument();
    expect(screen.getByText('Đơn 500.000đ ·', { exact: false })).toBeInTheDocument();
    for (const label of ['Đang chờ · đơn chưa giao', 'Đang chờ · đang giữ', 'Đã trả', 'Từ chối']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText('Có thể chuyển vào Ví').length).toBeGreaterThanOrEqual(1);
  });

  it('dòng hoa hồng kèm mã đơn và trạng thái đơn; khoản nằm trong lệnh rút cũ hiện "Lệnh rút cũ đang xử lý", không phải "Đã trả" (SELLER-10)', async () => {
    vi.mocked(getCommissions).mockResolvedValue([
      { id: 'c1', amount: 25_000, orderTotal: 500_000, status: 'APPROVED', withdrawing: true, orderCode: 'TB123', orderStatus: 'DELIVERED', createdAt: '2026-10-01T03:00:00.000Z' },
    ] as Awaited<ReturnType<typeof getCommissions>>);
    renderPage();
    await screen.findByRole('tab', { name: 'Hoa hồng' });
    openTab('Hoa hồng');
    expect(await screen.findByText('Lệnh rút cũ đang xử lý')).toBeInTheDocument();
    expect(screen.getByText('Đơn TB123 ·', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Giao thành công')).toBeInTheDocument();
    expect(screen.queryByText('Đã trả')).toBeNull();
  });

  it('mục Lịch sử chuyển vào Ví: trạng thái, lý do từ chối, mã giao dịch và thuế TNCN đã khấu trừ', async () => {
    vi.mocked(getMyPayouts).mockResolvedValue([
      { id: 'p1', amount: 2_700_000, grossAmount: 3_000_000, taxWithheld: 300_000, fee: 0, method: 'BANK', status: 'PAID', rejectionReason: null, bankRef: 'FT2610', requestedAt: '2026-10-01T03:00:00.000Z', reviewedAt: null, paidAt: '2026-10-02T03:00:00.000Z' },
      { id: 'p2', amount: 60_000, grossAmount: 60_000, taxWithheld: 0, fee: 0, method: 'BANK', status: 'REJECTED', rejectionReason: 'Thiếu số tài khoản', bankRef: null, requestedAt: '2026-10-03T03:00:00.000Z', reviewedAt: '2026-10-04T03:00:00.000Z', paidAt: null },
    ]);
    renderPage();
    await screen.findByRole('tab', { name: 'Hoa hồng' });
    openTab('Hoa hồng');
    expect(await screen.findByRole('heading', { level: 2, name: 'Lịch sử chuyển vào Ví' })).toBeInTheDocument();
    expect(await screen.findByText('Đã chuyển')).toBeInTheDocument();
    expect(screen.getByText('Mã giao dịch: FT2610')).toBeInTheDocument();
    expect(screen.getByText(/đã khấu trừ thuế TNCN 300\.000đ/)).toBeInTheDocument();
    expect(screen.getByText('Bị từ chối')).toBeInTheDocument();
    expect(screen.getByText(/Lý do: Thiếu số tài khoản/)).toBeInTheDocument();
  });

  it('Q2b: lệnh đã được hoàn thuế giữ dư vào Ví → ghi rõ số đã hoàn, không ghi thuế đã khấu trừ 0đ', async () => {
    vi.mocked(getMyPayouts).mockResolvedValue([
      { id: 'p1', amount: 750_000, grossAmount: 1_000_000, taxWithheld: 0, taxRefunded: 250_000, fee: 0, method: 'WALLET_BALANCE', status: 'PAID', rejectionReason: null, bankRef: null, requestedAt: '2026-10-09T03:00:00.000Z', reviewedAt: null, paidAt: '2026-10-09T03:00:00.000Z' },
    ]);
    renderPage();
    await screen.findByRole('tab', { name: 'Hoa hồng' });
    openTab('Hoa hồng');
    expect(await screen.findByText('Đã chuyển')).toBeInTheDocument();
    expect(screen.getByText(/đã hoàn 250\.000đ thuế giữ dư vào Ví/)).toBeInTheDocument();
    expect(screen.queryByText(/đã khấu trừ thuế TNCN 0đ/)).toBeNull();
  });

  it('SELLER-11: có khấu trừ trong năm → tổng thu nhập và thuế đã khấu trừ năm nay, cách nhận chứng từ khấu trừ', async () => {
    vi.mocked(getTaxStatement).mockResolvedValue({
      year: 2026, fullName: 'Nguyễn An', taxId: '079201001234', items: [],
      totals: { grossAmount: 3_000_000, taxWithheld: 300_000, netAmount: 2_700_000 },
    });
    renderPage();
    await screen.findByRole('tab', { name: 'Hoa hồng' });
    openTab('Hoa hồng');
    expect(await screen.findByText('Năm 2026: thu nhập hoa hồng 3.000.000đ · đã khấu trừ thuế TNCN 300.000đ')).toBeInTheDocument();
    expect(screen.getByText(/chứng từ khấu trừ thuế TNCN/)).toBeInTheDocument();
  });

  it('còn hoa hồng trong lệnh rút ngân hàng cũ: báo số đang chờ Tubu Tree xử lý', async () => {
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      todayCommission: 0, monthCommission: 0, pendingCommission: 0, withdrawableCommission: 0, withdrawingCommission: 80_000,
      totalClicks: 0, totalConversions: 0, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
    renderPage();
    expect(await screen.findByText(/Còn 80\.000đ nằm trong lệnh rút ngân hàng cũ/)).toBeInTheDocument();
  });
});

describe('Dashboard CTV — chuyển hoa hồng vào Ví', () => {
  /** zmp-ui Input vẽ nhãn là phần tử riêng (không htmlFor) nên tìm ô nhập đi kèm nhãn hiển thị. */
  const inputNear = (labelText: string): HTMLInputElement => {
    let node: HTMLElement | null = screen.getByText(labelText);
    while (node && !node.querySelector('input')) node = node.parentElement;
    const input = node?.querySelector('input');
    if (!input) throw new Error('Không thấy ô nhập cạnh nhãn: ' + labelText);
    return input;
  };

  /** Nút Chuyển vào Ví khoá tới khi số dư về, nên chờ nó mở rồi mới bấm. */
  const openTransfer = async () => {
    const btn = await screen.findByRole('button', { name: 'Chuyển vào Ví Tubu' });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 });
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      todayCommission: 0, monthCommission: 0, pendingCommission: 0, withdrawableCommission: 200_000,
      totalClicks: 0, totalConversions: 0, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
    vi.mocked(requestPayout).mockResolvedValue({ note: 'Đã chuyển hoa hồng vào Ví Tubu.' } as Awaited<ReturnType<typeof requestPayout>>);
  });

  it('mở sheet: tiêu đề h2, điền sẵn toàn bộ số có thể chuyển, không có lựa chọn ngân hàng, gửi đúng lệnh chuyển vào Ví', async () => {
    renderPage();
    await openTransfer();
    expect(await screen.findByRole('heading', { level: 2, name: 'Chuyển hoa hồng vào Ví' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ngân hàng|ZaloPay/ })).toBeNull();
    expect(screen.queryByText(/Tên ngân hàng|Số tài khoản|Chủ tài khoản/)).toBeNull();
    expect(screen.getByText('Mỗi lần chuyển là toàn bộ hoa hồng có thể chuyển.')).toBeInTheDocument();
    expect(screen.queryByText('Số tiền')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Nhận 200.000đ vào Ví' }));
    await waitFor(() => expect(requestPayout).toHaveBeenCalledTimes(1));
    expect(requestPayout).toHaveBeenCalledWith(200000, expect.any(String));
  });

  it('gửi lại sau lỗi dùng cùng Idempotency-Key (không tạo lệnh thứ hai)', async () => {
    vi.mocked(requestPayout).mockRejectedValueOnce(new Error('Network Error'));
    renderPage();
    await openTransfer();
    const submit = await screen.findByRole('button', { name: 'Nhận 200.000đ vào Ví' });
    fireEvent.click(submit);
    await waitFor(() => expect(requestPayout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(requestPayout).toHaveBeenCalledTimes(2));
    const keys = vi.mocked(requestPayout).mock.calls.map((c) => c[1]);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it('từ ngưỡng thuế TNCN: hiện số khấu trừ và thực nhận trước khi bấm chuyển (SELLER-11)', async () => {
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      todayCommission: 0, monthCommission: 0, pendingCommission: 0, withdrawableCommission: 3_000_000,
      totalClicks: 0, totalConversions: 0, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
    renderPage();
    await openTransfer();
    expect(await screen.findByText('Khấu trừ thuế TNCN 300.000đ · thực nhận 2.700.000đ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nhận 2.700.000đ vào Ví' })).toBeInTheDocument();
  });

  it('Q2: thuế tính cộng dồn trong tháng — chuyển 1.500.000đ dưới ngưỡng nhưng tháng này đã chuyển trước đó → hiện số khấu trừ máy chủ báo, bắt khai MST', async () => {
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      todayCommission: 0, monthCommission: 0, pendingCommission: 0, withdrawableCommission: 1_500_000, withdrawTaxPreview: 300_000,
      totalClicks: 0, totalConversions: 0, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
    renderPage();
    await openTransfer();
    expect(await screen.findByText('Khấu trừ thuế TNCN 300.000đ · thực nhận 1.200.000đ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nhận 1.200.000đ vào Ví' })).toBeDisabled();
    expect(inputNear('Mã số thuế cá nhân hoặc số CCCD')).toBeInTheDocument();
  });

  it('Q2: máy chủ báo chưa khấu trừ (tổng tháng chưa tới ngưỡng) → không hiện số khấu trừ dù số chuyển lần này lớn', async () => {
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      todayCommission: 0, monthCommission: 0, pendingCommission: 0, withdrawableCommission: 1_900_000, withdrawTaxPreview: 0,
      totalClicks: 0, totalConversions: 0, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
    renderPage();
    await openTransfer();
    expect(await screen.findByRole('button', { name: 'Nhận 1.900.000đ vào Ví' })).toBeEnabled();
    expect(screen.queryByText(/Khấu trừ thuế TNCN/)).toBeNull();
  });

  it('Q2: màn chuyển giải thích đúng cách tính thuế: cộng dồn các lần chuyển trong tháng, từ ngưỡng thì khấu trừ', async () => {
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      todayCommission: 0, monthCommission: 0, pendingCommission: 0, withdrawableCommission: 500_000,
      totalClicks: 0, totalConversions: 0, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
    renderPage();
    await openTransfer();
    expect(
      await screen.findByText(
        'Thuế TNCN 10% tính trên tổng hoa hồng bạn chuyển trong tháng (giờ Việt Nam). Khi tổng từ 2.000.000đ trở lên, thuế của các lần chuyển trước trong tháng chưa bị trừ sẽ được trừ bù vào lần chuyển này (tối đa bằng số tiền lần này).',
      ),
    ).toBeInTheDocument();
  });

  it('SELLER-11: lần chuyển bị khấu trừ mà chưa khai MST/CCCD → bắt nhập (10 hoặc 12 số) rồi gửi kèm', async () => {
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      todayCommission: 0, monthCommission: 0, pendingCommission: 0, withdrawableCommission: 3_000_000,
      totalClicks: 0, totalConversions: 0, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
    renderPage();
    await openTransfer();
    const submit = await screen.findByRole('button', { name: 'Nhận 2.700.000đ vào Ví' });
    expect(submit).toBeDisabled();
    fireEvent.change(inputNear('Mã số thuế cá nhân hoặc số CCCD'), { target: { value: '07920100' } });
    expect(submit).toBeDisabled();
    expect(screen.getByText('Mã số thuế cá nhân gồm 10 chữ số, hoặc số CCCD 12 chữ số.')).toBeInTheDocument();
    fireEvent.change(inputNear('Mã số thuế cá nhân hoặc số CCCD'), { target: { value: '079201001234' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(requestPayout).toHaveBeenCalledTimes(1));
    expect(requestPayout).toHaveBeenCalledWith(3_000_000, expect.any(String), '079201001234');
  });

  it('SELLER-11: đã khai MST/CCCD → không hỏi lại, ghi rõ số dùng để kê khai', async () => {
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0, personalTaxId: '079201001234' });
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      todayCommission: 0, monthCommission: 0, pendingCommission: 0, withdrawableCommission: 3_000_000,
      totalClicks: 0, totalConversions: 0, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
    renderPage();
    await openTransfer();
    const submit = await screen.findByRole('button', { name: 'Nhận 2.700.000đ vào Ví' });
    expect(screen.queryByText('Mã số thuế cá nhân hoặc số CCCD')).toBeNull();
    expect(screen.getByText('Kê khai khấu trừ theo MST/CCCD 079201001234')).toBeInTheDocument();
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(requestPayout).toHaveBeenCalledTimes(1));
    expect(requestPayout).toHaveBeenCalledWith(3_000_000, expect.any(String));
  });

});

describe('Dashboard CTV — thưởng mốc là Điểm Xanh (PD-3)', () => {
  const milestone = {
    id: 'M2', title: 'Mốc 10 triệu', threshold: 10_000_000, rewardPoints: 200, description: 'Doanh số đã chốt 10 triệu',
    achieved: true, claimed: false, canClaim: true, progressPct: 100,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 });
    vi.mocked(getCtvMilestones).mockResolvedValue({
      monthKey: '2026-10', currentRevenue: 12_000_000, pendingRevenue: 0, holdDays: 20,
      milestones: [milestone, { ...milestone, id: 'M1', title: 'Mốc 3 triệu', rewardPoints: 50, claimed: true, canClaim: false }],
      previousMonth: null,
    });
    vi.mocked(getCtvTiers).mockResolvedValue({
      revenue: 12_000_000,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
      allTiers: [
        { name: 'Hạt Giống', emoji: '🌱', min: 0, milestoneRewardPoints: null },
        { name: 'Chồi Non', emoji: '🌿', min: 10_000_000, milestoneRewardPoints: 200 },
      ],
    } as Awaited<ReturnType<typeof getCtvTiers>>);
  });

  it('mỗi mốc hiện thưởng bằng điểm, mốc đã nhận ghi "Đã cộng vào Điểm Xanh", không còn chữ xu', async () => {
    renderPage();
    expect(await screen.findByText('+200 điểm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả 2 mốc' }));
    expect(screen.getByText('+50 điểm')).toBeInTheDocument();
    expect(screen.getByText('Đã cộng vào Điểm Xanh')).toBeInTheDocument();
    expect(screen.queryByText(/xu\b/i)).toBeNull();
  });

  it('bảng 5 bậc đọc milestoneRewardPoints', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Bảng 5 bậc CTV & thưởng mốc Điểm Xanh/ }));
    expect(await screen.findByText('Thưởng mốc +200 điểm')).toBeInTheDocument();
    expect(screen.getByText('Bậc khởi đầu')).toBeInTheDocument();
  });

  it('nhận thưởng mốc: gọi API đúng mốc/tháng và làm mới Điểm Xanh (không còn làm mới xu)', async () => {
    vi.mocked(claimCtvMilestone).mockResolvedValue({
      success: true, message: 'Chúc mừng bạn đã nhận 200 Điểm Xanh', rewardPoints: 200, monthKey: '2026-10',
    });
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Nhận thưởng' }));
    await waitFor(() => expect(claimCtvMilestone).toHaveBeenCalledWith('M2', '2026-10'));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['loyalty'] }));
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['coins'] });
    invalidate.mockRestore();
  });
});

describe('Trang CTV — đại lý (D3-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('đại lý đã có gian hàng CTV hoặc hoa hồng: API trả isAffiliate nên vào thẳng dashboard, không hiện form đăng ký', async () => {
    mocks.getAffiliateMe.mockResolvedValue({
      isAffiliate: true, canRegister: false, canOrderForCustomer: false, referralCode: 'TUBU88', walletBalance: 0,
    });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Chuyển vào Ví Tubu' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đăng ký miễn phí ngay' })).toBeNull();
  });

  it('đại lý chưa được lên đơn hộ: dashboard không có lối tắt Lên đơn hộ khách (API sẽ từ chối)', async () => {
    mocks.getAffiliateMe.mockResolvedValue({
      isAffiliate: true, canRegister: false, canOrderForCustomer: false, referralCode: 'TUBU88', walletBalance: 0,
    });
    renderPage();
    await screen.findByRole('button', { name: 'Chuyển vào Ví Tubu' });
    expect(screen.queryByRole('button', { name: /Lên đơn hộ khách/ })).toBeNull();
  });

  it('đại lý thuần (không đăng ký CTV được): không đưa form đăng ký ngõ cụt, có đường về Hồ sơ', async () => {
    mocks.getAffiliateMe.mockResolvedValue({
      isAffiliate: false, canRegister: false, canOrderForCustomer: false, referralCode: 'TUBU88', walletBalance: 0,
    });
    renderPage();
    expect(await screen.findByText('Tài khoản này không đăng ký CTV được')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đăng ký miễn phí ngay' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Về Hồ sơ' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/profile');
  });

  it('khách thường (canRegister=true) vẫn thấy form đăng ký', async () => {
    mocks.getAffiliateMe.mockResolvedValue({
      isAffiliate: false, canRegister: true, canOrderForCustomer: false, referralCode: 'TUBU88', walletBalance: 0,
    });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Đăng ký miễn phí ngay' })).toBeInTheDocument();
  });
});

describe('Trang CTV — bố cục mới: lối tắt dưới thẻ hoa hồng (D7 việc 9)', () => {
  const before = (a: HTMLElement, b: HTMLElement) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: true, canOrderForCustomer: true, referralCode: 'TUBU88', walletBalance: 0 });
    mocks.copyText.mockResolvedValue(true);
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      todayCommission: 0, monthCommission: 125_000, pendingCommission: 30_000, withdrawableCommission: 200_000,
      totalClicks: 4, totalConversions: 1, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
  });

  it('bốn lối tắt ngay dưới thẻ hoa hồng, trước các tab, bậc, thưởng mốc và mã giới thiệu', async () => {
    vi.mocked(getCtvMilestones).mockResolvedValue({
      monthKey: '2026-10', currentRevenue: 0, pendingRevenue: 0, holdDays: 20, previousMonth: null,
      milestones: [{ id: 'M1', title: 'Mốc 3 triệu', threshold: 3_000_000, rewardPoints: 50, description: '', achieved: false, claimed: false, canClaim: false, progressPct: 0 }],
    });
    renderPage();
    const group = await screen.findByRole('group', { name: 'Lối tắt của CTV' });
    const names = Array.from(group.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Chia sẻ link và mã giới thiệu', 'Gian hàng của tôi', 'Lên đơn hộ khách', 'Chuyển vào Ví Tubu']);
    expect(before(screen.getByText('Có thể chuyển vào Ví'), group)).toBe(true);
    expect(before(await screen.findByRole('tablist'), await screen.findByRole('button', { name: /Bảng 5 bậc CTV/ }))).toBe(true);
    expect(before(group, screen.getByRole('tablist'))).toBe(true);
    expect(before(group, await screen.findByRole('button', { name: /Bảng 5 bậc CTV/ }))).toBe(true);
    expect(before(group, await screen.findByText('Thưởng mốc doanh số tháng'))).toBe(true);
    openTab('Chia sẻ');
    expect(before(group, await screen.findByRole('heading', { level: 2, name: 'Mã giới thiệu của bạn' }))).toBe(true);
  });

  it('đại lý (chưa lên đơn hộ được) chỉ có ba lối tắt', async () => {
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: true, canOrderForCustomer: false, referralCode: 'TUBU88', walletBalance: 0 });
    renderPage();
    const group = await screen.findByRole('group', { name: 'Lối tắt của CTV' });
    expect(group.querySelectorAll('button')).toHaveLength(3);
    expect(group.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
  });

  it('đại lý chưa có gian hàng CTV (canOpenStorefront=false): không có lối tắt Gian hàng vì builder trả 400, vẫn có Chia sẻ và Chuyển vào Ví', async () => {
    mocks.getAffiliateMe.mockResolvedValue({
      isAffiliate: true, canOrderForCustomer: false, canOpenStorefront: false, referralCode: 'TUBU88', walletBalance: 0,
    });
    renderPage();
    const group = await screen.findByRole('group', { name: 'Lối tắt của CTV' });
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Chia sẻ link và mã giới thiệu',
      'Chuyển vào Ví Tubu',
    ]);
    expect(group.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
  });

  it('đại lý có gian hàng CTV (canOpenStorefront=true) và API cũ thiếu cờ: vẫn có lối tắt Gian hàng', async () => {
    mocks.getAffiliateMe.mockResolvedValue({
      isAffiliate: true, canOrderForCustomer: false, canOpenStorefront: true, referralCode: 'TUBU88', walletBalance: 0,
    });
    const { unmount } = renderPage();
    expect(await screen.findByRole('button', { name: 'Gian hàng của tôi' })).toBeInTheDocument();
    unmount();
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Gian hàng của tôi' })).toBeInTheDocument();
  });

  it('Chia sẻ mở bảng chia sẻ link kèm mã; Gian hàng đi tới trình dựng gian hàng', async () => {
    mocks.shareLink.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ link và mã giới thiệu' }));
    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ qua Zalo/ }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(1));
    expect(mocks.shareLink.mock.calls[0]![0].path).toBe('/?ref=TUBU88');
    fireEvent.click(screen.getByRole('button', { name: 'Gian hàng của tôi' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/storefront');
  });

  it('Chuyển vào Ví luôn bấm được: chưa có số chuyển được thì mở hộp nói vì sao và số đang chờ, không có form chuyển', async () => {
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      todayCommission: 0, monthCommission: 9_520, pendingCommission: 9_520, withdrawableCommission: 0,
      totalClicks: 0, totalConversions: 0, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Chuyển vào Ví Tubu' });
    expect(btn).toBeEnabled();
    await screen.findByText(/Đang chờ: 9\.520đ ·/);
    fireEvent.click(btn);
    expect(await screen.findByText('Hoa hồng tự vào Ví Tubu khi đơn đã giao và hết thời gian đổi/trả. Đang chờ: 9.520đ.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /vào Ví$/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));
    expect(screen.queryByText(/Hoa hồng tự vào Ví Tubu khi đơn đã giao/)).toBeNull();
  });

  it('cờ tự chuyển tắt: hộp không hứa tự vào Ví', async () => {
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      todayCommission: 0, monthCommission: 9_520, pendingCommission: 9_520, withdrawableCommission: 0, autoWalletTransfer: false,
      totalClicks: 0, totalConversions: 0, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Chuyển vào Ví Tubu' });
    await screen.findByText(/Đang chờ: 9\.520đ ·/);
    fireEvent.click(btn);
    expect(await screen.findByText('Hoa hồng chuyển được vào Ví Tubu khi đơn đã giao và hết thời gian đổi/trả. Đang chờ: 9.520đ.')).toBeInTheDocument();
  });

  it('còn hoa hồng có thể chuyển: dưới số to có dòng nói đây là phần chưa tự vào Ví được; hết thì không có dòng đó', async () => {
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      todayCommission: 0, monthCommission: 0, pendingCommission: 0, withdrawableCommission: 50_000,
      totalClicks: 0, totalConversions: 0, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
    renderPage();
    expect(await screen.findByText(/Phần này chưa tự vào Ví được/)).toBeInTheDocument();
  });

  it('bấm Chuyển vào Ví khi dashboard còn đang tải: hộp hiện khung chờ, không nói "Đang chờ: 0đ" rồi đổi', async () => {
    let release!: (v: Awaited<ReturnType<typeof getAffiliateDashboard>>) => void;
    vi.mocked(getAffiliateDashboard).mockReturnValue(new Promise((r) => (release = r)));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Chuyển vào Ví Tubu' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Chuyển hoa hồng vào Ví' })).toBeInTheDocument();
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    // Trong hộp (không tính thẻ hoa hồng phía sau) không có câu "Đang chờ".
    expect(busy!.parentElement!.textContent).not.toContain('Đang chờ');
    expect(screen.queryByText(/Hoa hồng tự vào Ví Tubu khi đơn/)).toBeNull();
    release({
      todayCommission: 0, monthCommission: 0, pendingCommission: 0, withdrawableCommission: 0,
      totalClicks: 0, totalConversions: 0, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
  });

  it('dòng "Số dư Ví" ngay dưới lối tắt, chạm là sang Ví', async () => {
    renderPage();
    const row = await screen.findByRole('button', { name: /Số dư Ví/ });
    await waitFor(() => expect(row).toHaveTextContent('75.000đ'));
    fireEvent.click(row);
    expect(mocks.navigate).toHaveBeenCalledWith('/wallet');
  });

  it('CTV mới chưa có đơn: thẻ "Việc đầu tiên" có ba việc; có đơn rồi thì không hiện', async () => {
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      todayCommission: 0, monthCommission: 0, pendingCommission: 0, withdrawableCommission: 0,
      totalClicks: 0, totalConversions: 0, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
    mocks.fetchCourses.mockResolvedValue([{ id: 'c1', title: 'Bắt đầu' }]);
    const { unmount } = renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Việc đầu tiên' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Học khoá đầu tiên/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Chia sẻ mã giới thiệu/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mở gian hàng của bạn/ })).toBeInTheDocument();
    unmount();
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      todayCommission: 0, monthCommission: 0, pendingCommission: 0, withdrawableCommission: 0,
      totalClicks: 2, totalConversions: 1, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
    renderPage();
    await screen.findByRole('tab', { name: 'Tổng quan' });
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { level: 2, name: 'Việc đầu tiên' })).toBeNull();
  });

  it('mở trang chỉ gọi dữ liệu của tab Tổng quan; hoa hồng và link chỉ tải khi mở tab của chúng', async () => {
    renderPage();
    await screen.findByRole('tab', { name: 'Hoa hồng' });
    await waitFor(() => expect(getCtvMilestones).toHaveBeenCalled());
    expect(getCommissions).not.toHaveBeenCalled();
    expect(getMyPayouts).not.toHaveBeenCalled();
    expect(getAffiliateLinks).not.toHaveBeenCalled();
    openTab('Hoa hồng');
    await waitFor(() => expect(getCommissions).toHaveBeenCalledTimes(1));
    expect(getAffiliateLinks).not.toHaveBeenCalled();
    openTab('Chia sẻ');
    await waitFor(() => expect(getAffiliateLinks).toHaveBeenCalledTimes(1));
  });

  it('thưởng mốc: đang tải có khung chờ, lỗi tải có nút Thử lại gọi lại API', async () => {
    vi.mocked(getCtvMilestones).mockRejectedValueOnce(new Error('mạng lỗi')).mockResolvedValue({
      monthKey: '2026-10', currentRevenue: 0, pendingRevenue: 0, holdDays: 20, previousMonth: null,
      milestones: [{ id: 'M1', title: 'Mốc 3 triệu', threshold: 3_000_000, rewardPoints: 50, description: '', achieved: false, claimed: false, canClaim: false, progressPct: 0 }],
    });
    renderPage();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    fireEvent.click(retry);
    expect(await screen.findByText('Mốc 3 triệu')).toBeInTheDocument();
    expect(getCtvMilestones).toHaveBeenCalledTimes(2);
  });

  it('dòng link chỉ ghi số lượt bấm, không ghi "0 đơn" (cột conversions của link không được cập nhật)', async () => {
    vi.mocked(getAffiliateLinks).mockResolvedValueOnce([
      { id: 'L1', shortCode: 'abc123', targetType: 'HOMEPAGE', targetId: null, clicks: 1, conversions: 0, revenue: 0, createdAt: '2026-10-20T00:00:00Z' },
    ]);
    renderPage();
    await screen.findByRole('tab', { name: 'Chia sẻ' });
    openTab('Chia sẻ');
    expect(await screen.findByText('1 lượt bấm')).toBeInTheDocument();
    expect(screen.queryByText(/\d+ đơn/)).toBeNull();
  });
});
