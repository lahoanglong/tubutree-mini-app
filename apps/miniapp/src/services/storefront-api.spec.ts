import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./api', () => ({ api: { get: mocks.get, post: vi.fn() } }));

import { getStorefrontCategories } from './storefront-api';

describe('getStorefrontCategories', () => {
  beforeEach(() => mocks.get.mockReset());

  it('xin danh sách phẳng (?flat=1): GET /categories mặc định là cây, danh mục con sẽ mất khỏi bộ chọn mẫu gian hàng', async () => {
    const flat = [
      { id: 'cha', name: 'Gia dụng', slug: 'gia-dung', image: null },
      { id: 'con', name: 'Nhà bếp', slug: 'nha-bep', image: null },
    ];
    mocks.get.mockResolvedValue({ data: flat });
    await expect(getStorefrontCategories()).resolves.toEqual(flat);
    expect(mocks.get).toHaveBeenCalledWith('/categories', { params: { flat: 1 } });
  });
});
