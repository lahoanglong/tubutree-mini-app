import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock, type MockInstance } from 'vitest';

// PL-12: thêm giỏ xong thì chính nút xác nhận ("Đã thêm" 1,2 giây), không còn thanh thông báo đầu màn khi không có ghi chú đi kèm.

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  addToCart: vi.fn(),
  applyCoupon: vi.fn(),
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  createGroupBuy: vi.fn(),
  getProductBundles: vi.fn().mockResolvedValue({ combos: [], addons: [] }),
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
// Trang giữ khung chờ tới khi bộ Combo/Mua kèm về (`useBundlesWait`): không mock thì đó là một request thật, về sớm hay muộn tuỳ máy, còn đồng hồ giả chỉ chạy tay
// nên `openPdp` có lúc tới nút Thêm vào giỏ trước khi trang hết chờ.
vi.mock('../services/bundle-api', () => ({ getProductBundles: mocks.getProductBundles }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: mocks.createGroupBuy }));
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
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';

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

  it('đang Thêm vào giỏ thì Mua ngay báo aria-disabled (không disabled) và hết báo khi xong', async () => {
    const pending = deferred<ReturnType<typeof cart>>();
    mocks.addToCart.mockReturnValueOnce(pending.promise);
    await waitForPdp();
    expect(buyBtn()).not.toHaveAttribute('aria-disabled');
    fireEvent.click(addBtn());
    await waitFor(() => expect(buyBtn()).toHaveAttribute('aria-disabled', 'true'));
    expect(buyBtn()).not.toBeDisabled();
    expect(buyBtn()).not.toHaveAttribute('aria-busy');
    await act(async () => pending.resolve(cart()));
    await waitFor(() => expect(buyBtn()).not.toHaveAttribute('aria-disabled'));
  });

  it('đang Mua ngay thì Thêm vào giỏ báo aria-disabled (không disabled) và hết báo khi xong', async () => {
    const pending = deferred<ReturnType<typeof cart>>();
    mocks.addToCart.mockReturnValueOnce(pending.promise);
    await waitForPdp();
    expect(addBtn()).not.toHaveAttribute('aria-disabled');
    fireEvent.click(buyBtn());
    await waitFor(() => expect(addBtn()).toHaveAttribute('aria-disabled', 'true'));
    expect(addBtn()).not.toBeDisabled();
    expect(addBtn()).not.toHaveAttribute('aria-busy');
    await act(async () => pending.resolve(cart()));
    await waitFor(() => expect(addBtn()).not.toHaveAttribute('aria-disabled'));
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

// W113A: lệnh ghi giỏ/mở nhóm bị máy chủ từ chối vì tồn kho hay trạng thái sản phẩm đã đổi (400/404/409) thì nút giữ khoá tới khi dữ liệu làm mới về (tối đa LOCK_REFRESH_WAIT_MS),
// kẻo bấm lại trên số cũ nhận đúng lỗi đó. Mất mạng, quá hạn, 401, 5xx không nói gì về trạng thái thật: không tải lại, nhả ngay.
describe('ProductDetailPage — máy chủ từ chối thì giữ khoá tới khi dữ liệu làm mới về (W113A)', () => {
  type Refresh = () => Promise<unknown>;
  type Opened = { invalidate: MockInstance<QueryClient['invalidateQueries']>; trigger: () => void; busy: () => boolean };
  type Case = {
    name: string;
    write: Mock;
    keys: string[][];
    succeed: unknown;
    open: (refresh: Refresh) => Promise<Opened>;
  };

  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter((c) => c[0].type === 'error').length;
  // TanStack báo cache qua setTimeout(0): đợi một nhịp để `isPending` kịp về false sau khi lệnh xong.
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const renderLive = (refresh: Refresh, state: Record<string, unknown> | null = { variationId: 'v1' }) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[{ pathname: '/product/xa-phong', state }]} future={FUTURE}>
          <Routes>
            <Route path="/product/:slug" element={<ProductDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return invalidate;
  };
  const buyBtn = () => screen.getByRole('button', { name: /^(Mua ngay|Đang xử lý)/ });
  const groupBtn = () => screen.getByRole('button', { name: /Mở nhóm mua chung|Đang mở nhóm/ });

  const CASES: Case[] = [
    {
      name: 'Thêm vào giỏ',
      write: mocks.addToCart,
      keys: [['product', 'xa-phong'], ['cart']],
      succeed: cart(),
      open: async (refresh) => {
        const invalidate = renderLive(refresh);
        await screen.findByRole('button', { name: 'Thêm vào giỏ' });
        return { invalidate, trigger: () => fireEvent.click(addBtn()), busy: () => addBtn().getAttribute('aria-busy') === 'true' };
      },
    },
    {
      name: 'Mua ngay',
      write: mocks.addToCart,
      keys: [['product', 'xa-phong'], ['cart']],
      succeed: cart(),
      open: async (refresh) => {
        const invalidate = renderLive(refresh);
        await screen.findByRole('button', { name: /^Mua ngay/ });
        return { invalidate, trigger: () => fireEvent.click(buyBtn()), busy: () => screen.queryByRole('button', { name: /^Đang xử lý/ }) !== null };
      },
    },
    {
      name: 'Mở nhóm mua chung',
      write: mocks.createGroupBuy,
      keys: [['group-buy'], ['product', 'xa-phong']],
      succeed: { id: 'g1' },
      open: async (refresh) => {
        const invalidate = renderLive(refresh);
        await screen.findByRole('button', { name: /Mở nhóm mua chung/ });
        return { invalidate, trigger: () => fireEvent.click(groupBtn()), busy: () => screen.queryByRole('button', { name: /Đang mở nhóm/ }) !== null };
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addToCart.mockReset();
    mocks.createGroupBuy.mockReset();
    mocks.fetchProduct.mockResolvedValue(PRODUCT);
    mocks.applyCoupon.mockResolvedValue(cart({ couponCode: CODE, discount: 15_000 }));
  });

  describe.each(CASES)('$name', (c) => {
    it.each([
      [400, 'Chỉ còn 0 sản phẩm'],
      [404, 'Sản phẩm không còn bán'],
      [409, 'Vừa có thay đổi, bạn thử lại nhé'],
    ])('bị từ chối %i: báo lỗi một lần, tải lại đúng khoá, nút giữ khoá tới khi dữ liệu về rồi mới nhả', async (status, message) => {
      c.write.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue(c.succeed);
      const refresh = deferred();
      const { invalidate, trigger, busy } = await c.open(() => refresh.promise);
      trigger();
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: message, type: 'error' })));
      expect(errorSnackbars()).toBe(1);
      expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual(c.keys.map((queryKey) => ({ queryKey })));
      // Đã có lời báo lỗi mà dữ liệu chưa về: nút vẫn bận, chạm thêm không gửi lần hai.
      expect(busy()).toBe(true);
      await act(async () => {
        trigger();
        trigger();
      });
      expect(c.write).toHaveBeenCalledTimes(1);
      await act(async () => refresh.resolve());
      await settle();
      await waitFor(() => expect(busy()).toBe(false));
      expect(errorSnackbars()).toBe(1);
      trigger();
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });

    it.each([
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
      ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
      ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
      ['hết phiên 401', serverError('Unauthorized', 401)],
    ])('%s: không giữ khoá chờ tải lại, khoá nhả ngay', async (_label, error) => {
      c.write.mockRejectedValueOnce(error).mockResolvedValue(c.succeed);
      const { invalidate, trigger, busy } = await c.open(() => new Promise(() => undefined));
      trigger();
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await waitFor(() => expect(busy()).toBe(false));
      expect(invalidate).not.toHaveBeenCalled();
      trigger();
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });

    it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
      c.write.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue(c.succeed);
      const { trigger, busy } = await c.open(() => new Promise(() => undefined));
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        trigger();
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
        });
        expect(busy()).toBe(true);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(600);
        });
        await waitFor(() => expect(busy()).toBe(false));
      } finally {
        vi.useRealTimers();
      }
      trigger();
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });
  });

  describe('Mua ngay rồi bị từ chối: ở lại trang, không sang thanh toán', () => {
    it('lỗi 409: không điều hướng, "Thêm vào giỏ" ghi giỏ được sau khi dữ liệu về', async () => {
      mocks.addToCart.mockRejectedValueOnce(serverError('Chỉ còn 0 sản phẩm', 409)).mockResolvedValue(cart());
      const refresh = deferred();
      renderLive(() => refresh.promise);
      fireEvent.click(await screen.findByRole('button', { name: /^Mua ngay/ }));
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      expect(mocks.navigate).not.toHaveBeenCalled();
      // Cả hai nút ghi giỏ dùng chung một khoá: nút kia cũng bị bỏ qua tới khi dữ liệu về.
      await act(async () => {
        fireEvent.click(addBtn());
      });
      expect(mocks.addToCart).toHaveBeenCalledTimes(1);
      await act(async () => refresh.resolve());
      await settle();
      await waitFor(() => expect(screen.queryByRole('button', { name: /^Đang xử lý/ })).toBeNull());
      fireEvent.click(addBtn());
      await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
      expect(mocks.navigate).not.toHaveBeenCalled();
    });
  });

  describe('mã mua chung bị từ chối sau khi thêm giỏ xong', () => {
    const open = async (refresh: Refresh) => {
      const invalidate = renderLive(refresh, { variationId: 'v1', applyCoupon: CODE });
      await screen.findByRole('button', { name: 'Thêm vào giỏ' });
      return invalidate;
    };

    it.each([
      [400, 'Mã đã hết lượt'],
      [404, 'Mã không còn'],
      [409, 'Mã vừa đổi'],
    ])('máy chủ từ chối mã %i: giỏ vẫn thêm, tải lại danh sách mã và báo giá rồi mới nhả nút', async (status, message) => {
      mocks.addToCart.mockResolvedValue(cart());
      mocks.applyCoupon.mockRejectedValueOnce(serverError(message, status));
      const refresh = deferred();
      const invalidate = await open(() => refresh.promise);
      fireEvent.click(addBtn());
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', text: expect.stringContaining('Đã thêm vào giỏ') })));
      expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual([{ queryKey: ['coupons'] }, { queryKey: ['quote'] }]);
      expect(screen.getByRole('button', { name: 'Đã thêm' })).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Đã thêm' }));
      });
      expect(mocks.addToCart).toHaveBeenCalledTimes(1);
      await act(async () => refresh.resolve());
      await settle();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Đã thêm' })).not.toHaveAttribute('aria-busy'));
    });

    it.each([
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
      ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
      ['hết phiên 401', serverError('Unauthorized', 401)],
    ])('mã lỗi do %s: không tải lại, nhả ngay', async (_label, error) => {
      mocks.addToCart.mockResolvedValue(cart());
      mocks.applyCoupon.mockRejectedValueOnce(error);
      const invalidate = await open(() => new Promise(() => undefined));
      fireEvent.click(addBtn());
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' })));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Đã thêm' })).not.toHaveAttribute('aria-busy'));
      expect(invalidate).not.toHaveBeenCalled();
    });
  });
});
