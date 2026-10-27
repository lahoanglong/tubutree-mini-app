import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ZmpUi from 'zmp-ui';
import type { ProductCard as ProductCardData } from '../services/shop-api';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), fetchActive: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../services/shop-api', () => ({ fetchActiveFlashSales: mocks.fetchActive }));
vi.mock('./wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import ProductCard from './product-card';

const P: ProductCardData = {
  id: 'p1', slug: 'nrc', brand: 'Tubu', name: 'Nước rửa chén', thumbnail: null,
  basePrice: 150_000, salePrice: 120_000, isFeatured: false, inStock: true,
};
const FLASH = { itemId: 'i1', productSlug: 'nrc', variationId: 'v1', flashPrice: 99_000 };

function renderCard(product: ProductCardData = P) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProductCard product={product} />
    </QueryClientProvider>,
  );
  // Chờ dải giờ vàng tải xong: giá/badge/state điều hướng đều phụ thuộc vào nó.
  return waitFor(() => expect(qc.getQueryData(['flash-sales', 'active'])).toBeDefined());
}

describe('ProductCard (danh sách yêu thích, C-076 di cư DS v2: giữ nguyên hành vi)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchActive.mockResolvedValue([]);
  });

  it('giá đang bán + giá gốc gạch + badge -20%, chạm mở SP không kèm state', async () => {
    await renderCard();
    expect(await screen.findByText('-20%')).toBeInTheDocument();
    expect(screen.getByText('120.000đ')).toBeInTheDocument();
    expect(screen.getByText('150.000đ')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nước rửa chén' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nrc', undefined);
  });

  it('giá giờ vàng rẻ hơn thì thắng: badge giờ vàng và mở đúng phân loại đang giảm', async () => {
    mocks.fetchActive.mockResolvedValue([FLASH]);
    await renderCard();
    expect(await screen.findByText('99.000đ')).toBeInTheDocument();
    expect(screen.getByText(/-18%/)).toBeInTheDocument();
    expect(screen.getByText('120.000đ')).toHaveStyle({ textDecoration: 'line-through' });
    expect(screen.queryByText('150.000đ')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Nước rửa chén' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nrc', { state: { variationId: 'v1' } });
  });

  it('B-140: món gian hàng CTV ghim phân loại mở đúng phân loại ghim, Giờ vàng của phân loại khác không thắng', async () => {
    mocks.fetchActive.mockResolvedValue([FLASH]);
    await renderCard({ ...P, pinnedVariationId: 'v9', repVariationId: 'v9' });
    expect(await screen.findByText('120.000đ')).toBeInTheDocument();
    expect(screen.queryByText('99.000đ')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Nước rửa chén' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nrc', { state: { pinnedVariationId: 'v9' } });
  });

  it('giá giờ vàng KHÔNG rẻ hơn giá đang bán: giữ giá đang bán, không nhãn Giờ vàng, mở phân loại mặc định', async () => {
    mocks.fetchActive.mockResolvedValue([{ ...FLASH, flashPrice: 130_000 }]);
    await renderCard();
    expect(await screen.findByText('-20%')).toBeInTheDocument();
    expect(screen.getByText('120.000đ')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nước rửa chén' }));
    expect(screen.queryByText(/Giờ vàng/)).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nrc', undefined);
  });

  it('hết hàng: có nhãn hết hàng, không có badge % lộ ra dưới lớp phủ', async () => {
    await renderCard({ ...P, inStock: false });
    expect(await screen.findByText(/Tạm hết/)).toBeInTheDocument();
    expect(screen.queryByText(/-\d+%/)).toBeNull();
  });

  it('không giảm giá: không badge, không giá gạch', async () => {
    await renderCard({ ...P, salePrice: null });
    expect(await screen.findByText('150.000đ')).toBeInTheDocument();
    expect(screen.queryByText(/-\d+%/)).toBeNull();
  });
});
