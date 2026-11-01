import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { isPartnerOwnedProduct } from '../cart/partner-goods';
import type { LiveBundle } from './bundle-rules';

/** Trần % của bộ BUNDLE_PCT: kẹp lúc ghi (admin) và lúc tính tiền, như `storefront.max_combo_pct` của combo gian hàng. */
export const BUNDLE_MAX_PCT_KEY = 'bundle.max_pct';
export const BUNDLE_MAX_PCT_DEFAULT = 50;

/** Đang chạy: bật và `startAt <= now < endAt`. Đúng lúc `endAt` là đã hết, nên bộ hết hạn giữa báo giá và đặt đơn làm tổng tăng và bị `TOTAL_CHANGED` chặn. */
export const bundleLiveWhere = (now: Date) => ({ isActive: true, startAt: { lte: now }, endAt: { gt: now } }) satisfies Prisma.BundleWhereInput;

const LIVE_SELECT = {
  id: true,
  kind: true,
  pct: true,
  anchorProductId: true,
  anchorProduct: { select: { storefrontId: true } },
  items: {
    orderBy: { sortOrder: 'asc' },
    select: { productId: true, variationId: true, addonPrice: true, maxQty: true, product: { select: { storefrontId: true } } },
  },
} satisfies Prisma.BundleSelect;

/**
 * Bundle đang chạy có liên quan tới các sản phẩm trong giỏ (một truy vấn). Bộ có món hoặc sản phẩm chính là hàng của gian hàng
 * đối tác bị bỏ cả bộ (`partner-goods.ts`: hàng đối tác chỉ bán giá lẻ), kể cả khi dữ liệu ghi tay hoặc sản phẩm đổi chủ về sau;
 * ADDON mất sản phẩm chính (bị xoá) cũng không áp.
 */
export async function loadLiveBundles(prisma: Pick<PrismaService, 'bundle'>, now: Date, productIds: readonly string[]): Promise<LiveBundle[]> {
  if (productIds.length === 0) return [];
  const ids = [...productIds];
  const rows = await prisma.bundle.findMany({
    where: { ...bundleLiveWhere(now), OR: [{ items: { some: { productId: { in: ids } } } }, { anchorProductId: { in: ids } }] },
    select: LIVE_SELECT,
  });
  return rows
    .filter((b) => b.items.every((i) => !isPartnerOwnedProduct(i.product)))
    .filter((b) => (b.kind === 'ADDON' ? b.anchorProductId !== null && !isPartnerOwnedProduct(b.anchorProduct) : true))
    .map((b) => ({
      id: b.id,
      kind: b.kind,
      pct: b.pct,
      anchorProductId: b.anchorProductId,
      items: b.items.map((i) => ({ productId: i.productId, variationId: i.variationId, addonPrice: i.addonPrice, maxQty: i.maxQty })),
    }));
}
