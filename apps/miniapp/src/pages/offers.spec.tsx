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

describe('Trang Ưu đãi (tab giữa thanh đáy, phương án A)', () => {
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

  it('banner OFFERS_TOP nằm ngay dưới tiêu đề trang, trên cả thẻ Điểm Xanh', async () => {
    const live = {
      id: 'c1', slug: 'giua-thu', title: 'Giữa Thu', image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', linkType: 'CAMPAIGN_PAGE', linkValue: null, audience: 'ALL',
      startAt: new Date(Date.now() - 86_400_000).toISOString(), endAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    mocks.campaigns.mockResolvedValue([live]);
    renderPage();
    const banner = await screen.findByRole('region', { name: 'Chương trình nổi bật' });
    expect(mocks.campaigns).toHaveBeenCalledWith('/campaigns', expect.objectContaining({ query: { placement: 'OFFERS_TOP' } }));
    const points = await screen.findByRole('region', { name: /Điểm Xanh/ });
    expect(banner.compareDocumentPosition(points) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Giữa Thu' })).toHaveAttribute('href', '/campaign/giua-thu');
  });

  it('khách chưa đăng nhập vẫn thấy banner đầu trang (ngoài nhánh đăng nhập)', async () => {
    mocks.phase = 'guest';
    mocks.campaigns.mockResolvedValue([
      { id: 'c1', slug: 'a', title: 'Chương trình A', image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', linkType: 'CAMPAIGN_PAGE', linkValue: null, audience: 'ALL', startAt: new Date(Date.now() - 1000).toISOString(), endAt: new Date(Date.now() + 86_400_000).toISOString() },
    ]);
    renderPage();
    expect(await screen.findByRole('link', { name: 'Chương trình A' })).toBeInTheDocument();
  });

  it('có đủ: thẻ Điểm Xanh và hạng, Điểm danh, Đổi quà, Quà của tôi, Đổi rác, Tích điểm đơn sàn, Mua chung, Mã giảm giá của tôi', async () => {
    renderPage();
    expect(await screen.findByText('Mầm Xanh')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Điểm danh mỗi ngày' })).toBeInTheDocument();
    for (const t of ['Đổi quà', 'Quà của tôi', 'Đổi rác lấy quà', 'Tích điểm đơn sàn', 'Mua chung nhóm']) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
    expect(await screen.findByText('Giảm 25k')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mã của tôi' })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /Hạng và lịch sử điểm/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/loyalty');
  });

  it('nút điểm danh dùng luồng sẵn có (POST check-in), không đổi mức thưởng', async () => {
    mocks.postCheckIn.mockResolvedValue({ success: true, message: 'Đã điểm danh +8 điểm', pointsEarned: 8 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Điểm danh/ }));
    await waitFor(() => expect(mocks.postCheckIn).toHaveBeenCalledTimes(1));
  });

  it('Mã của tôi chỉ xếp 3 phiếu; từ 4 mã trở lên nút ghi "Tất cả (n)", tên đọc giữ đủ số ("Tất cả (8) Mã của tôi"), bỏ chữ "n mã" cũ', async () => {
    mocks.getCoupons.mockResolvedValue(Array.from({ length: 8 }, (_, i) => ({ ...COUPON, code: `MA-${i}`, value: 10_000 * (i + 1) })));
    renderPage();
    const mine = await screen.findByRole('region', { name: 'Mã của tôi' });
    await waitFor(() => expect(within(mine).getAllByRole('group')).toHaveLength(3));
    const all = within(mine).getByRole('button', { name: 'Tất cả (8) Mã của tôi' });
    expect(all).toHaveTextContent('Tất cả (8)');
    expect(mine.textContent).not.toMatch(/\b8 mã/);
    fireEvent.click(all);
    expect(mocks.navigate).toHaveBeenLastCalledWith('/vouchers?tab=mine');
  });

  it('chấm đỏ: ví có 4 mã sắp hết hạn mà trang chỉ vẽ 3 thì chỉ 3 mã vào danh sách đã xem (mã thứ 4 chưa ai thấy)', async () => {
    const soon = (i: number) => ({ ...COUPON, code: `SOON-${i}`, endAt: new Date(Date.now() + (i + 1) * 3_600_000).toISOString() });
    mocks.getCoupons.mockResolvedValue([0, 1, 2, 3].map(soon));
    renderPage();
    const mine = await screen.findByRole('region', { name: 'Mã của tôi' });
    await waitFor(() => expect(within(mine).getAllByRole('group')).toHaveLength(3));
    await waitFor(() => expect(localStorage.getItem('tubu_offers_seen_coupons')).not.toBeNull());
    const seen = JSON.parse(localStorage.getItem('tubu_offers_seen_coupons')!) as { items: string[] };
    expect(seen.items.map((k) => k.split('@')[0]).sort()).toEqual(['SOON-0', 'SOON-1', 'SOON-2']);
  });

  it('Mã của tôi đúng 3 mã: đủ 3 phiếu, nút cũng ghi "Tất cả (3)" (một mẫu, đếm đúng số trang đích sẽ vẽ)', async () => {
    mocks.getCoupons.mockResolvedValue(Array.from({ length: 3 }, (_, i) => ({ ...COUPON, code: `MA-${i}`, value: 10_000 * (i + 1) })));
    renderPage();
    const mine = await screen.findByRole('region', { name: 'Mã của tôi' });
    await waitFor(() => expect(within(mine).getAllByRole('group')).toHaveLength(3));
    expect(within(mine).getByRole('button', { name: 'Tất cả (3) Mã của tôi' })).toHaveTextContent('Tất cả (3)');
  });

  it('chưa có mã nào → trạng thái rỗng có hướng dẫn đổi quà, không có nút xem tất cả', async () => {
    mocks.getCoupons.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Chưa có mã giảm giá khả dụng')).toBeInTheDocument();
    const mine = screen.getByRole('region', { name: 'Mã của tôi' });
    expect(within(mine).queryByRole('button', { name: /tất cả/i })).toBeNull();
  });

  it('?section=coupons cuộn tới phần mã giảm giá khi dữ liệu mã đã về', async () => {
    mocks.search = '?section=coupons';
    renderPage();
    await screen.findByText('Giảm 25k');
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

  it('tài khoản khách bị chặn Điểm Xanh: cả trang chỉ một nút "Liên kết Zalo" (ở thẻ mời), thẻ điểm danh không lặp ghi chú', async () => {
    mocks.guest = true;
    mocks.getCheckIn.mockResolvedValue({ checkedInToday: false, streakDays: 0, currentCycleDay: 1, todayPoints: 0, todayWater: 10, pointsBlocked: 'GUEST', rewards: REWARDS });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Điểm danh mỗi ngày' })).toBeInTheDocument();
    // Ghi chú là chunk nạp lười: nạp trước rồi chờ một nhịp, để "không thấy" nghĩa là không vẽ chứ không phải chưa tới.
    await import('../components/loyalty/guest-points-note');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getAllByRole('button', { name: homeCopy.profile.guestCta })).toHaveLength(1);
    expect(screen.queryByTestId('guest-points-note')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đăng nhập Zalo' })).toBeNull();
  });

  it('chưa đăng nhập → thẻ mời đăng nhập ở khối cần tài khoản, không gọi API ưu đãi', async () => {
    mocks.phase = 'guest';
    renderPage();
    expect(await screen.findByRole('region', { name: 'Điểm Xanh và điểm danh' })).toBeInTheDocument();
    expect(mocks.getLoyalty).not.toHaveBeenCalled();
    expect(mocks.getCoupons).not.toHaveBeenCalled();
  });

  it('thẻ mời của khách: tiêu đề dưới 22px dùng Inter, không Fraunces (Q1)', async () => {
    mocks.phase = 'guest';
    renderPage();
    const region = await screen.findByRole('region', { name: 'Điểm Xanh và điểm danh' });
    const h = within(region).getByRole('heading', { level: 2 });
    expect(h.style.fontFamily).toContain('--font-ui');
    expect(h.style.fontFamily).not.toContain('--font-display');
  });

  it('tên đọc của thẻ Điểm Xanh chứa hạng và số điểm đang hiển thị', async () => {
    renderPage();
    const card = await screen.findByRole('button', { name: /Hạng và lịch sử điểm/ });
    await waitFor(() => expect(card).toHaveAccessibleName(/Mầm Xanh, 120 điểm/));
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

  it('Mã của tôi: mỗi thẻ có nút "Dùng ngay"; "Tất cả (n)" tới /vouchers?tab=mine', async () => {
    renderPage();
    const mine = await screen.findByRole('region', { name: 'Mã của tôi' });
    expect(await within(mine).findByRole('button', { name: 'Dùng ngay' })).toBeInTheDocument();
    fireEvent.click(within(mine).getByRole('button', { name: /Tất cả \(1\)/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/vouchers?tab=mine');
  });

  it('thứ tự trang theo Q10: Banner, Giờ vàng, Nhận mã, Điểm Xanh, Mã của tôi, Đổi quà', async () => {
    mocks.campaigns.mockResolvedValue([
      { id: 'c1', slug: 'giua-thu', title: 'Giữa Thu', image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', linkType: 'CAMPAIGN_PAGE', linkValue: null, audience: 'ALL', startAt: new Date(Date.now() - 86_400_000).toISOString(), endAt: new Date(Date.now() + 86_400_000).toISOString() },
    ]);
    mocks.flash.mockResolvedValue([FLASH_ITEM]);
    mocks.collectable.mockResolvedValue([OPEN_CODE]);
    renderPage();
    const regions = [
      await screen.findByRole('region', { name: 'Chương trình nổi bật' }),
      await screen.findByRole('region', { name: 'Giờ vàng hôm nay' }),
      await screen.findByRole('region', { name: 'Nhận mã' }),
      await screen.findByRole('region', { name: /Điểm Xanh/ }),
      await screen.findByRole('region', { name: 'Mã của tôi' }),
      await screen.findByRole('region', { name: /Đổi quà/ }),
    ];
    for (let i = 1; i < regions.length; i++) {
      expect(regions[i - 1]!.compareDocumentPosition(regions[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `khối ${i}`).toBeTruthy();
    }
  });

  it('khách chưa đăng nhập: Giờ vàng, Nhận mã, rồi mỗi khối cần tài khoản một thẻ mời cùng nhãn "Đăng nhập", Đổi quà vẫn hiện; không gọi API riêng của khách', async () => {
    mocks.phase = 'guest';
    mocks.flash.mockResolvedValue([FLASH_ITEM]);
    mocks.collectable.mockResolvedValue([OPEN_CODE]);
    renderPage();
    const flash = await screen.findByRole('region', { name: 'Giờ vàng hôm nay' });
    const collect = await screen.findByRole('region', { name: 'Nhận mã' });
    const points = await screen.findByRole('region', { name: 'Điểm Xanh và điểm danh' });
    const mine = screen.getByRole('region', { name: 'Mã của tôi' });
    const rewards = screen.getByRole('region', { name: 'Đổi quà' });
    const blocks = [flash, collect, points, mine, rewards];
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i - 1]!.compareDocumentPosition(blocks[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `khối ${i}`).toBeTruthy();
    }
    expect(screen.getAllByRole('button', { name: 'Đăng nhập' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Đăng nhập ngay' })).toBeNull();
    expect(screen.queryByText('Đăng nhập để xem ưu đãi')).toBeNull();
    expect(within(rewards).getByText('Quà của tôi')).toBeInTheDocument();
    expect(within(rewards).getByText('Vườn Xanh')).toBeInTheDocument();
    fireEvent.click(within(mine).getByRole('button', { name: 'Đăng nhập' }));
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.getLoyalty).not.toHaveBeenCalled();
    expect(mocks.getCoupons).not.toHaveBeenCalled();
  });

  it('phiên đang khôi phục hoặc mất mạng: không mời đăng nhập (người dùng có thể đang có phiên)', async () => {
    mocks.phase = 'loading';
    const first = renderPage();
    await screen.findByRole('region', { name: 'Chương trình nổi bật' }).catch(() => undefined);
    expect(screen.queryByRole('button', { name: 'Đăng nhập' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Đổi quà' })).toBeNull();
    first.unmount();
    mocks.phase = 'unavailable';
    renderPage();
    expect(await screen.findByRole('button', { name: /Thử lại/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đăng nhập' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Mã của tôi' })).toBeNull();
  });

  it('tài khoản thật đã đăng nhập: không có thẻ mời đăng nhập; tài khoản khách vẫn có thẻ liên kết Zalo như cũ', async () => {
    const real = renderPage();
    await screen.findByRole('region', { name: 'Mã của tôi' });
    expect(screen.queryByRole('button', { name: 'Đăng nhập' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Liên kết Zalo' })).toBeNull();
    real.unmount();
    mocks.guest = true;
    renderPage();
    expect(await screen.findByRole('button', { name: 'Liên kết Zalo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đăng nhập' })).toBeNull();
  });

  it('Nhận mã tải lỗi: báo tại chỗ có "Thử lại", các khối khác vẫn vẽ', async () => {
    mocks.collectable.mockRejectedValue({ isHttpError: true, response: { status: 500, data: { message: 'x' } } });
    renderPage();
    const collect = await screen.findByRole('region', { name: 'Nhận mã' });
    expect(within(collect).getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    expect(screen.getByText('Quà của tôi')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Mã của tôi' })).toBeInTheDocument();
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
    await screen.findByText('Quà của tôi');
    expect(screen.queryByText('Yêu cầu của tôi')).toBeNull();
  });
});
