import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { brandAccent, brandBrowseLabel, brandBrowsePath } from './brands';
import { BRAND_ORIGINS } from './brand-origins';

/** Tên nhãn đúng như cột `products.brand` của catalog: API `/products?brand=` so khớp CHÍNH XÁC chuỗi này. */
const catalogBrands = (): Set<string> => {
  const seed = readFileSync(fileURLToPath(new URL('../../../api/prisma/seed.ts', import.meta.url)), 'utf8');
  return new Set([...seed.matchAll(/\bbrand: '([^']+)'/g)].map((m) => m[1]!));
};

describe('brandBrowsePath (C-079)', () => {
  it('đưa tên nhãn catalog vào ?brand= đã mã hoá', () => {
    expect(brandBrowsePath('Le Plateau Coffee')).toBe('/browse?brand=Le%20Plateau%20Coffee');
    expect(brandBrowsePath('Pơ Lang')).toBe(`/browse?brand=${encodeURIComponent('Pơ Lang')}`);
    expect(brandBrowsePath('BH.Nong')).toBe('/browse?brand=BH.Nong');
  });

  it('tên rỗng thì về danh sách chung, không gửi ?brand= rỗng', () => {
    expect(brandBrowsePath('')).toBe('/browse');
    expect(brandBrowsePath('   ')).toBe('/browse');
  });

  it('cắt khoảng trắng hai đầu (API so khớp chính xác)', () => {
    expect(brandBrowsePath('  Sokfram ')).toBe('/browse?brand=Sokfram');
  });
});

describe('brandBrowseLabel (C-079)', () => {
  it('nói rõ nút mở danh sách sản phẩm của nhãn, không chỉ đọc tên nhãn', () => {
    expect(brandBrowseLabel('Le Plateau Coffee')).toBe('Xem sản phẩm nhãn Le Plateau Coffee');
  });

  it('cắt khoảng trắng hai đầu như brandBrowsePath', () => {
    expect(brandBrowseLabel('  Sokfram ')).toBe('Xem sản phẩm nhãn Sokfram');
  });
});

describe('BRAND_ORIGINS khớp catalog (C-079)', () => {
  it('có 8 nhãn, id không trùng', () => {
    expect(BRAND_ORIGINS).toHaveLength(8);
    expect(new Set(BRAND_ORIGINS.map((o) => o.id)).size).toBe(8);
  });

  it.each(BRAND_ORIGINS.map((o) => [o.catalogBrand] as const))(
    'catalogBrand %s có thật trong dữ liệu catalog (seed.ts)',
    (name) => {
      expect(catalogBrands().has(name)).toBe(true);
    },
  );

  it.each(BRAND_ORIGINS.map((o) => [o.catalogBrand] as const))('đường dẫn duyệt của %s giải mã về đúng tên catalog', (name) => {
    const url = new URL(brandBrowsePath(name), 'https://x.test');
    expect(url.pathname).toBe('/browse');
    expect(url.searchParams.get('brand')).toBe(name);
  });
});

describe('brandAccent', () => {
  it.each(BRAND_ORIGINS.map((o) => [o.catalogBrand] as const))('%s có màu nhận diện riêng (token, không hex)', (name) => {
    expect(brandAccent(name)).toMatch(/^var\(--color-brand-[a-z0-9]+\)$/);
    expect(brandAccent(name)).not.toBe(brandAccent('Nhãn lạ'));
  });

  it('nhãn lạ dùng màu hành động chính của DS', () => {
    expect(brandAccent('Nhãn lạ')).toBe('var(--color-action-primary-bg)');
  });

  it('bỏ qua hoa thường và khoảng trắng', () => {
    expect(brandAccent('LE PLATEAU coffee')).toBe(brandAccent('Le Plateau Coffee'));
    expect(brandAccent('Pơ Lang')).toBe(brandAccent('pơlang'));
  });
});

describe('css/brand-theme.css', () => {
  const css = readFileSync(fileURLToPath(new URL('../css/brand-theme.css', import.meta.url)), 'utf8');
  const defined = (name: string) => new RegExp(`${name}\\s*:`).test(css);

  it.each(BRAND_ORIGINS.map((o) => [o.id] as const))('nhãn %s khai báo đủ màu nhận diện và hai đầu gradient', (id) => {
    expect(defined(`--color-brand-${id}`)).toBe(true);
    expect(defined(`--color-brand-${id}-from`)).toBe(true);
    expect(defined(`--color-brand-${id}-to`)).toBe(true);
  });
});
