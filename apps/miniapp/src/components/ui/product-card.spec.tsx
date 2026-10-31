import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('zmp-ui', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useNavigate: () => navigate }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/shop-api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchActiveFlashSales: vi.fn(() => new Promise(() => {})),
  getPublicConfig: vi.fn(() => new Promise(() => {})),
}));

import { ProductCard } from './product-card';

const DAY = 86_400_000;
const PRODUCT: ProductCardData = {
  id: 'p1', slug: 'serum-x', name: 'Serum Bã Trầu', brand: 'Tubu', thumbnail: null,
  basePrice: 52_000, salePrice: null, isFeatured: false, inStock: true, createdAt: new Date(Date.now() - 400 * DAY).toISOString(),
};
const flashItem = (over: Record<string, unknown> = {}) => ({
  itemId: 'i1', variationId: 'v-flash', productSlug: 'serum-x', productName: 'Serum', thumbnail: null,
  flashPrice: 39_000, retailPrice: 52_000, soldCount: 0, quota: 10, endAt: new Date(Date.now() + 3_600_000).toISOString(), ...over,
});

function setup(seed: { flash?: unknown[]; config?: Record<string, unknown> } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seed.flash) qc.setQueryData(['flash-sales', 'active'], seed.flash);
  if (seed.config) qc.setQueryData(['public-config'], seed.config);
  const ui = (props: Partial<Parameters<typeof ProductCard>[0]> = {}) => (
    <QueryClientProvider client={qc}>
      <ProductCard product={PRODUCT} variant="grid" {...props} />
    </QueryClientProvider>
  );
  return { qc, ui };
}

beforeEach(() => navigate.mockClear());
afterEach(() => vi.useRealTimers());

describe('ProductCard: giá Giờ vàng và điều hướng', () => {
  it('Giờ vàng thắng: giá deal, nhãn ảnh Giờ vàng, mở chi tiết đúng phân loại của suất', () => {
    const { ui } = setup({ flash: [flashItem()], config: { catalogLaunchDate: null } });
    render(ui({ listSource: 'home_suggest' }));
    expect(screen.getByText('39.000đ')).toBeInTheDocument();
    expect(screen.getByText('Giờ vàng -25%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Serum Bã Trầu' }));
    expect(navigate).toHaveBeenCalledWith('/product/serum-x', { state: { listSource: 'home_suggest', variationId: 'v-flash' } });
  });

  it('không có suất: món ghim phân loại mở đúng phân loại ghim, không thì không state', () => {
    const { ui } = setup({ flash: [], config: { catalogLaunchDate: null } });
    const first = render(ui({ product: { ...PRODUCT, pinnedVariationId: 'pv1' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Serum Bã Trầu' }));
    expect(navigate).toHaveBeenLastCalledWith('/product/serum-x', { state: { pinnedVariationId: 'pv1' } });
    first.unmount();
    render(ui());
    fireEvent.click(screen.getByRole('button', { name: 'Serum Bã Trầu' }));
    expect(navigate).toHaveBeenLastCalledWith('/product/serum-x', undefined);
  });

  it('prop flash thắng danh sách trong cache; flash=null tắt Giờ vàng', () => {
    const { ui } = setup({ flash: [flashItem()], config: { catalogLaunchDate: null } });
    const a = render(ui({ flash: flashItem({ flashPrice: 30_000 }) }));
    expect(screen.getByText('30.000đ')).toBeInTheDocument();
    a.unmount();
    render(ui({ flash: null }));
    expect(screen.getByText('52.000đ')).toBeInTheDocument();
    expect(screen.queryByText(/Giờ vàng/)).toBeNull();
  });

  it('Giờ vàng hết giờ khi khách đang xem: thẻ về giá thường đúng mốc, không chờ tải lại', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { ui } = setup({ flash: [flashItem({ endAt: new Date(Date.now() + 5_000).toISOString() })], config: { catalogLaunchDate: null } });
    render(ui());
    expect(screen.getByText('39.000đ')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(6_000));
    expect(screen.getByText('52.000đ')).toBeInTheDocument();
    expect(screen.queryByText(/Giờ vàng/)).toBeNull();
  });
});

describe('ProductCard: nhãn không chớp khi cấu hình chưa về', () => {
  const fresh = { createdAt: new Date(Date.now() - 2 * DAY).toISOString() };

  it('chưa biết mốc ngày mở bán: chưa có "Mới"; mốc về (chưa đặt) thì có', async () => {
    const { qc, ui } = setup({ flash: [] });
    render(ui({ product: { ...PRODUCT, ...fresh } }));
    expect(screen.queryByText('Mới')).toBeNull();
    act(() => void qc.setQueryData(['public-config'], { catalogLaunchDate: null }));
    expect(await screen.findByText('Mới')).toBeInTheDocument();
  });

  it('chưa có ngưỡng miễn phí giao: không nhãn; có ngưỡng và Tubu giao, giá đạt ngưỡng: có nhãn', async () => {
    const { qc, ui } = setup({ flash: [], config: { catalogLaunchDate: null } });
    render(ui({ product: { ...PRODUCT, fulfiller: { kind: 'TUBU', name: 'Tubu', shippingFee: null, freeShipFrom: null } } }));
    expect(screen.queryByText('Miễn phí giao hàng')).toBeNull();
    act(() => void qc.setQueryData(['public-config'], { catalogLaunchDate: null, freeshipThreshold: 49_000 }));
    expect(await screen.findByText('Miễn phí giao hàng')).toBeInTheDocument();
  });

  it('thiếu fulfiller thì không bao giờ nhãn Miễn phí giao hàng', () => {
    const { ui } = setup({ flash: [], config: { catalogLaunchDate: null, freeshipThreshold: 1 } });
    render(ui());
    expect(screen.queryByText('Miễn phí giao hàng')).toBeNull();
  });
});

describe('ProductCard: tim và nút nổi', () => {
  it('tim mang tên sản phẩm ở grid, không có tim ở rail-sm; showWishlist=false tắt tim', () => {
    const { ui } = setup({ flash: [], config: { catalogLaunchDate: null } });
    const a = render(ui());
    expect(screen.getByRole('button', { name: 'Yêu thích Serum Bã Trầu' })).toBeInTheDocument();
    a.unmount();
    const b = render(ui({ variant: 'rail-sm' }));
    expect(screen.queryByRole('button', { name: /Yêu thích/ })).toBeNull();
    b.unmount();
    render(ui({ showWishlist: false }));
    expect(screen.queryByRole('button', { name: /Yêu thích/ })).toBeNull();
  });

  it('imageOverlay nằm trong thẻ và bấm nó không mở chi tiết', () => {
    const onOverlay = vi.fn();
    const { ui } = setup({ flash: [], config: { catalogLaunchDate: null } });
    render(ui({ imageOverlay: <button type="button" aria-label="Thêm nhanh" onClick={onOverlay}>+</button> }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm nhanh' }));
    expect(onOverlay).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('ProductCard: luật giá thẻ (chuyển từ thẻ Yêu thích cũ)', () => {
  const SALE: ProductCardData = { ...PRODUCT, id: 'p9', slug: 'nrc', name: 'Nước rửa chén', basePrice: 150_000, salePrice: 120_000 };
  const FLASH = flashItem({ productSlug: 'nrc', variationId: 'v1', flashPrice: 99_000, retailPrice: 150_000, salePrice: 120_000 });

  it('giá đang bán, giá gốc gạch, nhãn -20%; chạm mở sản phẩm không kèm state', () => {
    const { ui } = setup({ flash: [], config: { catalogLaunchDate: null } });
    render(ui({ product: SALE }));
    expect(screen.getByText('-20%')).toBeInTheDocument();
    expect(screen.getByText('120.000đ')).toBeInTheDocument();
    expect(screen.getByText('150.000đ')).toHaveStyle({ textDecoration: 'line-through' });
    fireEvent.click(screen.getByRole('button', { name: 'Nước rửa chén' }));
    expect(navigate).toHaveBeenCalledWith('/product/nrc', undefined);
  });

  it('Giờ vàng rẻ hơn thì thắng: gạch giá đang bán của phân loại có suất, mở đúng phân loại', () => {
    const { ui } = setup({ flash: [FLASH], config: { catalogLaunchDate: null } });
    render(ui({ product: SALE }));
    expect(screen.getByText('99.000đ')).toBeInTheDocument();
    expect(screen.getByText('Giờ vàng -18%')).toBeInTheDocument();
    expect(screen.getByText('120.000đ')).toHaveStyle({ textDecoration: 'line-through' });
    expect(screen.queryByText('150.000đ')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Nước rửa chén' }));
    expect(navigate).toHaveBeenCalledWith('/product/nrc', { state: { variationId: 'v1' } });
  });

  it('B-140: món ghim phân loại khác, Giờ vàng của phân loại kia không thắng và mở phân loại ghim', () => {
    const { ui } = setup({ flash: [FLASH], config: { catalogLaunchDate: null } });
    render(ui({ product: { ...SALE, pinnedVariationId: 'v9', repVariationId: 'v9' } }));
    expect(screen.getByText('120.000đ')).toBeInTheDocument();
    expect(screen.queryByText('99.000đ')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Nước rửa chén' }));
    expect(navigate).toHaveBeenCalledWith('/product/nrc', { state: { pinnedVariationId: 'v9' } });
  });

  it('Giờ vàng không rẻ hơn giá đang bán: giữ giá đang bán, không nhãn Giờ vàng, mở phân loại mặc định', () => {
    const { ui } = setup({ flash: [{ ...FLASH, flashPrice: 130_000 }], config: { catalogLaunchDate: null } });
    render(ui({ product: SALE }));
    expect(screen.getByText('-20%')).toBeInTheDocument();
    expect(screen.queryByText(/^Giờ vàng/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Nước rửa chén' }));
    expect(navigate).toHaveBeenCalledWith('/product/nrc', undefined);
  });

  it('hết hàng: chữ hết hàng, không nhãn % lộ dưới lớp phủ; không giảm giá thì không nhãn, không giá gạch', () => {
    const { ui } = setup({ flash: [], config: { catalogLaunchDate: null } });
    const oos = render(ui({ product: { ...SALE, inStock: false } }));
    expect(screen.getByText('Tạm hết hàng')).toBeInTheDocument();
    expect(screen.queryByText(/^-\d+%$/)).toBeNull();
    oos.unmount();
    render(ui({ product: { ...SALE, salePrice: null } }));
    expect(screen.getByText('150.000đ')).toBeInTheDocument();
    expect(screen.queryByText(/^-\d+%$/)).toBeNull();
  });
});
