import { describe, expect, it } from 'vitest';
import { BRAND_ORIGINS, brandBrowseHref, brandBrowseTarget } from './brand-origins';

// Hình học bản đồ và va chạm nhãn nay do packages/app-core/src/brand-map-data.spec.ts kiểm.

describe('brandBrowseHref — danh sách sản phẩm của nhãn trên web', () => {
  it('dẫn tới /san-pham?brand= theo tên đúng trong catalog, mã hoá ký tự đặc biệt', () => {
    expect(brandBrowseHref('Le Plateau Coffee')).toBe('/san-pham?brand=Le%20Plateau%20Coffee');
    expect(brandBrowseHref('Pơ Lang')).toBe(`/san-pham?brand=${encodeURIComponent('Pơ Lang')}`);
    expect(brandBrowseHref('BH.Nong')).toBe('/san-pham?brand=BH.Nong');
  });

  it('tên trống thì về /san-pham', () => {
    expect(brandBrowseHref('  ')).toBe('/san-pham');
  });

  it('mọi nhãn dùng đúng tên catalog đã khai báo', () => {
    for (const o of BRAND_ORIGINS) expect(brandBrowseHref(o.catalogBrand)).toBe(`/san-pham?brand=${encodeURIComponent(o.catalogBrand)}`);
  });
});

describe('brandBrowseTarget trên web', () => {
  it('nút Khám phá sản phẩm dùng ?q= theo từ khoá trong tên sản phẩm, không ?brand= (PROD chỉ có nhãn vỏ "Tubu Tree")', () => {
    for (const o of BRAND_ORIGINS) {
      const href = brandBrowseTarget(o, '/san-pham');
      expect(href.startsWith('/san-pham?q=')).toBe(true);
      expect(href).not.toContain('brand=');
    }
  });
});

describe('tỉnh ghi trên ô nhãn', () => {
  it('viết "Đắk Lắk" (không phải "Đắc Lắk")', () => {
    const provinces = BRAND_ORIGINS.map((o) => o.province);
    expect(provinces).not.toContain('Đắc Lắk');
    expect(provinces).toContain('Đắk Lắk');
  });
});
