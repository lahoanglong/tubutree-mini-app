import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPublicStorefront: vi.fn(),
  shareSheetProps: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
}));
vi.mock('../services/storefront-api', () => ({ getPublicStorefront: mocks.getPublicStorefront }));
vi.mock('../components/share-sheet', () => ({
  ShareSheet: (props: Record<string, unknown>) => {
    mocks.shareSheetProps(props);
    return null;
  },
}));
vi.mock('../components/store-page-shell', () => ({
  StorePageShell: ({ title, coverUrl, avatarUrl, badges, stickyBar, children }: { title: string; coverUrl?: string | null; avatarUrl?: string | null; badges?: ReactNode; stickyBar?: ReactNode; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      <span data-testid="shell-urls">{`${coverUrl ?? ''}|${avatarUrl ?? ''}`}</span>
      {badges}
      {children}
      {stickyBar}
    </div>
  ),
}));

import { useStorefrontContext } from '../store/storefront-context';
import { useAuthStore } from '../store/auth';
import StorefrontViewPage from './storefront-view';

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
    await screen.findByText('Gian hàng Lan');
    await waitFor(() => expect(useStorefrontContext.getState().referralCode).toBe('ABCD1234'));
    expect(useStorefrontContext.getState().slug).toBe('lan-shop');
    expect(mocks.shareSheetProps).toHaveBeenCalledWith(expect.objectContaining({ slug: 'lan-shop', referralCode: 'ABCD1234' }));
  });

  it('gian hàng đối tác (MERCHANT): API không trả mã → không có mã giới thiệu', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront({ type: 'MERCHANT', slug: 'doi-tac', referralCode: null }));
    renderPage('doi-tac');
    await screen.findByText('Gian hàng Lan');
    await waitFor(() => expect(useStorefrontContext.getState().slug).toBe('doi-tac'));
    expect(useStorefrontContext.getState().referralCode).toBeNull();
    expect(mocks.shareSheetProps).toHaveBeenCalledWith(expect.objectContaining({ referralCode: null }));
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
    await screen.findByText('Gian hàng Lan');
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

  it('khách (không phải chủ): nút đáy là "Xem sản phẩm" dẫn tới /browse, không có nút chia sẻ', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront(withItems));
    renderPage('abcd1234');
    fireEvent.click(await screen.findByRole('button', { name: 'Xem sản phẩm' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
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
    await screen.findByRole('button', { name: 'Xem sản phẩm' });
    expect(screen.queryByText('Gian hàng mẫu')).not.toBeInTheDocument();
  });

  it('khách xem gian hàng CTV của người khác: cuối trang có lối "Mở gian hàng" dẫn tới /storefront; chủ gian hàng và gian hàng nhãn thì không', async () => {
    mocks.getPublicStorefront.mockResolvedValue(storefront(withItems));
    const view = renderPage('abcd1234');
    expect(await screen.findByText('Bạn cũng muốn có gian hàng như này?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mở gian hàng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/storefront');
    view.unmount();
    useAuthStore.setState({ user: { id: 'u1', role: 'AFFILIATE', referralCode: 'ABCD1234' } as never });
    renderPage('abcd1234');
    await screen.findByRole('button', { name: 'Chia sẻ gian hàng' });
    expect(screen.queryByText('Bạn cũng muốn có gian hàng như này?')).not.toBeInTheDocument();
  });

  it('người khác đăng nhập (mã khác): vẫn là khách', async () => {
    useAuthStore.setState({ user: { id: 'u2', role: 'CUSTOMER', referralCode: 'ZZZZ9999' } as never });
    mocks.getPublicStorefront.mockResolvedValue(storefront(withItems));
    renderPage('abcd1234');
    expect(await screen.findByRole('button', { name: 'Xem sản phẩm' })).toBeInTheDocument();
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
    const urls = (await screen.findByTestId('shell-urls')).textContent!;
    expect(urls).toMatch(/^https?:\/\/[^|]+\/storefront\/image\/sf1\/cover\?v=a\|https:\/\/cdn\.x\/a\.jpg$/);
  });
});
