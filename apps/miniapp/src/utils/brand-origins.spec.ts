import { describe, expect, it } from 'vitest';
import { BRAND_ORIGINS, brandBrowseTarget, findBrandOrigin } from './brand-origins';

// Hình học bản đồ và va chạm nhãn do packages/app-core/src/brand-map-data.spec.ts kiểm (dùng chung với web).

describe('đích "Khám phá sản phẩm" trên Mini', () => {
  it('/browse?q= theo từ khoá trong tên sản phẩm, không ?brand= (PROD chỉ có nhãn vỏ "Tubu Tree")', () => {
    for (const o of BRAND_ORIGINS) {
      const url = new URL(brandBrowseTarget(o, '/browse'), 'https://x.test');
      expect(url.pathname).toBe('/browse');
      expect(url.searchParams.get('q')).toBe(o.searchKeyword);
      expect(url.searchParams.has('brand')).toBe(false);
    }
  });
});

describe('tên tỉnh hiển thị (D8-13)', () => {
  it('viết "Đắk Lắk" đúng chính tả, không còn "Đắc Lắk"', () => {
    const provinces = BRAND_ORIGINS.map((o) => o.province);
    expect(provinces.join('|')).not.toMatch(/Đắc/);
    expect(provinces).toContain('Đắk Lắk');
  });
});

describe('findBrandOrigin', () => {
  it('khớp theo slug hoặc tên (không phân biệt hoa thường), nhãn lạ thì null', () => {
    expect(findBrandOrigin({ slug: 'fuwa3e', name: 'x' })?.id).toBe('fuwa3e');
    expect(findBrandOrigin({ slug: 'khac', name: ' BH.NONG ' })?.id).toBe('bhnong');
    expect(findBrandOrigin({ slug: 'khac', name: 'Không có' })).toBeNull();
  });
});
