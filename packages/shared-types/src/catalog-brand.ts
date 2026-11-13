/**
 * Suy thương hiệu (`products.brand`) từ tên sản phẩm. Pancake POS không có cột thương hiệu nên đồng bộ ghi mặc định "Tubu Tree" cho mọi sản phẩm:
 * trên PROD 111/111 SKU cùng một nhãn, `/brands` chỉ có một dòng và bộ lọc theo nhãn không tách được gì. Tên sản phẩm thì luôn in tên nhãn
 * (Fuwa3e, Pineboo, Pơ Lang...), nên đọc nhãn từ đó. Dùng chung cho đồng bộ Pancake và lớp đọc catalog của api.
 *
 * Giá trị ghi ra là tên đúng như cột `products.brand` (`catalogBrand` trong `BRAND_ORIGINS` của app-core: "Le Plateau Coffee", "Sokfram"),
 * vì web và Mini App lọc theo chuỗi đó (`brandBrowsePath`). Pineboo là nhãn riêng (cửa hàng, câu chuyện và bảng SKU riêng), không phải dòng con của
 * Fuwa3e, nên chưa có ghim trên bản đồ xuất xứ. `catalog-brand.spec.ts` ở app-core giữ bảng này khớp `BRAND_ORIGINS`.
 */

/** Nhãn mặc định đồng bộ Pancake ghi khi chưa biết nhãn thật. */
export const GENERIC_CATALOG_BRAND = 'Tubu Tree';

/** Giá trị `products.brand` được coi là "chưa gán nhãn": rỗng hoặc nhãn mặc định. Nhãn khác là Admin đã gán, không bao giờ bị suy đè. */
export const GENERIC_CATALOG_BRANDS: readonly string[] = ['', GENERIC_CATALOG_BRAND];

interface BrandRule {
  /** Giá trị ghi vào `products.brand`. */
  brand: string;
  /** Khớp trên tên đã bỏ dấu, chữ thường. Giữ dấu chấm và gạch nối trong tên nhãn; "BH nóng" có dấu cách không phải nhãn. */
  inName: RegExp;
  /** Khớp trên slug (gạch nối thay mọi ký tự ngăn). Null khi slug không phân biệt được: "BH.NONG" và "BH nóng giòn" cùng ra `bh-nong`. */
  inSlug: RegExp | null;
}

export const CATALOG_BRAND_RULES: readonly BrandRule[] = [
  { brand: 'Fuwa3e', inName: /\bfuwa[ -]?3e\b/, inSlug: /(?:^|-)fuwa-?3e(?:-|$)/ },
  { brand: 'Pineboo', inName: /\bpine[ -]?boo\b/, inSlug: /(?:^|-)pine-?boo(?:-|$)/ },
  { brand: 'BH.Nong', inName: /\bbh[.-]?nong\b/, inSlug: null },
  { brand: 'Pơ Lang', inName: /\bpo[ -]?lang\b/, inSlug: /(?:^|-)po-?lang(?:-|$)/ },
  { brand: 'Visante', inName: /\bvisante\b/, inSlug: /(?:^|-)visante(?:-|$)/ },
  { brand: 'Hector', inName: /\bhector\b/, inSlug: /(?:^|-)hector(?:-|$)/ },
  { brand: 'Le Plateau Coffee', inName: /\ble[ -]?plateau\b/, inSlug: /(?:^|-)le-?plateau(?:-|$)/ },
  { brand: 'Cobote', inName: /\bcobote\b/, inSlug: /(?:^|-)cobote(?:-|$)/ },
  // "Sokfram" là chính tả đang dùng trong catalog; tên sản phẩm viết cả hai kiểu.
  { brand: 'Sokfram', inName: /\bsokf(?:ar|ra)m\b/, inSlug: /(?:^|-)sokf(?:ar|ra)m(?:-|$)/ },
];

/** Mọi nhãn mà `inferCatalogBrandFromTitle` có thể trả về. */
export const INFERRABLE_CATALOG_BRANDS: readonly string[] = CATALOG_BRAND_RULES.map((r) => r.brand);

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** `products.brand` chưa có nhãn thật: rỗng, null hoặc "Tubu Tree". */
export function isGenericCatalogBrand(brand: string | null | undefined): boolean {
  return GENERIC_CATALOG_BRANDS.includes((brand ?? '').trim());
}

/**
 * Nhãn suy từ tên (rồi từ slug khi tên không có nhãn nào), hoặc null khi không được suy:
 * `currentBrand` đã là nhãn cụ thể (Admin gán: không bao giờ đè), không nhãn nào khớp, hoặc khớp từ hai nhãn trở lên (combo hai nhãn: không đoán).
 */
export function inferCatalogBrandFromTitle(name: string | null | undefined, slug: string | null | undefined, currentBrand: string | null | undefined): string | null {
  if (!isGenericCatalogBrand(currentBrand)) return null;
  const folded = fold(name ?? '');
  const byName = CATALOG_BRAND_RULES.filter((r) => r.inName.test(folded));
  if (byName.length > 0) return byName.length === 1 ? byName[0]!.brand : null;
  const s = (slug ?? '').trim().toLowerCase();
  const bySlug = s ? CATALOG_BRAND_RULES.filter((r) => r.inSlug?.test(s)) : [];
  return bySlug.length === 1 ? bySlug[0]!.brand : null;
}

/** Nhãn hiệu lực của sản phẩm: nhãn suy được, nếu không thì chính `products.brand`. */
export function effectiveCatalogBrand(name: string | null | undefined, slug: string | null | undefined, brand: string): string {
  return inferCatalogBrandFromTitle(name, slug, brand) ?? brand;
}
