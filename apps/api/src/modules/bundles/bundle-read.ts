import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { isPartnerOwnedProduct } from '../cart/partner-goods';
import type { LiveBundle } from './bundle-rules';

/** Trần % của bộ BUNDLE_PCT: kẹp lúc ghi (admin) và lúc tính tiền, như `storefront.max_combo_pct` của combo gian hàng. */
export const BUNDLE_MAX_PCT_KEY = 'bundle.max_pct';
export const BUNDLE_MAX_PCT_DEFAULT = 50;

/** Đang chạy: bật và `startAt <= now < endAt`. Đúng lúc `endAt` là đã hết, nên bộ hết hạn giữa báo giá và đặt đơn làm tổng tăng và bị `TOTAL_CHANGED` chặn. */
export const bundleLiveWhere = (now: Date) => ({ isActive: true, startAt: { lte: now }, endAt: { gt: now } }) satisfies Prisma.BundleWhereInput;

/** Trần % đang cấu hình; giá trị cấu hình hỏng (không phải số hữu hạn) thì về mặc định, không để bộ giảm vô hạn. */
export async function readBundleMaxPct(config: Pick<SystemConfigService, 'get'>): Promise<number> {
  const configured = await config.get<number>(BUNDLE_MAX_PCT_KEY, BUNDLE_MAX_PCT_DEFAULT);
  return typeof configured === 'number' && Number.isFinite(configured) ? configured : BUNDLE_MAX_PCT_DEFAULT;
}

/**
 * Bộ có món (hoặc sản phẩm chính của ADDON) là hàng gian hàng đối tác bị bỏ cả bộ (`partner-goods.ts`: hàng đối tác chỉ bán giá lẻ),
 * kể cả khi dữ liệu ghi tay hoặc sản phẩm đổi chủ về sau; ADDON mất sản phẩm chính (bị xoá) cũng không hợp lệ.
 */
export function isTubuOnlyBundle(b: {
  kind: 'BUNDLE_PCT' | 'ADDON';
  anchorProductId: string | null;
  anchorProduct: { storefrontId: string | null } | null;
  items: { product: { storefrontId: string | null } }[];
}): boolean {
  if (b.items.some((i) => isPartnerOwnedProduct(i.product))) return false;
  return b.kind === 'ADDON' ? b.anchorProductId !== null && !isPartnerOwnedProduct(b.anchorProduct) : true;
}

const LIVE_SELECT = {
  id: true,
  kind: true,
  pct: true,
  anchorProductId: true,
  createdById: true,
  anchorProduct: { select: { storefrontId: true } },
  items: {
    orderBy: { sortOrder: 'asc' },
    select: { productId: true, variationId: true, addonPrice: true, refPrice: true, maxQty: true, product: { select: { storefrontId: true } } },
  },
} satisfies Prisma.BundleSelect;

/**
 * Bundle đang chạy có liên quan tới các sản phẩm trong giỏ (một truy vấn), đã bỏ bộ vi phạm `isTubuOnlyBundle`.
 */
export async function loadLiveBundles(prisma: Pick<PrismaService, 'bundle'>, now: Date, productIds: readonly string[]): Promise<LiveBundle[]> {
  if (productIds.length === 0) return [];
  const ids = [...productIds];
  const rows = await prisma.bundle.findMany({
    where: { ...bundleLiveWhere(now), OR: [{ items: { some: { productId: { in: ids } } } }, { anchorProductId: { in: ids } }] },
    select: LIVE_SELECT,
  });
  return rows
    .filter(isTubuOnlyBundle)
    .map((b) => ({
      id: b.id,
      kind: b.kind,
      pct: b.pct,
      anchorProductId: b.anchorProductId,
      createdById: b.createdById,
      items: b.items.map((i) => ({ productId: i.productId, variationId: i.variationId, addonPrice: i.addonPrice, refPrice: i.refPrice, maxQty: i.maxQty })),
    }));
}

/** Phân loại (và sản phẩm của chúng) đang có suất Giờ vàng: nơi đọc công khai dùng để không quảng cáo bộ mà giỏ sẽ không giảm. */
export interface FlashFootprint {
  variationIds: ReadonlySet<string>;
  productIds: ReadonlySet<string>;
}

/**
 * Giỏ không đưa dòng Giờ vàng vào tính bundle (`computeForStorefront` nhận dòng không flash), nên trang sản phẩm và Trang chủ phải ẩn
 * đúng những bộ mà dòng đó làm hụt. Cùng điều kiện với `FlashSaleService.resolveEffective`: đợt bật và đang trong giờ, còn suất,
 * phân loại còn bán. Không tra theo người mua (API công khai, cache chung): người đã hết suất cá nhân vẫn thấy bộ ẩn, và giỏ chỉ
 * giảm thêm chứ không bao giờ đắt hơn thứ đã quảng cáo.
 */
export async function loadFlashFootprint(prisma: Pick<PrismaService, 'flashSaleItem'>, now: Date, productIds: readonly string[]): Promise<FlashFootprint> {
  const variationIds = new Set<string>();
  const products = new Set<string>();
  if (productIds.length === 0) return { variationIds, productIds: products };
  const rows = await prisma.flashSaleItem.findMany({
    where: {
      variation: { productId: { in: [...productIds] }, isActive: true },
      flashSale: { isActive: true, startAt: { lte: now }, endAt: { gt: now } },
    },
    select: { variationId: true, soldCount: true, quota: true, variation: { select: { productId: true } } },
  });
  for (const r of rows) {
    if (r.soldCount >= r.quota) continue;
    variationIds.add(r.variationId);
    products.add(r.variation.productId);
  }
  return { variationIds, productIds: products };
}
