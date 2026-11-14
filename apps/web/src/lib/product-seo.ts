import type { ProductDetail } from './api';
import { SITE_URL } from './site';

const MAX_GALLERY = 12;
const JSON_LD_DESCRIPTION_MAX = 500;
const HTTP_URL = /^https?:\/\//i;

/**
 * Ảnh sản phẩm theo thứ tự hiển thị: ảnh đại diện trước, rồi các ảnh còn lại, bỏ trùng. Chỉ nhận http(s) vì URL ảnh do
 * đối tác/Pancake nhập (javascript:/data: không được lọt vào src hay JSON-LD).
 */
export function galleryImages(p: Pick<ProductDetail, 'thumbnail' | 'images'>): string[] {
  const seen = new Set<string>();
  for (const raw of [p.thumbnail, ...(p.images ?? [])]) {
    const url = typeof raw === 'string' ? raw.trim() : '';
    if (HTTP_URL.test(url)) seen.add(url);
    if (seen.size >= MAX_GALLERY) break;
  }
  return [...seen];
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Mô tả từ Pancake có thể là HTML. Đổi sang văn bản thường (hiển thị bằng whitespace-pre-line) thay vì
 * dangerouslySetInnerHTML: không cần tin nội dung đối tác và không cần thư viện làm sạch.
 */
export function plainText(html: string | null | undefined): string {
  if (!html) return '';
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<li\b[^>]*>/gi, '\u0001')
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\n*\u0001/g, '\n• ')
    .replace(/&(#\d+|#x[\da-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return ENTITY[e.toLowerCase()] ?? m;
    });
  return text
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const IN_STOCK = 'https://schema.org/InStock';
const OUT_OF_STOCK = 'https://schema.org/OutOfStock';
const DISCONTINUED = 'https://schema.org/Discontinued';

const BRAND_NAME = 'Tubu Tree';
export const META_DESCRIPTION_MAX = 160;

/**
 * Cắt mô tả meta ở ranh giới từ (không bỏ lửng giữa từ), gộp xuống một dòng và thêm "…" khi có cắt; kết quả luôn ≤ `max` ký tự.
 */
export function trimAtWord(text: string, max = META_DESCRIPTION_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max - 1);
  // Ký tự ngay sau điểm cắt là khoảng trắng nghĩa là đã cắt đúng ranh giới từ; ngược lại lùi về khoảng trắng gần nhất.
  const cut = flat[max - 1] === ' ' ? head : head.includes(' ') ? head.slice(0, head.lastIndexOf(' ')) : head;
  return `${cut.replace(/[\s,;:.\-–—]+$/, '')}…`;
}

/** Trần của `metaTitle`/`metaDesc` đã duyệt trong Admin (khớp `SEO_TITLE_MAX`/`SEO_DESC_MAX` ở apps/api): giá trị nhập ngoài Admin vượt trần thì cắt an toàn. */
export const META_TITLE_APPROVED_MAX = 65;
export const META_DESC_APPROVED_MAX = 155;

/**
 * SEO đã duyệt trong DB. API trả cả hai trường nhưng `ProductDetail` chưa khai, nên nhận qua kiểu cấu trúc tùy chọn:
 * trang truyền nguyên `product` nên giá trị tới nơi mà không cần đổi nơi gọi.
 */
export interface ApprovedSeo {
  metaTitle?: string | null;
  metaDesc?: string | null;
}

// Template tiêu đề gốc đã thêm " — Tubu Tree", nên hậu tố thương hiệu của chính `metaTitle` ("| Tubu Tree", "— Tubu Tree") phải gỡ để khỏi lặp.
const OWN_BRAND_SUFFIX = new RegExp(`\\s*[|—–-]\\s*${BRAND_NAME}\\s*$`, 'i');

/**
 * Tiêu đề trang sản phẩm (chưa gồm hậu tố "— Tubu Tree" của template gốc). Có `metaTitle` đã duyệt thì dùng đúng giá trị đó (cắt an toàn nếu vượt trần);
 * không thì dựng từ tên + nhãn, sản phẩm thuộc nhãn Tubu Tree không lặp tên nhãn.
 */
export function productTitle(p: Pick<ProductDetail, 'name' | 'brand'> & ApprovedSeo): string {
  const approved = p.metaTitle?.trim();
  if (approved) return trimAtWord(approved.replace(OWN_BRAND_SUFFIX, '').trim() || approved, META_TITLE_APPROVED_MAX);
  const brand = p.brand?.trim();
  return brand && brand.toLowerCase() !== BRAND_NAME.toLowerCase() ? `${p.name} — ${brand}` : p.name;
}

/** Mô tả meta: `metaDesc` đã duyệt, rồi mô tả ngắn, rồi mô tả đầy đủ (chuỗi rỗng từ Pancake không rơi xuống `??`), cuối cùng dựng từ tên + nhãn. */
export function productMetaDescription(p: Pick<ProductDetail, 'name' | 'brand' | 'shortDesc' | 'description'> & ApprovedSeo): string {
  const approved = p.metaDesc?.trim();
  if (approved) return trimAtWord(approved, META_DESC_APPROVED_MAX);
  const own = plainText(p.shortDesc) || plainText(p.description);
  if (own) return trimAtWord(own);
  const brand = p.brand?.trim();
  return trimAtWord(
    brand && brand.toLowerCase() !== BRAND_NAME.toLowerCase()
      ? `${p.name} — ${brand}, bán tại Tubu Tree.`
      : `${p.name} — sản phẩm thiên nhiên tại Tubu Tree.`,
  );
}

/** Tình trạng bán cho JSON-LD: gian hàng tạm nghỉ → hết hàng, đã ngừng bán → Discontinued, còn lại theo tồn kho. */
export function productAvailability(p: Pick<ProductDetail, 'variations' | 'fulfiller'>): string {
  const f = p.fulfiller;
  if (f?.kind === 'UNAVAILABLE') return f.reason === 'STORE_PAUSED' ? OUT_OF_STOCK : DISCONTINUED;
  return p.variations.some((v) => v.stock > 0) ? IN_STOCK : OUT_OF_STOCK;
}

/** Mô tả meta của trang thương hiệu: khẩu hiệu, rồi câu giới thiệu, cuối cùng dựng từ tên (+ xuất xứ nếu có); không đưa thêm điều khẳng định nào. */
export function brandMetaDescription(b: { name: string; tagline?: string | null; story?: string | null; origin?: string | null }): string {
  const tagline = plainText(b.tagline);
  if (tagline) return trimAtWord(tagline);
  const story = plainText(b.story);
  if (story) return trimAtWord(`${b.name} trên Tubu Tree: ${story}`);
  const origin = b.origin?.trim();
  return trimAtWord(`${b.name}${origin ? ` đến từ ${origin}` : ''} — thương hiệu sống xanh trên Tubu Tree.`);
}

export interface Crumb {
  name: string;
  /** Đường dẫn trong site (có thể kèm query); bỏ trống ở mục cuối nếu không có URL riêng. */
  href?: string;
}

/** Dữ liệu có cấu trúc BreadcrumbList; mọi URL được đổi sang tuyệt đối. */
export function breadcrumbJsonLd(items: readonly Crumb[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      ...(c.href ? { item: `${SITE_URL}${c.href}` } : {}),
    })),
  };
}

/** Dữ liệu có cấu trúc schema.org/Product để Google hiện giá, tình trạng hàng và đánh giá ở kết quả tìm kiếm. */
export function productJsonLd(p: ProductDetail & ApprovedSeo, url: string): Record<string, unknown> {
  const images = galleryImages(p);
  const prices = p.variations.map((v) => v.salePrice ?? v.retailPrice);
  const availability = productAvailability(p);

  let offers: Record<string, unknown>;
  if (p.variations.length > 1) {
    offers = {
      '@type': 'AggregateOffer',
      priceCurrency: 'VND',
      lowPrice: Math.min(...prices),
      highPrice: Math.max(...prices),
      offerCount: p.variations.length,
      availability,
    };
  } else {
    offers = { '@type': 'Offer', url, priceCurrency: 'VND', price: prices[0] ?? p.salePrice ?? p.basePrice, availability };
  }

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    url,
    brand: { '@type': 'Brand', name: p.brand?.trim() || BRAND_NAME },
    // Chuỗi rỗng từ Pancake không rơi xuống `??`; mô tả JSON-LD không bao giờ rỗng vì Google coi thiếu `description` là cảnh báo.
    description: (plainText(p.shortDesc) || plainText(p.description) || productMetaDescription(p)).slice(0, JSON_LD_DESCRIPTION_MAX),
    offers,
  };
  if (images.length > 0) ld.image = images;
  if (p.variations.length === 1 && p.variations[0]!.sku) ld.sku = p.variations[0]!.sku;
  if ((p.reviewCount ?? 0) > 0 && (p.ratingAvg ?? 0) > 0) {
    ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: p.ratingAvg, reviewCount: p.reviewCount };
  }
  return ld;
}

/** JSON an toàn để đặt trong <script type="application/ld+json">: thoát "<" để chuỗi trong dữ liệu không đóng được thẻ script. */
export const jsonLdScript = (data: unknown): string => JSON.stringify(data).replace(/</g, '\\u003c');
