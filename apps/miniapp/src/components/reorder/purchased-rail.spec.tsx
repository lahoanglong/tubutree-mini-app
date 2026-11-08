import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ZmpUi from 'zmp-ui';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), fetchPurchasedItems: vi.fn(), addToCart: vi.fn(), repurchaseOrder: vi.fn(), fetchActiveFlashSales: vi.fn(), fetchProducts: vi.fn(), fetchCombos: vi.fn(), addAllToCart: vi.fn(), getCart: vi.fn().mockResolvedValue({ items: [] }),
  status: 'authenticated', subs: true,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof ZmpUi>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/shop-api', () => ({
  fetchPurchasedItems: mocks.fetchPurchasedItems, addToCart: mocks.addToCart, repurchaseOrder: mocks.repurchaseOrder,
  fetchActiveFlashSales: mocks.fetchActiveFlashSales, fetchProducts: mocks.fetchProducts,
  getCart: mocks.getCart,
}));
vi.mock('../../services/bundle-api', () => ({ getHomeCombos: mocks.fetchCombos }));
vi.mock('../../services/cart-batch', () => ({ addAllToCart: mocks.addAllToCart }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => ({ subscribeDiscountPct: 0.1 }) }));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));
vi.mock('../../services/buy-flow-events', () => ({ trackReorderClicked: vi.fn(), trackReorderCompleted: vi.fn() }));
vi.mock('../../utils/features', () => ({ get SUBSCRIPTIONS_IN_MINIAPP() { return mocks.subs; } }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { PURCHASED_HINT_KEY, QUICK_REORDER_CARD_HEIGHT, purchasedSkeletonHeight } from '@tubutree/app-core/home-layout';
import { rebuyPricing } from '@tubutree/app-core/rebuy-pricing';
import { PurchasedRail } from './purchased-rail';
import { HomeBlockErrorSuppressed } from '../home/home-block-error';
import { useHomeShelves } from '../home/use-home-shelves';

const ITEM = {
  variationId: 'v1', productId: 'p1', slug: 'nuoc-rua-chen', productName: 'Nước rửa chén', variationName: 'Chanh', brand: 'Tubu',
  thumbnail: null, price: 65000, salePrice: null, stock: 8, inStock: true, timesBought: 2, retailOnly: false, lastPurchasedAt: '2026-09-10T00:00:00.000Z',
};
const CART = { items: [], couponCode: null, subtotal: 65000, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 1 };

function renderRail(source: 'home_rail' | 'orders_tab' = 'home_rail', excludeVariations?: ReadonlySet<string>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}><PurchasedRail source={source} excludeVariations={excludeVariations} /></QueryClientProvider>) };
}
const RAIL_KEY = ['purchased-items', 10];

/** Nút "Thêm vào giỏ" khoá (aria-busy) tới khi giỏ tải xong; chờ hết bận rồi mới bấm, như khách thật. */
async function pressAddToCart() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Thêm vào giỏ (1)' })).not.toHaveAttribute('aria-busy'));
  fireEvent.click(screen.getByRole('button', { name: 'Thêm vào giỏ (1)' }));
}

describe('PurchasedRail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subs = true;
    mocks.status = 'authenticated';
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
    mocks.fetchProducts.mockResolvedValue({ data: [], meta: { page: 1, limit: 12, total: 0 } });
    mocks.fetchCombos.mockResolvedValue([]);
  });

  it('khách cũ: vùng "Mua lại" với thẻ SP + nhãn số lần đã mua', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    renderRail();
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    expect(region).toHaveTextContent('Nước rửa chén');
    expect(region).toHaveTextContent('Chanh');
    expect(region).not.toHaveTextContent('Định kỳ');
    expect(mocks.fetchPurchasedItems).toHaveBeenCalledWith({ limit: 10 });
  });

  it('khách mới (rỗng) → không render gì', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    const { container } = renderRail();
    await waitFor(() => expect(mocks.fetchPurchasedItems).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('API cũ trả 404 → ẩn im lặng, không ErrorState / "Thử lại"', async () => {
    mocks.fetchPurchasedItems.mockRejectedValue(Object.assign(new Error('404'), { isHttpError: true, response: { status: 404 } }));
    const { container } = renderRail();
    await waitFor(() => expect(mocks.fetchPurchasedItems).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText('Thử lại')).toBeNull();
  });

  it('chưa đăng nhập → không gọi API, không render', () => {
    mocks.status = 'idle';
    const { container } = renderRail();
    expect(mocks.fetchPurchasedItems).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('đang tải → skeleton aria-hidden (không phải region)', () => {
    mocks.fetchPurchasedItems.mockReturnValue(new Promise(() => {}));
    renderRail();
    expect(screen.getByTestId('purchased-rail-loading')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('region', { name: 'Mua lại' })).toBeNull();
  });

  it('"Mua lại" → sheet → "Thêm vào giỏ (1)" → addToCart(repurchase) rồi tự sang /cart (không bắt khách tự tìm giỏ)', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    mocks.addToCart.mockResolvedValue(CART);
    renderRail();
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    fireEvent.click(region.querySelector('button.tubu-btn') as HTMLElement);
    await pressAddToCart();
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1, 'repurchase'));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/cart'));
  });

  it('tab Đơn hàng (source=orders_tab) cũng sang /cart sau khi thêm', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    mocks.addToCart.mockResolvedValue(CART);
    renderRail('orders_tab');
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    fireEvent.click(region.querySelector('button.tubu-btn') as HTMLElement);
    await pressAddToCart();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/cart'));
  });

  it('không thêm được món nào (hết hàng) → ở lại trang, không sang giỏ trống', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    mocks.addToCart.mockRejectedValue(new Error('Hết hàng'));
    renderRail();
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    fireEvent.click(region.querySelector('button.tubu-btn') as HTMLElement);
    await pressAddToCart();
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(mocks.navigate).not.toHaveBeenCalledWith('/cart');
  });

  it('chạm thẻ → trang sản phẩm', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    renderRail();
    const open = await screen.findByRole('button', { name: /^Nước rửa chén.*Chanh/ });
    expect(open.hasAttribute('aria-label')).toBe(false);
    fireEvent.click(open);
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nuoc-rua-chen', { state: { pinnedVariationId: 'v1' } });
  });

  describe('làm mới lỗi (React Query v5 giữ dữ liệu cũ, status=error)', () => {
    it('còn dữ liệu cũ → kệ KHÔNG biến mất: vẫn hiện thẻ cũ + dòng báo nhẹ + "Thử lại"; thử lại xong thì dòng báo mất', async () => {
      mocks.fetchPurchasedItems.mockResolvedValueOnce({ items: [ITEM], nextCursor: null }).mockRejectedValueOnce(new Error('boom'));
      const { qc } = renderRail();
      const region = await screen.findByRole('region', { name: 'Mua lại' });
      expect(within(region).queryByRole('button', { name: /^Thử lại/ })).toBeNull();

      await act(async () => {
        await qc.refetchQueries({ queryKey: RAIL_KEY });
      });
      await waitFor(() => expect(qc.getQueryState(RAIL_KEY)?.status).toBe('error'));
      const after = await screen.findByRole('region', { name: 'Mua lại' });
      expect(after).toHaveTextContent('Nước rửa chén');
      expect(await within(after).findByText('Có chút trục trặc, thử lại nhé')).toBeInTheDocument();

      mocks.fetchPurchasedItems.mockResolvedValueOnce({ items: [ITEM], nextCursor: null });
      fireEvent.click(within(after).getByRole('button', { name: 'Thử lại Mua lại' }));
      await waitFor(() => expect(screen.queryByText('Có chút trục trặc, thử lại nhé')).toBeNull());
      expect(screen.getByRole('region', { name: 'Mua lại' })).toHaveTextContent('Nước rửa chén');
    });

    it('lỗi ở lần tải đầu khi Trang chủ đã có dải lỗi cấp trang: kệ không thêm khối lỗi và nút Thử lại giống hệt', async () => {
      mocks.fetchPurchasedItems.mockRejectedValue(new Error('boom'));
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { container } = render(
        <QueryClientProvider client={qc}>
          <HomeBlockErrorSuppressed.Provider value>
            <PurchasedRail source="home_rail" />
          </HomeBlockErrorSuppressed.Provider>
        </QueryClientProvider>,
      );
      await waitFor(() => expect(qc.getQueryState(RAIL_KEY)?.status).toBe('error'));
      expect(screen.queryByRole('button', { name: 'Thử lại Mua lại' })).toBeNull();
      expect(container.querySelector('section')).toBeNull();
    });

    it('lỗi ở lần tải đầu (chưa có gì để giữ): hiện khối lỗi "Thử lại" thay vì ẩn im lặng; tải lại sau lỗi không chớp khung chờ', async () => {
      let release: (v: unknown) => void = () => {};
      mocks.fetchPurchasedItems
        .mockRejectedValueOnce(new Error('boom'))
        .mockImplementationOnce(() => new Promise((r) => { release = r; }));
      const { qc } = renderRail();
      await waitFor(() => expect(qc.getQueryState(RAIL_KEY)?.status).toBe('error'));
      const errored = await screen.findByRole('region', { name: 'Mua lại' });
      expect(within(errored).getByText('Có chút trục trặc, thử lại nhé')).toBeInTheDocument();
      expect(within(errored).getByRole('button', { name: 'Thử lại Mua lại' })).toBeInTheDocument();

      let refetching: Promise<unknown> = Promise.resolve();
      act(() => {
        refetching = qc.refetchQueries({ queryKey: RAIL_KEY });
      });
      await waitFor(() => expect(mocks.fetchPurchasedItems).toHaveBeenCalledTimes(2));
      expect(screen.queryByTestId('purchased-rail-loading')).toBeNull();

      await act(async () => {
        release({ items: [ITEM], nextCursor: null });
        await refetching;
      });
      const region = await screen.findByRole('region', { name: 'Mua lại' });
      expect(region).toHaveTextContent('Nước rửa chén');
      expect(within(region).queryByText('Có chút trục trặc, thử lại nhé')).toBeNull();
    });
  });

  describe('thẻ gọn ở tab Đơn hàng (1–2 món)', () => {
    it('API báo hàng chỉ bán lẻ (retailOnly): không mời "Định kỳ", vẫn có "Mua lại"', async () => {
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [{ ...ITEM, retailOnly: true }], nextCursor: null });
      renderRail('orders_tab');
      const region = await screen.findByRole('region', { name: 'Mua lại' });
      expect(region).not.toHaveTextContent('Định kỳ');
      expect(within(region).getByRole('button', { name: 'Mua lại' })).toBeInTheDocument();
    });

    it('hàng thường (retailOnly=false): có "Định kỳ" bấm được ngay, không cần tải chi tiết sản phẩm', async () => {
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
      renderRail('orders_tab');
      const region = await screen.findByRole('region', { name: 'Mua lại' });
      expect(within(region).getByRole('button', { name: 'Định kỳ -10%' })).toBeEnabled();
    });

    it('cờ SUBSCRIPTIONS_IN_MINIAPP tắt: không mời "Định kỳ" dù hàng thường, vẫn có "Mua lại"', async () => {
      mocks.subs = false;
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [{ ...ITEM, retailOnly: false }], nextCursor: null });
      renderRail('orders_tab');
      const region = await screen.findByRole('region', { name: 'Mua lại' });
      expect(region).not.toHaveTextContent('Định kỳ');
      expect(region).toHaveTextContent('Mua lại');
    });

    it('API cũ chưa trả retailOnly: không mời "Định kỳ" (máy chủ có thể từ chối)', async () => {
      const { retailOnly: _omit, ...old } = ITEM;
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [old], nextCursor: null });
      renderRail('orders_tab');
      const region = await screen.findByRole('region', { name: 'Mua lại' });
      expect(region).not.toHaveTextContent('Định kỳ');
    });

    it('hết hàng: ghi "Tạm hết hàng", không có nút Mua lại / Định kỳ', async () => {
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [{ ...ITEM, stock: 0, inStock: false }], nextCursor: null });
      renderRail('orders_tab');
      const region = await screen.findByRole('region', { name: 'Mua lại' });
      expect(region).toHaveTextContent('Tạm hết hàng');
      expect(within(region).queryByRole('button', { name: 'Mua lại' })).toBeNull();
      expect(region).not.toHaveTextContent('Định kỳ');
    });

    it('món đã mua nhiều lần có nhãn "Đã mua N lần"; mua một lần thì không', async () => {
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
      const first = renderRail('orders_tab');
      expect(await screen.findByText('Đã mua 2 lần')).toBeInTheDocument();
      first.unmount();
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [{ ...ITEM, timesBought: 1 }], nextCursor: null });
      renderRail('orders_tab');
      await screen.findByRole('region', { name: 'Mua lại' });
      expect(screen.queryByText(/Đã mua \d+ lần/)).toBeNull();
    });
  });
});

describe('kệ cuộn ở tab Đơn hàng (3 món trở lên)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subs = true;
    mocks.status = 'authenticated';
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
  });

  it('có món mua nhiều lần, có món mua một lần: mọi thẻ giữ dòng ghi chú để giá thẳng hàng; không món nào mua lại thì không dòng ghi chú', async () => {
    const three = (times: number[]) => times.map((timesBought, i) => ({ ...ITEM, variationId: `v${i}`, slug: `sp-${i}`, productName: `SP ${i}`, timesBought }));
    mocks.fetchPurchasedItems.mockResolvedValue({ items: three([3, 1, 1]), nextCursor: null });
    const first = renderRail('orders_tab');
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    await waitFor(() => expect(region.querySelectorAll('[data-ds="product-tile"]').length).toBe(3));
    expect(region.querySelectorAll('[data-ds-part="note"]').length).toBe(3);
    expect(region).toHaveTextContent('Đã mua 3 lần');
    first.unmount();
    mocks.fetchPurchasedItems.mockResolvedValue({ items: three([1, 1, 1]), nextCursor: null });
    renderRail('orders_tab');
    const plain = await screen.findByRole('region', { name: 'Mua lại' });
    await waitFor(() => expect(plain.querySelectorAll('[data-ds="product-tile"]').length).toBe(3));
    expect(plain.querySelectorAll('[data-ds-part="note"]').length).toBe(0);
  });
});

describe('Mua lại ở Trang chủ (Q6)', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...ITEM, variationId: `v${i}`, slug: `sp-${i}`, productName: `SP ${i}`, timesBought: 1 }));
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.subs = true;
    mocks.status = 'authenticated';
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
  });

  it('1 món: MỘT dòng cao 88px (ảnh, tên, phân loại, giá, nút "Mua lại"), không mời "Định kỳ", không kệ cuộn', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    renderRail();
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    const line = within(region).getByTestId('rebuy-line');
    expect(line).toHaveStyle({ height: '88px' });
    expect(within(line).getByRole('button', { name: 'Mua lại' })).toBeInTheDocument();
    expect(within(line).getByText('65.000đ')).toBeInTheDocument();
    expect(region).toHaveTextContent('Chanh');
    expect(region).not.toHaveTextContent('Định kỳ');
    expect(region.querySelector('[data-ds="product-tile"]')).toBeNull();
  });

  it('tiêu đề h2 "Mua lại" có "Xem tất cả" tới các đơn đã giao; chạm dòng mở sản phẩm', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    renderRail();
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Mua lại' })).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: 'Xem tất cả Mua lại' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/orders?tab=delivered');
    const open = within(region).getByRole('button', { name: /^Nước rửa chén.*Chanh/ });
    expect(open.hasAttribute('aria-label')).toBe(false);
    fireEvent.click(open);
    expect(mocks.navigate).toHaveBeenLastCalledWith('/product/nuoc-rua-chen', { state: { pinnedVariationId: 'v1' } });
  });

  it('2 món trở lên: dải "Mua lại món quen" thay kệ thẻ, không có dòng 88px, không kệ rail-md', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: many(2), nextCursor: null });
    renderRail();
    const strip = await screen.findByTestId('quick-reorder');
    expect(within(strip).getAllByTestId('quick-reorder-card')).toHaveLength(2);
    expect(screen.queryByTestId('rebuy-line')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Mua lại' })).toBeNull();
    expect(strip.querySelector('[data-ds="product-tile"]')).toBeNull();
  });

  it('hết hàng: dòng ghi "Tạm hết hàng", không có nút "Mua lại"', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [{ ...ITEM, stock: 0, inStock: false }], nextCursor: null });
    renderRail();
    const line = await screen.findByTestId('rebuy-line');
    expect(line).toHaveTextContent('Tạm hết hàng');
    expect(within(line).queryByRole('button', { name: 'Mua lại' })).toBeNull();
  });

  it('nút "Mua lại" của dòng mở sheet rồi tự sang giỏ', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    mocks.addToCart.mockResolvedValue(CART);
    renderRail();
    fireEvent.click(within(await screen.findByTestId('rebuy-line')).getByRole('button', { name: 'Mua lại' }));
    await pressAddToCart();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/cart'));
  });

  it('nhớ số món cho lần mở sau: 1 món -> "one", 3 món -> "many"', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    const first = renderRail();
    await screen.findByTestId('rebuy-line');
    await waitFor(() => expect(localStorage.getItem(PURCHASED_HINT_KEY)).toBe('one'));
    first.unmount();
    mocks.fetchPurchasedItems.mockResolvedValue({ items: many(3), nextCursor: null });
    renderRail();
    await waitFor(() => expect(localStorage.getItem(PURCHASED_HINT_KEY)).toBe('many'));
  });

  it.each([
    ['one', 'one'],
    ['many', 'many'],
    [null, 'one'],
  ] as const)('khung chờ khi đã nhớ %s cao đúng chiều cao khối thật (chưa nhớ: như một món)', (remembered, expected) => {
    if (remembered) localStorage.setItem(PURCHASED_HINT_KEY, remembered);
    mocks.fetchPurchasedItems.mockReturnValue(new Promise(() => {}));
    renderRail();
    expect(screen.getByTestId('purchased-rail-loading')).toHaveStyle({ height: `${purchasedSkeletonHeight(expected)}px` });
  });

  it('bỏ phân loại Giờ vàng đang giữ (excludeVariations): 2 món bỏ 1 thì còn dòng 88px; bỏ hết thì khối ẩn, hint ghi "none"', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: many(2), nextCursor: null });
    const first = renderRail('home_rail', new Set(['v0']));
    const line = await screen.findByTestId('rebuy-line');
    expect(line).toHaveTextContent('SP 1');
    expect(screen.queryByText('SP 0')).toBeNull();
    first.unmount();
    const second = renderRail('home_rail', new Set(['v0', 'v1']));
    await waitFor(() => expect(localStorage.getItem(PURCHASED_HINT_KEY)).toBe('none'));
    expect(second.container).toBeEmptyDOMElement();
  });

  it('Giờ vàng giữ phân loại khác của cùng sản phẩm (Can 1L) thì phân loại đã mua (Can 5L) vẫn hiện ở Mua lại (P2 #3)', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [{ ...ITEM, variationId: 'v-5l', slug: 'can', productName: 'Can nước rửa', variationName: '5L' }, ...many(1)], nextCursor: null });
    renderRail('home_rail', new Set(['v-1l']));
    const strip = await screen.findByTestId('quick-reorder');
    expect(strip).toHaveTextContent('Can nước rửa · 5L');
    expect(within(strip).getAllByTestId('quick-reorder-card').map((c) => c.getAttribute('data-variation-id'))).toEqual(['v-5l', 'v0']);
  });

  it('tab Đơn hàng với 1 món: vẫn thẻ gọn cũ có "Định kỳ", không dòng 88px', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    renderRail('orders_tab');
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    expect(within(region).getByRole('button', { name: 'Định kỳ -10%' })).toBeInTheDocument();
    expect(within(region).queryByTestId('rebuy-line')).toBeNull();
  });
});

describe('rebuyPricing / phân loại đã mua (B-146)', () => {
  const FLASH = (over: Record<string, unknown> = {}) => ({
    itemId: 'f1', variationId: 'v1', productSlug: 'nuoc-rua-chen', flashPrice: 50_000, retailPrice: 65_000, salePrice: null,
    endAt: new Date(Date.now() + 3_600_000).toISOString(), ...over,
  });

  it('Giờ vàng của đúng phân loại đã mua: thẻ hiện giá flash, gạch giá niêm yết', () => {
    expect(rebuyPricing(ITEM as never, [FLASH()] as never)).toMatchObject({ price: 50_000, isFlash: true, compareAt: 65_000 });
  });

  it('Giờ vàng của phân loại khác, hoặc đã hết giờ: giữ giá phân loại đã mua', () => {
    expect(rebuyPricing(ITEM as never, [FLASH({ variationId: 'v2' })] as never)).toMatchObject({ price: 65_000, isFlash: false });
    expect(rebuyPricing(ITEM as never, [FLASH({ endAt: new Date(Date.now() - 1000).toISOString() })] as never)).toMatchObject({ price: 65_000, isFlash: false });
  });

  it('thẻ trên kệ hiện giá flash của phân loại đã mua và chạm mở đúng phân loại đó', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM, { ...ITEM, variationId: 'v3', slug: 'xa-bong', productName: 'Xà bông' }, { ...ITEM, variationId: 'v4', slug: 'tay', productName: 'Tẩy' }], nextCursor: null });
    mocks.fetchActiveFlashSales.mockResolvedValue([FLASH()]);
    renderRail('orders_tab');
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    await waitFor(() => expect(region).toHaveTextContent('50.000'));
    fireEvent.click(region.querySelector('.tubu-tile-link')!);
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nuoc-rua-chen', { state: { pinnedVariationId: 'v1' } });
  });

  it('dải Trang chủ cũng hiện giá flash của đúng phân loại đã mua (gạch giá niêm yết, nhãn -x%) và chạm mở đúng phân loại đó', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM, { ...ITEM, variationId: 'v3', slug: 'xa-bong', productName: 'Xà bông' }], nextCursor: null });
    mocks.fetchActiveFlashSales.mockResolvedValue([FLASH()]);
    renderRail();
    const strip = await screen.findByTestId('quick-reorder');
    const [first] = within(strip).getAllByTestId('quick-reorder-card');
    await waitFor(() => expect(first).toHaveTextContent('50.000đ'));
    expect(first).toHaveTextContent('65.000đ');
    expect(first).toHaveTextContent('-23%');
    fireEvent.click(within(first!).getByText('Nước rửa chén · Chanh'));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nuoc-rua-chen', { state: { pinnedVariationId: 'v1' } });
  });

  it('hết suất Giờ vàng (flashAllowance=0): dải ghi giá thường như giỏ sẽ tính', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [{ ...ITEM, flashAllowance: 0 }, { ...ITEM, variationId: 'v3', slug: 'xa-bong', productName: 'Xà bông' }], nextCursor: null });
    mocks.fetchActiveFlashSales.mockResolvedValue([FLASH()]);
    renderRail();
    const strip = await screen.findByTestId('quick-reorder');
    await waitFor(() => expect(mocks.fetchActiveFlashSales).toHaveBeenCalled());
    const [first] = within(strip).getAllByTestId('quick-reorder-card');
    expect(first).toHaveTextContent('65.000đ');
    expect(first).not.toHaveTextContent('50.000đ');
  });

  it('giỏ đã đủ suất Giờ vàng còn lại (giới hạn 1, giỏ có 1): dải ghi giá thường vì giỏ tính cả dòng giá thường', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM, { ...ITEM, variationId: 'v3', slug: 'xa-bong', productName: 'Xà bông' }], nextCursor: null });
    mocks.fetchActiveFlashSales.mockResolvedValue([{ ...FLASH(), perUserLimit: 1 }]);
    mocks.getCart.mockResolvedValue({ items: [{ id: 'l1', variationId: 'v1', productId: 'p1', quantity: 1 }] });
    try {
      renderRail();
      const strip = await screen.findByTestId('quick-reorder');
      await waitFor(() => expect(mocks.getCart).toHaveBeenCalled());
      await waitFor(() => expect(within(strip).getAllByTestId('quick-reorder-card')[0]).toHaveTextContent('65.000đ'));
      expect(within(strip).getAllByTestId('quick-reorder-card')[0]).not.toHaveTextContent('50.000đ');
    } finally {
      mocks.getCart.mockResolvedValue({ items: [] });
    }
  });
});

// Khách thấy gì ở Mua lại khi tập loại trừ do `useHomeShelves` dựng (đúng cách `pages/home.tsx` nối hai thứ), không chép lại phép lọc trong test (H3 #2).
describe('PurchasedRail với tập loại trừ của useHomeShelves', () => {
  const flashItem = (slug: string, variationId: string) => ({
    itemId: `i-${variationId}`, variationId, productSlug: slug, productName: slug, thumbnail: null, flashPrice: 1, retailPrice: 2, soldCount: 0, quota: 5,
    endAt: '2099-01-01T00:00:00.000Z',
  });
  const bought = (slug: string, variationId: string, productName: string) => ({ ...ITEM, variationId, slug, productName, variationName: null, timesBought: 1 });
  function HomeRail() {
    const shelves = useHomeShelves('returning');
    return <PurchasedRail source="home_rail" excludeVariations={shelves.flashVariationIds} />;
  }
  const renderHomeRail = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return render(<QueryClientProvider client={qc}><HomeRail /></QueryClientProvider>);
  };

  it('phân loại thứ hai của sản phẩm Giờ vàng (kệ chỉ vẽ một thẻ) không hiện ở Mua lại, món khác vẫn hiện', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([flashItem('a', 'v-a-1l'), flashItem('b', 'v-b'), flashItem('c', 'v-c'), flashItem('a', 'v-a-5l')]);
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [bought('a', 'v-a-5l', 'Đã mua Can 5L'), bought('x', 'v-x', 'Đã mua món khác')], nextCursor: null });
    renderHomeRail();
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    expect(region).toHaveTextContent('Đã mua món khác');
    expect(region).not.toHaveTextContent('Đã mua Can 5L');
  });

  it('sản phẩm thứ 9 của Giờ vàng bị kệ cắt (tối đa 8): khách đã mua nó vẫn thấy ở Mua lại, không biến khỏi cả trang', async () => {
    const slugs = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9'];
    mocks.fetchActiveFlashSales.mockResolvedValue(slugs.map((s) => flashItem(s, `v-${s}`)));
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [bought('f9', 'v-f9', 'Đã mua sản phẩm chín'), bought('f1', 'v-f1', 'Đã mua sản phẩm một')], nextCursor: null });
    renderHomeRail();
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    expect(region).toHaveTextContent('Đã mua sản phẩm chín');
    expect(region).not.toHaveTextContent('Đã mua sản phẩm một');
  });
});

describe('Dải "Mua lại món quen" ở Trang chủ (W43A)', () => {
  const many = (n: number, over: Record<string, unknown> = {}) =>
    Array.from({ length: n }, (_, i) => ({ ...ITEM, variationId: `v${i}`, slug: `sp-${i}`, productName: `SP ${i}`, variationName: null, timesBought: 1, ...over }));
  const addButton = (id: string) => screen.getAllByTestId('quick-reorder-add').find((b) => b.getAttribute('data-variation-id') === id)!;
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.subs = true;
    mocks.status = 'authenticated';
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
  });

  it('tối đa 6 thẻ dù khách đã mua nhiều hơn, theo thứ tự mới nhất trước', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: many(8), nextCursor: null });
    renderRail();
    const strip = await screen.findByTestId('quick-reorder');
    expect(within(strip).getAllByTestId('quick-reorder-card').map((c) => c.getAttribute('data-variation-id'))).toEqual(['v0', 'v1', 'v2', 'v3', 'v4', 'v5']);
  });

  it('tab Đơn hàng không đổi: 2 món vẫn là kệ "Mua lại" cũ, không dải', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: many(2), nextCursor: null });
    renderRail('orders_tab');
    await screen.findByRole('region', { name: 'Mua lại' });
    expect(screen.queryByTestId('quick-reorder')).toBeNull();
  });

  it('2 món đã mua nhưng chỉ 1 còn hàng: không dải (dưới 2 món), giữ kệ cũ cho cả hai', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [...many(1), ...many(2, { variationId: 'v-out', stock: 0, inStock: false }).slice(0, 1)], nextCursor: null });
    renderRail();
    await screen.findByRole('region', { name: 'Mua lại' });
    expect(screen.queryByTestId('quick-reorder')).toBeNull();
  });

  it('"+ Thêm": một lệnh addToCart(đúng phân loại, 1, repurchase), báo thành công, ở lại Trang chủ (không sang giỏ)', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: many(3), nextCursor: null });
    mocks.addToCart.mockResolvedValue(CART);
    renderRail();
    await screen.findByTestId('quick-reorder');
    fireEvent.click(addButton('v1'));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1, 'repurchase'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('"+ Thêm" lỗi (hết hàng): báo lỗi, ở lại trang, nút mở khoá lại cho lần thử sau', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: many(2), nextCursor: null });
    mocks.addToCart.mockRejectedValue(new Error('Hết hàng'));
    renderRail();
    await screen.findByTestId('quick-reorder');
    fireEvent.click(addButton('v0'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(mocks.navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(addButton('v0')).not.toHaveAttribute('aria-busy', 'true'));
    expect(addButton('v1')).toBeEnabled();
  });

  it('đang thêm một món: nút món đó bận, mọi nút khác khoá; bấm "Thêm lại tất cả" lúc đó không bay lệnh thứ hai; xong thì mở khoá', async () => {
    let release: (v: unknown) => void = () => {};
    mocks.fetchPurchasedItems.mockResolvedValue({ items: many(3), nextCursor: null });
    mocks.addToCart.mockImplementation(() => new Promise((r) => { release = r; }));
    renderRail();
    await screen.findByTestId('quick-reorder');
    fireEvent.click(addButton('v0'));
    await waitFor(() => expect(addButton('v0')).toHaveAttribute('aria-busy', 'true'));
    expect(addButton('v1')).toBeDisabled();
    fireEvent.click(addButton('v1'));
    fireEvent.click(screen.getByRole('button', { name: /^Thêm lại tất cả 3 món vào giỏ/ }));
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    expect(mocks.addAllToCart).not.toHaveBeenCalled();
    await act(async () => release(CART));
    await waitFor(() => expect(addButton('v1')).toBeEnabled());
    expect(addButton('v0')).not.toHaveAttribute('aria-busy', 'true');
  });

  it('"Thêm lại tất cả": một lệnh lô cho mọi món đang hiện (mỗi món 1), báo số món, ở lại Trang chủ', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: many(3), nextCursor: null });
    mocks.addAllToCart.mockResolvedValue(CART);
    renderRail();
    await screen.findByTestId('quick-reorder');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lại tất cả 3 món vào giỏ, tổng 195.000đ' }));
    await waitFor(() => expect(mocks.addAllToCart).toHaveBeenCalledWith([
      { variationId: 'v0', quantity: 1 },
      { variationId: 'v1', quantity: 1 },
      { variationId: 'v2', quantity: 1 },
    ]));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text: 'Đã thêm 3 món vào giỏ' })));
    expect(mocks.addToCart).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('"Thêm lại tất cả" đang chạy: dải báo bận, mọi "+ Thêm" khoá, bấm lần hai không gọi lại', async () => {
    let release: (v: unknown) => void = () => {};
    mocks.fetchPurchasedItems.mockResolvedValue({ items: many(2), nextCursor: null });
    mocks.addAllToCart.mockImplementation(() => new Promise((r) => { release = r; }));
    renderRail();
    await screen.findByTestId('quick-reorder');
    const all = screen.getByRole('button', { name: /^Thêm lại tất cả 2 món vào giỏ/ });
    fireEvent.click(all);
    await waitFor(() => expect(screen.getByTestId('quick-reorder')).toHaveAttribute('aria-busy', 'true'));
    for (const b of screen.getAllByTestId('quick-reorder-add')) expect(b).toBeDisabled();
    fireEvent.click(all);
    fireEvent.click(addButton('v0'));
    expect(mocks.addAllToCart).toHaveBeenCalledTimes(1);
    expect(mocks.addToCart).not.toHaveBeenCalled();
    await act(async () => release(CART));
    await waitFor(() => expect(screen.getByTestId('quick-reorder')).not.toHaveAttribute('aria-busy'));
  });

  it('"Thêm lại tất cả" lỗi: báo lỗi, giỏ không đổi, nút mở khoá', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: many(2), nextCursor: null });
    mocks.addAllToCart.mockRejectedValue(new Error('boom'));
    renderRail();
    await screen.findByTestId('quick-reorder');
    fireEvent.click(screen.getByRole('button', { name: /^Thêm lại tất cả 2 món vào giỏ/ }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text: 'Chưa thêm được vào giỏ. Bạn thử lại nhé.' })));
    await waitFor(() => expect(addButton('v0')).toBeEnabled());
  });

  it('chạm thân thẻ mở sản phẩm ở đúng phân loại đã mua', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: many(2), nextCursor: null });
    renderRail();
    const strip = await screen.findByTestId('quick-reorder');
    fireEvent.click(within(strip).getByText('SP 1'));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/sp-1', { state: { pinnedVariationId: 'v1' } });
  });

  it('nhớ "many" cho lần mở sau và khung chờ cao đúng bằng dải thật (44 + 8 + thẻ + 8)', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: many(2), nextCursor: null });
    renderRail();
    await screen.findByTestId('quick-reorder');
    await waitFor(() => expect(localStorage.getItem(PURCHASED_HINT_KEY)).toBe('many'));
    expect(purchasedSkeletonHeight('many')).toBe(44 + 8 * 2 + QUICK_REORDER_CARD_HEIGHT);
  });

  it('làm mới lỗi khi còn dữ liệu cũ: dải KHÔNG biến mất, hiện dòng báo nhẹ + "Thử lại"', async () => {
    mocks.fetchPurchasedItems.mockResolvedValueOnce({ items: many(2), nextCursor: null }).mockRejectedValueOnce(new Error('boom'));
    const { qc } = renderRail();
    await screen.findByTestId('quick-reorder');
    await act(async () => {
      await qc.refetchQueries({ queryKey: RAIL_KEY });
    });
    await waitFor(() => expect(qc.getQueryState(RAIL_KEY)?.status).toBe('error'));
    expect(screen.getByTestId('quick-reorder')).toBeInTheDocument();
    expect(await screen.findByText('Có chút trục trặc, thử lại nhé')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thử lại Mua lại' })).toBeInTheDocument();
  });
});
