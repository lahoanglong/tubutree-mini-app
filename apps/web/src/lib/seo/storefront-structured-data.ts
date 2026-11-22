import { SITE_URL } from '../site';

/** Phần gian hàng JSON-LD cần (lấy từ `getStorefront`, đã lọc món không có sản phẩm). */
export interface StorefrontLdInput {
  slug: string;
  title: string;
  headerNote?: string | null;
  isSample?: boolean;
  avatarUrl?: string | null;
  collections: readonly { items: readonly { product: { slug: string; name: string } }[] }[];
}

/** Trần số món trong ItemList: đủ cho mọi bộ sưu tập hiện trong HTML mà khối JSON-LD không phình theo gian hàng lớn. */
export const STOREFRONT_LD_MAX_ITEMS = 30;

/** Chỉ URL https tuyệt đối mới vào JSON-LD: ảnh gian hàng có thể là base64 hoặc đường dẫn nội bộ. */
const httpsUrl = (u: string | null | undefined): string | undefined => (typeof u === 'string' && /^https:\/\/[^\s"<>]+$/.test(u) ? u : undefined);

/**
 * `OnlineStore` + `ItemList` (một `@graph`) cho gian hàng đã đăng `/s/[slug]`. API công khai chỉ trả gian hàng đã đăng; gian hàng mẫu (noindex, không phải người bán
 * thật) thì null. `OnlineStore` chứ không `Store`: Store là cửa hàng có địa chỉ (LocalBusiness), gian hàng CTV chỉ bán online. ItemList là các sản phẩm đang hiện trong HTML, theo thứ tự bộ sưu tập, mỗi sản phẩm một lần.
 */
export function storefrontJsonLd(sf: StorefrontLdInput): Record<string, unknown> | null {
  if (sf.isSample) return null;
  const url = `${SITE_URL}/s/${encodeURIComponent(sf.slug)}`;
  const seen = new Set<string>();
  const products = sf.collections
    .flatMap((c) => c.items.map((it) => it.product))
    .filter((p) => p.slug && !seen.has(p.slug) && seen.add(p.slug))
    .slice(0, STOREFRONT_LD_MAX_ITEMS);
  const description = sf.headerNote?.trim();
  const image = httpsUrl(sf.avatarUrl);
  const store: Record<string, unknown> = {
    '@type': 'OnlineStore',
    '@id': `${url}#store`,
    name: sf.title,
    url,
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
  };
  const graph: Record<string, unknown>[] = [store];
  if (products.length > 0) {
    graph.push({
      '@type': 'ItemList',
      '@id': `${url}#items`,
      name: sf.title,
      numberOfItems: products.length,
      itemListElement: products.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE_URL}/san-pham/${encodeURIComponent(p.slug)}`, name: p.name })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}
