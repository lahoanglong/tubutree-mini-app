import { describe, expect, it } from 'vitest';
import { GRID_PRODUCTS, GRID_PRODUCTS_WITH_FILTER, GRID_IMAGE_SIZES, GRID_IMAGE_SIZES_WITH_FILTER, GRID_RANK_IMAGE_SIZES, gridImageSizes } from './product-grid';

describe('sizes của ảnh thẻ trong lưới (Pa1)', () => {
  it('chọn theo lớp cột: lưới mặc định, lưới có cột lọc, lưới hạng 5 cột', () => {
    expect(gridImageSizes(GRID_PRODUCTS)).toBe(GRID_IMAGE_SIZES);
    expect(gridImageSizes(GRID_PRODUCTS_WITH_FILTER)).toBe(GRID_IMAGE_SIZES_WITH_FILTER);
    expect(gridImageSizes('grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-5')).toBe(GRID_RANK_IMAGE_SIZES);
    expect(gridImageSizes('grid grid-cols-1')).toBe(GRID_IMAGE_SIZES);
  });

  it('điện thoại: hai cột trừ lề 16×2 và khe 12 = (100vw - 44px) / 2; md: ba cột; mọi chuỗi kết thúc bằng một bề rộng cố định hoặc calc, không để trống', () => {
    for (const sizes of [GRID_IMAGE_SIZES, GRID_IMAGE_SIZES_WITH_FILTER, GRID_RANK_IMAGE_SIZES]) {
      expect(sizes.startsWith('(max-width: 767px) calc((100vw - 44px) / 2), (max-width: 1023px) calc((100vw - 80px) / 3)')).toBe(true);
    }
  });
});
