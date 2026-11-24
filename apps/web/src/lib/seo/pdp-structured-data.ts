import { canonicalBrandName } from '@tubutree/app-core/brand-origins';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { ProductDetail } from '../api';
import { runningFlash, variationPricing, type FlashItem } from '../flash-price';
import { browseText } from '../browse-text';
import { browseBreadcrumb, browseCanonicalPath } from '../home-seo';
import { faqPageJsonLd } from '../page-seo';
import { breadcrumbJsonLd, productJsonLd, type ApprovedSeo, type Crumb, type ProductPolicySeo } from '../product-seo';
import { productFaqItems } from './product-faq';

export { vnDateOf } from '../product-seo';

/**
 * Vệt "Trang chủ › nhãn › sản phẩm" của trang sản phẩm. Mục nhãn trỏ về canonical của trang danh mục theo nhãn (cùng dạng URL với
 * `/san-pham?brand=` và sitemap), dùng tên nhãn hiện hành (chính tả cũ như "Sokfram" không hiển thị). Nhãn trống thì bỏ mục đó.
 */
export function pdpCrumbs(p: Pick<ProductDetail, 'brand' | 'name' | 'slug'>): Crumb[] {
  const crumbs: Crumb[] = [{ name: fillCopy('browse.crumbHome'), href: '/' }];
  const brand = p.brand?.trim() ? canonicalBrandName(p.brand.trim()) : '';
  if (brand) crumbs.push({ name: brand, href: browseCanonicalPath({ brand }) });
  crumbs.push({ name: p.name, href: `/san-pham/${encodeURIComponent(p.slug)}` });
  return crumbs;
}

/**
 * Vệt thứ hai "Trang chủ › Danh mục › … › danh mục của sản phẩm › sản phẩm": cùng vệt với breadcrumb của chính trang danh mục (`browseBreadcrumb`),
 * nối thêm sản phẩm. Khối "Cùng danh mục" cuối trang hiện đủ các danh mục của vệt thành liên kết. Không có danh mục thì rỗng.
 */
export function pdpCategoryCrumbs(p: Pick<ProductDetail, 'name' | 'slug'>, trail: readonly { id: string; name: string }[] | undefined): Crumb[] {
  if (!trail || trail.length === 0) return [];
  return [
    ...browseBreadcrumb({ home: fillCopy('browse.crumbHome'), browse: browseText.title, category: [...trail] }),
    { name: p.name, href: `/san-pham/${encodeURIComponent(p.slug)}` },
  ];
}

interface PdpJsonLdInput {
  product: ProductDetail & ApprovedSeo;
  /** URL tuyệt đối của trang (canonical, không tham số). */
  url: string;
  policy?: ProductPolicySeo;
  /** Danh sách Giờ vàng gieo vào trang (cùng bản `FlashSalesSeed` dùng để vẽ giá). */
  flash?: readonly FlashItem[];
  /** Mốc dựng trang: đợt đã hết giờ ở mốc này không được tính. */
  now: number;
  /** Hỏi–đáp mà khối "Hỏi nhanh" cuối trang đang vẽ (`pdpGeneratedFaq`): chỉ truyền đúng các câu đã nằm trong HTML. */
  faq?: readonly { q: string; a: string }[];
  /** Vệt danh mục của sản phẩm (gốc → lá, `pdpCategoryTrail`): có thì thêm BreadcrumbList thứ hai theo danh mục. */
  categoryTrail?: readonly { id: string; name: string }[];
}

const questionKey = (q: string) => q.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Các khối JSON-LD của trang sản phẩm, mỗi khối một thẻ `<script>`: Product (giá như khách thấy ở lần vẽ đầu, gồm Giờ vàng nếu đang chạy),
 * BreadcrumbList theo nhãn (vệt hiển thị đầu trang) và theo danh mục khi có, và MỘT FAQPage gộp hỏi–đáp mô tả viết sẵn với hỏi–đáp của khối
 * "Hỏi nhanh" (câu trùng giữ câu của mô tả). AggregateRating chỉ có khi API báo ít nhất một đánh giá hiển thị (xem `productJsonLd`).
 */
export function pdpJsonLd({ product, url, policy, flash, now, faq, categoryTrail }: PdpJsonLdInput): Record<string, unknown>[] {
  const running = runningFlash(flash ?? [], now);
  const priceOf = (v: ProductDetail['variations'][number]) => {
    const r = variationPricing(v, running);
    return r.isFlash && r.endAt ? { price: r.price, endAt: r.endAt } : { price: r.price };
  };
  const blocks = [productJsonLd(product, url, policy, priceOf), breadcrumbJsonLd(pdpCrumbs(product))];
  const byCategory = pdpCategoryCrumbs(product, categoryTrail);
  if (byCategory.length > 0) blocks.push(breadcrumbJsonLd(byCategory));
  const items = [...productFaqItems(product.description)];
  const seen = new Set(items.map((f) => questionKey(f.q)));
  for (const f of faq ?? []) {
    const key = questionKey(f.q);
    if (!key || !f.a.trim() || seen.has(key)) continue;
    seen.add(key);
    items.push({ q: f.q, a: f.a });
  }
  if (items.length > 0) blocks.push(faqPageJsonLd(items));
  return blocks;
}
