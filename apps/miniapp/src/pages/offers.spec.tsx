import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  phase: 'authenticated' as 'authenticated' | 'guest' | 'loading',
  guest: false,
  search: '',
  cfg: { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true, vndPerPointRedeem: 1000 } } as Record<string, unknown>,
  getLoyalty: vi.fn(),
  getCoupons: vi.fn(),
  getCheckIn: vi.fn(),
  postCheckIn: vi.fn(),
  ensurePhone: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/offers', search: mocks.search, state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/account-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLoyalty: mocks.getLoyalty,
  getCoupons: mocks.getCoupons,
  getDailyCheckInStatus: mocks.getCheckIn,
  postDailyCheckIn: mocks.postCheckIn,
}));
vi.mock('../hooks/use-auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('../store/auth', () => {
  const state = () => ({
    status: 'authenticated',
    user: { id: 'u1', fullName: 'Lan', phone: mocks.guest ? null : '0901234567', zaloId: mocks.guest ? 'guest_1' : 'z1', pointsBalance: 100, pointsConvertedBalance: 20 },
    ensurePhone: mocks.ensurePhone,
    login: vi.fn(),
  });
  const useAuthStore = Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(state()) : state()), { getState: () => state() });
  return { useAuthStore };
});
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import OffersPage from './offers';

const REWARDS = Array.from({ length: 7 }, (_, i) => ({ day: i + 1, points: 5 + i, claimed: false, isToday: i === 0 }));
const COUPON = { code: 'WELCOME-U1', type: 'AMOUNT', value: 25000, minOrder: 150000, maxDiscount: null, endAt: '2026-12-01T00:00:00.000Z' };

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OffersPage /></QueryClientProvider>);
}

describe('Trang Ưu đãi (tab giữa thanh đáy, phương án A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.phase = 'authenticated';
    mocks.guest = false;
    mocks.search = '';
    mocks.cfg = { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true, vndPerPointRedeem: 1000 } };
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 100, pointsConvertedBalance: 20, tier: { name: 'Mầm Xanh' }, nextTier: null });
    mocks.getCoupons.mockResolvedValue([COUPON]);
    mocks.getCheckIn.mockResolvedValue({ checkedInToday: false, streakDays: 3, currentCycleDay: 4, todayPoints: 8, rewards: REWARDS });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('có đủ: thẻ Điểm Xanh và hạng, Điểm danh, Đổi quà, Quà của tôi, Đổi rác, Tích điểm đơn sàn, Mua chung, Mã giảm giá của tôi', async () => {
    renderPage();
    expect(await screen.findByText('Mầm Xanh')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Điểm danh nhận Điểm Xanh' })).toBeInTheDocument();
    for (const t of ['Đổi quà', 'Quà của tôi', 'Đổi rác lấy quà', 'Tích điểm đơn sàn', 'Mua chung nhóm']) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
    expect(await screen.findByText('Giảm 25.000đ')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mã giảm giá của tôi' })).toBeInTheDocument();
  });

  it('cờ Đổi rác và Tích điểm đơn sàn tắt → hai dòng đó bị ẩn, phần còn lại giữ nguyên', async () => {
    mocks.cfg = { isLoaded: true, waste: { enabled: false }, loyalty: { marketplaceClaimEnabled: false } };
    renderPage();
    await screen.findByText('Quà của tôi');
    expect(screen.queryByText('Đổi rác lấy quà')).toBeNull();
    expect(screen.queryByText('Tích điểm đơn sàn')).toBeNull();
    expect(screen.getByText('Mua chung nhóm')).toBeInTheDocument();
  });

  it('các dòng điều hướng đúng trang', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Đổi quà'));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/rewards');
    fireEvent.click(screen.getByText('Đổi rác lấy quà'));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle');
    fireEvent.click(screen.getByText('Mua chung nhóm'));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/group-buy');
    fireEvent.click(screen.getByRole('button', { name: 'Hạng và lịch sử điểm' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/loyalty');
  });

  it('nút điểm danh dùng luồng sẵn có (POST check-in), không đổi mức thưởng', async () => {
    mocks.postCheckIn.mockResolvedValue({ success: true, message: 'Đã điểm danh +8 điểm', pointsEarned: 8 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Điểm danh/ }));
    await waitFor(() => expect(mocks.postCheckIn).toHaveBeenCalledTimes(1));
  });

  it('chưa có mã nào → trạng thái rỗng có hướng dẫn đổi quà', async () => {
    mocks.getCoupons.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Chưa có mã giảm giá khả dụng')).toBeInTheDocument();
  });

  it('?section=coupons cuộn tới phần mã giảm giá khi dữ liệu mã đã về', async () => {
    mocks.search = '?section=coupons';
    renderPage();
    await screen.findByText('Giảm 25.000đ');
    await waitFor(() => expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it('lỗi tải mã → báo tại chỗ và có "Thử lại", các phần khác vẫn hiện', async () => {
    mocks.getCoupons.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/Chưa tải được mã giảm giá/)).toBeInTheDocument();
    expect(screen.getByText('Quà của tôi')).toBeInTheDocument();
  });

  it('tài khoản khách Mini App thấy thẻ liên kết Zalo; khách thật thì không', async () => {
    const first = renderPage();
    await screen.findByText('Quà của tôi');
    expect(screen.queryByText('Liên kết Zalo để giữ điểm và nhận quà')).toBeNull();
    first.unmount();
    mocks.guest = true;
    renderPage();
    expect(await screen.findByText('Liên kết Zalo để giữ điểm và nhận quà')).toBeInTheDocument();
  });

  it('chưa đăng nhập → mời đăng nhập, không gọi API ưu đãi', async () => {
    mocks.phase = 'guest';
    renderPage();
    expect(await screen.findByText('Đăng nhập để xem ưu đãi')).toBeInTheDocument();
    expect(mocks.getLoyalty).not.toHaveBeenCalled();
    expect(mocks.getCoupons).not.toHaveBeenCalled();
  });
});
