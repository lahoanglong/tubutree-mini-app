import type { Metadata } from 'next';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { ogBase, withBrand } from './og';
import { breadcrumbJsonLd, type Crumb } from './product-seo';
import { SITE_URL } from './site';

interface StaticPageSeo {
  /** Đường dẫn công khai của trang, bắt đầu bằng "/" và không kèm query (canonical, og:url và JSON-LD cùng dùng chuỗi này). */
  path: string;
  /** Tiêu đề chưa gồm hậu tố "— Tubu Tree" (template ở layout gốc thêm vào <title>; og:title thêm bằng `withBrand`). */
  title: string;
  description: string;
}

/**
 * Metadata cho trang tĩnh công khai được lập chỉ mục: canonical + openGraph đủ siteName, locale, ảnh mặc định và `url` của chính trang,
 * để link chia sẻ qua Zalo/Messenger hiện thẻ xem trước. Đường dẫn tương đối được Next ghép với `metadataBase` (= SITE_URL ở layout gốc).
 * Trang noindex không dùng hàm này (không khai canonical và og:url).
 */
export function staticPageMetadata({ path, title, description }: StaticPageSeo): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { ...ogBase, url: path, title: withBrand(title), description },
  };
}

/**
 * WebPage + BreadcrumbList (một `@graph`) cho trang tĩnh. Chỉ dùng chữ đã có trong metadata và đường dẫn của chính trang; không khai
 * giá, đánh giá, bài đăng hay mốc thời gian vì những thứ đó đổi theo dữ liệu và crawler sẽ coi chỗ lệch là khai sai.
 * `isPartOf` trỏ về WebSite đã khai ở trang chủ (cùng `@id` với `siteJsonLd`), nên không lặp Organization ở từng trang.
 * Vệt breadcrumb: "Trang chủ" rồi các mục `trail` (mặc định chỉ chính trang).
 */
export function staticPageJsonLd({ path, title, description, trail }: StaticPageSeo & { trail?: readonly Crumb[] }): Record<string, unknown> {
  const url = `${SITE_URL}${path}`;
  const crumbs: Crumb[] = [{ name: fillCopy('browse.crumbHome'), href: '/' }, ...(trail ?? [{ name: title, href: path }])];
  const { itemListElement } = breadcrumbJsonLd(crumbs);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: title,
        description,
        inLanguage: 'vi',
        isPartOf: { '@id': `${SITE_URL}/#website` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      { '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`, itemListElement },
    ],
  };
}
