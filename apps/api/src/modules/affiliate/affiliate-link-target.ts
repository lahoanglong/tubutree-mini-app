import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { liveWhere } from '../campaigns/campaign-public';
import { isPublicProduct, PUBLIC_PRODUCT_WHERE } from '../catalog/public-product';

/**
 * Đích của link CTV. HOMEPAGE, DEAL (trang Giờ vàng) và COMBO (trang Bộ quà tặng) không cần mã đích; PRODUCT, CATEGORY và CAMPAIGN lưu id sản
 * phẩm/danh mục/chiến dịch ở `targetId`. Đường dẫn thật (web `/san-pham/<slug>`, Mini `/product/<slug>`...) do client dựng từ `targetSlug`/`targetId` (app-core
 * `commerce/affiliate-deep-link.ts`), máy chủ chỉ lưu đích và trả tên để CTV nhận ra link. Cột `targetType` là chuỗi (không enum DB) nên thêm đích không cần migration.
 */
export const AFFILIATE_LINK_TARGETS = ['HOMEPAGE', 'PRODUCT', 'CATEGORY', 'DEAL', 'CAMPAIGN', 'COMBO'] as const;
export type AffiliateLinkTarget = (typeof AFFILIATE_LINK_TARGETS)[number];

export const LINK_TARGET_ID_REQUIRED = 'Chọn sản phẩm, danh mục hoặc chiến dịch cho link.';
export const LINK_PRODUCT_GONE = 'Sản phẩm này không còn bán, hãy chọn sản phẩm khác.';
export const LINK_PRODUCT_NO_COMMISSION = 'Sản phẩm này không tính hoa hồng CTV, hãy chọn sản phẩm khác.';
export const LINK_CATEGORY_GONE = 'Danh mục này không còn, hãy chọn danh mục khác.';
export const LINK_CAMPAIGN_GONE = 'Chiến dịch này đã kết thúc hoặc chưa mở, hãy chọn chiến dịch khác.';
export const LINK_TARGET_INVALID = 'Loại link không hợp lệ.';

type TargetDb = Pick<Prisma.TransactionClient, 'product' | 'category' | 'campaign'>;

/**
 * Kiểm đích trước khi lưu link. Sản phẩm phải đang hiện công khai và không bị chặn hoa hồng (cùng điều kiện danh sách chọn sản phẩm của
 * CTV, `StorefrontService.pickerProducts`): link tới hàng khách không mở được hay không tính hoa hồng chỉ làm CTV mất công gửi.
 * Chiến dịch phải đang chạy (bật, trong khung ngày) như trang công khai `/chien-dich/<slug>`: link tới chiến dịch khách không mở được chỉ làm CTV mất công gửi.
 * HOMEPAGE/DEAL/COMBO bỏ `targetId` client lỡ gửi kèm.
 */
export async function resolveLinkTargetForCreate(
  db: TargetDb,
  targetType: string,
  targetId?: string | null,
  now: Date = new Date(),
): Promise<{ targetType: AffiliateLinkTarget; targetId: string | null }> {
  if (targetType === 'HOMEPAGE' || targetType === 'DEAL' || targetType === 'COMBO') return { targetType, targetId: null };
  if (targetType !== 'PRODUCT' && targetType !== 'CATEGORY' && targetType !== 'CAMPAIGN') throw new BadRequestException(LINK_TARGET_INVALID);
  const id = targetId?.trim();
  if (!id) throw new BadRequestException(LINK_TARGET_ID_REQUIRED);
  if (targetType === 'PRODUCT') {
    const product = await db.product.findFirst({ where: { id, ...PUBLIC_PRODUCT_WHERE }, select: { id: true, affiliateBlocked: true } });
    if (!product) throw new NotFoundException(LINK_PRODUCT_GONE);
    if (product.affiliateBlocked) throw new BadRequestException(LINK_PRODUCT_NO_COMMISSION);
  } else if (targetType === 'CAMPAIGN') {
    const campaign = await db.campaign.findFirst({ where: { id, linkType: 'CAMPAIGN_PAGE', ...liveWhere(now) }, select: { id: true } });
    if (!campaign) throw new NotFoundException(LINK_CAMPAIGN_GONE);
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
  /** false khi sản phẩm đã ngừng hiện, danh mục đã bị xoá hoặc chiến dịch đã hết hạn/tắt: client mở Trang chủ thay vì trang lỗi. */
  targetAvailable: boolean;
  /** true khi sản phẩm vẫn bán nhưng đã bị tắt hoa hồng CTV sau khi tạo link: link vẫn mở được nhưng đơn không tính hoa hồng. */
  targetCommissionBlocked: boolean;
}

/** Gắn tên và slug đích cho cả trang link bằng hai truy vấn gom (không truy vấn từng dòng). */
export async function attachLinkTargets<T extends { targetType: string; targetId: string | null }>(db: TargetDb, links: T[], now: Date = new Date()): Promise<Array<T & LinkTargetInfo>> {
  const idsOf = (type: string) => [...new Set(links.filter((l) => l.targetType === type && l.targetId).map((l) => l.targetId!))];
  const productIds = idsOf('PRODUCT');
  const categoryIds = idsOf('CATEGORY');
  const campaignIds = idsOf('CAMPAIGN');
  const [products, categories, campaigns] = await Promise.all([
    productIds.length > 0
      ? db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, slug: true, name: true, isActive: true, approvalStatus: true, affiliateBlocked: true } })
      : Promise.resolve([]),
    categoryIds.length > 0 ? db.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, slug: true, name: true } }) : Promise.resolve([]),
    // Không lọc "đang chạy" ở truy vấn: chiến dịch hết hạn vẫn trả slug/tên để dòng link còn đọc được, `targetAvailable` mới báo hết hạn.
    campaignIds.length > 0 ? db.campaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true, slug: true, title: true, isActive: true, startAt: true, endAt: true } }) : Promise.resolve([]),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
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
    if (l.targetType === 'CAMPAIGN') {
      const c = l.targetId ? campaignById.get(l.targetId) : undefined;
      const live = !!c && c.isActive && c.startAt <= now && c.endAt > now;
      return { ...l, targetSlug: c?.slug ?? null, targetLabel: c?.title ?? null, targetAvailable: live, targetCommissionBlocked: false };
    }
    return { ...l, targetSlug: null, targetLabel: null, targetAvailable: true, targetCommissionBlocked: false };
  });
}
