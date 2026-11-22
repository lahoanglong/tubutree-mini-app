import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Trang ghép Hộp Xanh (Mini App, lối vào "Ghép thêm" ở giỏ): cùng dữ liệu, chữ và luật với web /hop-xanh.

const mocks = vi.hoisted(() => ({ goSmart: vi.fn(), coreGet: vi.fn(), getCart: vi.fn(), track: vi.fn(), phase: 'authenticated' as string }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
}));
vi.mock('../lib/smart-nav', () => ({ useSmartNavigate: () => mocks.goSmart }));
vi.mock('../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
vi.mock('../services/shop-api', () => ({ getCart: mocks.getCart }));
vi.mock('../services/cart-key', () => ({ useCartKey: () => ['cart', null] }));
vi.mock('../services/analytics', () => ({ trackEvent: mocks.track }));
vi.mock('../hooks/use-auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('../components/home/home-quick-add', () => ({ HomeQuickAddProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../components/ui/product-grid', () => ({
  ProductGrid: ({ items, loading }: { items: { slug: string; name: string }[]; loading?: boolean }) =>
    loading ? <div data-testid="grid-loading" /> : <ul data-testid="green-box-grid">{items.map((p) => <li key={p.slug}>{p.name}</li>)}</ul>,
}));

import GreenBoxPage from './green-box';

const product = (slug: string) => ({ id: slug, slug, name: `Món ${slug}`, brand: 'Tubu', thumbnail: null, basePrice: 50_000, salePrice: null, isFeatured: false, inStock: true });
const TIERS = [
  { minItems: 3, pct: 3 },
  { minItems: 5, pct: 5 },
];
let pageData: unknown;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GreenBoxPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.phase = 'authenticated';
  pageData = {
    enabled: true,
    tiers: TIERS,
    groups: [
      { category: { id: 'c1', name: 'Nước giặt', slug: 'nuoc-giat' }, products: [product('a'), product('b')] },
      { category: null, products: [product('c')] },
    ],
  };
  mocks.coreGet.mockImplementation(async (path: string) => {
    if (path === '/bundles/green-box') return pageData;
    throw new Error(`đường dẫn lạ ${path}`);
  });
  mocks.getCart.mockResolvedValue({ items: [], greenBox: { items: 3, tier: TIERS[0], next: TIERS[1], tiers: TIERS, discount: 4_500 } });
});

describe('GreenBoxPage (Mini App, tubu-w17-01)', () => {
  it('h1, câu bậc từ máy chủ, luật, nhóm theo danh mục (h2), thanh đáy đọc tiến độ giỏ; "Xem giỏ" mở giỏ; báo đã xem một lần', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Hộp Xanh tự chọn' })).toBeTruthy();
    await screen.findAllByTestId('green-box-grid');
    expect(document.body.textContent).toContain('từ 3 món giảm 3%');
    expect(document.body.textContent).toContain('Mỗi phân loại được giảm cho tối đa 2 sản phẩm');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Nước giặt', 'Món khác']);
    expect(screen.getAllByTestId('green-box-grid').map((g) => g.textContent)).toEqual(['Món aMón b', 'Món c']);
    await waitFor(() => expect(screen.getByTestId('green-box-bar-text').textContent).toBe('Đã chọn 3 món · giảm 3%'));
    expect(mocks.coreGet).toHaveBeenCalledWith('/bundles/green-box', { anonymous: true });
    fireEvent.click(screen.getByTestId('green-box-view-cart'));
    expect(mocks.goSmart).toHaveBeenCalledWith('/cart');
    expect(mocks.track.mock.calls).toEqual([['green_box_page_viewed', 'miniapp', {}]]);
  });

  it('chưa đăng nhập: không đọc giỏ, thanh đáy 0 món', async () => {
    mocks.phase = 'guest';
    renderPage();
    expect(await screen.findByTestId('green-box-bar-text')).toBeTruthy();
    expect(screen.getByTestId('green-box-bar-text').textContent).toBe('Đã chọn 0 món');
    expect(mocks.getCart).not.toHaveBeenCalled();
  });

  it('cờ tắt: lời "chưa mở" dẫn về Danh mục, không báo đã xem', async () => {
    pageData = { enabled: false, tiers: [], groups: [] };
    renderPage();
    expect(await screen.findByText('Hộp Xanh chưa mở. Bạn quay lại sau nhé.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xem sản phẩm khác' }));
    expect(mocks.goSmart).toHaveBeenCalledWith('/browse');
    expect(mocks.track).not.toHaveBeenCalled();
  });
});
