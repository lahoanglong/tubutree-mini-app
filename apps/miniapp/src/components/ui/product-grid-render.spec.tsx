// @vitest-environment jsdom
import { Profiler } from 'react';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';

vi.mock('zmp-ui', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useNavigate: () => vi.fn() }));
vi.mock('zmp-sdk/apis', () => ({ setStorage: vi.fn(), getStorage: vi.fn(), removeStorage: vi.fn() }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/wishlist-api', () => ({
  getWishlistIds: vi.fn(async () => ['p1']),
  addWishlist: vi.fn(),
  removeWishlist: vi.fn(),
}));
vi.mock('../../services/shop-api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchActiveFlashSales: vi.fn(async () => []),
  getPublicConfig: vi.fn(async () => ({ catalogLaunchDate: null })),
}));

import { ProductGrid } from './product-grid';
import { useAuthStore } from '../../store/auth';
import { WishlistHeart } from '../wishlist-heart';

const item = (n: number): ProductCardData => ({
  id: `p${n}`, slug: `sp-${n}`, name: `Sản phẩm ${n}`, brand: 'Tubu', thumbnail: null,
  basePrice: 10_000 * n, salePrice: null, isFeatured: false, inStock: true,
});
const items = Array.from({ length: 100 }, (_, i) => item(i + 1));

function mount(ui: React.ReactElement) {
  const qc = new QueryClient();
  qc.setQueryData(['flash-sales', 'active'], []);
  qc.setQueryData(['public-config'], { catalogLaunchDate: null });
  qc.setQueryData(['wishlist-ids'], ['p1']);
  let commits = 0;
  const utils = render(
    <QueryClientProvider client={qc}>
      <Profiler id="g" onRender={() => (commits += 1)}>
        {ui}
      </Profiler>
    </QueryClientProvider>,
  );
  return { qc, commits: () => commits, ...utils };
}

describe('lưới 100 thẻ', () => {
  it('đổi một trường không liên quan của auth store thì không thẻ nào render lại', async () => {
    useAuthStore.setState({ status: 'authenticated', user: null, error: undefined });
    const m = mount(<ProductGrid items={items} variant="grid" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const before = m.commits();
    act(() => useAuthStore.setState({ error: 'x' }));
    expect(m.commits()).toBe(before);
  });

  it('thêm yêu thích một sản phẩm chỉ vẽ lại tim của sản phẩm đó', async () => {
    useAuthStore.setState({ status: 'authenticated', user: null, error: undefined });
    const renders: string[] = [];
    const m = mount(
      <>
        {items.slice(0, 20).map((p) => (
          <Profiler key={p.id} id={p.id} onRender={(id) => renders.push(id)}>
            <WishlistHeart productId={p.id} />
          </Profiler>
        ))}
      </>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    renders.length = 0;
    await act(async () => {
      m.qc.setQueryData(['wishlist-ids'], ['p1', 'p2']);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(renders).toEqual(['p2']);
  });

  it('cha vẽ lại với onOpen mới: chạm vẫn gọi onOpen mới nhất', async () => {
    useAuthStore.setState({ status: 'authenticated', user: null, error: undefined });
    const first = vi.fn();
    const second = vi.fn();
    const few = items.slice(0, 3);
    const tree = (open: typeof first) => (
      <QueryClientProvider client={qc}>
        <ProductGrid items={few} variant="grid" onOpen={open} />
      </QueryClientProvider>
    );
    const qc = new QueryClient();
    qc.setQueryData(['flash-sales', 'active'], []);
    qc.setQueryData(['public-config'], { catalogLaunchDate: null });
    qc.setQueryData(['wishlist-ids'], []);
    const { rerender } = render(tree(first));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    rerender(tree(second));
    act(() => screen.getByRole('button', { name: 'Sản phẩm 1' }).click());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(few[0], 0);
  });
});
