import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { isPublicProduct, PUBLIC_PRODUCT_WHERE } from '../catalog/public-product';

/**
 * Đích của link CTV. HOMEPAGE và DEAL (trang Giờ vàng) không cần mã đích; PRODUCT và CATEGORY lưu id sản phẩm/danh mục ở `targetId`.
 * Đường dẫn thật (web `/san-pham/<slug>`, Mini `/product/<slug>`...) do client dựng từ `targetSlug`/`targetId` (app-core
 * `commerce/affiliate-deep-link.ts`), máy chủ chỉ lưu đích và trả tên để CTV nhận ra link.
 */
export const AFFILIATE_LINK_TARGETS = ['HOMEPAGE', 'PRODUCT', 'CATEGORY', 'DEAL'] as const;
export type AffiliateLinkTarget = (typeof AFFILIATE_LINK_TARGETS)[number];

export const LINK_TARGET_ID_REQUIRED = 'Chọn sản phẩm hoặc danh mục cho link.';
export const LINK_PRODUCT_GONE = 'Sản phẩm này không còn bán, hãy chọn sản phẩm khác.';
export const LINK_PRODUCT_NO_COMMISSION = 'Sản phẩm này không tính hoa hồng CTV, hãy chọn sản phẩm khác.';
export const LINK_CATEGORY_GONE = 'Danh mục này không còn, hãy chọn danh mục khác.';
export const LINK_TARGET_INVALID = 'Loại link không hợp lệ.';

type TargetDb = Pick<Prisma.TransactionClient, 'product' | 'category'>;

/**
 * Kiểm đích trước khi lưu link. Sản phẩm phải đang hiện công khai và không bị chặn hoa hồng (cùng điều kiện danh sách chọn sản phẩm của
 * CTV, `StorefrontService.pickerProducts`): link tới hàng khách không mở được hay không tính hoa hồng chỉ làm CTV mất công gửi.
 * HOMEPAGE/DEAL bỏ `targetId` client lỡ gửi kèm.
 */
export async function resolveLinkTargetForCreate(
  db: TargetDb,
  targetType: string,
  targetId?: string | null,
): Promise<{ targetType: AffiliateLinkTarget; targetId: string | null }> {
  if (targetType === 'HOMEPAGE' || targetType === 'DEAL') return { targetType, targetId: null };
  if (targetType !== 'PRODUCT' && targetType !== 'CATEGORY') throw new BadRequestException(LINK_TARGET_INVALID);
  const id = targetId?.trim();
  if (!id) throw new BadRequestException(LINK_TARGET_ID_REQUIRED);
  if (targetType === 'PRODUCT') {
    const product = await db.product.findFirst({ where: { id, ...PUBLIC_PRODUCT_WHERE }, select: { id: true, affiliateBlocked: true } });
    if (!product) throw new NotFoundException(LINK_PRODUCT_GONE);
    if (product.affiliateBlocked) throw new BadRequestException(LINK_PRODUCT_NO_COMMISSION);
  } else {
    const category = await db.category.findUnique({ where: { id }, select: { id: true } });
    if (!category) throw new NotFoundException(LINK_CATEGORY_GONE);
  }
  return { targetType, targetId: id };
}

export interface LinkTargetInfo {
  /** Slug sản phẩm/danh mục để client dựng đường dẫn; null với Trang chủ, Giờ vàng hoặc đích đã bị xoá. */
  targetSlug: string | null;
  /** Tên sản phẩm/danh mục; null như trên (client tự đặt nhãn Trang chủ/Giờ vàng). */
  targetLabel: string | null;
  /** false khi sản phẩm đã ngừng hiện hoặc danh mục đã bị xoá: client mở Trang chủ thay vì trang lỗi. */
  targetAvailable: boolean;
  /** true khi sản phẩm vẫn bán nhưng đã bị tắt hoa hồng CTV sau khi tạo link: link vẫn mở được nhưng đơn không tính hoa hồng. */
  targetCommissionBlocked: boolean;
}

/** Gắn tên và slug đích cho cả trang link bằng hai truy vấn gom (không truy vấn từng dòng). */
export async function attachLinkTargets<T extends { targetType: string; targetId: string | null }>(db: TargetDb, links: T[]): Promise<Array<T & LinkTargetInfo>> {
  const idsOf = (type: string) => [...new Set(links.filter((l) => l.targetType === type && l.targetId).map((l) => l.targetId!))];
  const productIds = idsOf('PRODUCT');
  const categoryIds = idsOf('CATEGORY');
  const [products, categories] = await Promise.all([
    productIds.length > 0
      ? db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, slug: true, name: true, isActive: true, approvalStatus: true, affiliateBlocked: true } })
      : Promise.resolve([]),
    categoryIds.length > 0 ? db.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, slug: true, name: true } }) : Promise.resolve([]),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  return links.map((l) => {
    if (l.targetType === 'PRODUCT') {
      const p = l.targetId ? productById.get(l.targetId) : undefined;
      return {
        ...l,
        targetSlug: p?.slug ?? null,
        targetLabel: p?.name ?? null,
        targetAvailable: !!p && isPublicProduct(p),
        targetCommissionBlocked: !!p?.affiliateBlocked,
      };
    }
    if (l.targetType === 'CATEGORY') {
      const c = l.targetId ? categoryById.get(l.targetId) : undefined;
      return { ...l, targetSlug: c?.slug ?? null, targetLabel: c?.name ?? null, targetAvailable: !!c, targetCommissionBlocked: false };
    }
    return { ...l, targetSlug: null, targetLabel: null, targetAvailable: true, targetCommissionBlocked: false };
  });
}
