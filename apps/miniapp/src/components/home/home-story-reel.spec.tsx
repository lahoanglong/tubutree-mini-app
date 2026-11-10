import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { REEL_SEEN_KEY } from '@tubutree/app-core/commerce/story-reel';

const mocks = vi.hoisted(() => ({
  fetchProducts: vi.fn(),
  fetchProduct: vi.fn(),
  addToCart: vi.fn(),
  fetchFlash: vi.fn(),
  getCart: vi.fn(),
  notify: vi.fn(),
  login: vi.fn(),
  auth: { status: 'authenticated' as string },
}));
vi.mock('../../services/shop-api', () => ({
  fetchProducts: mocks.fetchProducts,
  fetchProduct: mocks.fetchProduct,
  addToCart: mocks.addToCart,
  fetchActiveFlashSales: mocks.fetchFlash,
  fetchFlashAllowance: async () => [],
  getCart: mocks.getCart,
}));
vi.mock('../../hooks/use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../../hooks/use-login-notice', () => ({ useLoginWithNotice: () => mocks.login }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../store/auth', () => ({
  useAuthStore: Object.assign((sel: (s: { status: string }) => unknown) => sel(mocks.auth), { getState: () => mocks.auth }),
}));
vi.mock('../variation-sheet', () => ({
  VariationSheet: (p: { open: boolean; initialId: string | null; variations: { id: string }[]; onConfirm: (v: { id: string }, qty: number) => Promise<void> | void; onClose: () => void }) =>
    p.open ? (
      <div data-testid="variation-sheet" data-initial={p.initialId ?? ''}>
        <button type="button" onClick={() => void p.onConfirm(p.variations[1]!, 2)}>
          xác nhận phân loại
        </button>
        <button type="button" onClick={p.onClose}>
          đóng bảng
        </button>
      </div>
    ) : null,
}));

import { resetReelSeenMemory } from '../../utils/reel-seen-storage';
import { HttpError } from '../../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../../utils/settle-within';
import { HomeStoryReel } from './home-story-reel';

const card = (n: number, over: Record<string, unknown> = {}) => ({
  id: `p${n}`,
  slug: `mon-${n}`,
  brand: 'Tubu',
  name: `Món ${n}`,
  thumbnail: null,
  basePrice: 50_000,
  salePrice: null,
  repVariationId: `v${n}`,
  isFeatured: false,
  inStock: true,
  ...over,
});
const PAGE = (items: ReturnType<typeof card>[]) => ({ data: items, meta: { page: 1, limit: 8, total: items.length } });
const FOUR = () => PAGE([1, 2, 3, 4].map((n) => card(n)));

const variation = (id: string, stock = 5) => ({ id, sku: id, name: `Loại ${id}`, attributes: {}, retailPrice: 50_000, salePrice: null, stock });
const detail = (n: number, variations = [variation(`v${n}`)], over: Record<string, unknown> = {}) => ({
  id: `p${n}`,
  slug: `mon-${n}`,
  brand: 'Tubu',
  name: `Món ${n}`,
  shortDesc: null,
  description: '',
  images: [],
  thumbnail: null,
  basePrice: 50_000,
  salePrice: null,
  certifications: [],
  ingredients: null,
  variations,
  ...over,
});

function renderHost() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <HomeStoryReel />
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}
const ring = (n: number) => screen.getByRole('button', { name: new RegExp(`^Story Món ${n},`) });
const dialogReady = () => screen.findByTestId('story-add-to-cart');

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  resetReelSeenMemory();
  document.body.style.overflow = '';
  mocks.auth.status = 'authenticated';
  mocks.fetchProducts.mockResolvedValue(FOUR());
  mocks.fetchProduct.mockImplementation(async (slug: string) => detail(Number(slug.split('-')[1])));
  mocks.fetchFlash.mockResolvedValue([]);
  mocks.getCart.mockResolvedValue({ items: [], itemCount: 0 });
  mocks.addToCart.mockResolvedValue({ items: [{ id: 'l1' }], itemCount: 1 });
  mocks.login.mockResolvedValue(undefined);
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
});
afterEach(() => vi.unstubAllGlobals());

describe('HomeStoryReel: dải Story', () => {
  it('đang tải: khung chờ cao đúng khối thật, chưa có nút', () => {
    mocks.fetchProducts.mockReturnValue(new Promise(() => {}));
    renderHost();
    expect(screen.getByTestId('story-reel-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('có món: mỗi món một vòng, theo thứ tự Bán chạy nhất; lấy đúng thước đo 30 ngày', async () => {
    renderHost();
    expect(await screen.findAllByTestId('story-reel-item')).toHaveLength(4);
    expect(mocks.fetchProducts).toHaveBeenCalledWith(expect.objectContaining({ sort: 'best_seller_30d' }));
    expect(screen.getAllByTestId('story-reel-item').map((b) => b.textContent)).toEqual(['Story Món 1', 'Story Món 2', 'Story Món 3', 'Story Món 4']);
    expect(screen.queryByTestId('story-reel-skeleton')).toBeNull();
  });

  it('món hết hàng bị bỏ; còn dưới 3 món thì dải biến mất (không để tiêu đề trơ)', async () => {
    mocks.fetchProducts.mockResolvedValue(PAGE([card(1), card(2, { inStock: false }), card(3, { inStock: false }), card(4)]));
    const { container } = renderHost();
    await waitFor(() => expect(mocks.fetchProducts).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('story-reel-skeleton')).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });

  it('API lỗi: không vẽ gì, không ném', async () => {
    mocks.fetchProducts.mockRejectedValue(new Error('boom'));
    const { container } = renderHost();
    await waitFor(() => expect(screen.queryByTestId('story-reel-skeleton')).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });

  it('tối đa 8 vòng dù nguồn trả nhiều hơn', async () => {
    mocks.fetchProducts.mockResolvedValue(PAGE(Array.from({ length: 12 }, (_, i) => card(i + 1))));
    renderHost();
    expect(await screen.findAllByTestId('story-reel-item')).toHaveLength(8);
  });

  it('chạm xuống một vòng tải trước chi tiết món (Reel mở ngay)', async () => {
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    expect(mocks.fetchProduct).not.toHaveBeenCalled();
    fireEvent.pointerDown(ring(2));
    await waitFor(() => expect(mocks.fetchProduct).toHaveBeenCalledWith('mon-2'));
  });

  it('đã xem từ phiên trước (sessionStorage): vòng vẽ xám ngay từ đầu', async () => {
    sessionStorage.setItem(REEL_SEEN_KEY, JSON.stringify(['mon-3']));
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    expect(screen.getAllByTestId('story-reel-item').map((b) => b.getAttribute('data-seen'))).toEqual(['false', 'false', 'true', 'false']);
  });
});

describe('HomeStoryReel: mở Reel', () => {
  it('chạm vòng: khung chờ có nút đóng, rồi Reel toàn màn với "Thêm vào giỏ · giá", vị trí "2/4" và nút kế', async () => {
    const pending = new Map<string, () => void>();
    mocks.fetchProduct.mockImplementation(
      (slug: string) => new Promise((r) => { pending.set(slug, () => r(detail(Number(slug.split('-')[1])))); }),
    );
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(2));
    expect(await screen.findByTestId('reel-wait')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('reel-wait-close')).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    act(() => pending.get('mon-2')!());
    const add = await dialogReady();
    expect(screen.queryByTestId('reel-wait')).toBeNull();
    expect(add).toHaveTextContent('Thêm vào giỏ · 50.000đ');
    expect(screen.getByTestId('story-position')).toHaveTextContent('2/4');
    expect(screen.getByTestId('story-next')).toBeInTheDocument();
    expect(mocks.fetchProduct).toHaveBeenCalledWith('mon-2');
  });

  it('mở Reel là đánh dấu đã xem: ghi sessionStorage và vòng đổi sang xám + "Xem lại"', async () => {
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    await dialogReady();
    expect(JSON.parse(sessionStorage.getItem(REEL_SEEN_KEY)!)).toEqual(['mon-1']);
    fireEvent.click(screen.getByTestId('story-close'));
    await waitFor(() => expect(screen.queryByTestId('story-add-to-cart')).toBeNull());
    expect(screen.getByRole('button', { name: 'Story Món 1, đã xem, mở lại' })).toHaveAttribute('data-seen', 'true');
    expect(screen.getByRole('button', { name: 'Story Món 2, mở câu chuyện' })).toHaveAttribute('data-seen', 'false');
    expect(document.body.style.overflow).toBe('');
  });

  it('khung chờ đóng được bằng nút đóng và bằng Esc (chi tiết chưa về)', async () => {
    mocks.fetchProduct.mockReturnValue(new Promise(() => {}));
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    fireEvent.click(await screen.findByTestId('reel-wait-close'));
    await waitFor(() => expect(screen.queryByTestId('reel-wait')).toBeNull());
    expect(document.body.style.overflow).toBe('');
    fireEvent.click(ring(1));
    await screen.findByTestId('reel-wait');
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByTestId('reel-wait')).toBeNull());
  });

  it('"Câu chuyện kế": sang món kế (đánh dấu đã xem), tải trước món sau nữa; món cuối dải không có nút kế', async () => {
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(3));
    await dialogReady();
    await waitFor(() => expect(mocks.fetchProduct).toHaveBeenCalledWith('mon-4'));
    fireEvent.click(screen.getByTestId('story-next'));
    await waitFor(() => expect(screen.getByTestId('story-position')).toHaveTextContent('4/4'));
    expect(screen.queryByTestId('story-next')).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(REEL_SEEN_KEY)!)).toEqual(['mon-3', 'mon-4']);
  });

  it('chi tiết lỗi tải: báo "Chưa mở được câu chuyện…" và đóng khung, không treo màn chờ', async () => {
    mocks.fetchProduct.mockRejectedValue(new Error('boom'));
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith({ text: 'Chưa mở được câu chuyện. Bạn thử lại nhé.', type: 'error' }));
    await waitFor(() => expect(screen.queryByTestId('reel-wait')).toBeNull());
    expect(document.body.style.overflow).toBe('');
  });

  it('Admin đã tắt câu chuyện của món: nhảy thẳng sang món kế, không dựng kịch bản dự phòng', async () => {
    mocks.fetchProduct.mockImplementation(async (slug: string) => {
      const n = Number(slug.split('-')[1]);
      return detail(n, [variation(`v${n}`)], n === 2 ? { storyConfig: { version: 1, enabled: false, scenes: [] } } : {});
    });
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(2));
    await waitFor(() => expect(screen.getByTestId('story-position')).toHaveTextContent('3/4'));
    expect(screen.queryByText('Món Tubu Tree chọn')).toBeInTheDocument();
  });

  it('món cuối dải bị tắt câu chuyện: đóng khung (không còn món kế để nhảy)', async () => {
    mocks.fetchProduct.mockImplementation(async (slug: string) => detail(4, [variation('v4')], { slug, storyConfig: { version: 1, enabled: false, scenes: [] } }));
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(4));
    await waitFor(() => expect(screen.queryByTestId('reel-wait')).toBeNull());
    expect(screen.queryByTestId('story-add-to-cart')).toBeNull();
  });

  it('món hết sạch hàng: nút thêm khoá, ghi "Hết hàng", không gọi giỏ', async () => {
    mocks.fetchProduct.mockResolvedValue(detail(1, [variation('v1', 0)]));
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    const add = await dialogReady();
    expect(add).toBeDisabled();
    expect(add).toHaveTextContent('Hết hàng');
    fireEvent.click(add);
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });
});

describe('HomeStoryReel: thêm vào giỏ từ Reel', () => {
  it('một chạm với món một phân loại: đóng Reel, thêm thẳng 1 cái, ghi giỏ vào cache, báo thành công', async () => {
    const { qc } = renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    fireEvent.click(await dialogReady());
    expect(screen.queryByTestId('story-add-to-cart')).toBeNull();
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
    expect(qc.getQueryData(['cart', null])).toEqual({ items: [{ id: 'l1' }], itemCount: 1 });
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('món từ hai phân loại: đóng Reel rồi mở bảng chọn phân loại (mở sẵn phân loại đại diện của thẻ), chưa thêm gì', async () => {
    mocks.fetchProduct.mockResolvedValue(detail(1, [variation('v1'), variation('v1b'), variation('v1c')]));
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    fireEvent.click(await dialogReady());
    expect(screen.queryByTestId('story-add-to-cart')).toBeNull();
    expect(await screen.findByTestId('variation-sheet')).toHaveAttribute('data-initial', 'v1');
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('phân loại đại diện vừa hết hàng, còn nhiều loại khác: mở bảng chọn phân loại, chỉ thêm khi khách xác nhận', async () => {
    mocks.fetchProduct.mockResolvedValue(detail(1, [variation('v1', 0), variation('v1b'), variation('v1c')]));
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    fireEvent.click(await dialogReady());
    const sheet = await screen.findByTestId('variation-sheet');
    expect(sheet).toHaveAttribute('data-initial', 'v1');
    expect(mocks.addToCart).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'xác nhận phân loại' }));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v1b', 2));
    await waitFor(() => expect(screen.queryByTestId('variation-sheet')).toBeNull());
  });

  it('thẻ từ API cũ không mang phân loại đại diện, sản phẩm một phân loại: thêm thẳng phân loại duy nhất', async () => {
    mocks.fetchProducts.mockResolvedValue(PAGE([card(1, { repVariationId: undefined }), card(2), card(3)]));
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    fireEvent.click(await dialogReady());
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1));
    expect(screen.queryByTestId('variation-sheet')).toBeNull();
  });

  it('thẻ từ API cũ không mang phân loại đại diện, sản phẩm nhiều phân loại: hỏi khách chọn', async () => {
    mocks.fetchProducts.mockResolvedValue(PAGE([card(1, { repVariationId: undefined }), card(2), card(3)]));
    mocks.fetchProduct.mockResolvedValue(detail(1, [variation('v1'), variation('v1b')]));
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    fireEvent.click(await dialogReady());
    expect(await screen.findByTestId('variation-sheet')).toHaveAttribute('data-initial', '');
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('Giờ vàng đang thắng trên thẻ: nút ghi giá Giờ vàng; món một phân loại thêm thẳng phân loại đó', async () => {
    mocks.fetchFlash.mockResolvedValue([{ productSlug: 'mon-1', variationId: 'v1-flash', flashPrice: 30_000, retailPrice: 50_000, endAt: '2099-01-01T00:00:00Z' }]);
    mocks.fetchProduct.mockResolvedValue(detail(1, [variation('v1-flash')]));
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    await waitFor(() => expect(mocks.fetchFlash).toHaveBeenCalled());
    fireEvent.click(ring(1));
    const add = await dialogReady();
    await waitFor(() => expect(add).toHaveTextContent('Thêm vào giỏ · 30.000đ'));
    fireEvent.click(add);
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v1-flash', 1));
  });

  it('món CTV ghim phân loại, sản phẩm nhiều phân loại: bảng chọn mở sẵn đúng phân loại ghim', async () => {
    mocks.fetchProducts.mockResolvedValue(PAGE([card(1, { pinnedVariationId: 'v1b' }), card(2), card(3)]));
    mocks.fetchProduct.mockResolvedValue(detail(1, [variation('v1'), variation('v1b')]));
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    fireEvent.click(await dialogReady());
    expect(await screen.findByTestId('variation-sheet')).toHaveAttribute('data-initial', 'v1b');
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('chưa đăng nhập: đóng Reel, đăng nhập, rồi thêm khi đã vào được', async () => {
    mocks.auth.status = 'guest';
    mocks.login.mockImplementation(async () => {
      mocks.auth.status = 'authenticated';
    });
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    fireEvent.click(await dialogReady());
    await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1));
  });

  it('đăng nhập không thành: không thêm giỏ, không báo "đã thêm"', async () => {
    mocks.auth.status = 'guest';
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    fireEvent.click(await dialogReady());
    await waitFor(() => expect(mocks.login).toHaveBeenCalled());
    await act(async () => {});
    expect(mocks.addToCart).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('thêm giỏ lỗi: báo lỗi cho khách, không ghi giỏ vào cache', async () => {
    mocks.addToCart.mockRejectedValueOnce(new Error('boom'));
    const { qc } = renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    fireEvent.click(await dialogReady());
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(qc.getQueryData(['cart', null])).toBeUndefined();
  });
});

describe('HomeStoryReel: thêm giỏ từ Reel khoá chạm đúp (W70A)', () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it('chạm đúp "Thêm vào giỏ" trong cùng một khung hình chỉ thêm một lần', async () => {
    const d = deferred<{ items: { id: string }[]; itemCount: number }>();
    mocks.addToCart.mockReturnValueOnce(d.promise);
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    const add = await dialogReady();
    await act(async () => {
      fireEvent.click(add);
      fireEvent.click(add);
    });
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ items: [{ id: 'l1' }], itemCount: 1 }));
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1));
  });

  it('chưa đăng nhập, chạm đúp: chỉ mở một lần đăng nhập và thêm một lần', async () => {
    const login = deferred<void>();
    mocks.auth.status = 'guest';
    mocks.login.mockImplementation(async () => {
      await login.promise;
      mocks.auth.status = 'authenticated';
    });
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    const add = await dialogReady();
    await act(async () => {
      fireEvent.click(add);
      fireEvent.click(add);
    });
    expect(mocks.login).toHaveBeenCalledTimes(1);
    await act(async () => login.resolve());
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(1));
  });

  it('bảng chọn phân loại: chạm đúp "xác nhận" chỉ thêm một lần', async () => {
    mocks.fetchProduct.mockResolvedValue(detail(1, [variation('v1'), variation('v1b')]));
    const d = deferred<{ items: { id: string }[]; itemCount: number }>();
    mocks.addToCart.mockReturnValueOnce(d.promise);
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    fireEvent.click(await dialogReady());
    const confirm = await screen.findByRole('button', { name: 'xác nhận phân loại' });
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ items: [{ id: 'l1' }], itemCount: 1 }));
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
  });

  it('món A còn đang thêm: món B vẫn thêm được (khoá theo từng món, không nuốt cú chạm)', async () => {
    const d = deferred<{ items: { id: string }[]; itemCount: number }>();
    mocks.addToCart.mockReturnValueOnce(d.promise);
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    fireEvent.click(await dialogReady());
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1));
    fireEvent.click(ring(2));
    fireEvent.click(await dialogReady());
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v2', 1));
    await act(async () => d.resolve({ items: [{ id: 'l1' }], itemCount: 1 }));
  });

  it('khoá nhả sau khi thêm lỗi: mở Reel lại thêm được lần nữa', async () => {
    mocks.addToCart.mockRejectedValueOnce(new Error('boom'));
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    fireEvent.click(await dialogReady());
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    fireEvent.click(ring(1));
    fireEvent.click(await dialogReady());
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
  });

  it('đăng nhập không thành: khoá nhả, lần chạm sau mở đăng nhập lại', async () => {
    mocks.auth.status = 'guest';
    renderHost();
    await screen.findAllByTestId('story-reel-item');
    fireEvent.click(ring(1));
    fireEvent.click(await dialogReady());
    await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
    await act(async () => {});
    fireEvent.click(ring(1));
    fireEvent.click(await dialogReady());
    await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(2));
  });
});


// W113A: thêm giỏ từ Reel bị máy chủ từ chối vì tồn kho/giá đã đổi (400/404/409) thì khoá của món (và bảng chọn phân loại) giữ tới khi giỏ, chi tiết món và kệ Bán chạy nhất làm mới về
// (tối đa LOCK_REFRESH_WAIT_MS). Mất mạng, quá hạn, 401, 5xx không nói gì về trạng thái thật: không tải lại, nhả ngay.
describe('HomeStoryReel: máy chủ từ chối thì giữ khoá tới khi dữ liệu làm mới về (W113A)', () => {
  type Refresh = () => Promise<unknown>;
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const errorNotices = () => mocks.notify.mock.calls.filter((c) => c[0].type === 'error').length;
  // TanStack báo cache qua setTimeout(0): đợi một nhịp để trạng thái kịp cập nhật sau khi lệnh xong.
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const renderLive = (refresh: Refresh): MockInstance<QueryClient['invalidateQueries']> => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    render(
      <QueryClientProvider client={qc}>
        <HomeStoryReel />
      </QueryClientProvider>,
    );
    return invalidate;
  };
  const KEYS = [['cart'], ['product', 'mon-1'], ['products', 'home-best-seller']];

  /** Mỗi lối thêm: `first` bắt đầu lệnh đầu, `again` là cú chạm lặp vào cùng món, `held` cho biết nút/bảng còn đang giữ khoá nhìn từ màn. */
  const FLOWS = [
    {
      name: 'một chạm trong Reel (món một phân loại)',
      args: ['v1', 1] as const,
      setup: () => undefined,
      first: async () => {
        fireEvent.click(ring(1));
        fireEvent.click(await dialogReady());
      },
      again: async () => {
        fireEvent.click(ring(1));
        fireEvent.click(await dialogReady());
      },
      held: () => false,
      sheetFlow: false,
    },
    {
      name: 'bảng chọn phân loại',
      args: ['v1b', 2] as const,
      setup: () => mocks.fetchProduct.mockResolvedValue(detail(1, [variation('v1'), variation('v1b')])),
      first: async () => {
        fireEvent.click(ring(1));
        fireEvent.click(await dialogReady());
        fireEvent.click(await screen.findByRole('button', { name: 'xác nhận phân loại' }));
      },
      again: async () => {
        fireEvent.click(await screen.findByRole('button', { name: 'xác nhận phân loại' }));
      },
      held: () => screen.queryByTestId('variation-sheet') !== null,
      sheetFlow: true,
    },
  ];

  describe.each(FLOWS)('$name', (f) => {
    beforeEach(() => f.setup());

    it.each([
      [400, 'Sản phẩm đã hết hàng'],
      [404, 'Sản phẩm không còn bán'],
      [409, 'Vừa có thay đổi, bạn thử lại nhé'],
    ])('bị từ chối %i: báo lỗi một lần, tải lại đúng khoá, giữ khoá tới khi dữ liệu về rồi mới nhả', async (status, message) => {
      mocks.addToCart.mockRejectedValueOnce(serverError(message, status));
      const refresh = deferred();
      const invalidate = renderLive(() => refresh.promise);
      await screen.findAllByTestId('story-reel-item');
      await f.first();
      await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ text: message, type: 'error' })));
      expect(errorNotices()).toBe(1);
      expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual(KEYS.map((queryKey) => ({ queryKey })));
      // Đã báo lỗi mà dữ liệu chưa về: chạm lại vào cùng món không gửi lệnh nào (bảng chọn còn mở).
      if (f.sheetFlow) expect(f.held()).toBe(true);
      await f.again();
      expect(mocks.addToCart).toHaveBeenCalledTimes(1);
      await act(async () => refresh.resolve());
      await settle();
      if (f.sheetFlow) await waitFor(() => expect(f.held()).toBe(false));
      expect(errorNotices()).toBe(1);
      if (!f.sheetFlow) {
        await f.again();
        await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
        expect(mocks.addToCart.mock.calls[1]).toEqual([...f.args]);
      }
    });

    it.each([
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
      ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
      ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
      ['hết phiên 401', serverError('Unauthorized', 401)],
    ])('%s: không giữ khoá chờ tải lại, khoá nhả ngay', async (_label, error) => {
      mocks.addToCart.mockRejectedValueOnce(error);
      const invalidate = renderLive(() => new Promise(() => undefined));
      await screen.findAllByTestId('story-reel-item');
      await f.first();
      await waitFor(() => expect(errorNotices()).toBe(1));
      if (f.sheetFlow) await waitFor(() => expect(f.held()).toBe(false));
      expect(invalidate).not.toHaveBeenCalled();
      expect(mocks.addToCart.mock.calls[0]).toEqual([...f.args]);
      fireEvent.click(ring(1));
      fireEvent.click(await dialogReady());
      if (f.sheetFlow) fireEvent.click(await screen.findByRole('button', { name: 'xác nhận phân loại' }));
      await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
    });

    it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
      mocks.addToCart.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409));
      renderLive(() => new Promise(() => undefined));
      await screen.findAllByTestId('story-reel-item');
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        await f.first();
        await waitFor(() => expect(errorNotices()).toBe(1));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
        });
        await f.again();
        expect(mocks.addToCart).toHaveBeenCalledTimes(1);
        if (f.sheetFlow) expect(f.held()).toBe(true);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(600);
        });
        if (f.sheetFlow) await waitFor(() => expect(f.held()).toBe(false));
      } finally {
        vi.useRealTimers();
      }
      if (!f.sheetFlow) {
        await f.again();
        await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
      }
    });
  });
});
