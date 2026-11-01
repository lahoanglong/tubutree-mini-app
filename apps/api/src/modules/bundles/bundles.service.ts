import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isPartnerOwnedProduct } from '../cart/partner-goods';
import { CatalogService } from '../catalog/catalog.service';
import { PUBLIC_PRODUCT_WHERE } from '../catalog/public-product';
import { SystemConfigService } from '../system-config/system-config.service';
import { BUNDLE_MIN_PRODUCTS, addonPayPrice } from './bundle-rules';
import { bundleLiveWhere, isTubuOnlyBundle, loadFlashFootprint, readBundleMaxPct, type FlashFootprint } from './bundle-read';

export const PDP_COMBO_MAX = 2;
export const PDP_ADDON_MAX = 3;
export const HOME_COMBOS_DEFAULT = 4;
export const HOME_COMBOS_MAX = 8;

type CardOf = Awaited<ReturnType<CatalogService['cardsByIds']>>[number];

export interface BundleItemDTO {
  productId: string;
  /** Phân loại sẽ vào giỏ: món ghim thì đúng phân loại ghim, không ghim (chỉ BUNDLE_PCT) thì phân loại đại diện của thẻ. */
  variationId: string | null;
  /** Số đơn vị mỗi đơn được hưởng ưu đãi (giá kèm hay giảm %). */
  maxQty: number;
  /** Chỉ ADDON; BUNDLE_PCT là null. Giá khách trả mỗi đơn vị, đã qua trần theo giá tham chiếu (`addonPayPrice`): bằng đúng số giỏ tính. */
  addonPrice: number | null;
  /** false: phân loại này hết hàng, thẻ báo "Combo tạm hết" thay vì cho thêm vào giỏ. */
  inStock: boolean;
  /** Thẻ sản phẩm công khai, giá đã thay bằng giá của phân loại ghim (nếu có). */
  product: CardOf;
}

export interface BundleDTO {
  id: string;
  kind: 'BUNDLE_PCT' | 'ADDON';
  title: string;
  /** Đã kẹp theo `bundle.max_pct`; ADDON là null. */
  pct: number | null;
  endAt: string;
  anchorProductId: string | null;
  items: BundleItemDTO[];
}

const PUBLIC_SELECT = {
  id: true,
  kind: true,
  title: true,
  pct: true,
  endAt: true,
  anchorProductId: true,
  anchorProduct: { select: { storefrontId: true } },
  items: {
    orderBy: { sortOrder: 'asc' },
    select: { productId: true, variationId: true, addonPrice: true, refPrice: true, maxQty: true, product: { select: { storefrontId: true } } },
  },
} satisfies Prisma.BundleSelect;

type Row = Prisma.BundleGetPayload<{ select: typeof PUBLIC_SELECT }>;

const BUNDLE_ORDER = [{ sortOrder: 'asc' }, { createdAt: 'desc' }] satisfies Prisma.BundleOrderByWithRelationInput[];
const FETCH_CAP = 20;

interface PinnedVariation {
  id: string;
  productId: string;
  retailPrice: number;
  salePrice: number | null;
  stock: number;
}

/** Bộ công khai đang chạy cho trang sản phẩm và Trang chủ (không phụ thuộc người gọi nên cache chung). */
@Injectable()
export class BundlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly config: SystemConfigService,
  ) {}

  /**
   * Combo (BUNDLE_PCT) có sản phẩm này và bộ mua kèm (ADDON) mà sản phẩm này là sản phẩm chính. Sản phẩm không công khai → 404;
   * hàng gian hàng đối tác → rỗng (hàng đó chỉ bán giá lẻ). Sản phẩm chính hết hàng thì không có bộ mua kèm: khách thêm được món kèm
   * mà không bỏ được món chính vào giỏ, giỏ sẽ tính món kèm giá thường. Combo vẫn hiện (thẻ báo "tạm hết" theo từng món).
   */
  async forProduct(slug: string, now: Date = new Date()): Promise<{ combos: BundleDTO[]; addons: BundleDTO[] }> {
    const product = await this.prisma.product.findFirst({
      where: { slug, ...PUBLIC_PRODUCT_WHERE },
      select: { id: true, storefrontId: true, variations: { where: { isActive: true, stock: { gt: 0 } }, select: { id: true }, take: 1 } },
    });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');
    if (isPartnerOwnedProduct(product)) return { combos: [], addons: [] };
    const rows = await this.prisma.bundle.findMany({
      where: { ...bundleLiveWhere(now), OR: [{ items: { some: { productId: product.id } } }, { anchorProductId: product.id }] },
      select: PUBLIC_SELECT,
      orderBy: BUNDLE_ORDER,
      take: FETCH_CAP,
    });
    const anchorBuyable = product.variations.length > 0;
    const shown = await this.toPublic(
      rows.filter((r) => (r.kind === 'ADDON' ? anchorBuyable && r.anchorProductId === product.id : true)),
      now,
    );
    return {
      combos: shown.filter((b) => b.kind === 'BUNDLE_PCT').slice(0, PDP_COMBO_MAX),
      addons: shown.filter((b) => b.kind === 'ADDON').slice(0, PDP_ADDON_MAX),
    };
  }

  /** Combo đang chạy mà MỌI món còn hàng (Trang chủ không quảng cáo combo không mua được). */
  async homeCombos(limit: number = HOME_COMBOS_DEFAULT, now: Date = new Date()): Promise<BundleDTO[]> {
    const take = Math.min(HOME_COMBOS_MAX, Math.max(1, Math.trunc(limit) || 1));
    const rows = await this.prisma.bundle.findMany({
      where: { ...bundleLiveWhere(now), kind: 'BUNDLE_PCT' },
      select: PUBLIC_SELECT,
      orderBy: BUNDLE_ORDER,
      take: take * 3,
    });
    const shown = await this.toPublic(rows, now);
    return shown.filter((b) => b.items.every((i) => i.inStock)).slice(0, take);
  }

  /**
   * Dựng DTO; bộ thiếu món công khai, có hàng đối tác, ghim phân loại đã tắt, đang dính Giờ vàng hay không còn đúng luật thì bỏ cả bộ
   * (không quảng cáo bộ không đủ, và giá hiện ra phải bằng giá giỏ tính).
   */
  private async toPublic(rows: readonly Row[], now: Date): Promise<BundleDTO[]> {
    const candidates = rows.filter(isTubuOnlyBundle);
    if (candidates.length === 0) return [];
    const productIds = [...new Set(candidates.flatMap((b) => b.items.map((i) => i.productId)))];
    const flashProductIds = [...new Set([...productIds, ...candidates.flatMap((b) => (b.anchorProductId ? [b.anchorProductId] : []))])];
    const pinnedIds = [...new Set(candidates.flatMap((b) => b.items.map((i) => i.variationId).filter((v): v is string => v !== null)))];
    const [cards, pinned, maxPct, flash] = await Promise.all([
      this.catalog.cardsByIds(productIds),
      pinnedIds.length > 0
        ? (this.prisma.variation.findMany({
            where: { id: { in: pinnedIds }, isActive: true },
            select: { id: true, productId: true, retailPrice: true, salePrice: true, stock: true },
          }) as Promise<PinnedVariation[]>)
        : Promise.resolve([] as PinnedVariation[]),
      readBundleMaxPct(this.config),
      loadFlashFootprint(this.prisma, now, flashProductIds),
    ]);
    const cardById = new Map(cards.map((c) => [c.id, c]));
    const pinnedById = new Map(pinned.map((v) => [v.id, v]));
    const out: BundleDTO[] = [];
    for (const b of candidates) {
      const dto = this.build(b, cardById, pinnedById, maxPct, flash);
      if (dto) out.push(dto);
    }
    return out;
  }

  private build(
    b: Row,
    cardById: ReadonlyMap<string, CardOf>,
    pinnedById: ReadonlyMap<string, PinnedVariation>,
    maxPct: number,
    flash: FlashFootprint,
  ): BundleDTO | null {
    // Dòng Giờ vàng không nhận bundle ở giỏ, nên sản phẩm chính đang Giờ vàng thì món kèm không về giá kèm (giỏ không thấy sản phẩm chính).
    if (b.kind === 'ADDON' && b.anchorProductId !== null && flash.productIds.has(b.anchorProductId)) return null;
    const items: BundleItemDTO[] = [];
    for (const it of b.items) {
      if (b.kind === 'ADDON' && it.productId === b.anchorProductId) continue;
      // Giá kèm áp cho một phân loại: bộ ghi tay không ghim thì giỏ không giảm (`addonBundle`), nên không quảng cáo.
      if (b.kind === 'ADDON' && it.variationId === null) continue;
      const card = cardById.get(it.productId);
      if (!card) return null;
      let product: CardOf = card;
      let variationId = card.repVariationId ?? null;
      let inStock = card.inStock;
      if (it.variationId !== null) {
        const v = pinnedById.get(it.variationId);
        if (!v || v.productId !== it.productId) return null;
        product = { ...card, basePrice: v.retailPrice, salePrice: v.salePrice, repVariationId: v.id };
        variationId = v.id;
        inStock = v.stock > 0;
      }
      // Phân loại sẽ vào giỏ đang Giờ vàng: dòng đó giỏ tính giá Giờ vàng và không nhận bundle. Combo thiếu một món thì không còn là bộ.
      if (variationId !== null && flash.variationIds.has(variationId)) {
        if (b.kind === 'BUNDLE_PCT') return null;
        continue;
      }
      let addonPrice: number | null = null;
      if (b.kind === 'ADDON') {
        // Cùng hàm với giỏ: giá khách trả sau trần theo giá tham chiếu lúc tạo. Không giảm được đồng nào (giá kèm không thấp hơn, hay thiếu
        // giá tham chiếu) thì giỏ tính giá thường, nên không quảng cáo "deal sốc".
        if (it.addonPrice === null) continue;
        const unit = product.salePrice ?? product.basePrice;
        addonPrice = addonPayPrice(unit, it.addonPrice, it.refPrice);
        if (addonPrice >= unit) continue;
      }
      items.push({ productId: it.productId, variationId, maxQty: it.maxQty, addonPrice, inStock, product });
    }
    if (b.kind === 'ADDON') {
      if (items.length === 0) return null;
    } else {
      if (new Set(items.map((i) => i.productId)).size < BUNDLE_MIN_PRODUCTS) return null;
    }
    const pct = b.kind === 'BUNDLE_PCT' ? Math.min(b.pct ?? 0, maxPct, 100) : null;
    if (b.kind === 'BUNDLE_PCT' && (pct ?? 0) <= 0) return null;
    return { id: b.id, kind: b.kind, title: b.title, pct, endAt: b.endAt.toISOString(), anchorProductId: b.anchorProductId, items };
  }
}
