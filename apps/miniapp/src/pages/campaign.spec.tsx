import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), navigate: vi.fn(), copy: vi.fn(), authStatus: 'guest' as string }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useParams: () => ({ slug: 'giua-thu' }),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/campaign/giua-thu', search: '', hash: '', state: null, key: 'k' }),
}));
vi.mock('../services/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('../hooks/use-coupon-use', () => ({ useCouponUse: () => ({ copy: mocks.copy, use: vi.fn() }) }));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.authStatus }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../services/shop-api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchActiveFlashSales: vi.fn(() => new Promise(() => undefined)),
  getPublicConfig: vi.fn(() => new Promise(() => undefined)),
}));

import CampaignPage from './campaign';

const DAY = 86_400_000;
const DETAIL = {
  id: 'c1',
  slug: 'giua-thu',
  title: 'Giữa Thu',
  subtitle: 'Giảm sâu mùa trăng',
  image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  linkType: 'CAMPAIGN_PAGE',
  linkValue: null,
  audience: 'ALL',
  startAt: '2026-10-31T17:00:00.000Z',
  endAt: '2026-11-10T17:30:00.000Z',
  productCount: 3,
  coupons: [{ code: 'THU10', type: 'PERCENT', value: 10, minOrder: 100_000, maxDiscount: 30_000, endAt: new Date(Date.now() + 5 * DAY).toISOString() }],
};
const card = (n: number) => ({ id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 10_000 * n, salePrice: null, isFeatured: false, inStock: true });
const productsPage = (ids: number[], page: number, total: number) => ({ data: ids.map(card), meta: { page, limit: 20, total } });
const httpError = (status: number) => Object.assign(new Error(String(status)), { isHttpError: true, response: { status } });

function route(over: { detail?: unknown; products?: (page: number) => unknown } = {}) {
  mocks.get.mockImplementation(async (path: string, opts?: { query?: { page?: number } }) => {
    if (path === '/campaigns/giua-thu') {
      const d = 'detail' in over ? over.detail : DETAIL;
      if (d instanceof Error) throw d;
      return d;
    }
    if (path === '/campaigns/giua-thu/products') {
      const r = (over.products ?? ((p: number) => productsPage([1, 2, 3], p, 3)))(opts?.query?.page ?? 1);
      if (r instanceof Error) throw r;
      return r;
    }
    throw new Error(`không mock ${path}`);
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CampaignPage />
    </QueryClientProvider>,
  );
}

describe('Trang chiến dịch (Mini)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'guest';
  });

  it('khách chưa đăng nhập vẫn thấy đủ: tên chương trình là h1, phụ đề, ảnh đầu trang, ngày theo giờ Việt Nam', async () => {
    route();
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Giữa Thu' })).toBeInTheDocument();
    expect(screen.getByText('Giảm sâu mùa trăng')).toBeInTheDocument();
    // Ảnh trang trí (alt rỗng): h1 ngay trên đã gọi tên, đọc lại lần nữa là trùng.
    const hero = document.querySelector('img')!;
    expect(hero.getAttribute('alt')).toBe('');
    expect(hero).toHaveStyle({ aspectRatio: 'var(--banner-ratio)' });
    expect(screen.getByText('Từ 01/11 đến 11/11')).toBeInTheDocument();
  });

  it('mỗi khối có đúng một h2: mã giảm giá và sản phẩm', async () => {
    route();
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Giữa Thu' });
    const coupons = await screen.findByRole('region', { name: 'Mã giảm giá của chương trình' });
    const products = await screen.findByRole('region', { name: 'Sản phẩm trong chương trình' });
    expect(within(coupons).getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(within(products).getAllByRole('heading', { level: 2 })).toHaveLength(1);
  });

  it('vé mã có nút "Sao chép mã" gọi copy với đúng mã', async () => {
    route();
    renderPage();
    const coupons = await screen.findByRole('region', { name: 'Mã giảm giá của chương trình' });
    fireEvent.click(within(coupons).getByRole('button', { name: /Sao chép mã/ }));
    expect(mocks.copy).toHaveBeenCalledWith('THU10');
  });

  it('lưới sản phẩm hiện đủ thẻ của trang 1, và gọi API với trang 1 giới hạn 20', async () => {
    route();
    renderPage();
    expect(await screen.findByText('Sản phẩm 1')).toBeInTheDocument();
    expect(screen.getByText('Sản phẩm 3')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/campaigns/giua-thu/products', expect.objectContaining({ query: { page: 1, limit: 20 } }));
    expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
  });

  it('còn trang kế: "Xem thêm" nạp thêm 20 món và nối vào lưới', async () => {
    route({
      detail: { ...DETAIL, productCount: 21 },
      products: (p) => (p === 1 ? productsPage(Array.from({ length: 20 }, (_, i) => i + 1), 1, 21) : productsPage([21], 2, 21)),
    });
    renderPage();
    await screen.findByText('Sản phẩm 20');
    expect(screen.queryByText('Sản phẩm 21')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xem thêm' }));
    expect(await screen.findByText('Sản phẩm 21')).toBeInTheDocument();
    expect(screen.getByText('Sản phẩm 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
  });

  it('không có mã: không vẽ khối mã (không tiêu đề trơ trọi)', async () => {
    route({ detail: { ...DETAIL, coupons: [] } });
    renderPage();
    await screen.findByText('Sản phẩm 1');
    expect(screen.queryByRole('region', { name: 'Mã giảm giá của chương trình' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Mã giảm giá của chương trình' })).toBeNull();
  });

  it('không mã và không sản phẩm: một dòng "Chương trình chưa có sản phẩm" thay cho trang trống', async () => {
    route({ detail: { ...DETAIL, coupons: [], productCount: 0 }, products: (p) => productsPage([], p, 0) });
    renderPage();
    expect(await screen.findByText('Chương trình chưa có sản phẩm')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sản phẩm trong chương trình' })).toBeNull();
  });

  it('có mã nhưng không có sản phẩm: chỉ khối mã, không báo "chưa có sản phẩm"', async () => {
    route({ detail: { ...DETAIL, productCount: 0 }, products: (p) => productsPage([], p, 0) });
    renderPage();
    await screen.findByRole('region', { name: 'Mã giảm giá của chương trình' });
    expect(screen.queryByText('Chương trình chưa có sản phẩm')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Sản phẩm trong chương trình' })).toBeNull();
  });

  it('ảnh không phục vụ được (null): bỏ ảnh, trang vẫn đủ nội dung', async () => {
    route({ detail: { ...DETAIL, image: null } });
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Giữa Thu' });
    expect(screen.queryByRole('img', { name: 'Giữa Thu' })).toBeNull();
    expect(await screen.findByText('Sản phẩm 1')).toBeInTheDocument();
  });

  it('404 (hết hạn, chưa mở hay không có): "Chương trình đã kết thúc" và nút về trang chủ', async () => {
    route({ detail: httpError(404) });
    renderPage();
    expect(await screen.findByText('Chương trình đã kết thúc')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Về trang chủ' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('lỗi khác 404: báo lỗi kèm "Thử lại", bấm Thử lại gọi lại chi tiết', async () => {
    route({ detail: httpError(500) });
    renderPage();
    const retry = await screen.findByRole('button', { name: /Thử lại/ });
    expect(screen.queryByText('Chương trình đã kết thúc')).toBeNull();
    const before = mocks.get.mock.calls.filter(([p]) => p === '/campaigns/giua-thu').length;
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.get.mock.calls.filter(([p]) => p === '/campaigns/giua-thu').length).toBe(before + 1));
  });

  it('đang tải: khung chờ, chưa có h1 của chương trình', () => {
    mocks.get.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Chương trình' })).toBeInTheDocument();
    expect(screen.getByTestId('campaign-loading')).toBeInTheDocument();
  });
});
