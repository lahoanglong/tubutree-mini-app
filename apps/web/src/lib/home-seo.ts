import type { Metadata } from 'next';
import { normalizeSearchQuery } from './catalog-filter';
import { homeText } from './home-text';
import { SITE_URL } from './site';
import type { SupportContact } from './api';
import { trimAtWord, type Crumb } from './product-seo';

/** Tiêu đề trang chủ: từ khoá của h1 + tên nhãn, ≤ 60 ký tự; `absolute` để template gốc không nối thêm hậu tố. */
export const HOME_TITLE = `Tubu Tree — ${homeText.seoTitle}`;
export const HOME_DESCRIPTION =
  'Tubu Tree: mỹ phẩm và đồ tiêu dùng sinh học thuần khiết, thiên nhiên Việt cho cả nhà. Sống xanh an lành cùng các thương hiệu Việt, xem hành trình nguyên liệu.';

const BRAND_TITLE_MAX = 60;
const BROWSE_PATH = '/san-pham';

interface BrowseSeoFilter {
  brand?: string;
  page?: number;
  /** Danh mục đã xác nhận có trong cây (id đúng như trên URL) và là bộ lọc duy nhất: trang danh mục được lập chỉ mục. */
  category?: { id: string; name: string };
}

/** Tham số URL làm kết quả khác "danh sách gốc" (khách tự lọc/sắp xếp/tìm): trang lọc là bản trùng nên không lập chỉ mục. */
const NOINDEX_PARAMS = ['segment', 'minPrice', 'maxPrice', 'inStock', 'rating', 'sort', 'all'] as const;

/**
 * Noindex theo tham số. `?category=` đứng một mình là trang danh mục (lập chỉ mục, nếu danh mục có thật: việc của `generateMetadata`,
 * cần cây danh mục); kèm bất kỳ tham số nào khác (nhãn, trang, lọc, sắp xếp, tìm) hoặc rỗng thì noindex.
 */
export function browseNoindex(params: URLSearchParams): boolean {
  if (normalizeSearchQuery(params.get('q'))) return true;
  if (NOINDEX_PARAMS.some((k) => params.has(k))) return true;
  if (!params.has('category')) return false;
  return !params.get('category') || params.has('brand') || params.has('page');
}

/**
 * Đường dẫn canonical của trang danh mục theo bộ lọc: trang 1 không lọc là "/san-pham", còn lại tự trỏ về chính nó
 * (không từ khoá tìm kiếm — trang tìm kiếm đã noindex). Dựng riêng: canonical không được mang tham số theo dõi (utm, ref, s).
 */
export function browseCanonicalPath({ brand, page, category }: BrowseSeoFilter): string {
  const params = new URLSearchParams();
  if (category) params.set('category', category.id);
  if (brand) params.set('brand', brand);
  if (page && page > 1) params.set('page', String(Math.floor(page)));
  const qs = params.toString();
  return qs ? `${BROWSE_PATH}?${qs}` : BROWSE_PATH;
}

/**
 * Metadata trang danh mục cho từng biến thể (nhãn, danh mục, trang N): mỗi URL một tiêu đề + mô tả + canonical riêng, để công cụ
 * tìm kiếm không coi các trang phân trang là bản trùng nội dung. `brandKnown` = nhãn có trong danh mục thật; URL tự bịa
 * thì không cho lập chỉ mục. Tiêu đề chưa gồm hậu tố "— Tubu Tree" (template ở layout gốc thêm).
 *
 * Danh sách gốc không lọc từ trang 2 (`?page=N`) noindex như `?all=1` (trang 1 của danh sách): nếu không, trang 1 noindex mà trang 2+ lập chỉ mục
 * và rel=prev trỏ về trang noindex. Trang noindex không khai canonical (hai tín hiệu mâu thuẫn).
 */
export function browseMetadata(filter: BrowseSeoFilter, brandKnown: boolean): Metadata {
  const brand = filter.brand?.slice(0, BRAND_TITLE_MAX).trim() || undefined;
  const page = filter.page && filter.page > 1 ? Math.floor(filter.page) : 1;
  const category = filter.category;
  const meta: Metadata = {};
  const noindex = (filter.brand && !brandKnown) || (page > 1 && !brand && !category);
  if (noindex) meta.robots = { index: false, follow: true };
  else meta.alternates = { canonical: browseCanonicalPath({ brand: filter.brand, page, category }) };

  if (category) {
    meta.title = category.name;
    meta.description = trimAtWord(`${category.name} tại Tubu Tree: sản phẩm mỹ phẩm và đồ tiêu dùng thiên nhiên, lọc theo giá, thương hiệu, đánh giá.`);
  } else if (brand) {
    meta.title = `Sản phẩm ${brand}${page > 1 ? ` — Trang ${page}` : ''}`;
    meta.description = `Mua sản phẩm ${brand} chính hãng tại Tubu Tree${page > 1 ? ` (trang ${page})` : ''}: hàng sống xanh, an toàn, giao nhanh toàn quốc.`;
  } else if (page > 1) {
    meta.title = `Sản phẩm sống xanh — Trang ${page}`;
    meta.description = `Trang ${page} danh mục mỹ phẩm và đồ tiêu dùng thiên nhiên của Tubu Tree.`;
  } else {
    meta.title = 'Tất cả sản phẩm';
    meta.description = 'Danh mục mỹ phẩm và đồ tiêu dùng thiên nhiên của Tubu Tree: tìm kiếm, lọc theo giá, thương hiệu, đánh giá.';
  }
  return meta;
}

/** Đường dẫn chữ "Trang chủ › Danh mục › …" của trang danh mục theo nhãn hoặc danh mục (cùng dãy với vệt breadcrumb của BrowseView). */
export function browseBreadcrumb(opts: { home: string; browse: string; brand?: string; category?: { id: string; name: string }[] }): Crumb[] {
  const crumbs: Crumb[] = [{ name: opts.home, href: '/' }, { name: opts.browse, href: BROWSE_PATH }];
  if (opts.category && opts.category.length > 0) {
    for (const n of opts.category) crumbs.push({ name: n.name, href: `${BROWSE_PATH}?category=${encodeURIComponent(n.id)}` });
  } else if (opts.brand) {
    crumbs.push({ name: opts.brand, href: browseCanonicalPath({ brand: opts.brand }) });
  }
  return crumbs;
}

const toE164 = (phone: string): string => {
  const digits = phone.replace(/[^\d+]/g, '');
  return digits.startsWith('0') ? `+84${digits.slice(1)}` : digits;
};

/**
 * Organization + WebSite (một `@graph`) cho trang chủ. Chỉ dùng giá trị đã có trong cấu hình công khai (hotline/email hỗ trợ, link cộng đồng https);
 * thiếu thì bỏ trường, không bịa. Logo là app/icon.png, được Next phục vụ ở /icon.png.
 */
export function siteJsonLd(support: Pick<SupportContact, 'hotline' | 'email' | 'community'> | undefined): Record<string, unknown> {
  const sameAs = Object.values(support?.community ?? {}).filter((u): u is string => typeof u === 'string' && u !== '');
  const contact: Record<string, string> = {};
  if (support?.hotline) contact.telephone = toE164(support.hotline);
  if (support?.email) contact.email = support.email;
  const organization: Record<string, unknown> = {
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: 'Tubu Tree',
    url: SITE_URL,
    logo: `${SITE_URL}/icon.png`,
  };
  if (sameAs.length > 0) organization.sameAs = sameAs;
  if (Object.keys(contact).length > 0) {
    organization.contactPoint = [{ '@type': 'ContactPoint', contactType: 'customer service', areaServed: 'VN', availableLanguage: 'vi', ...contact }];
  }
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organization,
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: 'Tubu Tree',
        url: SITE_URL,
        publisher: { '@id': `${SITE_URL}/#organization` },
        potentialAction: { '@type': 'SearchAction', target: `${SITE_URL}/san-pham?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
      },
    ],
  };
}
