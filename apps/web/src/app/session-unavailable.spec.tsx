// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// R2-BUYERWEB-5: tắt API/mất mạng lúc mở trang thì khách đang đăng nhập thấy "Đăng nhập để xem giỏ hàng" như khách
// vãng lai, bấm đăng nhập lại (vòng OAuth thừa). Phải nói mất kết nối và cho thử lại.

const mocks = vi.hoisted(() => ({
  retrySession: vi.fn(async () => undefined),
  auth: {
    user: null,
    status: 'idle',
    initialized: true,
    sessionUnavailable: true,
    logout: vi.fn(),
  } as Record<string, unknown>,
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ ...mocks.auth, retrySession: mocks.retrySession }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/tai-khoan/don-hang',
  useParams: () => ({ code: 'TB-77', id: 'p1' }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: vi.fn(async () => {
    throw new Error('không được gọi giỏ khi chưa khôi phục được phiên');
  }),
  getAddresses: vi.fn(async () => []),
  getPublicConfig: async () => ({}),
  fetchOrder: vi.fn(),
  fetchOrdersPage: vi.fn(),
  getMe: vi.fn(),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getPublicSupport: async () => ({ hotline: '0984 606 774', email: 'tubutree@gmail.com' }),
}));

import CartPage from './gio-hang/page';
import CheckoutPage from './thanh-toan/page';
import AccountPage from './tai-khoan/page';
import BankPaymentPage from './thanh-toan/chuyen-khoan/[code]/page';
import OrdersPage from './tai-khoan/don-hang/page';
import OrderDetailPage from './tai-khoan/don-hang/[code]/page';
import AddressBookPage from './tai-khoan/dia-chi/page';
import EditProfilePage from './tai-khoan/ho-so/page';
import SettingsPage from './tai-khoan/cai-dat/page';
import NotificationsPage from './tai-khoan/thong-bao/page';
import LoyaltyPage from './tai-khoan/diem-xanh/page';
import WalletPage from './tai-khoan/vi-tubu/page';
import RewardsPage from './kho-qua/page';
import RewardsMinePage from './kho-qua/cua-toi/page';
import GamePage from './vuon-xanh/page';
import AdvisorPage from './tu-van/page';
import CashbackPage from './hoan-tien/page';
import WishlistPage from './tai-khoan/yeu-thich/page';
import CtvPage from './ctv/page';
import CtvStorefrontPage from './ctv/gian-hang/page';
import LeaderboardPage from './cong-dong/xep-hang/page';
import EventsPage from './cong-dong/su-kien/page';
import PostDetailPage from './cong-dong/[id]/page';
import { CourseList } from './hoc-vien/course-list';
import { CourseDetailView } from './hoc-vien/[courseId]/course-detail';
import DealerPage from './dai-ly/page';
import StaffPage from './nhan-vien/page';
import MyPayrollPage from './nhan-vien/bang-luong/page';
import BrandOwnerPage from './chu-thuong-hieu/page';
import RecyclePage from './doi-rac/page';
import RecycleRequestsPage from './doi-rac/yeu-cau/page';
import RecycleNewPage from './doi-rac/tao/page';
import RecyclePointsPage from './doi-rac/diem-nhan/page';
import RecycleRequestDetailPage from './doi-rac/yeu-cau/[id]/page';
import RecycleEditPage from './doi-rac/yeu-cau/[id]/sua/page';
import RecycleDonePage from './doi-rac/xong/[id]/page';
import RecycleDeskPage from './doi-rac/quay/page';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};

beforeEach(() => {
  mocks.retrySession.mockClear();
  mocks.auth.sessionUnavailable = true;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

type PageCase = [string, () => JSX.Element];
const CORE: PageCase[] = [
  ['/gio-hang', () => <CartPage />],
  ['/thanh-toan', () => <CheckoutPage />],
  ['/tai-khoan', () => <AccountPage />],
  ['/tai-khoan/don-hang/[code]', () => <OrderDetailPage />],
  ['/tai-khoan/dia-chi', () => <AddressBookPage />],
];
const SHOP: PageCase[] = [['/tai-khoan/yeu-thich', () => <WishlistPage />]];
const ORDER: PageCase[] = [
  ['/thanh-toan/chuyen-khoan/[code]', () => <BankPaymentPage />],
  ['/tai-khoan/don-hang', () => <OrdersPage />],
];
const ACCOUNT: PageCase[] = [
  ['/tai-khoan/ho-so', () => <EditProfilePage />],
  ['/tai-khoan/cai-dat', () => <SettingsPage />],
  ['/tai-khoan/thong-bao', () => <NotificationsPage />],
];
const LOYALTY: PageCase[] = [
  ['/tai-khoan/diem-xanh', () => <LoyaltyPage />],
  ['/tai-khoan/vi-tubu', () => <WalletPage />],
  ['/kho-qua', () => <RewardsPage />],
  ['/kho-qua/cua-toi', () => <RewardsMinePage />],
  ['/hoan-tien', () => <CashbackPage />],
];
const COMMUNITY: PageCase[] = [
  ['/cong-dong/xep-hang', () => <LeaderboardPage />],
  ['/cong-dong/su-kien', () => <EventsPage />],
  ['/cong-dong/[id]', () => <PostDetailPage />],
  ['/hoc-vien', () => <CourseList />],
  ['/hoc-vien/[courseId]', () => <CourseDetailView courseId="c1" />],
];
const AFFILIATE: PageCase[] = [
  ['/ctv', () => <CtvPage />],
  ['/ctv/gian-hang', () => <CtvStorefrontPage />],
];
const GAME: PageCase[] = [
  ['/vuon-xanh', () => <GamePage />],
  ['/tu-van', () => <AdvisorPage />],
];
const PRO: PageCase[] = [
  ['/dai-ly', () => <DealerPage />],
  ['/nhan-vien', () => <StaffPage />],
  ['/nhan-vien/bang-luong', () => <MyPayrollPage />],
  ['/chu-thuong-hieu', () => <BrandOwnerPage />],
];
const RECYCLE: PageCase[] = [
  ['/doi-rac', () => <RecyclePage />],
  ['/doi-rac/yeu-cau', () => <RecycleRequestsPage />],
  ['/doi-rac/tao', () => <RecycleNewPage />],
  ['/doi-rac/diem-nhan', () => <RecyclePointsPage />],
  ['/doi-rac/yeu-cau/[id]', () => <RecycleRequestDetailPage params={{ id: 'req-77' }} />],
  ['/doi-rac/yeu-cau/[id]/sua', () => <RecycleEditPage params={{ id: 'req-77' }} />],
  ['/doi-rac/xong/[id]', () => <RecycleDonePage params={{ id: 'req-77' }} />],
  ['/doi-rac/quay', () => <RecycleDeskPage />],
];
const PAGES: PageCase[] = [...CORE, ...SHOP, ...ORDER, ...ACCOUNT, ...LOYALTY, ...COMMUNITY, ...AFFILIATE, ...GAME, ...PRO, ...RECYCLE];

describe.each(PAGES)('mở %s khi cờ phiên còn mà API không trả lời', (_name, page) => {
  it('nói không kết nối được, KHÔNG mời đăng nhập lại', async () => {
    const { container } = mount(page());
    await flush();
    expect(container.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(container.textContent).toContain('Bạn vẫn đang đăng nhập');
    expect(container.querySelector('a[href^="/dang-nhap"]')).toBeNull();
    expect(container.textContent).not.toContain('Đăng nhập với Zalo');
  });

  it('bấm Thử lại gọi khôi phục phiên', async () => {
    const { container } = mount(page());
    await flush();
    const retry = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Thử lại')!;
    click(retry);
    await flush();
    expect(mocks.retrySession).toHaveBeenCalledTimes(1);
  });
});

describe('khách vãng lai thật (không có cờ phiên)', () => {
  it('vẫn thấy lời mời đăng nhập', async () => {
    mocks.auth.sessionUnavailable = false;
    const { container } = mount(<CartPage />);
    await flush();
    expect(container.querySelector('a[href^="/dang-nhap"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Không kết nối được');
  });
});
