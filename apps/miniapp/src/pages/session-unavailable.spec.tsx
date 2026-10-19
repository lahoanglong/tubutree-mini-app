import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentType, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * R5-BUYER-1: mở app lúc mất mạng thì phiên không khôi phục được (status 'error'). Mọi màn cần đăng nhập và có trạng thái
 * "trống" phải nói mất kết nối + Thử lại, tuyệt đối không vẽ "chưa có đơn / giỏ trống / chưa có thông báo...". Spec này chạy
 * từng trang thật với store thật; dịch vụ gọi API đều bị mock nên mọi lời gọi mạng đều lộ ra.
 */

vi.mock('zmp-sdk/apis', () => ({ setStorage: vi.fn(), getStorage: vi.fn().mockResolvedValue({}), removeStorage: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => vi.fn(),
  useParams: () => ({ code: 'TT001', id: 'p1' }),
  useLocation: () => ({ pathname: '/', search: '', state: null, key: 'k' }),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api');
vi.mock('../services/account-api');
vi.mock('../services/wishlist-api');
vi.mock('../services/waste-api');
vi.mock('../services/affiliate-api');
vi.mock('../services/feed-api');
vi.mock('../services/game-api');
vi.mock('../services/cashback-api');
vi.mock('../services/brand-owner-api');
vi.mock('../services/dealer-api');
vi.mock('../services/subscriptions-api');
vi.mock('../services/payment-api');
vi.mock('../services/analytics');
vi.mock('../services/zmp-bridge', () => ({
  hasOA: false,
  callPhone: vi.fn(),
  openOAChat: vi.fn(),
  openExternal: vi.fn(),
  getLaunchReferral: vi.fn(),
  getZaloAccessToken: vi.fn(),
  requestZaloPhoneToken: vi.fn(),
  shouldShowFollowOaPrompt: () => false,
  getOaPromptState: vi.fn().mockResolvedValue({ promptSeen: true }),
}));

import { vi as copy } from '../i18n/vi';
import { useAuthStore } from '../store/auth';
import * as shopApi from '../services/shop-api';
import * as accountApi from '../services/account-api';
import * as wishlistApi from '../services/wishlist-api';
import * as wasteApi from '../services/waste-api';
import * as feedApi from '../services/feed-api';

interface PageCase {
  name: string;
  load: () => Promise<{ default: ComponentType }>;
  /** Câu "trống"/"đăng nhập" của chính trang đó, không được xuất hiện khi chưa vào được phiên. */
  forbidden: RegExp[];
}

const PAGES: PageCase[] = [
  { name: 'Đơn hàng', load: () => import('./orders'), forbidden: [/Bạn chưa có đơn nào/, /Không có đơn nào ở mục này/] },
  { name: 'Giỏ hàng', load: () => import('./cart'), forbidden: [/Giỏ còn trống đấy/] },
  { name: 'Thanh toán', load: () => import('./checkout'), forbidden: [/Giỏ còn trống đấy/] },
  { name: 'Thông báo', load: () => import('./notifications'), forbidden: [/Chưa có thông báo nào/] },
  { name: 'Yêu thích', load: () => import('./wishlist'), forbidden: [/Chưa có sản phẩm yêu thích/] },
  { name: 'Đổi rác', load: () => import('./recycle'), forbidden: [/Chương trình đang tạm dừng/, /Đăng nhập Zalo và chia sẻ số điện thoại để đổi rác/] },
  { name: 'Sổ địa chỉ', load: () => import('./addresses'), forbidden: [/Bạn chưa có địa chỉ giao hàng nào/] },
  { name: 'Điểm Xanh', load: () => import('./loyalty'), forbidden: [/Chưa có giao dịch điểm nào/] },
  { name: 'Ví Tubu', load: () => import('./wallet'), forbidden: [/0\s?₫|0đ/] },
  { name: 'Cộng tác viên', load: () => import('./affiliate'), forbidden: [/Đăng ký làm CTV|Đăng ký trở thành/i] },
  { name: 'Chi tiết đơn', load: () => import('./order-detail'), forbidden: [/Có chút trục trặc/] },
  { name: 'Hoàn tiền sàn ngoài', load: () => import('./cashback'), forbidden: [/Chưa có giao dịch hoàn tiền/] },
  { name: 'Cộng đồng', load: () => import('./feed'), forbidden: [/Chưa có bài viết nào/, new RegExp(copy.community.loginToView)] },
  { name: 'Sự kiện cộng đồng', load: () => import('./community-events'), forbidden: [new RegExp(copy.community.loginToView)] },
  { name: 'Bảng xếp hạng', load: () => import('./community-leaderboard'), forbidden: [new RegExp(copy.community.loginToView)] },
  { name: 'Bài viết', load: () => import('./post-detail'), forbidden: [new RegExp(copy.community.loginToView)] },
  { name: 'Vườn Xanh', load: () => import('./game'), forbidden: [new RegExp(copy.community.loginToView)] },
  { name: 'Cá nhân', load: () => import('./profile'), forbidden: [/Đã đăng xuất/, /network error/i] },
];

const restore = vi.fn(() => Promise.resolve());
const login = vi.fn(() => Promise.resolve());

function renderPage(Page: ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <Page />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function setSession(status: 'idle' | 'loading' | 'authenticated' | 'error') {
  act(() => useAuthStore.setState({ status, user: null, error: undefined, restore, login }));
}

const DATA_CALLS = [
  shopApi.fetchOrders,
  shopApi.getCart,
  shopApi.getAddresses,
  shopApi.fetchOrder,
  accountApi.getNotifications,
  accountApi.getLoyalty,
  accountApi.getWallet,
  wishlistApi.getWishlist,
  wasteApi.getWasteMe,
  feedApi.getFeed,
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(PAGES)('$name — mất kết nối lúc khôi phục phiên (R5-BUYER-1)', ({ load, forbidden }) => {
  it('hiện "Mất kết nối" + Thử lại gọi restore(); không vẽ màn trống/đăng nhập; không gọi API dữ liệu nào', async () => {
    setSession('error');
    const { default: Page } = await load();
    const { container } = renderPage(Page);

    expect(await screen.findByText(copy.errors.sessionUnavailable)).toBeInTheDocument();
    const text = container.textContent ?? '';
    for (const re of forbidden) expect(text).not.toMatch(re);
    expect(text).not.toMatch(/network error/i);
    for (const fn of DATA_CALLS) if (typeof fn === 'function' && 'mock' in fn) expect(fn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('đang khôi phục phiên: khung chờ, không câu lỗi và không màn trống', async () => {
    setSession('loading');
    const { default: Page } = await load();
    const { container } = renderPage(Page);

    await act(async () => {
      await Promise.resolve();
    });
    const text = container.textContent ?? '';
    expect(text).not.toContain(copy.errors.sessionUnavailable);
    for (const re of forbidden) expect(text).not.toMatch(re);
  });
});
