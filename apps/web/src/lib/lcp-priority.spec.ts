import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GRID_PRODUCTS, GRID_PRODUCTS_WITH_FILTER, GRID_IMAGE_SIZES, GRID_IMAGE_SIZES_WITH_FILTER, GRID_RANK_IMAGE_SIZES, gridImageSizes } from './product-grid';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('ảnh ưu tiên chỉ đặt ở khối nằm trong màn đầu 375×812 (Pa2)', () => {
  it('lưới gợi ý cuối trang chủ: không priorityCount (khối cuối trang, ảnh eager + fetchpriority=high giành băng thông của ứng viên LCP thật)', () => {
    const src = read('components/home/suggest-feed.tsx');
    expect(src).not.toMatch(/priorityCount/);
    expect(src).not.toMatch(/PRIORITY_CARDS/);
  });

  it('kệ Bán chạy ở trang chủ (dưới Giờ vàng, Danh mục): không priorityCount', () => {
    expect(read('components/home/best-seller-rail.tsx')).not.toMatch(/priorityCount=\{[1-9]/);
  });

  it('Giờ vàng ở trang chủ: 2 thẻ đầu ưu tiên', () => {
    const src = read('components/home/flash-sale.tsx');
    expect(src).toMatch(/FLASH_PRIORITY_CARDS = 2/);
    expect(src).toMatch(/priority=\{i < FLASH_PRIORITY_CARDS\}/);
    expect(src).toMatch(/priority=\{priority\}/);
  });

  it('kệ Bán chạy của hub danh mục: 2 thẻ đầu; khối đầu của gian hàng/thương hiệu: 2 thẻ đầu', () => {
    expect(read('components/catalog/browse-hub.tsx')).toMatch(/<ProductRail[^>]*priorityCount=\{2\}/);
    expect(read('components/shop-page/storefront-body.tsx')).toMatch(/priorityCount=\{i === 0 \? 2 : 0\}/);
    const section = read('components/mini/shop-section.tsx');
    expect(section).toMatch(/priorityCount = 0/);
    expect(section.match(/priorityCount=\{priorityCount\}/g)!.length).toBeGreaterThanOrEqual(2);
    expect(section).toMatch(/priorityCount=\{railAsGrid \? 0 : priorityCount\}/);
  });
});

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
