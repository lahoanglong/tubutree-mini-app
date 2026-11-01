import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ZmpUi from 'zmp-ui';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), fetchPurchasedItems: vi.fn(), addToCart: vi.fn(), repurchaseOrder: vi.fn(), fetchActiveFlashSales: vi.fn(),
  status: 'authenticated', subs: true,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof ZmpUi>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/shop-api', () => ({
  fetchPurchasedItems: mocks.fetchPurchasedItems, addToCart: mocks.addToCart, repurchaseOrder: mocks.repurchaseOrder,
  fetchActiveFlashSales: mocks.fetchActiveFlashSales,
}));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => ({ subscribeDiscountPct: 0.1 }) }));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));
vi.mock('../../services/buy-flow-events', () => ({ trackReorderClicked: vi.fn(), trackReorderCompleted: vi.fn() }));
vi.mock('../../utils/features', () => ({ get SUBSCRIPTIONS_IN_MINIAPP() { return mocks.subs; } }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { PURCHASED_HINT_KEY, purchasedSkeletonHeight } from '@tubutree/app-core/home-layout';
import { rebuyPricing } from '@tubutree/app-core/rebuy-pricing';
import { PurchasedRail } from './purchased-rail';

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

describe('PurchasedRail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subs = true;
    mocks.status = 'authenticated';
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
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
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào giỏ (1)' }));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1, 'repurchase'));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/cart'));
  });

  it('tab Đơn hàng (source=orders_tab) cũng sang /cart sau khi thêm', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    mocks.addToCart.mockResolvedValue(CART);
    renderRail('orders_tab');
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    fireEvent.click(region.querySelector('button.tubu-btn') as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào giỏ (1)' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/cart'));
  });

  it('không thêm được món nào (hết hàng) → ở lại trang, không sang giỏ trống', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    mocks.addToCart.mockRejectedValue(new Error('Hết hàng'));
    renderRail();
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    fireEvent.click(region.querySelector('button.tubu-btn') as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào giỏ (1)' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(mocks.navigate).not.toHaveBeenCalledWith('/cart');
  });

  it('chạm thẻ → trang sản phẩm', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    renderRail();
    fireEvent.click(await screen.findByRole('button', { name: 'Nước rửa chén' }));
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

describe('kệ cuộn (3 món trở lên)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subs = true;
    mocks.status = 'authenticated';
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
  });

  it('có món mua nhiều lần, có món mua một lần: mọi thẻ giữ dòng ghi chú để giá thẳng hàng; không món nào mua lại thì không dòng ghi chú', async () => {
    const three = (times: number[]) => times.map((timesBought, i) => ({ ...ITEM, variationId: `v${i}`, slug: `sp-${i}`, productName: `SP ${i}`, timesBought }));
    mocks.fetchPurchasedItems.mockResolvedValue({ items: three([3, 1, 1]), nextCursor: null });
    const first = renderRail();
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    await waitFor(() => expect(region.querySelectorAll('[data-ds="product-tile"]').length).toBe(3));
    expect(region.querySelectorAll('[data-ds-part="note"]').length).toBe(3);
    expect(region).toHaveTextContent('Đã mua 3 lần');
    first.unmount();
    mocks.fetchPurchasedItems.mockResolvedValue({ items: three([1, 1, 1]), nextCursor: null });
    renderRail();
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
    fireEvent.click(within(region).getByRole('button', { name: 'Nước rửa chén' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/product/nuoc-rua-chen', { state: { pinnedVariationId: 'v1' } });
  });

  it('2 món trở lên: kệ thẻ rail-md như cũ, không có dòng 88px', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: many(2), nextCursor: null });
    renderRail();
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    await waitFor(() => expect(region.querySelectorAll('[data-ds="product-tile"]').length).toBe(2));
    expect(within(region).queryByTestId('rebuy-line')).toBeNull();
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
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào giỏ (1)' }));
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
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    expect(region).toHaveTextContent('Can nước rửa');
    expect(region).toHaveTextContent('5L');
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
    renderRail();
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    await waitFor(() => expect(region).toHaveTextContent('50.000'));
    fireEvent.click(region.querySelector('.tubu-tile-link')!);
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nuoc-rua-chen', { state: { pinnedVariationId: 'v1' } });
  });
});
