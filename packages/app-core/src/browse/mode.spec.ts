import { describe, expect, it } from 'vitest';
import { BROWSE_PAGE_LIMIT, browseMode, type BrowseModeInput } from './mode';

const EMPTY: BrowseModeInput = { q: '', brands: [], inStock: false };

describe('browseMode', () => {
  it('không tham số nào: hub', () => {
    expect(browseMode(EMPTY)).toBe('hub');
  });

  it.each<[string, Partial<BrowseModeInput>]>([
    ['từ khoá', { q: 'nuoc' }],
    ['danh mục', { category: 'c1' }],
    ['phân khúc', { segment: 'eco' }],
    ['sắp xếp', { sort: 'newest' }],
    ['nút Xem tất cả sản phẩm', { all: true }],
    ['thương hiệu', { brands: ['Tubu'] }],
    ['giá tối thiểu', { minPrice: 1 }],
    ['giá tối đa', { maxPrice: 1 }],
    ['còn hàng', { inStock: true }],
    ['từ 4 sao', { minRating: 4 }],
  ])('%s: danh sách', (_name, patch) => {
    expect(browseMode({ ...EMPTY, ...patch })).toBe('list');
  });

  it('một trang 20 món (lưới 2, 4, 5 cột chia hết)', () => {
    expect(BROWSE_PAGE_LIMIT).toBe(20);
  });
});
