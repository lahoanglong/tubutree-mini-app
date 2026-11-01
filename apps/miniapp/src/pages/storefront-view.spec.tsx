import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPublicStorefront: vi.fn(),
  shareSheetProps: vi.fn(),
  navigate: vi.fn(),
  fetchFlash: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
}));
vi.mock('../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchActiveFlashSales: mocks.fetchFlash,
}));
vi.mock('../services/storefront-api', () => ({ getPublicStorefront: mocks.getPublicStorefront }));
vi.mock('../components/share-sheet', () => ({
  ShareSheet: (props: Record<string, unknown>) => {
    mocks.shareSheetProps(props);
    return null;
  },
}));

import { useStorefrontContext } from '../store/storefront-context';
import { cartStorefrontSlug } from '../services/cart-key';
import { useAuthStore } from '../store/auth';
import StorefrontViewPage from './storefront-view';

const title = () => screen.findByRole('heading', { level: 1, name: 'Gian hàng Lan' });
const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

const storefront = (over: Record<string, unknown>) => ({
  id: 'sf1', slug: 'abcd1234', type: 'CTV', title: 'Gian hàng Lan', headerNote: null, ownerTier: null,
  avatarUrl: null, coverUrl: null, theme: 'default', referralCode: 'ABCD1234', collections: [], ...over,
});

function renderPage(slug: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/s/${slug}`]} future={FUTURE}>
        <Routes>
          <Route path="/s/:slug" element={<StorefrontViewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StorefrontViewPage — mã giới thiệu lấy từ API, không suy từ slug (D3-17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStorefrontContext.getState().clear();
    useAuthStore.setState({ user: null });
  });

  it('gian hàng CTV: ngữ cảnh và nút chia sẻ dùng referralCode API trả về, kể cả khi slug khác mã', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ slug: 'lan-shop', referralCode: 'ABCD1234' }));
    renderPage('lan-shop');
    await title();
    await waitFor(() => expect(useStorefrontContext.getState().referralCode).toBe('ABCD1234'));
    expect(useStorefrontContext.getState().slug).toBe('lan-shop');
    expect(mocks.shareSheetProps).toHaveBeenCalledWith(expect.objectContaining({ slug: 'lan-shop', referralCode: 'ABCD1234' }));
  });

  it('gian hàng đối tác (MERCHANT): API không trả mã → không có mã giới thiệu', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ type: 'MERCHANT', slug: 'doi-tac', referralCode: null }));
    renderPage('doi-tac');
    await title();
    await waitFor(() => expect(useStorefrontContext.getState().slug).toBe('doi-tac'));
    expect(useStorefrontContext.getState().referralCode).toBeNull();
    expect(mocks.shareSheetProps).toHaveBeenCalledWith(expect.objectContaining({ referralCode: null }));
  });
});

describe('StorefrontViewPage: ngữ cảnh ghi công theo loại gian hàng', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    useStorefrontContext.getState().clear();
    useAuthStore.setState({ user: null });
  });

  it('gian hàng đối tác (MERCHANT): không xoá mã CTV đang có, không gắn slug gian hàng vào đơn', async () => {
    useStorefrontContext.getState().setContext({ slug: 'an', referralCode: 'AN123', kind: 'ctv' });
    mocks.getPublicStorefront.mockResolvedValue(storefront({ type: 'MERCHANT', slug: 'doi-tac', referralCode: null }));
    renderPage('doi-tac');
    await title();
    await waitFor(() => expect(useStorefrontContext.getState().slug).toBe('doi-tac'));
    const ctx = useStorefrontContext.getState();
    expect(ctx.referralCode).toBe('AN123');
    expect(ctx.kind).not.toBe('ctv');
    expect(cartStorefrontSlug()).toBeNull();
  });

  it('gian hàng đối tác: quay lại và "Tiếp tục mua sắm" vẫn về trang /s/ của gian hàng, không rẽ sang /brand/', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ type: 'MERCHANT', slug: 'doi-tac', referralCode: null }));
    renderPage('doi-tac');
    await waitFor(() => expect(useStorefrontContext.getState().slug).toBe('doi-tac'));
    expect(useStorefrontContext.getState().kind).not.toBe('brand');
  });

  it('gian hàng nhãn hàng (BRAND): cũng không phải gian hàng CTV', async () => {
    useStorefrontContext.getState().setContext({ referralCode: 'AN123', kind: 'ctv' });
    mocks.getPublicStorefront.mockResolvedValue(storefront({ type: 'BRAND', slug: 'nhan-hang', referralCode: null }));
    renderPage('nhan-hang');
    await waitFor(() => expect(useStorefrontContext.getState().slug).toBe('nhan-hang'));
    expect(useStorefrontContext.getState().referralCode).toBe('AN123');
    expect(cartStorefrontSlug()).toBeNull();
  });

  it('gian hàng CTV: đặt mã của CTV, kind ctv (gắn slug vào đơn) và biết trước mã hợp lệ', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ type: 'CTV', slug: 'lan-shop', referralCode: 'ABCD1234' }));
    renderPage('lan-shop');
    await waitFor(() => expect(useStorefrontContext.getState().referralCode).toBe('ABCD1234'));
    const ctx = useStorefrontContext.getState();
    expect(ctx).toMatchObject({ slug: 'lan-shop', kind: 'ctv', referralEligible: true });
    expect(cartStorefrontSlug()).toBe('lan-shop');
  });
});

const product = { id: 'p1', name: 'Trà xanh', slug: 'tra-xanh', thumbnail: null, brand: 'Tubu', basePrice: 100_000, salePrice: null, ratingAvg: 5, reviewCount: 1, inStock: true };
const withItems = { collections: [{ id: 'c1', title: 'Bộ A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, items: [{ id: 'i1', note: null, variationId: null, product }] }] };

describe('StorefrontViewPage — nhãn tin cậy, nút đáy và trạng thái rỗng (D3-02, D5-09)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStorefrontContext.getState().clear();
    useAuthStore.setState({ user: null });
  });

  it('CTV chưa được duyệt: không có nhãn "CTV tuyển chọn"; được duyệt thì có', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ approved: false, ...withItems }));
    const view = renderPage('abcd1234');
    await title();
    expect(screen.queryByText('CTV tuyển chọn')).not.toBeInTheDocument();
    view.unmount();
    mocks.getPublicStorefront.mockResolvedValue(storefront({ approved: true, ...withItems }));
    renderPage('abcd1234');
    expect(await screen.findByText('CTV tuyển chọn')).toBeInTheDocument();
  });

  it('nhãn không còn nói "chính hãng": đối tác ghi "Đối tác của Tubu Tree" (khi đã duyệt), nhãn hàng ghi "Nhãn hàng trên Tubu Tree"', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ type: 'MERCHANT', referralCode: null, approved: true, ...withItems }));
    const view = renderPage('doi-tac');
    expect(await screen.findByText('Đối tác của Tubu Tree')).toBeInTheDocument();
    expect(screen.queryByText(/chính hãng/i)).not.toBeInTheDocument();
    view.unmount();
    mocks.getPublicStorefront.mockResolvedValue(storefront({ type: 'BRAND', referralCode: null, approved: true, ...withItems }));
    renderPage('nhan-hang');
    expect(await screen.findByText('Nhãn hàng trên Tubu Tree')).toBeInTheDocument();
  });

  it('khách (không phải chủ): không có nút dính đáy kéo ra danh mục; lối sang Tubu Tree là link phụ cuối trang, không có nút chia sẻ', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront(withItems));
    renderPage('abcd1234');
    fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm ở Tubu Tree' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
    expect(screen.queryByRole('button', { name: 'Xem sản phẩm' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chia sẻ gian hàng' })).not.toBeInTheDocument();
  });

  it('chủ gian hàng (mã giới thiệu trùng): giữ nút "Chia sẻ gian hàng", không có "Xem sản phẩm"', async () => {
    useAuthStore.setState({ user: { id: 'u1', role: 'AFFILIATE', referralCode: 'ABCD1234' } as never });
    mocks.getPublicStorefront.mockResolvedValue(storefront(withItems));
    renderPage('abcd1234');
    fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ gian hàng' }));
    expect(screen.queryByRole('button', { name: 'Xem sản phẩm' })).not.toBeInTheDocument();
  });

  it('gian hàng mẫu: hiện nhãn "Gian hàng mẫu" và lời giải thích; gian hàng thật thì không', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ isSample: true, ...withItems }));
    const view = renderPage('mebimla');
    expect(await screen.findByText('Gian hàng mẫu')).toBeInTheDocument();
    expect(screen.getByTestId('sample-note')).toHaveTextContent('không phải người bán thật');
    view.unmount();
    mocks.getPublicStorefront.mockResolvedValue(storefront({ isSample: false, ...withItems }));
    renderPage('abcd1234');
    await screen.findByRole('button', { name: 'Xem thêm ở Tubu Tree' });
    expect(screen.queryByText('Gian hàng mẫu')).not.toBeInTheDocument();
  });

  it('chia sẻ gian hàng mẫu: tiêu đề có tiền tố "Gian hàng mẫu · "; gian hàng thật giữ nguyên', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ isSample: true, title: 'Góc Mẹ Bỉm Lá', ...withItems }));
    const view = renderPage('mebimla');
    await screen.findByText('Gian hàng mẫu');
    expect(mocks.shareSheetProps).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Gian hàng mẫu · Góc Mẹ Bỉm Lá' }));
    view.unmount();
    mocks.getPublicStorefront.mockResolvedValue(storefront({ isSample: false, title: 'Shop An', ...withItems }));
    renderPage('abcd1234');
    await screen.findByRole('button', { name: 'Xem thêm ở Tubu Tree' });
    expect(mocks.shareSheetProps).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Shop An' }));
  });

  it('khách xem gian hàng CTV của người khác: cuối trang có dòng chữ nhỏ "Tìm hiểu" dẫn tới /storefront (không còn thẻ nặng); chủ gian hàng thì không', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront(withItems));
    const view = renderPage('abcd1234');
    fireEvent.click(await screen.findByRole('button', { name: 'Muốn có gian hàng như này? Tìm hiểu' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/storefront');
    view.unmount();
    useAuthStore.setState({ user: { id: 'u1', role: 'AFFILIATE', referralCode: 'ABCD1234' } as never });
    renderPage('abcd1234');
    await screen.findByRole('button', { name: 'Chia sẻ gian hàng' });
    expect(screen.queryByRole('button', { name: 'Muốn có gian hàng như này? Tìm hiểu' })).not.toBeInTheDocument();
  });

  it('người khác đăng nhập (mã khác): vẫn là khách', async () => {
    useAuthStore.setState({ user: { id: 'u2', role: 'CUSTOMER', referralCode: 'ZZZZ9999' } as never });
    mocks.getPublicStorefront.mockResolvedValue(storefront(withItems));
    renderPage('abcd1234');
    expect(await screen.findByRole('button', { name: 'Xem thêm ở Tubu Tree' })).toBeInTheDocument();
  });

  it('chưa có sản phẩm khách thấy: trạng thái rỗng có nút "Xem sản phẩm" dẫn tới /browse (khách không gặp trang trắng)', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ collections: [{ id: 'c1', title: 'Bộ A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, items: [] }] }));
    renderPage('abcd1234');
    expect(await screen.findByText('Gian hàng chưa có sản phẩm nào để xem')).toBeInTheDocument();
    expect(screen.queryByText('Bộ A')).not.toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Xem sản phẩm' });
    fireEvent.click(buttons[0]!);
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
  });

  it('chủ gian hàng mà gian hàng rỗng: được mời thêm sản phẩm ở trình dựng, không bị dẫn đi xem hàng', async () => {
    useAuthStore.setState({ user: { id: 'u1', role: 'AFFILIATE', referralCode: 'ABCD1234' } as never });
    mocks.getPublicStorefront.mockResolvedValue(storefront({ collections: [] }));
    renderPage('abcd1234');
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm sản phẩm' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/storefront');
    expect(screen.queryByRole('button', { name: 'Xem sản phẩm' })).not.toBeInTheDocument();
  });
});

describe('StorefrontViewPage — ảnh do API phục vụ (D3-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStorefrontContext.getState().clear();
    useAuthStore.setState({ user: null });
  });

  it('ảnh bìa và ảnh đại diện dạng đường dẫn tương đối API được ghép với gốc API; URL tuyệt đối giữ nguyên', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ coverUrl: '/storefront/image/sf1/cover?v=a', avatarUrl: 'https://cdn.x/a.jpg', ...withItems }));
    renderPage('abcd1234');
    const cover = (await screen.findByTestId('shop-cover')).style.background;
    expect(cover).toMatch(/https?:\/\/[^"')]+\/storefront\/image\/sf1\/cover\?v=a/);
    expect(screen.getByTestId('shop-avatar').querySelector('img')).toHaveAttribute('src', 'https://cdn.x/a.jpg');
  });
});

describe('StorefrontViewPage: giá trong gian hàng khớp trang chủ và web (B-24)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStorefrontContext.getState().clear();
    useAuthStore.setState({ user: null });
  });

  it('đang Giờ vàng: thẻ hiện giá Giờ vàng và giá gạch đang bán, không hiện giá niêm yết cũ', async () => {
    mocks.fetchFlash.mockResolvedValue([{ itemId: 'i1', variationId: 'v1', productSlug: 'cao-ca-gai-leo', productName: 'Cao cà gai leo', thumbnail: null, flashPrice: 165_000, retailPrice: 220_000, salePrice: null, soldCount: 1, quota: 10, endAt: '2099-01-01T00:00:00.000Z' }]);
    mocks.getPublicStorefront.mockResolvedValue(storefront({
      collections: [{ id: 'c1', title: 'Bán chạy', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, items: [
        { id: 'it1', note: null, variationId: null, product: { id: 'p1', name: 'Cao cà gai leo', slug: 'cao-ca-gai-leo', thumbnail: null, brand: 'Tubu', basePrice: 220_000, salePrice: null, ratingAvg: 0, reviewCount: 0, inStock: true } },
      ] }],
    }));
    renderPage('abcd1234');
    await waitFor(() => expect(screen.getByText('165.000đ')).toBeInTheDocument());
    expect(screen.getByText('220.000đ')).toBeInTheDocument();
    expect(screen.getByText('Giờ vàng -25%')).toBeInTheDocument();
  });
});

const prod = (n: number, over: Record<string, unknown> = {}) => ({
  id: `p${n}`, name: `Sản phẩm ${String(n).padStart(2, '0')}`, slug: `sp-${n}`, thumbnail: null, brand: 'Tubu', basePrice: 10_000 * n,
  salePrice: null, ratingAvg: 0, reviewCount: 0, inStock: true, repVariationId: `v${n}`, ...over,
});
const colOf = (id: string, title: string, kind: string, layout: string, from: number, count: number, pct: number | null = null) => ({
  id, title, kind, layout, comboDiscountPct: pct,
  items: Array.from({ length: count }, (_, i) => ({ id: `${id}-i${i}`, note: null, variationId: null, product: prod(from + i) })),
});
const tileCount = (id: string) => screen.getByTestId(id).querySelectorAll('[data-ds="product-tile"]').length;

describe('StorefrontViewPage: khung shop (tab, khối theo layout, thống kê)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStorefrontContext.getState().clear();
    useAuthStore.setState({ user: null });
  });

  const four = [
    colOf('a', 'Bếp xanh', 'NORMAL', 'CAROUSEL', 1, 14),
    colOf('b', 'Chăm bé', 'NORMAL', 'GRID', 20, 9),
    colOf('c', 'Mình hay dùng', 'NORMAL', 'STACK', 40, 8),
    colOf('d', 'Combo giặt', 'COMBO', 'GRID', 60, 3, 10),
  ];

  it('tab mặc định "Shop" vẽ đúng layout từng bộ (kệ, lưới, dòng, combo); không còn khung StorePageShell', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ collections: four }));
    renderPage('abcd1234');
    await title();
    expect(screen.getByRole('tab', { name: 'Shop', selected: true })).toBeInTheDocument();
    expect(tileCount('shop-rail')).toBe(10);
    expect(tileCount('shop-grid')).toBe(6);
    expect(tileCount('shop-line')).toBe(5);
    expect(screen.getByTestId('shop-combo')).toBeInTheDocument();
  });

  it('hàng số liệu: số sản phẩm khác nhau; tab "Sản phẩm (n)" đếm đúng', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ collections: four }));
    renderPage('abcd1234');
    await title();
    const stat = screen.getAllByTestId('shop-stat')[0]!;
    expect(stat).toHaveAttribute('aria-label', '34 sản phẩm');
    expect(screen.getByRole('tab', { name: 'Sản phẩm (34)' })).toBeInTheDocument();
  });

  it('bấm "Tất cả (14)" của khối bị cắt chuyển sang tab Sản phẩm, lọc đúng bộ đó, có chip để gỡ lọc', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ collections: four }));
    renderPage('abcd1234');
    await title();
    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả 14 sản phẩm trong Bếp xanh' }));
    expect(screen.getByRole('tab', { name: /^Sản phẩm/, selected: true })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-ds="product-tile"]')).toHaveLength(14);
    fireEvent.click(screen.getByRole('button', { name: 'Bếp xanh, bỏ lọc' }));
    expect(document.querySelectorAll('[data-ds="product-tile"]')).toHaveLength(20);
  });

  it('8 bộ: tab Shop chỉ vẽ 6 khối, tab Danh mục liệt kê cả 8 và bấm một dòng mở tab Sản phẩm của bộ đó', async () => {
    const cols = Array.from({ length: 8 }, (_, i) => colOf(`c${i}`, `Bộ ${i + 1}`, 'NORMAL', 'GRID', i * 10 + 1, 2));
    mocks.getPublicStorefront.mockResolvedValue(storefront({ collections: cols }));
    renderPage('abcd1234');
    await title();
    expect(screen.getAllByTestId('shop-grid')).toHaveLength(6);
    fireEvent.click(screen.getByRole('tab', { name: 'Danh mục' }));
    expect(screen.getAllByRole('button', { name: /^Bộ \d, 2 món$/ })).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Bộ 8, 2 món' }));
    expect(screen.getByRole('button', { name: 'Bộ 8, bỏ lọc' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-ds="product-tile"]')).toHaveLength(2);
  });

  it('chỉ một bộ: không có tab Danh mục', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront(withItems));
    renderPage('abcd1234');
    await title();
    expect(screen.queryByRole('tab', { name: 'Danh mục' })).toBeNull();
  });

  it('bậc CTV: publicBadge=false không hiện huy hiệu, true thì hiện', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ ownerTier: { name: 'Tân binh', emoji: '🌱', publicBadge: false }, ...withItems }));
    const view = renderPage('abcd1234');
    await title();
    expect(screen.queryByText(/Tân binh/)).toBeNull();
    view.unmount();
    mocks.getPublicStorefront.mockResolvedValue(storefront({ ownerTier: { name: 'Bạc', emoji: '🥈', publicBadge: true }, ...withItems }));
    renderPage('abcd1234');
    expect(await screen.findByText(/Bạc/)).toBeInTheDocument();
  });

  it('chủ gian hàng: nút Chia sẻ nằm ở đầu shop, không còn thanh dính đáy', async () => {
    useAuthStore.setState({ user: { id: 'u1', role: 'AFFILIATE', referralCode: 'ABCD1234' } as never });
    mocks.getPublicStorefront.mockResolvedValue(storefront(withItems));
    renderPage('abcd1234');
    const share = await screen.findByRole('button', { name: 'Chia sẻ gian hàng' });
    expect(share).toHaveTextContent('Chia sẻ');
    expect(screen.getByTestId('shop-cover').parentElement!.contains(share)).toBe(true);
    expect(document.querySelector('[data-testid="sticky-bar"]')).toBeNull();
  });

  it('khách chưa đăng nhập vẫn thấy đủ: chỉ gọi API công khai của gian hàng', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ collections: four }));
    renderPage('abcd1234');
    await title();
    expect(mocks.getPublicStorefront).toHaveBeenCalledTimes(1);
    expect(tileCount('shop-rail')).toBe(10);
  });
});
