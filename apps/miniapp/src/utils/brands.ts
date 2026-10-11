import '../css/brand-theme.css';

/**
 * Màu nhận diện nhãn theo Design Brief §4.2 — dùng cho chip/tag/brand carousel.
 * Giá trị nằm ở css/brand-theme.css (--color-brand-<id>); module này nạp file đó để mọi nơi gọi
 * brandAccent (thẻ sản phẩm, PDP) đều có token mà không phụ thuộc trang nào đã import.
 * Key chuẩn hóa: lowercase, bỏ dấu cách. Brand lạ → màu hành động chính.
 */
const BRAND_IDS: Record<string, string> = {
  visante: 'visante',
  polang: 'polang',
  'pơlang': 'polang',
  cobote: 'cobote',
  fuwa3e: 'fuwa3e',
  babycare: 'babycare',
  umikai: 'umikai',
  'bh.nong': 'bhnong',
  bhnong: 'bhnong',
  sokfram: 'sokfram',
  leplateau: 'leplateau',
  leplateaucoffee: 'leplateau',
  themoshav: 'moshav',
  moshav: 'moshav',
  hector: 'hector',
};

export function brandAccent(brand: string): string {
  const id = BRAND_IDS[brand.normalize('NFC').toLowerCase().replace(/\s+/g, '')];
  return id ? `var(--color-brand-${id})` : 'var(--color-action-primary-bg)';
}

/**
 * Danh sách sản phẩm của một nhãn. API `/products?brand=` so khớp CHÍNH XÁC chuỗi `products.brand`
 * (không phải slug, không phân biệt gì khác tên hiển thị), nên truyền tên đúng như catalog: "Le Plateau"
 * hay "Sokfarm" cho danh sách rỗng vì catalog ghi "Le Plateau Coffee" và "Sokfram".
 */
export function brandBrowsePath(catalogBrand: string): string {
  const name = catalogBrand.trim();
  return name ? `/browse?brand=${encodeURIComponent(name)}` : '/browse';
}
