import { describe, expect, it } from 'vitest';
import { homeCanonicalPath, homeMetadata } from './home-seo';

// R2-BUYERWEB-9: /?page=N và /?brand= dùng chung một tiêu đề, không có canonical.

describe('homeCanonicalPath', () => {
  it('trang 1 không bộ lọc → "/"; có nhãn/trang thì ghi đủ, không neo #san-pham', () => {
    expect(homeCanonicalPath({})).toBe('/');
    expect(homeCanonicalPath({ page: 1 })).toBe('/');
    expect(homeCanonicalPath({ brand: 'A&B' })).toBe('/?brand=A%26B');
    expect(homeCanonicalPath({ page: 3 })).toBe('/?page=3');
    expect(homeCanonicalPath({ brand: 'Hector', page: 2 })).toBe('/?brand=Hector&page=2');
  });
});

describe('homeMetadata', () => {
  it('trang chủ gốc: giữ tiêu đề mặc định của layout, canonical về "/"', () => {
    const m = homeMetadata({ page: 1 }, true);
    expect(m.title).toBeUndefined();
    expect(m.alternates).toEqual({ canonical: '/' });
    expect(m.robots).toBeUndefined();
  });

  it('trang phân trang có tiêu đề và mô tả riêng kèm số trang, canonical trỏ chính nó', () => {
    const m = homeMetadata({ page: 2 }, true);
    expect(m.title).toBe('Sản phẩm sống xanh — Trang 2 | Tubu Tree');
    expect(m.description).toContain('Trang 2');
    expect(m.alternates).toEqual({ canonical: '/?page=2' });
  });

  it('lọc theo nhãn: tiêu đề nêu tên nhãn; nhãn + trang 2 thì thêm số trang', () => {
    expect(homeMetadata({ brand: 'Hector', page: 1 }, true).title).toBe('Sản phẩm Hector | Tubu Tree');
    const p2 = homeMetadata({ brand: 'Hector', page: 2 }, true);
    expect(p2.title).toBe('Sản phẩm Hector — Trang 2 | Tubu Tree');
    expect(p2.alternates).toEqual({ canonical: '/?brand=Hector&page=2' });
    expect(homeMetadata({ brand: 'Hector' }, true).description).toContain('Hector');
  });

  it('nhãn không có trong danh mục (URL tự bịa) → không cho lập chỉ mục', () => {
    expect(homeMetadata({ brand: 'khong-co' }, false).robots).toEqual({ index: false, follow: true });
  });

  it('tên nhãn quá dài bị cắt để tiêu đề không phình', () => {
    expect((homeMetadata({ brand: 'x'.repeat(300) }, true).title as string).length).toBeLessThan(120);
  });
});
