import { describe, expect, it } from 'vitest';
import { browseCanonicalPath, browseMetadata, browseNoindex } from './home-seo';

// R2-BUYERWEB-9: /san-pham?page=N và ?brand= dùng chung một tiêu đề, không có canonical. Danh mục chuyển từ "/" sang
// /san-pham (00-ma-tran dòng 2) nên canonical, tiêu đề và noindex theo trang mới.

describe('browseCanonicalPath', () => {
  it('trang 1 không bộ lọc → "/san-pham"; có nhãn/trang thì ghi đủ, không neo', () => {
    expect(browseCanonicalPath({})).toBe('/san-pham');
    expect(browseCanonicalPath({ page: 1 })).toBe('/san-pham');
    expect(browseCanonicalPath({ brand: 'A&B' })).toBe('/san-pham?brand=A%26B');
    expect(browseCanonicalPath({ page: 3 })).toBe('/san-pham?page=3');
    expect(browseCanonicalPath({ brand: 'Hector', page: 2 })).toBe('/san-pham?brand=Hector&page=2');
  });
});

describe('browseNoindex', () => {
  it('từ khoá, danh mục, phân khúc và mọi bộ lọc/sắp xếp khác đều noindex; chỉ nhãn và số trang thì không', () => {
    expect(browseNoindex(new URLSearchParams(''))).toBe(false);
    expect(browseNoindex(new URLSearchParams('brand=Tubu&page=2'))).toBe(false);
    expect(browseNoindex(new URLSearchParams('utm_source=zalo'))).toBe(false);
    for (const qs of ['q=gội', 'category=c1', 'segment=eco', 'minPrice=1000', 'maxPrice=9', 'inStock=1', 'rating=4', 'sort=newest']) {
      expect(browseNoindex(new URLSearchParams(qs))).toBe(true);
    }
  });

  it('từ khoá chỉ có khoảng trắng không tính là tìm kiếm', () => {
    expect(browseNoindex(new URLSearchParams('q=%20%20'))).toBe(false);
  });
});

describe('browseMetadata', () => {
  it('trang gốc: tiêu đề riêng của trang danh mục, canonical về "/san-pham"', () => {
    const m = browseMetadata({ page: 1 }, true);
    expect(m.title).toBe('Tất cả sản phẩm | Tubu Tree');
    expect(m.alternates).toEqual({ canonical: '/san-pham' });
    expect(m.robots).toBeUndefined();
  });

  it('trang phân trang có tiêu đề và mô tả riêng kèm số trang, canonical trỏ chính nó', () => {
    const m = browseMetadata({ page: 2 }, true);
    expect(m.title).toBe('Sản phẩm sống xanh — Trang 2 | Tubu Tree');
    expect(m.description).toContain('Trang 2');
    expect(m.alternates).toEqual({ canonical: '/san-pham?page=2' });
  });

  it('lọc theo nhãn: tiêu đề nêu tên nhãn; nhãn + trang 2 thì thêm số trang', () => {
    const p1 = browseMetadata({ brand: 'Hector', page: 1 }, true);
    expect(p1.title).toBe('Sản phẩm Hector | Tubu Tree');
    expect(p1.alternates).toEqual({ canonical: '/san-pham?brand=Hector' });
    const p2 = browseMetadata({ brand: 'Hector', page: 2 }, true);
    expect(p2.title).toBe('Sản phẩm Hector — Trang 2 | Tubu Tree');
    expect(p2.alternates).toEqual({ canonical: '/san-pham?brand=Hector&page=2' });
    expect(browseMetadata({ brand: 'Hector' }, true).description).toContain('Hector');
  });

  it('nhãn không có trong danh mục (URL tự bịa) → không cho lập chỉ mục', () => {
    expect(browseMetadata({ brand: 'khong-co' }, false).robots).toEqual({ index: false, follow: true });
  });

  it('tên nhãn quá dài bị cắt để tiêu đề không phình', () => {
    expect((browseMetadata({ brand: 'x'.repeat(300) }, true).title as string).length).toBeLessThan(120);
  });
});
