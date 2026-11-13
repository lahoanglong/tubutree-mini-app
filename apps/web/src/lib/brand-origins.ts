export * from '@tubutree/app-core/brand-origins';

/**
 * Danh sách sản phẩm của một nhãn. API `/products?brand=` so khớp CHÍNH XÁC chuỗi `products.brand`, nên truyền tên đúng như catalog:
 * "Le Plateau" cho danh sách rỗng vì catalog ghi "Le Plateau Coffee". "Sokfarm" là tên chuẩn; link cũ `?brand=Sokfram` vẫn ra đúng sản phẩm (API ánh xạ về "Sokfarm").
 */
export function brandBrowseHref(catalogBrand: string): string {
  const name = catalogBrand.trim();
  return name ? `/san-pham?brand=${encodeURIComponent(name)}` : '/san-pham';
}
