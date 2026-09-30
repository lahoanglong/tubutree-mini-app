import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

function renderRail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><PurchasedRail source="home_rail" /></QueryClientProvider>);
}

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
    mocks.fetchPurchasedItems.mockRejectedValue(Object.assign(new Error('404'), { isAxiosError: true, response: { status: 404 } }));
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

  it('2 chạm: "Mua lại" → sheet → "Thêm vào giỏ (1)" → addToCart(repurchase), ở lại trang', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    mocks.addToCart.mockResolvedValue(CART);
    renderRail();
    const region = await screen.findByRole('region', { name: 'Mua lại' });
    fireEvent.click(region.querySelector('button.tubu-btn') as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào giỏ (1)' }));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1, 'repurchase'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({ text: 'Xem giỏ' }) })));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('chạm thẻ → trang sản phẩm', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
    renderRail();
    fireEvent.click(await screen.findByRole('button', { name: 'Nước rửa chén · Chanh' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nuoc-rua-chen');
  });
});
