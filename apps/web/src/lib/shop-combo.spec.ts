// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('./client-api', () => ({ apiFetch }));

import { rememberStorefront } from './storefront-context';
import { addAllToCart } from './shop-combo';
import { fetchBrandProductsPage } from './shop-brand-products';

beforeEach(() => {
  sessionStorage.clear();
  apiFetch.mockReset().mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } });
});

describe('addAllToCart ("Thêm cả combo")', () => {
  it('một lệnh POST /cart/items/batch, nguồn ctv_sheet', async () => {
    await addAllToCart([{ variationId: 'v1', quantity: 1 }, { variationId: 'v2', quantity: 1 }]);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith('/cart/items/batch', {
      method: 'POST',
      body: { items: [{ variationId: 'v1', quantity: 1 }, { variationId: 'v2', quantity: 1 }], addSource: 'ctv_sheet' },
    });
  });

  it('kèm gian hàng CTV đang ghi công để giỏ trừ đúng combo', async () => {
    rememberStorefront('shop-a', 'CTV');
    await addAllToCart([{ variationId: 'v1', quantity: 1 }]);
    expect(apiFetch.mock.calls[0]![0]).toBe('/cart/items/batch?storefrontSlug=shop-a');
  });
});

describe('fetchBrandProductsPage', () => {
  it('phân trang thật của thương hiệu', async () => {
    await fetchBrandProductsPage('fuwa', { page: 2, limit: 20, sort: 'newest' });
    expect(apiFetch.mock.calls[0]![0]).toBe('/brand/public/fuwa/products?page=2&limit=20&sort=newest');
  });
});
