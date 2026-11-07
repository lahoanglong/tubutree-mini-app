import { fillCopy } from '../shop-copy';

/**
 * Link giới thiệu của CTV (Mini App và web): gắn `?ref=<mã CTV>` vào trang chủ hoặc trang sản phẩm, kèm lời giới thiệu ngắn để CTV dán gửi khách,
 * và danh sách "sản phẩm hoa hồng nổi bật" xếp theo số tiền hoa hồng dự kiến. Hai app chỉ vẽ và chép.
 */

/** Cùng khuôn mã giới thiệu mà `withReferral` của hai app chấp nhận; mã khác khuôn bị bỏ khỏi URL. */
const REF_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Đường dẫn trang sản phẩm trên web; Mini App dùng `/product` (truyền qua `productPath`). */
const WEB_PRODUCT_PATH = '/san-pham';

export interface AffiliateShareParams {
  /** Gốc link: `https://tubutree.com` ở web, `https://zalo.me/s/<id>` ở Mini App. Dấu / cuối bị bỏ. */
  baseUrl: string;
  /** Có slug thì link tới trang sản phẩm, không thì trang chủ. */
  productSlug?: string | null;
  /** Tên sản phẩm cho lời giới thiệu; thiếu thì dùng câu chung. */
  productName?: string | null;
  affiliateCode: string;
  /** Đường dẫn trang sản phẩm của nền tảng; mặc định theo web. */
  productPath?: string;
}

export interface AffiliateShare {
  url: string;
  /** Lời giới thiệu một dòng đã kèm link, chép là gửi được. */
  text: string;
}

const tidy = (s: string): string => s.replace(/!/g, '').replace(/\s+/g, ' ').trim();

/**
 * Link giới thiệu + lời giới thiệu. Mã CTV sai khuôn (không thể xảy ra với mã máy chủ cấp) thì link không có `ref`, không đưa chuỗi lạ vào URL;
 * nơi gọi chỉ dựng link khi đã có mã.
 */
export function buildAffiliateShareUrl(p: AffiliateShareParams): AffiliateShare {
  const base = p.baseUrl.replace(/\/+$/, '');
  const slug = p.productSlug?.trim();
  const path = slug ? `${p.productPath ?? WEB_PRODUCT_PATH}/${encodeURIComponent(slug)}` : '/';
  const ref = REF_CODE_PATTERN.test(p.affiliateCode) ? `?ref=${p.affiliateCode}` : '';
  const url = `${base}${path}${ref}`;
  const name = p.productName ? tidy(p.productName) : '';
  const text = slug && name ? fillCopy('ctv.share.introProduct', { name, url }) : fillCopy('ctv.share.introHome', { url });
  return { url, text };
}

/** Hoa hồng dự kiến của một sản phẩm theo giá và mức % (làm tròn xuống như máy chủ ở `affiliate.service`); giá hoặc mức không hợp lệ thì 0. */
export function estimateCommission(price: number, ratePct: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(ratePct) || price <= 0 || ratePct <= 0) return 0;
  return Math.floor((price * ratePct) / 100);
}

/** Phần của một dòng `PickerProduct` (API `/storefront/me/products`) mà khối hoa hồng cần. */
export interface FeaturedSource {
  id: string;
  name: string;
  slug: string;
  thumbnail: string | null;
  basePrice: number;
  salePrice: number | null;
  /** Mức hoa hồng cao nhất trong các phân loại đang bán (phần trăm). */
  maxAffiliateRate: number;
}

export interface FeaturedAffiliateProduct {
  id: string;
  name: string;
  slug: string;
  thumbnail: string | null;
  /** Giá đang bán của một sản phẩm. */
  price: number;
  ratePct: number;
  /** Hoa hồng dự kiến cho đơn một sản phẩm (tới mức cao nhất của sản phẩm). */
  commission: number;
  share: AffiliateShare;
}

export interface FeaturedOptions {
  baseUrl: string;
  affiliateCode: string;
  productPath?: string;
  /** Số sản phẩm giữ lại; mặc định 5. */
  limit?: number;
}

/** Giá đang bán: giá giảm khi có và thấp hơn giá gốc. */
const sellingPrice = (p: Pick<FeaturedSource, 'basePrice' | 'salePrice'>): number => (p.salePrice !== null && p.salePrice > 0 && p.salePrice < p.basePrice ? p.salePrice : p.basePrice);

/** Sản phẩm có hoa hồng, nhiều tiền nhất lên đầu (bằng nhau thì mức % cao hơn), kèm link giới thiệu sẵn. */
export function featuredAffiliateProducts(products: readonly FeaturedSource[], opts: FeaturedOptions): FeaturedAffiliateProduct[] {
  return products
    .map<FeaturedAffiliateProduct>((p) => {
      const price = sellingPrice(p);
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        thumbnail: p.thumbnail,
        price,
        ratePct: p.maxAffiliateRate,
        commission: estimateCommission(price, p.maxAffiliateRate),
        share: buildAffiliateShareUrl({ baseUrl: opts.baseUrl, productSlug: p.slug, productName: p.name, affiliateCode: opts.affiliateCode, productPath: opts.productPath }),
      };
    })
    .filter((p) => p.commission > 0)
    .sort((a, b) => b.commission - a.commission || b.ratePct - a.ratePct)
    .slice(0, opts.limit ?? 5);
}
