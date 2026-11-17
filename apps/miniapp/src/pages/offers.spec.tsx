import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  phase: 'authenticated' as 'authenticated' | 'guest' | 'loading' | 'unavailable',
  login: vi.fn(),
  guest: false,
  search: '',
  cfg: { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true, vndPerPointRedeem: 1000 } } as Record<string, unknown>,
  getLoyalty: vi.fn(),
  getCoupons: vi.fn(),
  recycleOpen: false,
  getCheckIn: vi.fn(),
  postCheckIn: vi.fn(),
  ensurePhone: vi.fn(),
  campaigns: vi.fn(),
  collectable: vi.fn(),
  flash: vi.fn(),
  coreGet: vi.fn(),
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
vi.mock('../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
vi.mock('../services/shop-api', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), fetchActiveFlashSales: mocks.flash }));
vi.mock('../services/coupon-claim', () => ({ claimCoupon: vi.fn() }));
vi.mock('../services/campaign-api', () => ({ fetchHomeCampaigns: vi.fn() }));
vi.mock('../hooks/use-auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('../hooks/use-recycle-open-requests', () => ({ useRecycleOpenRequests: () => mocks.recycleOpen }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('../store/auth', () => {
  const state = () => ({
    status: 'authenticated',
    user: { id: 'u1', fullName: 'Lan', phone: mocks.guest ? null : '0901234567', zaloId: mocks.guest ? 'guest_1' : 'z1', pointsBalance: 100, pointsConvertedBalance: 20 },
    ensurePhone: mocks.ensurePhone,
    login: mocks.login,
  });
  const useAuthStore = Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(state()) : state()), { getState: () => state() });
  return { useAuthStore };
});
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

// Kho quà có spec riêng (rewards.spec.tsx); ở đây chỉ kiểm tab Đổi quà nạp nó đúng lúc.
vi.mock('./rewards', () => ({ RewardsView: () => <div data-testid="rewards-view">Kho quà</div> }));

import { homeCopy } from '@tubutree/app-core/home-copy';
import OffersPage from './offers';

const REWARDS = Array.from({ length: 7 }, (_, i) => ({ day: i + 1, points: 5 + i, claimed: false, isToday: i === 0 }));
const FLASH_ITEM = {
  itemId: 'f1', variationId: 'v1', productSlug: 'nuoc-rua-chen', productName: 'Nước rửa chén', thumbnail: null,
  retailPrice: 100000, flashPrice: 80000, quota: 10, soldCount: 2, endAt: new Date(Date.now() + 3_600_000).toISOString(),
};
const OPEN_CODE = {
  code: 'NHAN10', title: null, type: 'AMOUNT', value: 10000, minOrder: null, maxDiscount: null,
  startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-12-31T00:00:00.000Z', newCustomerOnly: false, claimedCount: 0, usageLimit: null,
};
const COUPON = { code: 'WELCOME-U1', type: 'AMOUNT', value: 25000, minOrder: 150000, maxDiscount: null, endAt: '2026-12-01T00:00:00.000Z' };

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OffersPage /></QueryClientProvider>);
}

describe('Trung tâm Ưu đãi (tab giữa thanh đáy, ba phân mục)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.phase = 'authenticated';
    mocks.guest = false;
    mocks.recycleOpen = false;
    mocks.search = '';
    mocks.cfg = { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true, vndPerPointRedeem: 1000 } };
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 100, pointsConvertedBalance: 20, tier: { name: 'Mầm Xanh' }, nextTier: null });
    mocks.getCoupons.mockResolvedValue([COUPON]);
    mocks.campaigns.mockResolvedValue([]);
    mocks.collectable.mockResolvedValue([]);
    mocks.flash.mockResolvedValue([]);
    mocks.coreGet.mockImplementation((path: string, opts: unknown) => {
      if (path === '/coupons/collectable') return mocks.collectable(path, opts);
      if (path === '/coupons/collectable/mine') return Promise.resolve({ claimed: [], newCustomerOnly: [] });
      return mocks.campaigns(path, opts);
    });
    mocks.getCheckIn.mockResolvedValue({ checkedInToday: false, streakDays: 3, currentCycleDay: 4, todayPoints: 8, rewards: REWARDS });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  const goTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
  const manyCoupons = (n: number) => Array.from({ length: n }, (_, i) => ({ ...COUPON, code: `MA-${i}`, value: 10_000 * (i + 1) }));
  const LIVE_CAMPAIGN = {
    id: 'c1', slug: 'giua-thu', title: 'Giữa Thu', image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', linkType: 'CAMPAIGN_PAGE', linkValue: null, audience: 'ALL',
    startAt: new Date(Date.now() - 86_400_000).toISOString(), endAt: new Date(Date.now() + 86_400_000).toISOString(),
  };

  describe('thanh tab và đổi tab', () => {
    it('ba tab Săn mã, Mã của tôi, Đổi quà; mặc định Săn mã đang chọn', async () => {
      renderPage();
      const tabs = await screen.findAllByRole('tab');
      expect(tabs.map((t) => t.textContent)).toEqual(['Săn mã', 'Mã của tôi', 'Đổi quà']);
      expect(screen.getByRole('tablist', { name: 'Các mục Ưu đãi' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Săn mã' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel', { name: 'Săn mã' })).toBeInTheDocument();
    });
    it('bấm tab: đổi tại chỗ bằng replace (Back không tua từng tab); tab mặc định không kèm tham số', async () => {
      renderPage();
      await screen.findAllByRole('tab');
      goTab('Mã của tôi');
      expect(mocks.navigate).toHaveBeenLastCalledWith('/offers?tab=wallet', { replace: true });
      goTab('Đổi quà');
      expect(mocks.navigate).toHaveBeenLastCalledWith('/offers?tab=rewards', { replace: true });
    });
    it('đang ở Mã của tôi, bấm Săn mã: về /offers bằng replace; bấm lại đúng tab đang chọn thì không làm gì', async () => {
      mocks.search = '?tab=wallet';
      renderPage();
      await screen.findAllByRole('tab');
      goTab('Mã của tôi');
      expect(mocks.navigate).not.toHaveBeenCalled();
      goTab('Săn mã');
      expect(mocks.navigate).toHaveBeenLastCalledWith('/offers', { replace: true });
    });
    it('tab lạ trên URL: về Săn mã', async () => {
      mocks.search = '?tab=claim';
      renderPage();
      expect(await screen.findByRole('tab', { name: 'Săn mã' })).toHaveAttribute('aria-selected', 'true');
    });
    it('link cũ ?section=coupons mở thẳng tab Mã của tôi', async () => {
      mocks.search = '?section=coupons';
      renderPage();
      expect(await screen.findByRole('tab', { name: 'Mã của tôi' })).toHaveAttribute('aria-selected', 'true');
      expect(await screen.findByText('Giảm 25k')).toBeInTheDocument();
    });
  });

  describe('tab Săn mã', () => {
    it('banner OFFERS_TOP nằm ngay dưới thanh tab, trên cả thẻ Điểm Xanh', async () => {
      mocks.campaigns.mockResolvedValue([LIVE_CAMPAIGN]);
      renderPage();
      const banner = await screen.findByRole('region', { name: 'Chương trình nổi bật' });
      expect(mocks.campaigns).toHaveBeenCalledWith('/campaigns', expect.objectContaining({ query: { placement: 'OFFERS_TOP' } }));
      const points = await screen.findByRole('region', { name: /Điểm Xanh/ });
      expect(banner.compareDocumentPosition(points) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Giữa Thu' })).toHaveAttribute('href', '/campaign/giua-thu');
    });

    it('thứ tự: Banner, Giờ vàng, Nhận mã, Điểm Xanh, dải điểm danh', async () => {
      mocks.campaigns.mockResolvedValue([LIVE_CAMPAIGN]);
      mocks.flash.mockResolvedValue([FLASH_ITEM]);
      mocks.collectable.mockResolvedValue([OPEN_CODE]);
      renderPage();
      const regions = [
        await screen.findByRole('region', { name: 'Chương trình nổi bật' }),
        await screen.findByRole('region', { name: 'Giờ vàng hôm nay' }),
        await screen.findByRole('region', { name: 'Nhận mã' }),
        await screen.findByRole('region', { name: /Điểm Xanh/ }),
        await screen.findByRole('region', { name: 'Hôm nay bạn chưa điểm danh' }),
      ];
      for (let i = 1; i < regions.length; i++) {
        expect(regions[i - 1]!.compareDocumentPosition(regions[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `khối ${i}`).toBeTruthy();
      }
    });

    it('không còn mã của tôi, Kho quà hay thẻ điểm danh đầy đủ ở tab này; Kho quà chưa nạp', async () => {
      renderPage();
      await screen.findByText('Mầm Xanh');
      expect(screen.queryByRole('region', { name: 'Mã của tôi' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Điểm danh mỗi ngày' })).toBeNull();
      expect(screen.queryByTestId('rewards-view')).toBeNull();
      expect(screen.queryByText('Quà của tôi')).toBeNull();
    });

    it('dải điểm danh chỉ báo trạng thái hôm nay và mở tab Vườn Xanh, không gọi POST check-in', async () => {
      renderPage();
      const strip = await screen.findByRole('region', { name: 'Hôm nay bạn chưa điểm danh' });
      expect(within(strip).getByText('Mở tab Vườn Xanh')).toBeInTheDocument();
      fireEvent.click(within(strip).getByRole('button'));
      expect(mocks.navigate).toHaveBeenLastCalledWith('/game', { replace: true });
      expect(mocks.postCheckIn).not.toHaveBeenCalled();
    });

    it('đã điểm danh hôm nay: dải ghi "đã điểm danh"', async () => {
      mocks.getCheckIn.mockResolvedValue({ checkedInToday: true, streakDays: 4, currentCycleDay: 5, todayPoints: 0, rewards: REWARDS });
      renderPage();
      expect(await screen.findByRole('region', { name: 'Hôm nay bạn đã điểm danh' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Hôm nay bạn chưa điểm danh' })).toBeNull();
    });

    it('tiện ích: Mua chung nhóm và Tích điểm đơn sàn; cờ tắt thì ẩn Tích điểm đơn sàn', async () => {
      const first = renderPage();
      expect(await screen.findByText('Mua chung nhóm')).toBeInTheDocument();
      expect(screen.getByText('Tích điểm đơn sàn')).toBeInTheDocument();
      fireEvent.click(screen.getByText('Mua chung nhóm'));
      expect(mocks.navigate).toHaveBeenLastCalledWith('/group-buy');
      first.unmount();
      mocks.cfg = { isLoaded: true, waste: { enabled: false }, loyalty: { marketplaceClaimEnabled: false } };
      renderPage();
      await screen.findByText('Mua chung nhóm');
      expect(screen.queryByText('Tích điểm đơn sàn')).toBeNull();
    });

    it('thẻ Điểm Xanh dẫn tới /loyalty; tên đọc chứa hạng và số điểm', async () => {
      renderPage();
      const card = await screen.findByRole('button', { name: /Hạng và lịch sử điểm/ });
      await waitFor(() => expect(card).toHaveAccessibleName(/^Mầm Xanh, Hạng và lịch sử điểm, 120 điểm/));
      fireEvent.click(card);
      expect(mocks.navigate).toHaveBeenLastCalledWith('/loyalty');
    });

    it('chưa có số hạng: không đoán "Mầm Xanh", giữ chỗ thanh tiến độ; lỗi thì báo và "Thử lại" gọi lại', async () => {
      mocks.getLoyalty.mockRejectedValueOnce(new Error('boom'));
      renderPage();
      expect(await screen.findByText('Chưa tải được hạng và điểm')).toBeInTheDocument();
      expect(screen.queryByText('Mầm Xanh')).toBeNull();
      expect(screen.queryByRole('progressbar')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
      expect(await screen.findByText('Mầm Xanh')).toBeInTheDocument();
      expect(screen.queryByText('Chưa tải được hạng và điểm')).toBeNull();
    });

    it('đang trong hạn giữ hạng: dòng giữ hạng, không vẽ thanh tiến độ lên hạng kế', async () => {
      mocks.getLoyalty.mockResolvedValue({
        pointsBalance: 100, pointsConvertedBalance: 20, tier: { name: 'Lộc Biếc' }, nextTier: null,
        tierGrace: { until: '2026-11-07T00:00:00.000Z', spendingToKeep: 400_000, pointsToKeep: 30_000 },
      });
      renderPage();
      expect(await screen.findByText(/Giữ hạng Lộc Biếc: đơn giao thành công thêm 400.000đ trước 07\/11\/2026/)).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('không trong hạn giữ hạng: vẫn có thanh tiến độ lên hạng kế', async () => {
      renderPage();
      await screen.findByText('Mầm Xanh');
      expect(await screen.findByRole('progressbar', { name: 'Tiến độ lên hạng kế' })).toBeInTheDocument();
    });

    it('tài khoản khách Mini App thấy thẻ liên kết Zalo (một nút duy nhất); khách thật thì không', async () => {
      const first = renderPage();
      await screen.findByText('Mầm Xanh');
      expect(screen.queryByText('Liên kết Zalo để giữ điểm và nhận quà')).toBeNull();
      first.unmount();
      mocks.guest = true;
      mocks.getCheckIn.mockResolvedValue({ checkedInToday: false, streakDays: 0, currentCycleDay: 1, todayPoints: 0, todayWater: 10, pointsBlocked: 'GUEST', rewards: REWARDS });
      renderPage();
      expect(await screen.findByText('Liên kết Zalo để giữ điểm và nhận quà')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: homeCopy.profile.guestCta })).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'Đăng nhập Zalo' })).toBeNull();
    });

    it('khách chưa đăng nhập: vẫn thấy banner, Giờ vàng, Nhận mã, một thẻ mời "Đăng nhập"; không gọi API riêng của khách', async () => {
      mocks.phase = 'guest';
      mocks.campaigns.mockResolvedValue([LIVE_CAMPAIGN]);
      mocks.flash.mockResolvedValue([FLASH_ITEM]);
      mocks.collectable.mockResolvedValue([OPEN_CODE]);
      renderPage();
      const banner = await screen.findByRole('link', { name: 'Giữa Thu' });
      const flash = await screen.findByRole('region', { name: 'Giờ vàng hôm nay' });
      const collect = await screen.findByRole('region', { name: 'Nhận mã' });
      const points = await screen.findByRole('region', { name: 'Điểm Xanh và điểm danh' });
      const blocks = [banner, flash, collect, points];
      for (let i = 1; i < blocks.length; i++) {
        expect(blocks[i - 1]!.compareDocumentPosition(blocks[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `khối ${i}`).toBeTruthy();
      }
      expect(screen.getAllByRole('button', { name: 'Đăng nhập' })).toHaveLength(1);
      expect(screen.queryByRole('region', { name: /điểm danh$/i })?.textContent ?? '').not.toContain('Vườn Xanh');
      expect(mocks.getLoyalty).not.toHaveBeenCalled();
      expect(mocks.getCoupons).not.toHaveBeenCalled();
      expect(mocks.getCheckIn).not.toHaveBeenCalled();
    });

    it('thẻ mời của khách: tiêu đề dưới 22px dùng Inter, không Fraunces (Q1)', async () => {
      mocks.phase = 'guest';
      renderPage();
      const region = await screen.findByRole('region', { name: 'Điểm Xanh và điểm danh' });
      const h = within(region).getByRole('heading', { level: 2 });
      expect(h.style.fontFamily).toContain('--font-ui');
      expect(h.style.fontFamily).not.toContain('--font-display');
    });

    it('?codes=all (lối tắt Mã giảm giá, link cũ /vouchers): khối Nhận mã mở sẵn cả kho với chip lọc và "Thu gọn"', async () => {
      mocks.search = '?tab=deals&codes=all';
      mocks.collectable.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ ...OPEN_CODE, code: `NHAN-${i}` })));
      renderPage();
      const collect = await screen.findByRole('region', { name: 'Nhận mã' });
      expect(screen.getByRole('tab', { name: 'Săn mã' })).toHaveAttribute('aria-selected', 'true');
      await waitFor(() => expect(within(collect).getAllByRole('group')).toHaveLength(5));
      expect(within(collect).getByRole('button', { name: 'Tất cả' })).toHaveAttribute('aria-pressed', 'true');
      expect(within(collect).getByRole('button', { name: 'Thu gọn' })).toBeInTheDocument();
    });

    it('không có ?codes=all: khối Nhận mã gập ở 3 mã', async () => {
      mocks.collectable.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ ...OPEN_CODE, code: `NHAN-${i}` })));
      renderPage();
      const collect = await screen.findByRole('region', { name: 'Nhận mã' });
      await waitFor(() => expect(within(collect).getAllByRole('group')).toHaveLength(3));
      expect(within(collect).getByRole('button', { name: 'Tất cả (5) Mã giảm giá' })).toBeInTheDocument();
    });

    it('Nhận mã tải lỗi: báo tại chỗ có "Thử lại", các khối khác vẫn vẽ', async () => {
      mocks.collectable.mockRejectedValue({ isHttpError: true, response: { status: 500, data: { message: 'x' } } });
      renderPage();
      const collect = await screen.findByRole('region', { name: 'Nhận mã' });
      expect(within(collect).getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
      expect(screen.getByText('Mua chung nhóm')).toBeInTheDocument();
    });

    it('phiên đang khôi phục hoặc mất mạng: không mời đăng nhập (người dùng có thể đang có phiên)', async () => {
      mocks.phase = 'loading';
      const first = renderPage();
      await screen.findByRole('tab', { name: 'Săn mã' });
      expect(screen.queryByRole('button', { name: 'Đăng nhập' })).toBeNull();
      first.unmount();
      mocks.phase = 'unavailable';
      renderPage();
      await screen.findByRole('tab', { name: 'Săn mã' });
      expect(screen.queryByRole('button', { name: 'Đăng nhập' })).toBeNull();
    });
  });

  describe('tab Mã của tôi', () => {
    beforeEach(() => {
      mocks.search = '?tab=wallet';
    });

    it('xếp CẢ ví (không cắt ở 3), mỗi phiếu có "Dùng ngay"; không còn nút "Tất cả (n)"', async () => {
      mocks.getCoupons.mockResolvedValue(manyCoupons(8));
      renderPage();
      const mine = await screen.findByRole('region', { name: 'Mã của tôi' });
      await waitFor(() => expect(within(mine).getAllByRole('group')).toHaveLength(8));
      expect(within(mine).getAllByRole('button', { name: 'Dùng ngay' })).toHaveLength(8);
      expect(within(mine).queryByRole('button', { name: /Tất cả/ })).toBeNull();
    });

    it('"Dùng ngay" dùng luồng coupon-use có sẵn (đi giỏ hoặc sản phẩm), không sang trang /vouchers', async () => {
      renderPage();
      const mine = await screen.findByRole('region', { name: 'Mã của tôi' });
      fireEvent.click(await within(mine).findByRole('button', { name: 'Dùng ngay' }));
      await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
      expect(mocks.navigate).not.toHaveBeenCalledWith('/vouchers');
      expect(mocks.navigate).not.toHaveBeenCalledWith('/vouchers?tab=mine');
    });

    const HISTORY_PATH = '/me/coupons/history';
    const USED = { ...COUPON, code: 'DA-DUNG', status: 'USED', usedAt: '2026-11-01T00:00:00.000Z' };
    const historyCalls = () => mocks.coreGet.mock.calls.filter(([p]) => p === HISTORY_PATH);
    const withHistory = (rows: unknown[]) => {
      const base = mocks.coreGet.getMockImplementation()!;
      mocks.coreGet.mockImplementation((path: string, opts: unknown) => (path === HISTORY_PATH ? Promise.resolve(rows) : base(path, opts)));
    };

    it('"Mã đã dùng, hết hạn" mở/đóng ngay tại chỗ (không sang trang khác); chỉ gọi lịch sử khi mở', async () => {
      withHistory([USED]);
      renderPage();
      const toggle = await screen.findByRole('button', { name: 'Mã đã dùng, hết hạn' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(historyCalls()).toHaveLength(0);
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
      await waitFor(() => expect(within(panel).getAllByRole('group')).toHaveLength(1));
      expect(within(panel).queryByRole('button')).toBeNull();
      expect(historyCalls()).toHaveLength(1);
      expect(mocks.navigate).not.toHaveBeenCalled();
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(panel).not.toBeVisible();
    });

    it('?history=1 (link cũ /vouchers?tab=history): mục lịch sử mở sẵn, gọi lịch sử và cuộn tới mục', async () => {
      mocks.search = '?tab=wallet&history=1';
      withHistory([]);
      renderPage();
      const toggle = await screen.findByRole('button', { name: 'Mã đã dùng, hết hạn' });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(await screen.findByText('Chưa có mã đã dùng hoặc hết hạn')).toBeInTheDocument();
      expect(historyCalls()).toHaveLength(1);
      await waitFor(() => expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled());
    });

    it('chưa có mã nào: trạng thái rỗng, nút "Nhận thêm mã" về tab Săn mã bằng replace', async () => {
      mocks.getCoupons.mockResolvedValue([]);
      renderPage();
      expect(await screen.findByText('Chưa có mã giảm giá khả dụng')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Nhận thêm mã' }));
      expect(mocks.navigate).toHaveBeenLastCalledWith('/offers', { replace: true });
    });

    it('lỗi tải mã: báo tại chỗ và có "Thử lại"', async () => {
      mocks.getCoupons.mockRejectedValue(new Error('boom'));
      renderPage();
      expect(await screen.findByText(/Chưa tải được mã giảm giá/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    });

    it('mã sắp hết hạn có chữ "Còn n ngày" tông cảnh báo; mã còn xa thì chữ "Dùng đến"', async () => {
      const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
      const far = new Date(Date.now() + 30 * 86_400_000).toISOString();
      mocks.getCoupons.mockResolvedValue([{ ...COUPON, code: 'SOON', endAt: soon }, { ...COUPON, endAt: far }]);
      renderPage();
      const mine = await screen.findByRole('region', { name: 'Mã của tôi' });
      const expiries = await within(mine).findAllByTestId('voucher-expiry');
      expect(expiries.map((e) => e.textContent)).toEqual(['Còn 2 ngày', expect.stringMatching(/^Dùng đến \d{2}\/\d{2}$/)]);
      expect(expiries[0]!.style.color).toBe('var(--color-status-warning-fg)');
      expect(expiries[1]!.style.color).toBe('var(--color-text-tertiary)');
    });

    it('chấm đỏ: cả ví đã hiện nên cả 4 mã sắp hết hạn vào danh sách đã xem', async () => {
      const soon = (i: number) => ({ ...COUPON, code: `SOON-${i}`, endAt: new Date(Date.now() + (i + 1) * 3_600_000).toISOString() });
      mocks.getCoupons.mockResolvedValue([0, 1, 2, 3].map(soon));
      renderPage();
      const mine = await screen.findByRole('region', { name: 'Mã của tôi' });
      await waitFor(() => expect(within(mine).getAllByRole('group')).toHaveLength(4));
      await waitFor(() => expect(localStorage.getItem('tubu_offers_seen_coupons')).not.toBeNull());
      const seen = JSON.parse(localStorage.getItem('tubu_offers_seen_coupons')!) as { items: string[] };
      expect(seen.items.map((k) => k.split('@')[0]).sort()).toEqual(['SOON-0', 'SOON-1', 'SOON-2', 'SOON-3']);
    });

    it('chấm đỏ chưa tắt khi khách mới ở tab Săn mã (chưa thấy ví)', async () => {
      mocks.search = '';
      const soon = { ...COUPON, code: 'SOON-0', endAt: new Date(Date.now() + 3_600_000).toISOString() };
      mocks.getCoupons.mockResolvedValue([soon]);
      renderPage();
      await screen.findByText('Mầm Xanh');
      await waitFor(() => expect(mocks.getCoupons).toHaveBeenCalled());
      expect(localStorage.getItem('tubu_offers_seen_coupons')).toBeNull();
    });

    it('khách chưa đăng nhập: thẻ mời "Đăng nhập" (bấm gọi đăng nhập), không gọi API ví', async () => {
      mocks.phase = 'guest';
      renderPage();
      const invite = await screen.findByRole('button', { name: 'Đăng nhập' });
      fireEvent.click(invite);
      expect(mocks.login).toHaveBeenCalledTimes(1);
      expect(mocks.getCoupons).not.toHaveBeenCalled();
    });
  });

  describe('tab Đổi quà', () => {
    beforeEach(() => {
      mocks.search = '?tab=rewards';
    });

    it('nạp Kho quà tại chỗ, kèm dải sang Điểm Xanh (hạng, lịch sử điểm) và Đổi rác', async () => {
      renderPage();
      expect(await screen.findByTestId('rewards-view')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Đổi quà' })).toHaveAttribute('aria-selected', 'true');
      fireEvent.click(screen.getByText('Hạng và lịch sử điểm'));
      expect(mocks.navigate).toHaveBeenLastCalledWith('/loyalty');
      fireEvent.click(screen.getByText('Đổi rác lấy quà'));
      expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle');
    });

    it('Đổi rác tạm dừng mà khách còn yêu cầu mở: dòng đổi thành "Yêu cầu của tôi"; hết yêu cầu thì ẩn', async () => {
      mocks.cfg = { isLoaded: true, waste: { enabled: false }, loyalty: { marketplaceClaimEnabled: false } };
      mocks.recycleOpen = true;
      const first = renderPage();
      expect(await screen.findByText('Yêu cầu của tôi')).toBeInTheDocument();
      expect(screen.queryByText('Đổi rác lấy quà')).toBeNull();
      fireEvent.click(screen.getByText('Yêu cầu của tôi'));
      expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle');
      first.unmount();
      mocks.recycleOpen = false;
      renderPage();
      await screen.findByTestId('rewards-view');
      expect(screen.queryByText('Yêu cầu của tôi')).toBeNull();
      expect(screen.queryByText('Đổi rác lấy quà')).toBeNull();
    });

    it('khách chưa đăng nhập: vẫn xem Kho quà, không có dải Điểm Xanh/Đổi rác (cần tài khoản)', async () => {
      mocks.phase = 'guest';
      renderPage();
      expect(await screen.findByTestId('rewards-view')).toBeInTheDocument();
      expect(screen.queryByText('Hạng và lịch sử điểm')).toBeNull();
      expect(screen.queryByText('Đổi rác lấy quà')).toBeNull();
    });
  });
});
