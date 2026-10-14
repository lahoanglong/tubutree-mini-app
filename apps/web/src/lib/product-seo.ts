import type { ProductDetail } from './api';

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

/** Dữ liệu có cấu trúc schema.org/Product để Google hiện giá, tình trạng hàng và đánh giá ở kết quả tìm kiếm. */
export function productJsonLd(p: ProductDetail, url: string): Record<string, unknown> {
  const images = galleryImages(p);
  const prices = p.variations.map((v) => v.salePrice ?? v.retailPrice);
  const availability = p.variations.some((v) => v.stock > 0) ? IN_STOCK : OUT_OF_STOCK;

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
    brand: { '@type': 'Brand', name: p.brand },
    description: plainText(p.shortDesc ?? p.description).slice(0, JSON_LD_DESCRIPTION_MAX),
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
