import type { Metadata } from 'next';
import { ogBase, withBrand } from '../og';
import { breadcrumbJsonLd, type Crumb } from '../product-seo';
import { SITE_URL } from '../site';

/** Sản phẩm đang hiện trong danh sách của trang (kệ Bán chạy ở hub, hoặc trang danh sách đầu). */
export interface CollectionItem {
  slug: string;
  name: string;
}

/** Canonical tương đối của metadata; trang noindex không có (browseMetadata không khai canonical cho trang noindex). */
function canonicalOf(meta: Metadata): string | undefined {
  const c = meta.alternates?.canonical;
  return typeof c === 'string' && c.startsWith('/') ? c : undefined;
}

/**
 * og/twitter cho trang danh mục được lập chỉ mục, dựng từ chính metadata (tiêu đề, mô tả, canonical) để thẻ chia sẻ không lệch trang:
 * layout gốc chỉ khai type/siteName/locale nên thiếu khối này thì og:url, og:title của mọi biến thể danh mục trống. Trang noindex giữ nguyên.
 * `image`: ảnh riêng của trang (bìa thương hiệu); vắng thì ảnh chung của site.
 */
export function withBrowseSocial(meta: Metadata, image?: string): Metadata {
  const canonical = canonicalOf(meta);
  if (!canonical || typeof meta.title !== 'string') return meta;
  const title = withBrand(meta.title);
  const description = typeof meta.description === 'string' ? meta.description : undefined;
  return {
    ...meta,
    openGraph: { ...ogBase, url: canonical, title, ...(description ? { description } : {}), images: image ? [image] : ogBase.images },
    twitter: { card: 'summary_large_image', title, ...(description ? { description } : {}), images: image ? [image] : ogBase.images.map((i) => i.url) },
  };
}

/**
 * CollectionPage + BreadcrumbList (một `@graph`) cho trang danh mục được lập chỉ mục. Tên, mô tả, URL lấy từ metadata của chính trang (cùng
 * canonical), ItemList chỉ gồm các sản phẩm đang hiện trong HTML máy chủ (`startPosition` = số món của các trang trước). Trang noindex hoặc
 * thiếu tiêu đề thì null. `isPartOf` trỏ về WebSite đã khai ở trang chủ (`siteJsonLd`).
 */
export function browseCollectionJsonLd(meta: Metadata, crumbs: readonly Crumb[], items: readonly CollectionItem[], startPosition = 0): Record<string, unknown> | null {
  const canonical = canonicalOf(meta);
  if (!canonical || typeof meta.title !== 'string') return null;
  const url = `${SITE_URL}${canonical}`;
  const list = items
    .filter((it) => it.slug)
    .map((it, i) => ({ '@type': 'ListItem', position: startPosition + i + 1, url: `${SITE_URL}/san-pham/${encodeURIComponent(it.slug)}`, name: it.name }));
  const page: Record<string, unknown> = {
    '@type': 'CollectionPage',
    '@id': `${url}#collection`,
    url,
    name: meta.title,
    ...(typeof meta.description === 'string' ? { description: meta.description } : {}),
    inLanguage: 'vi',
    isPartOf: { '@id': `${SITE_URL}/#website` },
    breadcrumb: { '@id': `${url}#breadcrumb` },
  };
  if (list.length > 0) page.mainEntity = { '@type': 'ItemList', numberOfItems: list.length, itemListElement: list };
  const { itemListElement } = breadcrumbJsonLd(crumbs);
  return { '@context': 'https://schema.org', '@graph': [page, { '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`, itemListElement }] };
}
