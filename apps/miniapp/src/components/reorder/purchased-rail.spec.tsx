import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ZmpUi from 'zmp-ui';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), fetchPurchasedItems: vi.fn(), addToCart: vi.fn(), repurchaseOrder: vi.fn(),
  status: 'authenticated',
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof ZmpUi>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/shop-api', () => ({
  fetchPurchasedItems: mocks.fetchPurchasedItems, addToCart: mocks.addToCart, repurchaseOrder: mocks.repurchaseOrder,
}));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));
vi.mock('../../services/buy-flow-events', () => ({ trackReorderClicked: vi.fn(), trackReorderCompleted: vi.fn() }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { PurchasedRail } from './purchased-rail';

const ITEM = {
  variationId: 'v1', productId: 'p1', slug: 'nuoc-rua-chen', productName: 'Nước rửa chén', variationName: 'Chanh', brand: 'Tubu',
  thumbnail: null, price: 65000, salePrice: null, stock: 8, inStock: true, timesBought: 2, lastPurchasedAt: '2026-09-10T00:00:00.000Z',
};
const CART = { items: [], couponCode: null, subtotal: 65000, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 1 };

function renderRail(source: 'home_rail' | 'orders_tab' = 'home_rail') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}><PurchasedRail source={source} /></QueryClientProvider>) };
}
const RAIL_KEY = ['purchased-items', 10];

describe('PurchasedRail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
  });

  it('khách cũ: vùng "Mua lại" với thẻ SP + nhãn số lần đã mua', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    renderRail();
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    expect(region).toHaveTextContent('Nước rửa chén · Chanh');
    expect(region).toHaveTextContent('Đã mua 2 lần');
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
    fireEvent.click(await screen.findByRole('button', { name: 'Nước rửa chén · Chanh' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nuoc-rua-chen');
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
      expect(after).toHaveTextContent('Nước rửa chén · Chanh');
      expect(await within(after).findByText('Có chút trục trặc, thử lại nhé')).toBeInTheDocument();

      mocks.fetchPurchasedItems.mockResolvedValueOnce({ items: [ITEM], nextCursor: null });
      fireEvent.click(within(after).getByRole('button', { name: 'Thử lại Mua lại' }));
      await waitFor(() => expect(screen.queryByText('Có chút trục trặc, thử lại nhé')).toBeNull());
      expect(screen.getByRole('region', { name: 'Mua lại' })).toHaveTextContent('Nước rửa chén · Chanh');
    });

    it('lỗi ở lần tải đầu (chưa có gì để giữ) → ẩn như cũ; tải lại sau lỗi không chớp khung chờ', async () => {
      let release: (v: unknown) => void = () => {};
      mocks.fetchPurchasedItems
        .mockRejectedValueOnce(new Error('boom'))
        .mockImplementationOnce(() => new Promise((r) => { release = r; }));
      const { qc, container } = renderRail();
      await waitFor(() => expect(qc.getQueryState(RAIL_KEY)?.status).toBe('error'));
      expect(container).toBeEmptyDOMElement();

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
      expect(await screen.findByRole('region', { name: 'Mua lại' })).toHaveTextContent('Nước rửa chén · Chanh');
    });
  });
});
