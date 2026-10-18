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
  useParams: () => ({ code: 'TB-77' }),
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
import OrderDetailPage from './tai-khoan/don-hang/[code]/page';
import AddressBookPage from './tai-khoan/dia-chi/page';
import LoyaltyPage from './tai-khoan/diem-xanh/page';

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
const SHOP: PageCase[] = [];
const ORDER: PageCase[] = [];
const ACCOUNT: PageCase[] = [];
const LOYALTY: PageCase[] = [['/tai-khoan/diem-xanh', () => <LoyaltyPage />]];
const COMMUNITY: PageCase[] = [];
const AFFILIATE: PageCase[] = [];
const GAME: PageCase[] = [];
const PRO: PageCase[] = [];
const RECYCLE: PageCase[] = [];
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
