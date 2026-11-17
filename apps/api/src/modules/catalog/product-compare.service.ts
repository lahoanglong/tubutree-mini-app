import { canonicalCatalogBrand } from '@tubutree/shared-types';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { publicProductThumb } from '../../common/public-image';
import { withCoverImages } from './card-select';
import { ingredientNames } from './ingredient-names';
import { PUBLIC_PRODUCT_WHERE, isPublicProduct } from './public-product';
import { VARIATION_ORDER_BY, sortVariationsByPrice } from './variation-order';
import { isPartnerStore } from '../merchant/partner-store';
import { merchantStoreUnavailableReason } from '../checkout/checkout-split';
import { formatSize, measureOf, nameGroup, unitPriceOf, type Measure, type UnitPrice } from './product-compare.unit';

export const PDP_COMPARE_ENABLED_KEY = 'catalog.pdp_compare_enabled';

/** Cùng dạng với `CompareItem` ở `packages/app-core/src/api/product-compare.ts` (API không phụ thuộc app-core). */
export interface CompareItem {
  productId: string;
  slug: string;
  name: string;
  brand: string;
  thumbnail: string | null;
  price: number;
  variationName: string;
  size: string | null;
  unitPrice: UnitPrice | null;
  keyIngredients: string[];
}

export interface ProductCompare {
  current: CompareItem;
  others: CompareItem[];
}

const COMPARE_LIMIT = 2;
const KEY_INGREDIENTS = 2;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_KEYS = 500;

const VARIATION_SELECT = { id: true, sku: true, name: true, retailPrice: true, salePrice: true, stock: true } satisfies Prisma.VariationSelect;

const ITEM_SELECT = {
  id: true,
  slug: true,
  name: true,
  brand: true,
  thumbnail: true,
  isCombo: true,
  ingredients: true,
  basePrice: true,
  salePrice: true,
} satisfies Prisma.ProductSelect;

type Variation = { id: string; sku: string; name: string; retailPrice: number; salePrice: number | null; stock: number };
type Row = {
  id: string;
  slug: string;
  name: string;
  brand: string;
  thumbnail: string | null;
  isCombo: boolean;
  ingredients: Prisma.JsonValue;
  basePrice: number;
  salePrice: number | null;
};
type Picked = { row: Row; variation: Variation | null; price: number };

const priceOf = (v: { retailPrice: number; salePrice: number | null }) => v.salePrice ?? v.retailPrice;

/** Phân loại dùng để so: phân loại còn hàng có giá đang bán thấp nhất (như giá thẻ), bỏ giá ≤ 0; hết hàng cả thì phân loại rẻ nhất. */
function compareVariation(variations: readonly Variation[]): Variation | null {
  const priced = sortVariationsByPrice(variations.filter((v) => priceOf(v) > 0));
  return priced.find((v) => v.stock > 0) ?? priced[0] ?? null;
}

/**
 * Bảng "So với món tương tự" trên trang sản phẩm (`GET /products/:slug/compare`). Chỉ đọc dữ liệu công khai của sản phẩm, không theo
 * người gọi, nên đệm chung theo slug được.
 */
@Injectable()
export class ProductCompareService {
  // Đệm trong tiến trình như `boughtTogetherCache` của CatalogService: mỗi bản API có đệm riêng, lệch tối đa CACHE_TTL_MS. Chỉ slug của
  // sản phẩm công khai có thật mới vào đệm (slug lạ ném 404 trước khi ghi), và có trần số khoá.
  private readonly cache = new Map<string, { value: ProductCompare; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async compare(slug: string): Promise<ProductCompare> {
    // Kiểm cờ trước đệm: tắt cờ thì 404 ngay cả với slug đã nằm trong đệm.
    if ((await this.config.get<unknown>(PDP_COMPARE_ENABLED_KEY, false)) !== true) throw new NotFoundException('Không tìm thấy.');
    const hit = this.cache.get(slug);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await this.build(slug);
    this.cache.delete(slug);
    if (this.cache.size >= CACHE_MAX_KEYS) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(slug, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  private async build(slug: string): Promise<ProductCompare> {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      select: {
        ...ITEM_SELECT,
        isActive: true,
        approvalStatus: true,
        forSegment: true,
        variations: { where: { isActive: true }, orderBy: VARIATION_ORDER_BY, select: VARIATION_SELECT },
      },
    });
    if (!product || !isPublicProduct(product)) throw new NotFoundException('Không tìm thấy sản phẩm.');

    const variation = compareVariation(product.variations);
    const current: Picked = { row: product, variation, price: variation ? priceOf(variation) : (product.salePrice ?? product.basePrice) };
    const others = await this.similar(product);

    const covers = await withCoverImages(this.prisma, [current, ...others].map((p) => ({ id: p.row.id, thumbnail: p.row.thumbnail })));
    const coverOf = new Map(covers.map((c) => [c.id, c.images]));
    const reference = this.measure(current);
    const item = (p: Picked): CompareItem => {
      const measure = this.measure(p);
      return {
        productId: p.row.id,
        slug: p.row.slug,
        name: p.row.name,
        brand: canonicalCatalogBrand(p.row.brand),
        thumbnail: publicProductThumb({ id: p.row.id, thumbnail: p.row.thumbnail, images: coverOf.get(p.row.id) }),
        price: p.price,
        variationName: p.variation?.name ?? '',
        size: measure ? formatSize(measure) : null,
        unitPrice: unitPriceOf(p.price, measure, reference),
        keyIngredients: ingredientNames(p.row.ingredients).slice(0, KEY_INGREDIENTS),
      };
    };
    return { current: item(current), others: others.map(item) };
  }

  /** Sản phẩm combo gồm nhiều món: giá chia theo dung tích một món không có nghĩa. */
  private measure(p: Picked): Measure | null {
    return p.row.isCombo ? null : measureOf(p.variation?.name ?? '', p.row.name);
  }

  /**
   * Món cùng phân khúc (giao nhau ở `forSegment`) và cùng nhóm tên, còn hàng, mua được: hàng gian hàng đối tác đang tạm nghỉ hay đã
   * đóng bị bỏ vì trang của nó tắt nút mua. Lọc nhóm tên ở TS trên các món cùng phân khúc (vài chục tới vài trăm dòng nhỏ).
   */
  private async similar(product: Row & { forSegment: string[] }): Promise<Picked[]> {
    const group = nameGroup(product.name, product.brand);
    if (group === '' || product.forSegment.length === 0) return [];
    const rows = await this.prisma.product.findMany({
      where: {
        ...PUBLIC_PRODUCT_WHERE,
        id: { not: product.id },
        forSegment: { hasSome: product.forSegment },
        variations: { some: { isActive: true, stock: { gt: 0 } } },
      },
      select: {
        ...ITEM_SELECT,
        soldApp: true,
        soldExternal: true,
        fulfilment: true,
        variations: { where: { isActive: true, stock: { gt: 0 } }, orderBy: VARIATION_ORDER_BY, select: VARIATION_SELECT },
        storefront: { select: { type: true, isPartner: true, ordersPausedAt: true, owner: { select: { role: true, isBlocked: true } } } },
      },
    });
    const picked: (Picked & { sold: number })[] = [];
    for (const r of rows) {
      if (nameGroup(r.name, r.brand) !== group) continue;
      if (r.fulfilment === 'MERCHANT' && r.storefront && isPartnerStore(r.storefront) && merchantStoreUnavailableReason(r.storefront)) continue;
      const variation = compareVariation(r.variations.filter((v) => v.stock > 0));
      if (!variation) continue;
      picked.push({ row: r, variation, price: priceOf(variation), sold: r.soldApp + r.soldExternal });
    }
    return picked
      .sort((a, b) => b.sold - a.sold || a.price - b.price || (a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0))
      .slice(0, COMPARE_LIMIT);
  }
}
