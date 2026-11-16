import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('zmp-ui', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useNavigate: () => navigate }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../../services/shop-api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchActiveFlashSales: vi.fn(() => new Promise(() => {})),
  getPublicConfig: vi.fn(() => new Promise(() => {})),
}));

import { ProductCard } from './product-card';
import { ProductCardQuickAddContext, QuickAddButton, type ProductCardQuickAdd } from './product-card-quick-add';

const PRODUCT: ProductCardData = {
  id: 'p1', slug: 'serum-x', name: 'Serum Bã Trầu', brand: 'Tubu', thumbnail: null,
  basePrice: 52_000, salePrice: null, isFeatured: false, inStock: true,
};

function renderCard(quickAdd: ProductCardQuickAdd | null, props: Partial<Parameters<typeof ProductCard>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProductCardQuickAddContext.Provider value={quickAdd}>
        <ProductCard product={PRODUCT} variant="grid" {...props} />
      </ProductCardQuickAddContext.Provider>
    </QueryClientProvider>,
  );
}

describe('QuickAddButton — nút ＋ trên ảnh thẻ', () => {
  it('nhãn đọc "Thêm <tên> vào giỏ", vòng 32px (token) với vùng chạm giãn 44×44, không có chữ nhìn thấy', () => {
    render(<QuickAddButton name="Serum Bã Trầu" busy={false} onPress={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Thêm Serum Bã Trầu vào giỏ' });
    expect(btn).toHaveClass('tubu-hit-44-square');
    expect(btn.style.width).toBe('var(--space-stack-xl)');
    expect(btn.style.height).toBe('var(--space-stack-xl)');
    expect(btn.textContent).toBe('');
    expect(btn).toHaveAttribute('aria-busy', 'false');
    expect(btn).not.toHaveAttribute('aria-disabled');
  });

  it('chạm báo phần tử gốc (để hiệu ứng bay vào giỏ), không nổi bọt lên thẻ nên không mở chi tiết sản phẩm', () => {
    const onPress = vi.fn();
    const onCard = vi.fn();
    render(
      <div onClick={onCard}>
        <QuickAddButton name="Serum" busy={false} onPress={onPress} />
      </div>,
    );
    const btn = screen.getByRole('button', { name: /Thêm Serum/ });
    fireEvent.click(btn);
    expect(onPress).toHaveBeenCalledWith(btn);
    expect(onCard).not.toHaveBeenCalled();
  });

  it('đang thêm: aria-busy và aria-disabled, vòng mờ đi nhưng vẫn là nút (không tắt hẳn để không mất tiêu điểm)', () => {
    render(<QuickAddButton name="Serum" busy onPress={() => {}} />);
    const btn = screen.getByRole('button', { name: /Thêm Serum/ });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).not.toBeDisabled();
    expect(btn.style.opacity).toBe('0.6');
  });
});

describe('ProductCard — nút ＋ chỉ có khi nơi dùng cắm context', () => {
  beforeEach(() => navigate.mockClear());

  it('không context: không có nút ＋ (mọi màn khác không đổi)', () => {
    renderCard(null);
    expect(screen.queryByRole('button', { name: /vào giỏ/ })).toBeNull();
  });

  it('có context: thẻ lưới có đúng MỘT nút ＋; chạm gọi add(sản phẩm, phần tử) và không điều hướng', () => {
    const add = vi.fn();
    renderCard({ add, busyId: null });
    const btn = screen.getByRole('button', { name: 'Thêm Serum Bã Trầu vào giỏ' });
    expect(screen.getAllByRole('button', { name: /vào giỏ/ })).toHaveLength(1);
    fireEvent.click(btn);
    expect(add).toHaveBeenCalledWith(PRODUCT, btn);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('busyId trùng sản phẩm của thẻ thì chỉ thẻ đó báo bận', () => {
    const { unmount } = renderCard({ add: vi.fn(), busyId: 'p1' });
    expect(screen.getByRole('button', { name: /vào giỏ/ })).toHaveAttribute('aria-busy', 'true');
    unmount();
    renderCard({ add: vi.fn(), busyId: 'khac' });
    expect(screen.getByRole('button', { name: /vào giỏ/ })).toHaveAttribute('aria-busy', 'false');
  });

  it('hết hàng (inStock=false): không có nút ＋', () => {
    renderCard({ add: vi.fn(), busyId: null }, { product: { ...PRODUCT, inStock: false } });
    expect(screen.queryByRole('button', { name: /vào giỏ/ })).toBeNull();
  });

  it('thẻ đã có nút Thêm riêng (onAdd) hay lớp phủ riêng (imageOverlay): không chồng thêm nút ＋', () => {
    const { unmount } = renderCard({ add: vi.fn(), busyId: null }, { onAdd: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Thêm Serum Bã Trầu vào giỏ' })).toBeNull();
    unmount();
    renderCard({ add: vi.fn(), busyId: null }, { imageOverlay: <span data-testid="own-overlay" /> });
    expect(screen.getByTestId('own-overlay')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thêm Serum Bã Trầu vào giỏ' })).toBeNull();
  });
});
