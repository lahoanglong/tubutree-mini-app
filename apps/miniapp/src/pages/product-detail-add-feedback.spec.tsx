import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// PL-12: thêm giỏ xong thì chính nút xác nhận ("Đã thêm" 1,2 giây), không còn thanh thông báo đầu màn khi không có ghi chú đi kèm.

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  addToCart: vi.fn(),
  applyCoupon: vi.fn(),
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar }),
  useNavigate: () => mocks.navigate,
}));
vi.mock('../services/shop-api', () => ({
  fetchProduct: mocks.fetchProduct,
  fetchRelated: vi.fn().mockResolvedValue([]),
  fetchBoughtTogether: vi.fn().mockResolvedValue([]),
  fetchReviews: vi.fn().mockResolvedValue({ data: [], count: 0, average: 0 }),
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  getCart: vi.fn().mockResolvedValue({ items: [], itemCount: 0 }),
  addToCart: mocks.addToCart,
  applyCoupon: mocks.applyCoupon,
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi'),
}));
vi.mock('../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn(), hasOA: false, openOAChat: vi.fn() }));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated', login: vi.fn(), user: { id: 'u1' } };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, freeshipThreshold: 200_000, subscribeDiscountPct: 0.1 }) }));
vi.mock('../components/reviews-section', () => ({ ReviewsSection: () => null, Stars: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/subscribe-sheet', () => ({ SubscribeSheet: () => null }));
vi.mock('../components/content-kit-sheet', () => ({ ContentKitSheet: () => null }));
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/ui/cart-badge', () => ({ CartBadge: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import ProductDetailPage from './product-detail';
import { useAnnouncements } from '../hooks/use-notify';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const CODE = 'GBUY-ABCD1234-WXYZ5678';
const PRODUCT = {
  id: 'p1', slug: 'xa-phong', brand: 'Cô Lan', name: 'Xà phòng sả chanh', shortDesc: null, description: 'Mô tả',
  images: [], thumbnail: null, basePrice: 100_000, salePrice: null, certifications: [], ingredients: null, sold: 0,
  variations: [{ id: 'v1', sku: 'S1', name: 'Mặc định', attributes: {}, retailPrice: 100_000, salePrice: null, stock: 5 }],
};
const cart = (over: Record<string, unknown> = {}) => ({
  items: [{ id: 'line1', variationId: 'v1', quantity: 1 }], itemCount: 1, couponCode: null, discount: 0, ...over,
});

function Announced() {
  return <output data-testid="announced">{useAnnouncements().status}</output>;
}

function renderPdp(state: Record<string, unknown> | null = { variationId: 'v1' }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Announced />
      <MemoryRouter initialEntries={[{ pathname: '/product/xa-phong', state }]} future={FUTURE}>
        <Routes>
          <Route path="/product/:slug" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const addBtn = () => screen.getByRole('button', { name: 'Thêm vào giỏ' });

async function openPdp(state?: Record<string, unknown> | null) {
  renderPdp(state);
  await advance(30);
  await advance(30);
}

describe('ProductDetailPage — nút thêm giỏ tự xác nhận (PL-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.fetchProduct.mockResolvedValue(PRODUCT);
    mocks.addToCart.mockResolvedValue(cart());
    mocks.applyCoupon.mockResolvedValue(cart({ couponCode: CODE, discount: 15_000 }));
  });
  afterEach(() => vi.useRealTimers());

  it('thêm giỏ xong: nút đổi thành "Đã thêm" kèm dấu tick đúng 1,2 giây rồi về "Thêm vào giỏ"', async () => {
    await openPdp();
    fireEvent.click(addBtn());
    await advance(30);
    const done = screen.getByRole('button', { name: 'Đã thêm' });
    expect(done.querySelector('svg')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Thêm vào giỏ' })).toBeNull();
    await advance(1_100);
    expect(screen.getByRole('button', { name: 'Đã thêm' })).toBeInTheDocument();
    await advance(100);
    expect(addBtn()).toBeInTheDocument();
  });

  it('không có ghi chú đi kèm: không mở thanh thông báo, chỉ ghi vùng đọc role=status "Đã thêm vào giỏ"', async () => {
    await openPdp();
    fireEvent.click(addBtn());
    await advance(200);
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
    expect(screen.getByTestId('announced')).toHaveTextContent('Đã thêm vào giỏ');
  });

  it('có ghi chú đi kèm (mã mua chung): vẫn báo bằng thanh thông báo như trước', async () => {
    await openPdp({ variationId: 'v1', applyCoupon: CODE });
    fireEvent.click(addBtn());
    await advance(200);
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Đã thêm vào giỏ') }));
  });

  it('bấm lần hai khi đang "Đã thêm": cửa sổ 1,2 giây tính lại từ lần bấm sau', async () => {
    await openPdp();
    fireEvent.click(addBtn());
    await advance(30);
    await advance(900);
    fireEvent.click(screen.getByRole('button', { name: 'Đã thêm' }));
    await advance(30);
    await advance(900);
    expect(screen.getByRole('button', { name: 'Đã thêm' })).toBeInTheDocument();
    await advance(400);
    expect(addBtn()).toBeInTheDocument();
  });

  it('thêm giỏ lỗi: nút không đổi thành "Đã thêm"', async () => {
    mocks.addToCart.mockRejectedValue(new Error('Chỉ còn 0 sản phẩm'));
    await openPdp();
    fireEvent.click(addBtn());
    await advance(30);
    expect(screen.queryByRole('button', { name: 'Đã thêm' })).toBeNull();
    expect(addBtn()).toBeInTheDocument();
  });
});

describe('ProductDetailPage — khoá chạm đúp Thêm vào giỏ / Mua ngay dùng chung một khoá ghi giỏ (W79A)', () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const buyBtn = () => screen.getByRole('button', { name: /^Mua ngay/ });
  const STORY_PRODUCT = { ...PRODUCT, ingredients: [{ name: 'Sả chanh', percentage: '12%' }] };
  const TWO_VARIATIONS = {
    ...PRODUCT,
    variations: [
      { id: 'v1', sku: 'S1', name: '250g', attributes: {}, retailPrice: 100_000, salePrice: null, stock: 5 },
      { id: 'v2', sku: 'S2', name: '500g', attributes: {}, retailPrice: 180_000, salePrice: null, stock: 5 },
    ],
  };
  const waitForPdp = async () => {
    renderPdp();
    await screen.findByRole('button', { name: 'Thêm vào giỏ' });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProduct.mockResolvedValue(PRODUCT);
    mocks.addToCart.mockResolvedValue(cart());
    mocks.applyCoupon.mockResolvedValue(cart({ couponCode: CODE, discount: 15_000 }));
  });

  it('Thêm vào giỏ rồi Mua ngay cùng một nhịp vẽ: chỉ một lần ghi giỏ và Mua ngay không chạy; xong thì khoá nhả, Mua ngay sau đó ghi giỏ và tới thanh toán', async () => {
    const pending = deferred<ReturnType<typeof cart>>();
    mocks.addToCart.mockReturnValueOnce(pending.promise);
    await waitForPdp();
    await act(async () => {
      fireEvent.click(addBtn());
      fireEvent.click(buyBtn());
    });
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(addBtn()).toHaveAttribute('aria-busy', 'true'));
    await act(async () => pending.resolve(cart()));
    expect(mocks.navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(addBtn()).not.toHaveAttribute('aria-busy'));
    fireEvent.click(buyBtn());
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/checkout', { state: { itemIds: ['line1'] } }));
    expect(mocks.addToCart).toHaveBeenCalledTimes(2);
  });

  it('Mua ngay rồi Thêm vào giỏ cùng một nhịp vẽ: một lần ghi giỏ, đi tới thanh toán đúng một lần', async () => {
    const pending = deferred<ReturnType<typeof cart>>();
    mocks.addToCart.mockReturnValueOnce(pending.promise);
    await waitForPdp();
    await act(async () => {
      fireEvent.click(buyBtn());
      fireEvent.click(addBtn());
    });
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Đang xử lý/ })).toHaveAttribute('aria-busy', 'true'));
    await act(async () => pending.resolve(cart()));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
    expect(mocks.navigate).toHaveBeenCalledWith('/checkout', { state: { itemIds: ['line1'] } });
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Thêm vào giỏ', () => addBtn()],
    ['Mua ngay', () => buyBtn()],
  ])('chạm đúp "%s" cách nhau một vi tác vụ (khoá Promise của Button đã nhả, trang chưa vẽ lại): chỉ một lần ghi giỏ', async (_name, pick) => {
    const pending = deferred<ReturnType<typeof cart>>();
    mocks.addToCart.mockReturnValueOnce(pending.promise);
    await waitForPdp();
    const btn = pick();
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      fireEvent.click(btn);
    });
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(cart()));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(1));
  });

  it('Mua ngay lỗi: báo lỗi, khoá chung được nhả nên Thêm vào giỏ ngay sau đó vẫn ghi giỏ', async () => {
    mocks.addToCart.mockRejectedValueOnce(new Error('Chỉ còn 0 sản phẩm')).mockResolvedValueOnce(cart());
    await waitForPdp();
    fireEvent.click(buyBtn());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text: 'Chỉ còn 0 sản phẩm' })));
    await waitFor(() => expect(buyBtn()).not.toHaveAttribute('aria-busy'));
    fireEvent.click(addBtn());
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Đã thêm' })).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  describe('khung câu chuyện toàn màn (nút trả về void nên Button không tự khoá)', () => {
    const openStory = async () => {
      mocks.fetchProduct.mockResolvedValue(STORY_PRODUCT);
      renderPdp();
      fireEvent.click(await screen.findByRole('button', { name: 'Xem câu chuyện sản phẩm' }));
      return within(await screen.findByRole('dialog', { name: 'Câu chuyện sản phẩm' }));
    };

    it('chạm đúp "Thêm vào giỏ" trong khung câu chuyện cùng nhịp vẽ: một lần ghi giỏ, khung đóng, báo Đã thêm', async () => {
      const pending = deferred<ReturnType<typeof cart>>();
      mocks.addToCart.mockReturnValueOnce(pending.promise);
      const dialog = await openStory();
      const add = dialog.getByTestId('story-add-to-cart');
      await act(async () => {
        fireEvent.click(add);
        fireEvent.click(add);
      });
      expect(mocks.addToCart).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: 'Câu chuyện sản phẩm' })).toBeNull();
      await act(async () => pending.resolve(cart()));
      expect(await screen.findByRole('button', { name: 'Đã thêm' })).toBeInTheDocument();
      expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    });

    it('chạm "Thêm vào giỏ" rồi "Mua ngay" trong khung câu chuyện cùng nhịp vẽ: chỉ nút đầu ghi giỏ', async () => {
      const pending = deferred<ReturnType<typeof cart>>();
      mocks.addToCart.mockReturnValueOnce(pending.promise);
      const dialog = await openStory();
      await act(async () => {
        fireEvent.click(dialog.getByTestId('story-add-to-cart'));
        fireEvent.click(dialog.getByTestId('story-buy-now'));
      });
      expect(mocks.addToCart).toHaveBeenCalledTimes(1);
      await act(async () => pending.resolve(cart()));
      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(await screen.findByRole('button', { name: 'Đã thêm' })).toBeInTheDocument();
    });
  });

  it('bảng chọn phân loại: chạm đúp nút xác nhận cùng nhịp vẽ chỉ ghi giỏ một lần, bảng đóng và chọn đúng phân loại', async () => {
    const pending = deferred<ReturnType<typeof cart>>();
    mocks.addToCart.mockReturnValueOnce(pending.promise);
    mocks.fetchProduct.mockResolvedValue(TWO_VARIATIONS);
    renderPdp(null);
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào giỏ' }));
    const sheet = within(await screen.findByRole('dialog', { name: 'Chọn phân loại' }));
    fireEvent.click(sheet.getByRole('button', { name: /500g/ }));
    const confirm = sheet.getByRole('button', { name: /^Thêm vào giỏ · / });
    // Cách nhau một vi tác vụ: khoá Promise của Button đã nhả nhưng trang chưa vẽ lại (isPending, sheetMode còn cũ), chỉ khoá ghi giỏ chặn được.
    await act(async () => {
      fireEvent.click(confirm);
      await Promise.resolve();
      fireEvent.click(confirm);
    });
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    expect(mocks.addToCart).toHaveBeenCalledWith('v2', 1);
    await act(async () => pending.resolve(cart()));
    expect(await screen.findByRole('button', { name: 'Đã thêm' })).toBeInTheDocument();
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
  });
});
