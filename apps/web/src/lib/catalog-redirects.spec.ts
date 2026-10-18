import { describe, expect, it } from 'vitest';
import { buildCatalogRedirects } from './catalog-redirects.mjs';

// Danh mục chuyển từ "/" sang /san-pham; URL "/?q=", "/?category=", "/?brand=" đã được lập chỉ mục và đã chia sẻ nên phải còn dùng được.
describe('buildCatalogRedirects', () => {
  const rows = buildCatalogRedirects();

  it('mỗi khoá tìm/lọc cũ của trang chủ có một dòng 307 từ "/" sang /san-pham, chỉ khi URL có khoá đó', () => {
    expect(rows).toEqual([
      { source: '/', has: [{ type: 'query', key: 'q' }], destination: '/san-pham', permanent: false },
      { source: '/', has: [{ type: 'query', key: 'category' }], destination: '/san-pham', permanent: false },
      { source: '/', has: [{ type: 'query', key: 'brand' }], destination: '/san-pham', permanent: false },
    ]);
  });

  it('chuyển tạm thời (307), không vĩnh viễn: trang chủ sẽ có lại nội dung riêng', () => {
    expect(rows.every((r) => r.permanent === false)).toBe(true);
  });

  it('đích không mang query riêng: Next giữ nguyên query gốc (q, brand, page, utm, ref, s)', () => {
    expect(rows.every((r) => !r.destination.includes('?'))).toBe(true);
  });
});
