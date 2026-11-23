import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isPartnerOwnedProduct } from '../cart/partner-goods';
import { CatalogService } from '../catalog/catalog.service';
import { PUBLIC_PRODUCT_WHERE } from '../catalog/public-product';
import { SystemConfigService } from '../system-config/system-config.service';
import { BUNDLE_MIN_PRODUCTS, addonPayPrice, bundleSetSaving, type BundleLine, type LiveBundle } from './bundle-rules';
import { bundleLiveWhere, isTubuOnlyBundle, loadFlashFootprint, readBundleMaxPct, staffBundlePredicate, type FlashFootprint } from './bundle-read';
import { loadGreenBoxSettings, type GreenBoxTier } from './green-box';
import { LEGACY_FAKE_PANCAKE_PREFIX } from '../integrations/pancake/pancake-fulfilment';
import { loadGiftTrialSettings } from '../gift-tiers/gift-trial';
import { GIFT_TRIAL_VARIATION_WHERE } from '../gift-tiers/gift-trial.service';
import { FREE_SHIP_THRESHOLD_DEFAULT } from '../pricing/pricing.service';
import { loadStaffCouponCaps } from '../admin/coupon-input-rules';

export const PDP_COMBO_MAX = 2;
export const PDP_ADDON_MAX = 3;
export const HOME_COMBOS_DEFAULT = 4;
export const HOME_COMBOS_MAX = 8;
/** Trang ghép Hộp Xanh: số món tối đa (đủ cho vài danh mục, một lần tải). */
export const GREEN_BOX_PAGE_MAX = 60;

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

/** Một danh mục thật của trang ghép Hộp Xanh. */
export interface GreenBoxPageGroup {
  category: { id: string; name: string; slug: string } | null;
  products: CardOf[];
}

/** Combo của trang Bộ quà tặng: kèm số tiền giỏ sẽ giảm khi mua đúng bộ đó. */
export interface GiftComboDTO extends BundleDTO {
  /**
   * Số giỏ trừ khi giỏ có đúng các món của bộ, mỗi món một đơn vị (thứ "Thêm cả combo" gửi lên): cùng `allocateBundleDiscounts`, cùng phép floor
   * từng dòng, cùng `maxQty` và trần tiền nhân viên với giỏ (`bundleSetSaving`). Luôn > 0: bộ không giảm được đồng nào bị bỏ khỏi trang.
   */
  saving: number;
}

/** Trang Bộ quà tặng & combo khởi đầu (`/bo-qua-tang` web, `/gift-combos` Mini App). */
export interface GiftLandingDTO {
  /** Cùng luật Combo Trang chủ (đang chạy, mọi món còn hàng), tối đa `HOME_COMBOS_MAX`, theo thứ tự admin sắp. */
  combos: GiftComboDTO[];
  /** Ngưỡng Miễn phí giao hàng: cùng khoá và mặc định với cấu hình công khai (`shipping.free_threshold`); số hỏng thì null, trang không hứa. */
  freeshipThreshold: number | null;
  /**
   * Mốc thấp nhất mở quà dùng thử 0đ (`commerce.gift_trial_min_order`, quà có mốc riêng thì mốc nhỏ nhất). null khi cờ tắt hay không còn quà
   * nào đưa ra được (hết hàng, ngừng bán): trang không hứa quà mà giỏ sẽ không tặng.
   */
  giftTrialMinOrder: number | null;
}

export interface GreenBoxPageDTO {
  /** Cờ `commerce.green_box_enabled` tắt (hoặc bậc cấu hình sai dạng) thì `false` và trang báo chưa mở, không có món. */
  enabled: boolean;
  tiers: GreenBoxTier[];
  groups: GreenBoxPageGroup[];
}

const PUBLIC_SELECT = {
  id: true,
  kind: true,
  title: true,
  pct: true,
  endAt: true,
  anchorProductId: true,
  createdById: true,
  anchorProduct: { select: { storefrontId: true } },
  items: {
    orderBy: { sortOrder: 'asc' },
    select: { productId: true, variationId: true, addonPrice: true, refPrice: true, maxQty: true, product: { select: { storefrontId: true } } },
  },
} satisfies Prisma.BundleSelect;

type Row = Prisma.BundleGetPayload<{ select: typeof PUBLIC_SELECT }>;
type PublicPair = { row: Row; dto: BundleDTO };

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
  async forProduct(slug: string, now: Date = new Date()): Promise<{ combos: BundleDTO[]; addons: BundleDTO[]; addonsSoldOut?: true }> {
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
    const shown = await this.toPublic(
      rows.filter((r) => (r.kind === 'ADDON' ? r.anchorProductId === product.id : true)),
      now,
    );
    const combos = shown.filter((b) => b.kind === 'BUNDLE_PCT').slice(0, PDP_COMBO_MAX);
    const addons = shown.filter((b) => b.kind === 'ADDON').slice(0, PDP_ADDON_MAX);
    if (product.variations.length > 0) return { combos, addons };
    // Sản phẩm chính hết hàng: không bán được món chính nên không mời Mua kèm. Báo riêng để khách đang xem trang thấy "Tạm hết hàng", không
    // phải "Đã kết thúc" (danh sách rỗng thường nghĩa là bộ đã kết thúc).
    return { combos, addons: [], ...(addons.length > 0 ? { addonsSoldOut: true as const } : {}) };
  }

  /** Combo đang chạy mà MỌI món còn hàng (Trang chủ không quảng cáo combo không mua được). */
  async homeCombos(limit: number = HOME_COMBOS_DEFAULT, now: Date = new Date()): Promise<BundleDTO[]> {
    return (await this.liveCombos(limit, now)).map((p) => p.dto);
  }

  private async liveCombos(limit: number, now: Date): Promise<PublicPair[]> {
    const take = Math.min(HOME_COMBOS_MAX, Math.max(1, Math.trunc(limit) || 1));
    const rows = await this.prisma.bundle.findMany({
      where: { ...bundleLiveWhere(now), kind: 'BUNDLE_PCT' },
      select: PUBLIC_SELECT,
      orderBy: BUNDLE_ORDER,
      take: take * 3,
    });
    const shown = await this.toPublicPairs(rows, now);
    return shown.filter((p) => p.dto.items.every((i) => i.inStock)).slice(0, take);
  }

  /**
   * Trang Bộ quà tặng & combo khởi đầu: combo đang bán được và mốc quà dùng thử 0đ còn quà thật. Số tiền đều do máy chủ trả (giá combo tính như
   * Trang chủ, giỏ vẫn tính lại); trang không ghi cứng giá hay mốc nào.
   */
  async giftLanding(now: Date = new Date()): Promise<GiftLandingDTO> {
    const [combos, freeship, giftTrialMinOrder] = await Promise.all([
      this.liveCombos(HOME_COMBOS_MAX, now).then((pairs) => this.withSetSaving(pairs)),
      this.config.get<unknown>('shipping.free_threshold', FREE_SHIP_THRESHOLD_DEFAULT),
      this.giftTrialFloor(),
    ]);
    const freeshipThreshold = typeof freeship === 'number' && Number.isInteger(freeship) && freeship > 0 ? freeship : null;
    return { combos, freeshipThreshold, giftTrialMinOrder };
  }

  /**
   * Gắn số "Tiết kiệm" thật của từng combo (`GiftComboDTO.saving`). Trần nhân viên chỉ tra vai trò người tạo khi số thô vượt trần, như giỏ: chưa vượt thì
   * không bộ nào bị kẹp. Người mua là chính người tạo (nhân viên không hưởng bộ của mình) thì giỏ giảm ít hơn: API công khai không biết người mua.
   */
  private async withSetSaving(pairs: readonly PublicPair[]): Promise<GiftComboDTO[]> {
    if (pairs.length === 0) return [];
    const [maxPct, caps] = await Promise.all([readBundleMaxPct(this.config), loadStaffCouponCaps(this.config)]);
    const sets = pairs.map(({ row, dto }) => {
      const live: LiveBundle = {
        id: row.id,
        kind: row.kind,
        title: row.title,
        pct: row.pct,
        anchorProductId: row.anchorProductId,
        createdById: row.createdById ?? null,
        items: row.items.map((i) => ({ productId: i.productId, variationId: i.variationId, addonPrice: i.addonPrice, refPrice: i.refPrice, maxQty: i.maxQty })),
      };
      // Đúng các dòng "Thêm cả combo" gửi lên: phân loại của thẻ (ghim hoặc đại diện), một đơn vị, giá đang bán.
      const lines: BundleLine[] = dto.items.flatMap((it) =>
        it.variationId ? [{ variationId: it.variationId, productId: it.productId, total: it.product.salePrice ?? it.product.basePrice, quantity: 1 }] : [],
      );
      return { dto, live, lines, raw: bundleSetSaving(live, lines, maxPct, null) };
    });
    const over = sets.filter((s) => s.raw > caps.maxAmount);
    const isStaff = over.length > 0 ? await staffBundlePredicate(this.prisma, over.map((s) => s.live)) : () => false;
    return sets.flatMap(({ dto, live, lines, raw }) => {
      const saving = raw > caps.maxAmount && isStaff(live) ? bundleSetSaving(live, lines, maxPct, caps.maxAmount) : raw;
      return saving > 0 ? [{ ...dto, saving }] : [];
    });
  }

  private async giftTrialFloor(): Promise<number | null> {
    const settings = await loadGiftTrialSettings(this.config);
    if (!settings.enabled || settings.options.length === 0) return null;
    const ids = settings.options.map((o) => o.variationId);
    const live = await this.prisma.variation.findMany({ where: { id: { in: ids }, ...GIFT_TRIAL_VARIATION_WHERE }, select: { id: true } });
    const inStock = new Set(live.map((v) => v.id));
    const floors = settings.options.filter((o) => inStock.has(o.variationId)).map((o) => o.minOrder);
    return floors.length > 0 ? Math.min(...floors) : null;
  }

  /**
   * Danh mục đã lọc sẵn món đủ điều kiện Hộp Xanh: Tubu giao, không phải hàng gian hàng đối tác, còn hàng, không đang Giờ vàng (dòng Giờ vàng
   * không được tính). Nhóm theo danh mục thật đầu tiên của sản phẩm, theo `sortOrder` của danh mục; món không có danh mục vào nhóm cuối. Giá thật và
   * việc món có được tính hay không vẫn do giỏ quyết (`applyGreenBox`): trang này chỉ là lối vào.
   */
  async greenBoxPage(now: Date = new Date()): Promise<GreenBoxPageDTO> {
    const settings = await loadGreenBoxSettings(this.config);
    if (!settings.enabled || settings.tiers.length === 0) return { enabled: false, tiers: [], groups: [] };
    const rows = await this.prisma.product.findMany({
      where: {
        ...PUBLIC_PRODUCT_WHERE,
        fulfilment: 'TUBU',
        storefrontId: null,
        // Cùng điều kiện "kho Tubu giao" của giỏ (`fulfillerOf`): thiếu mã Pancake thật thì giỏ báo không giao được, không vào Hộp Xanh.
        variations: { some: { isActive: true, stock: { gt: 0 }, retailPrice: { gt: 0 }, pancakeId: { not: null }, NOT: { pancakeId: { startsWith: LEGACY_FAKE_PANCAKE_PREFIX } } } },
      },
      select: { id: true, categoryIds: true },
      orderBy: [{ soldApp30d: 'desc' }, { id: 'asc' }],
      take: GREEN_BOX_PAGE_MAX * 2,
    });
    const flash = await loadFlashFootprint(this.prisma, now, rows.map((r) => r.id));
    const picked = rows.filter((r) => !flash.productIds.has(r.id)).slice(0, GREEN_BOX_PAGE_MAX);
    const categoryIds = [...new Set(picked.flatMap((r) => r.categoryIds))];
    const [cards, categories] = await Promise.all([
      this.catalog.cardsByIds(picked.map((r) => r.id)),
      categoryIds.length > 0
        ? this.prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true, slug: true, sortOrder: true } })
        : Promise.resolve([] as { id: string; name: string; slug: string; sortOrder: number }[]),
    ]);
    const catById = new Map(categories.map((c) => [c.id, c]));
    const byGroup = new Map<string, GreenBoxPageGroup & { order: number }>();
    const cardById = new Map(cards.map((c) => [c.id, c]));
    for (const r of picked) {
      const card = cardById.get(r.id);
      if (!card || card.inStock === false) continue;
      const cat = r.categoryIds.map((id) => catById.get(id)).find((c) => c !== undefined) ?? null;
      const key = cat?.id ?? '';
      const g = byGroup.get(key) ?? { category: cat ? { id: cat.id, name: cat.name, slug: cat.slug } : null, products: [], order: cat ? cat.sortOrder : Number.MAX_SAFE_INTEGER };
      g.products.push(card);
      byGroup.set(key, g);
    }
    const groups = [...byGroup.values()]
      .sort((a, b) => a.order - b.order || (a.category?.name ?? '').localeCompare(b.category?.name ?? '', 'vi'))
      .map(({ category, products }) => ({ category, products }));
    return { enabled: true, tiers: settings.tiers, groups };
  }

  /**
   * Dựng DTO; bộ thiếu món công khai, có hàng đối tác, ghim phân loại đã tắt, đang dính Giờ vàng hay không còn đúng luật thì bỏ cả bộ
   * (không quảng cáo bộ không đủ, và giá hiện ra phải bằng giá giỏ tính).
   */
  private async toPublic(rows: readonly Row[], now: Date): Promise<BundleDTO[]> {
    return (await this.toPublicPairs(rows, now)).map((p) => p.dto);
  }

  /** Như `toPublic`, giữ kèm dòng gốc (người tạo, món chưa ghim) cho nơi cần tính lại số tiền theo đúng luật giỏ. */
  private async toPublicPairs(rows: readonly Row[], now: Date): Promise<PublicPair[]> {
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
    const out: PublicPair[] = [];
    for (const b of candidates) {
      const dto = this.build(b, cardById, pinnedById, maxPct, flash);
      if (dto) out.push({ row: b, dto });
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
        // giá tham chiếu) thì giỏ tính giá thường, nên không quảng cáo là giá tốt.
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
