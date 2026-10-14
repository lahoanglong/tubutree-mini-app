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
  getMyPayouts: vi.fn().mockResolvedValue([]),
  requestPayout: vi.fn(),
  getStorefrontAnalytics: vi.fn().mockResolvedValue({ storefronts: [] }),
  getProductBreakdown: vi.fn().mockResolvedValue([]),
  getCtvTiers: vi.fn().mockResolvedValue({ allTiers: [] }),
  getCtvMilestones: vi.fn().mockResolvedValue({ milestones: [], previousMonth: null }),
  claimCtvMilestone: vi.fn(),
}));
vi.mock('../hooks/use-public-config', () => ({
  usePublicConfig: () => ({
    affiliateMinWithdrawBank: 50_000,
    affiliatePitWithhold: { pct: 0.1, threshold: 2_000_000 },
    isLoaded: true,
  }),
}));

import AffiliatePage from './affiliate';
import {
  claimCtvMilestone,
  getAffiliateDashboard,
  getCommissions,
  getCtvMilestones,
  getMyPayouts,
  getCtvTiers,
  requestPayout,
} from '../services/affiliate-api';

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

  it('thẻ hoa hồng tháng, số đang chờ, số có thể rút và từng dòng lịch sử đúng số và đúng nhãn trạng thái', async () => {
    renderPage();
    expect(await screen.findByText('125.000đ')).toBeInTheDocument();
    expect(screen.getByText('15.000đ')).toBeInTheDocument();
    expect(screen.getByText('30.000đ')).toBeInTheDocument();
    expect(screen.getByText('200.000đ')).toBeInTheDocument();
    expect(await screen.findByText('+25.000đ')).toBeInTheDocument();
    expect(screen.getByText('Đơn 500.000đ ·', { exact: false })).toBeInTheDocument();
    for (const label of ['Đang chờ · đơn chưa giao', 'Đang chờ · đang giữ', 'Đã trả', 'Từ chối']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText('Có thể rút')).toHaveLength(2);
  });

  it('dòng hoa hồng kèm mã đơn và trạng thái đơn; khoản đang nằm trong lệnh rút hiện "Đang rút", không phải "Đã trả" (SELLER-10)', async () => {
    vi.mocked(getCommissions).mockResolvedValue([
      { id: 'c1', amount: 25_000, orderTotal: 500_000, status: 'APPROVED', withdrawing: true, orderCode: 'TB123', orderStatus: 'DELIVERED', createdAt: '2026-10-01T03:00:00.000Z' },
    ] as Awaited<ReturnType<typeof getCommissions>>);
    renderPage();
    expect(await screen.findByText('Đang rút')).toBeInTheDocument();
    expect(screen.getByText('Đơn TB123 ·', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Giao thành công')).toBeInTheDocument();
    expect(screen.queryByText('Đã trả')).toBeNull();
  });

  it('mục Lệnh rút: trạng thái, lý do từ chối, mã giao dịch và thuế TNCN đã khấu trừ', async () => {
    vi.mocked(getMyPayouts).mockResolvedValue([
      { id: 'p1', amount: 2_700_000, grossAmount: 3_000_000, taxWithheld: 300_000, fee: 0, method: 'BANK', status: 'PAID', rejectionReason: null, bankRef: 'FT2610', requestedAt: '2026-10-01T03:00:00.000Z', reviewedAt: null, paidAt: '2026-10-02T03:00:00.000Z' },
      { id: 'p2', amount: 60_000, grossAmount: 60_000, taxWithheld: 0, fee: 0, method: 'BANK', status: 'REJECTED', rejectionReason: 'Thiếu số tài khoản', bankRef: null, requestedAt: '2026-10-03T03:00:00.000Z', reviewedAt: '2026-10-04T03:00:00.000Z', paidAt: null },
    ]);
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Lệnh rút' })).toBeInTheDocument();
    expect(await screen.findByText('Đã chuyển')).toBeInTheDocument();
    expect(screen.getByText('Mã giao dịch: FT2610')).toBeInTheDocument();
    expect(screen.getByText(/đã khấu trừ thuế TNCN 300\.000đ/)).toBeInTheDocument();
    expect(screen.getByText('Bị từ chối')).toBeInTheDocument();
    expect(screen.getByText(/Lý do: Thiếu số tài khoản/)).toBeInTheDocument();
  });

  it('có hoa hồng đang rút: báo số đang chờ Tubu Tree chuyển khoản', async () => {
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      todayCommission: 0, monthCommission: 0, pendingCommission: 0, withdrawableCommission: 0, withdrawingCommission: 80_000,
      totalClicks: 0, totalConversions: 0, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
    renderPage();
    expect(await screen.findByText(/Đang rút 80\.000đ về ngân hàng/)).toBeInTheDocument();
  });
});

describe('Dashboard CTV — rút hoa hồng', () => {
  /** zmp-ui Input vẽ nhãn là phần tử riêng (không htmlFor) nên tìm ô nhập đi kèm nhãn hiển thị. */
  const inputNear = (labelText: string): HTMLInputElement => {
    let node: HTMLElement | null = screen.getByText(labelText);
    while (node && !node.querySelector('input')) node = node.parentElement;
    const input = node?.querySelector('input');
    if (!input) throw new Error('Không thấy ô nhập cạnh nhãn: ' + labelText);
    return input;
  };

  /** Nút Rút khoá tới khi số dư về, nên chờ nó mở rồi mới bấm. */
  const openWithdraw = async () => {
    const btn = await screen.findByRole('button', { name: 'Rút hoa hồng' });
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
    vi.mocked(requestPayout).mockResolvedValue({ note: 'Đã gửi yêu cầu rút.' } as Awaited<ReturnType<typeof requestPayout>>);
  });

  it('mở sheet: tiêu đề h2, mặc định chọn Ví Tubu và điền sẵn toàn bộ số có thể rút, gửi đúng lệnh rút về Ví', async () => {
    renderPage();
    await openWithdraw();
    expect(await screen.findByRole('heading', { level: 2, name: 'Rút hoa hồng' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ví Tubu/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Ngân hàng/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Mỗi lần rút là toàn bộ hoa hồng có thể rút.')).toBeInTheDocument();
    expect(screen.queryByText('Số tiền')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Nhận 200.000đ vào Ví' }));
    await waitFor(() => expect(requestPayout).toHaveBeenCalledTimes(1));
    expect(requestPayout).toHaveBeenCalledWith(200000, 'WALLET_BALANCE', undefined, expect.any(String));
  });

  it('gửi lại sau lỗi dùng cùng Idempotency-Key (không tạo lệnh rút thứ hai)', async () => {
    vi.mocked(requestPayout).mockRejectedValueOnce(new Error('Network Error'));
    renderPage();
    await openWithdraw();
    const submit = await screen.findByRole('button', { name: 'Nhận 200.000đ vào Ví' });
    fireEvent.click(submit);
    await waitFor(() => expect(requestPayout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(requestPayout).toHaveBeenCalledTimes(2));
    const keys = vi.mocked(requestPayout).mock.calls.map((c) => c[3]);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it('từ ngưỡng thuế TNCN: hiện số khấu trừ và thực nhận trước khi bấm rút (SELLER-11)', async () => {
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      todayCommission: 0, monthCommission: 0, pendingCommission: 0, withdrawableCommission: 3_000_000,
      totalClicks: 0, totalConversions: 0, monthRevenue: 0,
      tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
    } as Awaited<ReturnType<typeof getAffiliateDashboard>>);
    renderPage();
    await openWithdraw();
    expect(await screen.findByText('Khấu trừ thuế TNCN 300.000đ · thực nhận 2.700.000đ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nhận 2.700.000đ vào Ví' })).toBeInTheDocument();
  });

  it('chọn Ngân hàng: khoá nút tới khi nhập đủ thông tin tài khoản, rồi gửi kèm thông tin ngân hàng', async () => {
    renderPage();
    await openWithdraw();
    fireEvent.click(await screen.findByRole('button', { name: /Ngân hàng/ }));
    expect(screen.getByRole('button', { name: /Ngân hàng/ })).toHaveAttribute('aria-pressed', 'true');
    const submit = screen.getByRole('button', { name: 'Rút 200.000đ' });
    expect(submit).toBeDisabled();
    fireEvent.change(inputNear('Tên ngân hàng'), { target: { value: 'Vietcombank' } });
    fireEvent.change(inputNear('Số tài khoản'), { target: { value: '0123456789' } });
    fireEvent.change(inputNear('Chủ tài khoản'), { target: { value: 'NGUYEN VAN A' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(requestPayout).toHaveBeenCalledTimes(1));
    expect(requestPayout).toHaveBeenCalledWith(
      200000,
      'BANK',
      { bankName: 'Vietcombank', accountNumber: '0123456789', accountName: 'NGUYEN VAN A' },
      expect.any(String),
    );
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
