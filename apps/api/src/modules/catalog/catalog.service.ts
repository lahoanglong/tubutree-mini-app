import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, type Category } from '@prisma/client';
import { VARIATION_ORDER_BY, cardPriceWithFlash, cardPrices, sortVariationsByPrice, type FlashOffer } from './variation-order';
import { activeFlashWhere, isStillDiscounted } from '../flash-sale/flash-active';
import { PrismaService } from '../../prisma/prisma.service';
import { paginated, skipTake } from '../../common/pagination';
import { ProductQuery } from './dto/product-query.dto';
import type { BrandProductsQuery } from './dto/brand-products-query.dto';
import { foldVietnamese, likeContainsPattern } from './search-text';
import { CRON_TZ } from '../../common/cron-tz';
import { PUBLIC_PRODUCT_WHERE, isPublicProduct } from './public-product';
import { SystemConfigService } from '../system-config/system-config.service';
import { merchantStoreUnavailableReason, TUBU_FULFILLER_NAME, type UnavailableReason } from '../checkout/checkout-split';
import { isPartnerStore } from '../merchant/partner-store';
import { DEFAULT_MERCHANT_SHIPPING_FEE } from '../merchant/merchant-config';
import { isPartnerOwnedProduct } from '../cart/partner-goods';
import { TrackCron } from '../../common/cron-run/track-cron';
import { publicImages, publicProductThumb } from '../../common/public-image';
import { publicImage } from '../../common/public-image';
import { CATALOG_LOVED_KEYS, DEFAULT_LOVED_THRESHOLDS, LOVED_THRESHOLD_MAX, isLoved, sanitizeLovedThreshold, type LovedThresholds } from './catalog-loved';

/**
 * Ai giao sản phẩm (D4), cho trang chi tiết: hàng gian hàng tự giao đi kiện riêng với phí giao/ngưỡng miễn phí của gian
 * hàng (giống lúc checkout), không theo luật freeship của Tubu, và không đặt định kỳ/mua chung được. UNAVAILABLE: gian hàng đang
 * tạm nghỉ hoặc đã ngừng bán nên chưa nhận đơn (R3-MERCHANT-3) — trang vẫn hiện, nút mua tắt.
 */
export interface ProductFulfiller {
  kind: 'TUBU' | 'MERCHANT' | 'UNAVAILABLE';
  name: string;
  shippingFee: number | null;
  freeShipFrom: number | null;
  reason?: UnavailableReason;
}

type FulfillerStore = {
  title: string;
  type: string;
  isPartner?: boolean;
  shippingFee: number | null;
  freeShipFrom: number | null;
  ordersPausedAt: Date | null;
  owner: { role: string; isBlocked: boolean } | null;
};

/** Trần số id trả về từ SQL tìm không dấu — catalog hiện vài trăm SP; chặn trường hợp từ khoá quá chung. */
const TEXT_MATCH_LIMIT = 2000;
/** Số slug tối đa một lần lấy theo `slugs` (khớp số mục của dải "Đã xem gần đây" trên Mini App). */
const MAX_LIST_SLUGS = 20;
/** Cửa sổ của `soldApp30d` ("Bán chạy nhất"), tính theo ngày giao. */
const SOLD_WINDOW_DAYS = 30;

/** Gợi ý khi gõ: từ khoá (đã gấp dấu) ngắn hơn thế khớp gần như mọi SP và trigram không lọc được. */
export const SUGGEST_MIN_CHARS = 2;

/**
 * SQL lấy id SP khớp từ khoá (không dấu, không phân biệt hoa thường — spec 4b §2): so trên cột
 * `"nameSearch"` mà trigger DB giữ bằng `foldVietnamese(name)` (migration
 * 20261010053812_catalog_name_search_index) nên dùng được index trigram, thay vì gấp dấu từng dòng.
 * Tag vẫn khớp đúng nguyên văn (chữ thường); `@>` thay `= ANY` để đi được GIN `products_tags_gin`.
 *
 * An toàn SQL: mọi giá trị đi qua tham số ràng buộc. `ESCAPE '!'` PHẢI là chữ trong câu lệnh
 * (`${...}` luôn thành tham số) và bằng `LIKE_ESCAPE`. ORDER BY cho phần cắt `LIMIT` ổn định và giữ
 * lại SP nổi bật/bán chạy khi từ khoá quá chung; điều kiện isActive/approvalStatus lặp lại
 * `listWhere` để SP ẩn không chiếm chỗ trong phần cắt.
 */
export function textMatchSql(raw: string): Prisma.Sql {
  const tag = raw.toLowerCase();
  return Prisma.sql`
    SELECT p.id FROM products p
    WHERE p."isActive" = true
      AND p."approvalStatus" = 'APPROVED'
      AND (p."nameSearch" LIKE ${likeContainsPattern(raw)} ESCAPE '!' OR p.tags @> ARRAY[${tag}]::text[])
    ORDER BY p."isFeatured" DESC, (p."soldExternal" + p."soldApp") DESC, p.id ASC
    LIMIT ${TEXT_MATCH_LIMIT}`;
}

/** Khoảng giá cho filter Prisma; min > max thì đổi chỗ (client không gửi vậy, nhưng không 400). */
type PriceBounds = { gte?: number; lte?: number };

function priceRange(min?: number, max?: number): PriceBounds | undefined {
  if (min == null && max == null) return undefined;
  let lo = min;
  let hi = max;
  if (lo != null && hi != null && lo > hi) [lo, hi] = [hi, lo];
  return { ...(lo != null ? { gte: lo } : {}), ...(hi != null ? { lte: hi } : {}) };
}

const inPriceRange = (value: number, r: PriceBounds) => (r.gte == null || value >= r.gte) && (r.lte == null || value <= r.lte);

type CardVariation = { id: string; sku: string; retailPrice: number; salePrice: number | null; stock: number };
const CARD_VARIATION_SELECT = { id: true, sku: true, retailPrice: true, salePrice: true, stock: true } satisfies Prisma.VariationSelect;

/** Giá khách thấy trên thẻ: giá đang bán của phân loại đại diện, hoặc giá Giờ vàng thắng (xem `cardPriceWithFlash`). */
function standingOf(p: { id: string; basePrice: number; salePrice: number | null; variations: CardVariation[] }, offers: ReadonlyMap<string, FlashOffer[]>): number {
  return cardPriceWithFlash(p, p.variations, offers.get(p.id));
}

/** Danh mục kèm số SP đang bán — miniapp chỉ hiện danh mục có hàng (plan 4b Ruling 4). */
export type CategoryWithCount = Category & { productCount: number };
/** Nút của cây danh mục: `productCount` của cha đã cộng cả con (mỗi sản phẩm một lần). */
export type CategoryNode = CategoryWithCount & { children: CategoryNode[] };

type PricedFields = { basePrice: number; salePrice: number | null; variations: CardVariation[] };

/** Cột Product thẻ cần; `fulfilment`/`storefrontId` thiếu (mẫu cũ, dữ liệu trước cột) thì coi như hàng Tubu giao. */
type CardRow = {
  id: string;
  slug: string;
  brand: string;
  name: string;
  thumbnail: string | null;
  images: string[];
  basePrice: number;
  salePrice: number | null;
  isFeatured: boolean;
  ratingAvg: number;
  reviewCount: number;
  soldExternal: number;
  soldApp: number;
  createdAt?: Date;
  fulfilment?: string;
  storefrontId?: string | null;
  variations: { id: string; sku: string; retailPrice: number; salePrice: number | null; stock: number }[];
};

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  // Brands/categories đổi 15 phút/lần qua sync Pancake nhưng đang query DB mỗi request
  // (brands() groupBy toàn bảng products). Cache 60s là đủ tươi mà giảm tải đáng kể.
  //
  // !!! HẠN CHẾ — KHÔNG AN TOÀN KHI SCALE:
  // - Cache PER-INSTANCE (field RAM) → khi tăng số replica API ≥ 2, mỗi replica có cache
  //   riêng + skew tới 60s giữa các replica → khách thấy dữ liệu khác nhau giữa request.
  // - Sync Pancake job + admin sửa Category KHÔNG gọi invalidate → brand/category mới
  //   trễ tới 60s. Tăng TTL ở đây mà không có invalidate sẽ làm vấn đề rõ hơn.
  // Khi scale → chuyển sang Redis (đã có trong compose), hoặc emit event từ sync job
  // để gọi invalidate trên TẤT CẢ instance.
  private brandsCache: { value: unknown; expiresAt: number } | null = null;
  private categoriesCache: { value: CategoryNode[]; expiresAt: number } | null = null;
  // Id con theo id cha, cho lọc `?category=<cha>` gồm cả con. Cùng hạn chế per-instance như categoriesCache.
  private categoryChildrenCache: { value: Map<string, string[]>; expiresAt: number } | null = null;
  private readonly TTL_MS = 60_000;

  // "Thường mua kèm" quét order_items 90 ngày; chi phí tăng theo doanh số của sản phẩm nên cache phần co-occurrence (id sản phẩm),
  // còn thẻ sản phẩm vẫn đọc tươi để giá/tồn/ẩn hiện luôn đúng. Cùng hạn chế per-instance như brandsCache; có trần số khoá vì
  // slug do khách gửi.
  private readonly boughtTogetherCache = new Map<string, { ids: string[]; expiresAt: number }>();
  private readonly BOUGHT_TOGETHER_TTL_MS = 10 * 60_000;
  private readonly BOUGHT_TOGETHER_MAX_KEYS = 500;

  // Mapper public-safe cho getBySlug() — endpoint /products/:slug là @Public() (không cần đăng
  // nhập). KHÔNG được `include` trần cho variations/reviews: `include` kéo TOÀN BỘ cột của
  // Prisma, gồm dealerPrices/affiliateRate (giá sỉ đại lý + % hoa hồng CTV) và reservedStock/
  // pancakeStock/pancakeId (nội bộ đồng bộ) ở Variation, cùng userId/orderId (định danh khách +
  // đơn hàng thật) ở Review — bất kỳ ai gọi API này đều lấy được. `stock` đã là tồn kho BÁN ĐƯỢC
  // (xem comment tại Variation.stock trong schema) nên không cần trừ reservedStock lại ở đây.
  private readonly publicVariationSelect = {
    id: true,
    sku: true,
    name: true,
    attributes: true,
    retailPrice: true,
    salePrice: true,
    stock: true,
    weight: true,
  } satisfies Prisma.VariationSelect;

  // Không có images: ảnh đánh giá có thể là base64 tới ~700 nghìn ký tự/ảnh, app đọc đánh giá qua GET /products/:slug/reviews.
  private readonly publicReviewSelect = {
    rating: true,
    comment: true,
    videoUrl: true,
    isVerified: true,
    createdAt: true,
  } satisfies Prisma.ReviewSelect;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  async list(query: ProductQuery) {
    return this.listPage(await this.listWhere(query), query);
  }

  /**
   * Trang sản phẩm công khai cho một điều kiện lọc có sẵn: `/products` (bộ lọc của query) và trang thương hiệu (theo nhãn) dùng chung
   * cách xếp, phân trang và dựng thẻ, không có đường thứ hai.
   */
  private async listPage(where: Prisma.ProductWhereInput, query: Pick<ProductQuery, 'page' | 'limit' | 'sort' | 'minPrice' | 'maxPrice'>) {
    const { page, limit, sort } = query;
    const price = priceRange(query.minPrice, query.maxPrice);
    if (sort === 'best_seller') return this.listBestSellers(where, page, limit, price);
    if (sort === 'best_seller_30d') return this.listBestSellers30d(where, page, limit, price);
    if (sort === 'price_asc' || sort === 'price_desc') return this.listByStandingPrice(where, page, limit, sort === 'price_asc' ? 'asc' : 'desc', price);
    if (price) return this.listRanked<{ id: string }>(where, page, limit, { id: true }, null, price, [this.orderBy(sort), { id: 'asc' }]);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        // `id` làm tiêu chí phụ: chỉ sắp theo isFeatured/createdAt/giá thì các SP hoà nhau đổi thứ
        // tự giữa hai lần query → cuộn vô hạn ở Browse hiện trùng hoặc sót SP giữa các trang.
        orderBy: [this.orderBy(sort), { id: 'asc' }],
        ...skipTake(page, limit),
        include: { variations: { where: { isActive: true }, orderBy: VARIATION_ORDER_BY } },
      }),
      this.prisma.product.count({ where }),
    ]);
    return paginated(await this.toCards(items), page, limit, total);
  }

  /**
   * "Bán chạy" = soldApp + soldExternal giảm dần, hoà thì id tăng dần (spec 5b.2, plan 4b Ruling 2).
   * Prisma không orderBy được theo biểu thức → xếp hạng ở đây: lấy vài cột nhỏ của MỌI SP khớp, sắp,
   * cắt trang, rồi lấy thẻ đầy đủ đúng các id của trang (giữ thứ tự). total = số SP khớp.
   * Không đọc phân loại, giá hay Giờ vàng (không cần cho thứ hạng) và danh sách id đã xếp được nhớ 60 giây (xem listRanked):
   * một lần tải trang là 3 câu SQL, các lần sau trong 60 giây là 2. Vượt ~5k SP → chuyển sang cột soldTotal có index.
   */
  private listBestSellers(where: Prisma.ProductWhereInput, page: number, limit: number, price?: PriceBounds) {
    return this.listRanked<{ id: string; soldApp: number; soldExternal: number }>(
      where,
      page,
      limit,
      { id: true, soldApp: true, soldExternal: true },
      (x, y) => y.soldApp + y.soldExternal - (x.soldApp + x.soldExternal),
      price,
      undefined,
      false,
    );
  }

  /**
   * "Bán chạy nhất" theo cửa sổ 30 ngày (Q18): `soldApp30d` giảm dần, hoà thì tổng đã bán (gồm số nhập tay) giảm dần, hoà nữa id tăng dần.
   * Cùng đường xếp hạng và bộ nhớ 60 giây với `listBestSellers`; thứ hạng không phụ thuộc giá nên không đọc phân loại hay Giờ vàng.
   */
  private listBestSellers30d(where: Prisma.ProductWhereInput, page: number, limit: number, price?: PriceBounds) {
    return this.listRanked<{ id: string; soldApp30d: number; soldApp: number; soldExternal: number }>(
      where,
      page,
      limit,
      { id: true, soldApp30d: true, soldApp: true, soldExternal: true },
      (x, y) => y.soldApp30d - x.soldApp30d || y.soldApp + y.soldExternal - (x.soldApp + x.soldExternal),
      price,
      undefined,
      false,
    );
  }

  /**
   * "Giá tăng/giảm" theo giá khách thấy trên thẻ: giá đang bán của phân loại đại diện hoặc giá Giờ vàng đang thắng
   * (`cardPriceWithFlash`), không phải cột của Product (Pancake chỉ ghi giá bán vào phân loại).
   */
  private listByStandingPrice(where: Prisma.ProductWhereInput, page: number, limit: number, dir: 'asc' | 'desc', price?: PriceBounds) {
    type Row = { id: string; basePrice: number; salePrice: number | null; variations: CardVariation[] };
    return this.listRanked<Row>(
      where,
      page,
      limit,
      { id: true },
      (x, y, offers) => (dir === 'asc' ? standingOf(x, offers) - standingOf(y, offers) : standingOf(y, offers) - standingOf(x, offers)),
      price,
    );
  }

  /**
   * Nạp mọi SP khớp kèm giá phân loại, lọc khoảng giá và xếp thứ tự ở TS (giá thẻ là biểu thức nên Prisma không lọc/sắp được),
   * cắt trang rồi lấy thẻ đầy đủ đúng các id của trang. `total` là số SP còn lại sau khi lọc giá. `compare` rỗng thì giữ thứ tự `orderBy` của DB.
   * `needsPrice` false (thứ hạng không phụ thuộc giá, vd Bán chạy) thì bỏ qua phân loại và Giờ vàng. Danh sách id đã xếp được nhớ
   * RANK_TTL_MS theo bộ lọc: tải liên tiếp không quét lại cả catalog (per-instance, cùng hạn chế như brandsCache; hàng ẩn/gỡ vẫn bị
   * loại vì thẻ của trang luôn đọc lại với `where`, chỉ `total` và thứ tự có thể cũ tới 60 giây).
   */
  private async listRanked<T extends { id: string }>(
    where: Prisma.ProductWhereInput,
    page: number,
    limit: number,
    select: Prisma.ProductSelect,
    compare: ((x: T & { basePrice: number; salePrice: number | null; variations: CardVariation[] }, y: T & { basePrice: number; salePrice: number | null; variations: CardVariation[] }, offers: ReadonlyMap<string, FlashOffer[]>) => number) | null,
    price?: PriceBounds,
    orderBy?: Prisma.ProductOrderByWithRelationInput[],
    needsPrice = true,
  ) {
    const rankedIds = await this.rankedIds<T>(where, select, compare, price, orderBy, needsPrice);
    const { skip, take } = skipTake(page, limit);
    const pageIds = rankedIds.slice(skip, skip + take);
    if (pageIds.length === 0) return paginated([], page, limit, rankedIds.length);
    const rows = await this.prisma.product.findMany({
      where: { AND: [where, { id: { in: pageIds } }] },
      include: { variations: { where: { isActive: true }, orderBy: VARIATION_ORDER_BY } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = pageIds.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
    return paginated(await this.toCards(ordered), page, limit, rankedIds.length);
  }

  private readonly rankCache = new Map<string, { ids: string[]; expiresAt: number }>();
  private readonly RANK_TTL_MS = 60_000;
  private readonly RANK_MAX_KEYS = 100;

  /** Id đã lọc giá và xếp thứ tự, mới nhất theo bộ lọc trong RANK_TTL_MS. */
  private async rankedIds<T extends { id: string }>(
    where: Prisma.ProductWhereInput,
    select: Prisma.ProductSelect,
    compare: ((x: T & PricedFields, y: T & PricedFields, offers: ReadonlyMap<string, FlashOffer[]>) => number) | null,
    price: PriceBounds | undefined,
    orderBy: Prisma.ProductOrderByWithRelationInput[] | undefined,
    needsPrice: boolean,
  ): Promise<string[]> {
    // Thứ hạng phụ thuộc giá (xếp giá, lọc giá) đổi ngay khi Giờ vàng bắt đầu/hết hoặc giá sửa nên không nhớ.
    const cacheable = !needsPrice && !price;
    const key = cacheable ? JSON.stringify({ where, select, price, orderBy, needsPrice }) : '';
    const now = Date.now();
    const hit = cacheable && key.length <= 2000 ? this.rankCache.get(key) : undefined;
    if (hit && hit.expiresAt > now) return hit.ids;
    type Priced = T & PricedFields;
    const priced = needsPrice || price;
    let ranked = (await this.prisma.product.findMany({
      where,
      ...(orderBy ? { orderBy } : {}),
      select: priced ? { ...select, basePrice: true, salePrice: true, variations: { where: { isActive: true }, select: CARD_VARIATION_SELECT } } : select,
    })) as unknown as Priced[];
    const offers = priced ? await this.activeFlashOffers() : new Map<string, FlashOffer[]>();
    if (price) ranked = ranked.filter((r) => inPriceRange(standingOf(r, offers), price));
    if (compare) {
      ranked.sort((x, y) => {
        const diff = compare(x, y, offers);
        if (diff !== 0) return diff;
        return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
      });
    }
    const ids = ranked.map((r) => r.id);
    if (cacheable && key.length <= 2000) {
      if (this.rankCache.size >= this.RANK_MAX_KEYS) this.rankCache.delete(this.rankCache.keys().next().value as string);
      this.rankCache.set(key, { ids, expiresAt: now + this.RANK_TTL_MS });
    }
    return ids;
  }

  /** Suất Giờ vàng đang chạy gom theo sản phẩm: một truy vấn, cùng điều kiện và cùng luật "còn rẻ hơn" với dải Giờ vàng. */
  private async activeFlashOffers(): Promise<Map<string, FlashOffer[]>> {
    const rows = await this.prisma.flashSaleItem.findMany({
      where: activeFlashWhere(new Date()),
      select: {
        flashPrice: true,
        soldCount: true,
        quota: true,
        variationId: true,
        variation: { select: { productId: true, retailPrice: true, salePrice: true } },
      },
    });
    const byProduct = new Map<string, FlashOffer[]>();
    for (const r of rows) {
      if (r.soldCount >= r.quota || !isStillDiscounted(r)) continue;
      const list = byProduct.get(r.variation.productId) ?? [];
      list.push({ variationId: r.variationId, flashPrice: r.flashPrice, retailPrice: r.variation.retailPrice, salePrice: r.variation.salePrice });
      byProduct.set(r.variation.productId, list);
    }
    return byProduct;
  }

  /**
   * Bộ lọc công khai của catalog — MỘT nơi duy nhất (list + best_seller dùng chung).
   * P0 A2-03 = A5-06 = A6-04 (docs/audit-2026-09): SP đối tác được tạo với isActive:true ngay cả
   * khi approvalStatus:'PENDING_REVIEW' và bị REJECTED cũng không tự tắt isActive → mọi truy vấn
   * công khai gác thêm approvalStatus, giữ isActive là cờ vòng đời riêng.
   * Điều kiện cần `OR` (giá, từ khoá) đi vào `AND` để không đè nhau.
   */
  private async listWhere(query: ProductQuery): Promise<Prisma.ProductWhereInput> {
    const { brand, category, segment, inStock, minRating, slugs } = query;
    const where: Prisma.ProductWhereInput = { ...PUBLIC_PRODUCT_WHERE };
    const and: Prisma.ProductWhereInput[] = [];
    // Có tham số `slugs` mà rỗng thì không trả gì (không rơi về cả catalog).
    if (slugs !== undefined) {
      where.slug = { in: slugs.split(',').map((x) => x.trim()).filter(Boolean).slice(0, MAX_LIST_SLUGS) };
    }
    if (brand) {
      const brandList = brand.split(',').map((b) => b.trim()).filter(Boolean);
      if (brandList.length === 1) {
        where.brand = brandList[0];
      } else if (brandList.length > 1) {
        where.brand = { in: brandList };
      }
    }
    if (category) {
      // Cha gồm cả con (BG-13): sản phẩm thường gán vào lá, nên lọc theo cha phải khớp cả id của các con cháu.
      const scope = await this.categoryScope(category);
      where.categoryIds = scope.length > 1 ? { hasSome: scope } : { has: category };
    }
    if (segment) where.forSegment = { has: segment };
    const text = await this.textWhere(query.q);
    if (text) and.push(text);
    // Cùng quy tắc với `inStock` của thẻ (toCard): có phân loại đang bán còn tồn.
    if (inStock) where.variations = { some: { isActive: true, stock: { gt: 0 } } };
    // ratingAvg mặc định 0 → SP chưa có đánh giá không lọt "Từ 4★" (đúng ý bộ lọc).
    if (minRating != null) where.ratingAvg = { gte: minRating };
    if (and.length > 0) where.AND = and;
    return where;
  }

  /**
   * Khớp từ khoá qua `textMatchSql`. SQL lỗi (vd DB chưa chạy migration cột nameSearch) → lùi về
   * `contains` cũ cho request đó, không tắt cờ vĩnh viễn (lỗi tạm thời không làm hỏng cả phiên).
   */
  private async textWhere(q: string | undefined): Promise<Prisma.ProductWhereInput | undefined> {
    const raw = (q ?? '').trim();
    if (!foldVietnamese(raw)) return undefined;
    try {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>(textMatchSql(raw));
      return { id: { in: rows.map((r) => r.id) } };
    } catch (err) {
      this.logger.warn(`Tìm không dấu lỗi, dùng contains: ${err instanceof Error ? err.message : String(err)}`);
      return { OR: [{ name: { contains: raw, mode: 'insensitive' } }, { tags: { has: raw.toLowerCase() } }] };
    }
  }

  /**
   * Sản phẩm công khai của một nhãn đã đăng (`GET /brand/public/:slug/products`), phân trang thật: trang nhãn không còn bị cắt cứng
   * ở 30 món của `getPublicBySlug`. Nhãn chưa đăng thì 404 như trang nhãn.
   */
  async listBrandProducts(slug: string, query: BrandProductsQuery) {
    const brand = await this.prisma.brand.findFirst({ where: { slug, isPublished: true }, select: { id: true } });
    if (!brand) throw new NotFoundException('Nhãn hàng không tồn tại hoặc chưa đăng.');
    return this.listPage({ ...PUBLIC_PRODUCT_WHERE, brandId: brand.id }, query);
  }

  async getBySlug(slug: string) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: {
        variations: { where: { isActive: true }, orderBy: VARIATION_ORDER_BY, select: this.publicVariationSelect },
        // Chỉ slug + cờ công khai của nhãn (không kéo cả bản ghi Brand: có ownerUserId): để tên nhãn ở PDP dẫn sang /brand/:slug.
        brandRef: { select: { slug: true, isPublished: true } },
        // take:20 — trang chi tiết không phân trang review; sản phẩm nhiều review sẽ load hết
        // nếu không giới hạn. FE cần xem thêm thì gọi endpoint /products/:slug/reviews riêng.
        reviews: {
          where: { isVisible: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: this.publicReviewSelect,
        },
        // ordersPausedAt + owner chỉ để suy ra "gian hàng chưa nhận đơn" (R3-MERCHANT-3); cả storefront bị bỏ khỏi phản hồi.
        storefront: {
          select: {
            title: true,
            type: true,
            shippingFee: true,
            freeShipFrom: true,
            ordersPausedAt: true,
            isPartner: true,
            owner: { select: { role: true, isBlocked: true } },
          },
        },
      },
    });
    // P0 A2-03=A5-06=A6-04: SP chưa duyệt (PENDING_REVIEW) hoặc bị từ chối (REJECTED, kể cả từng
    // APPROVED rồi bị duyệt lại thành từ chối) không được lộ qua PDP công khai.
    if (!product || !isPublicProduct(product)) {
      throw new NotFoundException('Không tìm thấy sản phẩm.');
    }
    // pancakeId là khoá nội bộ của hệ thống Pancake (endpoint này @Public) — không có lý do để FE công
    // khai cần; admin dùng endpoint admin riêng. rejectReason là lời nhắn của admin cho đối tác (sản phẩm đang bán vẫn mang lý
    // do từ chối bản sửa gần nhất). include trả mọi cột scalar nên phải bỏ tại đây (variations đã loại qua publicVariationSelect).
    const { pancakeId: _pancakeId, rejectReason: _rejectReason, brandRef, storefront, ...publicProduct } = product;
    // Nhãn chưa công khai thì /brand/:slug trả 404: không đưa slug ra để FE không dựng liên kết chết.
    const brandSlug = brandRef?.isPublished ? brandRef.slug : null;
    return {
      ...publicProduct,
      images: publicImages('product', product.id, publicProduct.images ?? []),
      thumbnail: publicProductThumb(publicProduct),
      variations: sortVariationsByPrice(publicProduct.variations),
      brandSlug,
      sold: product.soldExternal + product.soldApp,
      fulfiller: await this.fulfillerOf(product.fulfilment, storefront),
      // Hàng của gian hàng đối tác chỉ bán giá lẻ: trang chi tiết ẩn đặt định kỳ và mua chung (partner-goods.ts).
      partnerOwned: isPartnerOwnedProduct(product),
    };
  }

  private async fulfillerOf(fulfilment: string, store: FulfillerStore | null): Promise<ProductFulfiller> {
    if (fulfilment !== 'MERCHANT') return { kind: 'TUBU', name: TUBU_FULFILLER_NAME, shippingFee: null, freeShipFrom: null };
    const partner = store ? isPartnerStore(store) : false;
    const reason = store && partner ? merchantStoreUnavailableReason(store) : null;
    if (store && reason) return { kind: 'UNAVAILABLE', reason, name: store.title, shippingFee: null, freeShipFrom: null };
    const defaultFee =
      (await this.config?.get<number>('merchant.default_shipping_fee', DEFAULT_MERCHANT_SHIPPING_FEE)) ??
      DEFAULT_MERCHANT_SHIPPING_FEE;
    return {
      kind: 'MERCHANT',
      name: store && partner ? store.title : 'Gian hàng đối tác',
      shippingFee: store?.shippingFee ?? defaultFee,
      freeShipFrom: store?.freeShipFrom ?? null,
    };
  }

  async related(slug: string) {
    const product = await this.prisma.product.findUnique({ where: { slug } });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');
    const items = await this.prisma.product.findMany({
      where: { ...PUBLIC_PRODUCT_WHERE, brand: product.brand, id: { not: product.id } },
      take: 8,
      include: { variations: { where: { isActive: true }, orderBy: VARIATION_ORDER_BY } },
    });
    // Trả cùng shape card với /products để FE dùng chung ProductCard.
    return this.toCards(items);
  }

  /** "Thường mua kèm" (§6.12): co-occurrence trên đơn 90 ngày gần nhất. */
  async boughtTogether(slug: string) {
    const product = await this.prisma.product.findUnique({ where: { slug } });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');
    const hit = this.boughtTogetherCache.get(product.id);
    let ids = hit && hit.expiresAt > Date.now() ? hit.ids : null;
    if (!ids) {
      const since = new Date(Date.now() - 90 * 864e5);
      const rows = await this.prisma.$queryRaw<{ productId: string }[]>`
        WITH target_orders AS (
          SELECT DISTINCT oi."orderId"
          FROM order_items oi
          JOIN variations v ON v.id = oi."variationId"
          JOIN orders o ON o.id = oi."orderId"
          WHERE v."productId" = ${product.id} AND o."createdAt" >= ${since}
        )
        SELECT v2."productId" AS "productId", COUNT(*) AS cnt
        FROM order_items oi2
        JOIN variations v2 ON v2.id = oi2."variationId"
        WHERE oi2."orderId" IN (SELECT "orderId" FROM target_orders)
          AND v2."productId" <> ${product.id}
        GROUP BY v2."productId"
        ORDER BY cnt DESC
        LIMIT 6`;
      ids = rows.map((r) => r.productId);
      // Làm mới đúng khoá đang có (hết hạn) thì không thêm khoá mới, nên không có lý do bỏ khoá của sản phẩm khác.
      if (!this.boughtTogetherCache.has(product.id) && this.boughtTogetherCache.size >= this.BOUGHT_TOGETHER_MAX_KEYS) {
        this.boughtTogetherCache.delete(this.boughtTogetherCache.keys().next().value as string);
      }
      this.boughtTogetherCache.set(product.id, { ids, expiresAt: Date.now() + this.BOUGHT_TOGETHER_TTL_MS });
    }
    if (ids.length === 0) return [];
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, ...PUBLIC_PRODUCT_WHERE },
      include: { variations: { where: { isActive: true }, orderBy: VARIATION_ORDER_BY } },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    return this.toCards(ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p)));
  }

  /**
   * Feed "Dành cho bạn" — gợi ý cá nhân hoá rule-based (không ML):
   * 1) Lấy danh mục từ lịch sử mua gần đây (20 order item cuối) + nhãn đang theo dõi.
   * 2) Gợi ý sản phẩm active trùng danh mục HOẶC thuộc nhãn theo dõi; sản phẩm ĐÃ MUA vẫn có thể
   *    xuất hiện nhưng luôn xếp sau sản phẩm chưa mua (spec 4a.3), trong mỗi nhóm sắp theo tổng đã bán
   *    (soldApp + soldExternal) giảm dần.
   * 3) Không có lịch sử/không match → fallback sản phẩm isFeatured (sắp theo đã bán).
   *
   * `known.hasOrders === false` = người gọi đã biết khách chưa có đơn nào (Home đếm sẵn): khỏi đọc lịch sử mua.
   */
  async getForYou(userId: string, known: { hasOrders?: boolean } = {}) {
    const TAKE = 10;
    const RECENT_ITEMS = 20;

    const orderItems =
      known.hasOrders === false
        ? []
        : await this.prisma.orderItem.findMany({
            where: { order: { userId } },
            orderBy: { order: { createdAt: 'desc' } },
            take: RECENT_ITEMS,
            select: { variationId: true },
          });

    const variationIds = [...new Set(orderItems.map((oi) => oi.variationId))];
    // Sản phẩm của các biến thể đã mua, một câu thay vì tra biến thể rồi tra sản phẩm.
    const purchasedProducts = variationIds.length
      ? await this.prisma.product.findMany({
          where: { variations: { some: { id: { in: variationIds } } } },
          select: { id: true, categoryIds: true },
        })
      : [];
    const purchasedProductIds = purchasedProducts.map((p) => p.id);
    const categorySet = [...new Set(purchasedProducts.flatMap((p) => p.categoryIds))];

    const follows = await this.prisma.brandFollow.findMany({
      where: { userId },
      select: { brandId: true },
    });
    const followedBrandIds = follows.map((f) => f.brandId);

    let items: CardRow[] = [];
    if (categorySet.length > 0 || followedBrandIds.length > 0) {
      const or: Prisma.ProductWhereInput[] = [];
      if (categorySet.length > 0) or.push({ categoryIds: { hasSome: categorySet } });
      if (followedBrandIds.length > 0) or.push({ brandId: { in: followedBrandIds } });
      const where: Prisma.ProductWhereInput = { ...PUBLIC_PRODUCT_WHERE, OR: or };
      items = await this.prisma.product.findMany({
        where,
        // take:200 — trước đây không giới hạn nên load HẾT sản phẩm khớp rồi mới sort+cắt 10
        // trong JS; catalog càng lớn càng nặng. 200 ứng viên là đủ dư để sort lấy top 10.
        take: 200,
        include: { variations: { where: { isActive: true }, orderBy: VARIATION_ORDER_BY } },
      });
    }

    if (items.length === 0) {
      items = await this.prisma.product.findMany({
        where: { ...PUBLIC_PRODUCT_WHERE, isFeatured: true },
        take: 200,
        include: { variations: { where: { isActive: true }, orderBy: VARIATION_ORDER_BY } },
      });
    }

    const purchased = new Set(purchasedProductIds);
    const sold = (p: { soldExternal: number; soldApp: number }) => p.soldExternal + p.soldApp;
    const sorted = [...items].sort((a, b) => {
      const pa = purchased.has(a.id) ? 1 : 0;
      const pb = purchased.has(b.id) ? 1 : 0;
      return pa !== pb ? pa - pb : sold(b) - sold(a);
    });
    return this.toCards(sorted.slice(0, TAKE));
  }

  async brands() {
    if (this.brandsCache && this.brandsCache.expiresAt > Date.now()) {
      return this.brandsCache.value;
    }
    const rows = await this.prisma.product.groupBy({
      by: ['brand'],
      where: PUBLIC_PRODUCT_WHERE,
      _count: { _all: true },
    });
    // Slug của nhãn đã công khai (khớp theo tên) để trang chủ dẫn tới /brand/:slug; nhãn chưa có trang thì null.
    const published = await this.prisma.brand.findMany({
      where: { isPublished: true, name: { in: rows.map((r) => r.brand) } },
      select: { name: true, slug: true },
    });
    const slugByName = new Map(published.map((b) => [b.name, b.slug]));
    const value = rows.map((r) => ({ brand: r.brand, count: r._count._all, slug: slugByName.get(r.brand) ?? null }));
    this.brandsCache = { value, expiresAt: Date.now() + this.TTL_MS };
    return value;
  }

  /** `[id, ...mọi con cháu]` của một danh mục; id lạ hoặc danh mục lá trả `[id]`. Có `visited` nên vòng `parentId` không treo. */
  private async categoryScope(id: string): Promise<string[]> {
    if (!this.categoryChildrenCache || this.categoryChildrenCache.expiresAt <= Date.now()) {
      const rows = await this.prisma.category.findMany({ select: { id: true, parentId: true } });
      const children = new Map<string, string[]>();
      for (const r of rows) {
        if (!r.parentId) continue;
        const list = children.get(r.parentId) ?? [];
        list.push(r.id);
        children.set(r.parentId, list);
      }
      this.categoryChildrenCache = { value: children, expiresAt: Date.now() + this.TTL_MS };
    }
    const children = this.categoryChildrenCache.value;
    const scope = [id];
    const visited = new Set(scope);
    for (let i = 0; i < scope.length; i++) {
      for (const child of children.get(scope[i]!) ?? []) {
        if (visited.has(child)) continue;
        visited.add(child);
        scope.push(child);
      }
    }
    return scope;
  }

  /**
   * Cây danh mục hai tầng: gốc là danh mục không cha (hoặc cha không còn), con lồng trong `children`.
   * Đồng bộ Pancake KHÔNG ghi `categoryIds` (chỉ SP seed/đối tác có) → danh mục seed có thể trống
   * trên prod. `productCount` (field cộng thêm, client cũ bỏ qua) để miniapp ẩn danh mục
   * trống và lùi về 4 phân khúc khi không còn danh mục nào có hàng; của cha cộng cả con, mỗi sản phẩm đếm một lần
   * dù gán cả cha lẫn con.
   */
  async categories(): Promise<CategoryNode[]> {
    if (this.categoriesCache && this.categoriesCache.expiresAt > Date.now()) {
      return this.categoriesCache.value;
    }
    const [rows, products] = await Promise.all([
      this.prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      this.prisma.product.findMany({
        where: PUBLIC_PRODUCT_WHERE,
        select: { categoryIds: true },
      }),
    ]);
    const parentOf = new Map(rows.map((c) => [c.id, c.parentId]));
    const counts = new Map<string, number>();
    for (const p of products) {
      // Mỗi danh mục của sản phẩm và mọi tổ tiên của nó, một lần cho sản phẩm này.
      const covered = new Set<string>();
      for (const id of p.categoryIds) {
        for (let cur: string | null | undefined = id; cur && !covered.has(cur); cur = parentOf.get(cur)) covered.add(cur);
      }
      for (const id of covered) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const nodes = new Map<string, CategoryNode>(rows.map((c) => [c.id, { ...c, productCount: counts.get(c.id) ?? 0, children: [] }]));
    const value: CategoryNode[] = [];
    for (const c of rows) {
      const node = nodes.get(c.id)!;
      const parent = c.parentId && c.parentId !== c.id ? nodes.get(c.parentId) : undefined;
      if (parent) parent.children.push(node);
      else value.push(node);
    }
    this.categoriesCache = { value, expiresAt: Date.now() + this.TTL_MS };
    return value;
  }

  async suggest(q: string) {
    if (foldVietnamese(q).length < SUGGEST_MIN_CHARS) return [];
    const text = await this.textWhere(q);
    if (!text) return [];
    const rows = await this.prisma.product.findMany({
      where: { ...PUBLIC_PRODUCT_WHERE, AND: [text] },
      take: 8,
      select: {
        id: true, slug: true, name: true, thumbnail: true, basePrice: true, salePrice: true,
        variations: { where: { isActive: true }, select: { id: true, sku: true, retailPrice: true, salePrice: true, stock: true } },
      },
    });
    return rows.map(({ id, variations, ...r }) => ({
      ...r,
      ...cardPrices(r, variations),
      thumbnail: publicImage('product', id, 'thumb', r.thumbnail),
    }));
  }

  private orderBy(sort?: string): Prisma.ProductOrderByWithRelationInput {
    switch (sort) {
      case 'newest':
        return { createdAt: 'desc' };
      case 'rating':
        return { ratingAvg: 'desc' };
      default:
        return { isFeatured: 'desc' };
    }
  }

  /** Ngưỡng nhãn "Được yêu thích" từ cấu hình; thiếu hoặc hỏng thì dùng mặc định (xem `sanitizeLovedThreshold`). */
  private async lovedThresholds(): Promise<LovedThresholds> {
    const d = DEFAULT_LOVED_THRESHOLDS;
    if (!this.config) return d;
    const [minRating, minReviews, minSold] = await Promise.all([
      this.config.get<unknown>(CATALOG_LOVED_KEYS.minRating, d.minRating),
      this.config.get<unknown>(CATALOG_LOVED_KEYS.minReviews, d.minReviews),
      this.config.get<unknown>(CATALOG_LOVED_KEYS.minSold, d.minSold),
    ]);
    return {
      minRating: sanitizeLovedThreshold(minRating, d.minRating, LOVED_THRESHOLD_MAX.minRating),
      minReviews: sanitizeLovedThreshold(minReviews, d.minReviews, LOVED_THRESHOLD_MAX.minReviews),
      minSold: sanitizeLovedThreshold(minSold, d.minSold, LOVED_THRESHOLD_MAX.minSold),
    };
  }

  /**
   * Gian hàng của các thẻ hàng đối tác, một truy vấn theo lô. Thẻ hàng Tubu (đa số) không có `storefrontId` cần tra nên trang toàn
   * hàng Tubu không tốn thêm truy vấn nào.
   */
  private async storesOfCards(rows: readonly CardRow[]): Promise<Map<string, FulfillerStore>> {
    const ids = [...new Set(rows.filter((p) => p.fulfilment === 'MERCHANT' && p.storefrontId).map((p) => p.storefrontId as string))];
    if (ids.length === 0) return new Map();
    const stores = await this.prisma.storefront.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        type: true,
        isPartner: true,
        shippingFee: true,
        freeShipFrom: true,
        ordersPausedAt: true,
        owner: { select: { role: true, isBlocked: true } },
      },
    });
    return new Map(stores.map((s) => [s.id, s]));
  }

  /**
   * Thẻ sản phẩm công khai. `fulfiller` (cùng dạng với trang chi tiết) cho nhãn "Miễn phí giao hàng", `isLoved` cho nhãn "Được yêu thích":
   * tính ở máy chủ để ngưỡng chỉnh được ở cấu hình và hai app không chép luật.
   */
  private async toCards(rows: readonly CardRow[]) {
    if (rows.length === 0) return [];
    const [loved, stores] = await Promise.all([this.lovedThresholds(), this.storesOfCards(rows)]);
    return Promise.all(
      rows.map(async (p) => {
        const sold = (p.soldExternal ?? 0) + (p.soldApp ?? 0); // tổng "đã bán" (sàn ngoài + app)
        return {
          id: p.id,
          slug: p.slug,
          brand: p.brand,
          name: p.name,
          thumbnail: publicProductThumb(p),
          ...cardPrices(p, p.variations),
          isFeatured: p.isFeatured,
          ratingAvg: p.ratingAvg,
          reviewCount: p.reviewCount,
          sold,
          inStock: p.variations.some((v) => v.stock > 0),
          createdAt: p.createdAt?.toISOString(),
          isLoved: isLoved({ ratingAvg: p.ratingAvg, reviewCount: p.reviewCount, sold }, loved),
          fulfiller: await this.fulfillerOf(p.fulfilment ?? 'TUBU', p.storefrontId ? (stores.get(p.storefrontId) ?? null) : null),
        };
      }),
    );
  }

  /**
   * Tính lại `soldApp` (đơn DELIVERED, cộng dồn theo product) và `soldApp30d` (cùng đơn nhưng giao trong 30 ngày gần nhất,
   * để xếp "Bán chạy nhất") — idempotent: ghi đè cả hai, nên tự GIẢM khi đơn bị RETURNED và khi đơn trôi khỏi cửa sổ 30 ngày.
   * Hiển thị "đã bán" = soldExternal + soldApp; `soldApp30d` không hiển thị và không gồm `soldExternal`.
   * Đơn DELIVERED chưa có `deliveredAt` (dữ liệu trước khi có cột này) không vào cửa sổ 30 ngày: chấp nhận được vì
   * cửa sổ ngắn hơn tuổi của dữ liệu đó.
   */
  async recomputeSoldCounts(): Promise<{ updated: number }> {
    const since = new Date(Date.now() - SOLD_WINDOW_DAYS * 864e5);
    const [grouped, grouped30d] = await Promise.all([
      this.prisma.orderItem.groupBy({
        by: ['variationId'],
        where: { order: { status: 'DELIVERED' } },
        _sum: { quantity: true },
      }),
      this.prisma.orderItem.groupBy({
        by: ['variationId'],
        where: { order: { status: 'DELIVERED', deliveredAt: { gte: since } } },
        _sum: { quantity: true },
      }),
    ]);
    const variationIds = [...new Set([...grouped, ...grouped30d].map((g) => g.variationId))];
    const vars = variationIds.length
      ? await this.prisma.variation.findMany({
          where: { id: { in: variationIds } },
          select: { id: true, productId: true },
        })
      : [];
    const vmap = new Map(vars.map((v) => [v.id, v.productId]));
    const sumByProduct = (rows: typeof grouped) => {
      const perProduct = new Map<string, number>();
      for (const g of rows) {
        const pid = vmap.get(g.variationId);
        if (!pid) continue;
        perProduct.set(pid, (perProduct.get(pid) ?? 0) + (g._sum.quantity ?? 0));
      }
      return perProduct;
    };
    const perProduct = sumByProduct(grouped);
    const perProduct30d = sumByProduct(grouped30d);
    // Reset phải nguyên tử cùng với lần ghi lại — nhưng KHÔNG được reset toàn bảng bên trong
    // transaction: `updateMany` không điều kiện khoá MỌI dòng `products` cho tới khi N lệnh
    // update chạy xong, đủ để chặn đứng cron đồng bộ Pancake (cũng nổ lúc 03:00) và mọi thao tác
    // sửa sản phẩm của admin/đối tác. Trước đó nữa thì reset commit riêng, nên một sản phẩm bị
    // xoá giữa chừng làm transaction rollback trong khi reset đã commit — cả catalog hiện "đã
    // bán 0" suốt 24 giờ.
    //
    // Cách hiện tại: chỉ chạm đúng những dòng CẦN đổi.
    //  - Dòng có số bán mới → update từng dòng (khoá đúng dòng đó). Đơn 30 ngày là tập con của đơn
    //    đã giao nên mọi sản phẩm có số 30 ngày đều có trong `perProduct`.
    //  - Dòng đang khác 0 mà không còn đơn nào → đưa về 0, một câu lệnh, phạm vi hẹp.
    const ids = [...perProduct.keys()];
    const ops = [
      ...[...perProduct.entries()].map(([productId, sold]) =>
        this.prisma.product.update({ where: { id: productId }, data: { soldApp: sold, soldApp30d: perProduct30d.get(productId) ?? 0 } }),
      ),
      this.prisma.product.updateMany({
        where: { OR: [{ soldApp: { not: 0 } }, { soldApp30d: { not: 0 } }], ...(ids.length ? { id: { notIn: ids } } : {}) },
        data: { soldApp: 0, soldApp30d: 0 },
      }),
    ];
    await this.prisma.$transaction(ops);
    return { updated: perProduct.size };
  }

  /** Cron 03:00 hằng ngày — tính lại số đã bán (social proof không cần realtime). */
  @Cron('0 3 * * *', { timeZone: CRON_TZ })
  @TrackCron()
  async recomputeSoldCron(): Promise<void> {
    // Nuốt lỗi im lặng ở đây từng khiến hỏng mà không ai biết — số "đã bán" sai cả ngày và
    // không có một dòng log nào để lần ra.
    await this.recomputeSoldCounts().catch((err) =>
      this.logger.error(`Tính lại số đã bán lỗi: ${err instanceof Error ? err.message : err}`),
    );
  }

  /**
   * Admin nhập tổng đã bán từ sàn ngoài theo SKU (variation.sku → product.soldExternal).
   * Trước đây findUnique+update TUẦN TỰ từng dòng — N+1 thật khi admin đối soát vài nghìn SKU
   * (hàng nghìn round-trip DB nối tiếp nhau). Fix: gom 1 findMany rồi cập nhật theo lô qua
   * $transaction, ~50 dòng/lô để không gửi 1 transaction khổng lồ.
   */
  async setSoldExternal(rows: { sku: string; count: number }[]): Promise<{ updated: number }> {
    const BATCH_SIZE = 50;
    const valid = rows.filter((r) => r.sku && Number.isFinite(r.count) && r.count >= 0);
    if (valid.length === 0) return { updated: 0 };

    const skus = [...new Set(valid.map((r) => r.sku))];
    const variations = await this.prisma.variation.findMany({
      where: { sku: { in: skus } },
      select: { sku: true, productId: true },
    });
    const productIdBySku = new Map(variations.map((v) => [v.sku, v.productId]));

    let updated = 0;
    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
      const batch = valid.slice(i, i + BATCH_SIZE);
      const ops = batch
        .map((r) => {
          const productId = productIdBySku.get(r.sku);
          if (!productId) return null;
          return this.prisma.product.update({
            where: { id: productId },
            data: { soldExternal: Math.floor(r.count) },
          });
        })
        .filter((op): op is NonNullable<typeof op> => op !== null);
      if (ops.length === 0) continue;
      await this.prisma.$transaction(ops);
      updated += ops.length;
    }
    return { updated };
  }
}
