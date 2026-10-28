export * from '@tubutree/app-core/brand-origins';

/**
 * Danh sách sản phẩm của một nhãn. API `/products?brand=` so khớp CHÍNH XÁC chuỗi `products.brand`, nên truyền tên đúng như catalog:
 * "Le Plateau" hay "Sokfarm" cho danh sách rỗng vì catalog ghi "Le Plateau Coffee" và "Sokfram".
 */
export function brandBrowseHref(catalogBrand: string): string {
  const name = catalogBrand.trim();
  return name ? `/san-pham?brand=${encodeURIComponent(name)}` : '/san-pham';
}
