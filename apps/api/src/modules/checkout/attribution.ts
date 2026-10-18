import type { PrismaService } from '../../prisma/prisma.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import { resolvePublishedStorefront, type ResolvedStorefront } from '../storefront/resolve-storefront';

/**
 * Ghi công của một lần mua: người giới thiệu và gian hàng đang được ghi công (quyết định combo). Đặt đơn, báo giá, xem trước mã và
 * trang giỏ dùng chung để cùng một khách luôn ra cùng gian hàng, nên cùng combo và cùng số tiền.
 *
 * Mỗi bậc (mã giới thiệu → chủ gian hàng CTV → "chạm" còn hạn) chỉ ghi công người thuộc vai trò hưởng hoa hồng (CTV/đại lý,
 * AffiliateService.findEligibleReferrer / isCommissionEligible); người không đủ vai trò bị bỏ qua để xét bậc kế tiếp.
 */
export async function resolveAttribution(
  prisma: PrismaService,
  affiliate: Pick<AffiliateService, 'getActiveTouch' | 'findEligibleReferrer' | 'isCommissionEligible' | 'storefrontVisibility'>,
  userId: string,
  input: { referralCode?: string; storefrontSlug?: string | null },
): Promise<{ referrerUserId: string | null; storefront: ResolvedStorefront | null }> {
  let referrerUserId = input.referralCode ? await affiliate.findEligibleReferrer(input.referralCode, userId) : null;
  const visibility = await affiliate.storefrontVisibility();
  let storefront = await resolvePublishedStorefront(prisma, visibility, input.storefrontSlug);
  // Khách đang mua trong gian hàng CTV mà mã giới thiệu phiên không khớp ai (web suy mã từ subdomain, SELLER-4): chủ gian
  // hàng là người giới thiệu — trước khi rơi về "chạm" cũ có thể của CTV khác.
  const owner = storefront?.type === 'CTV' && storefront.ownerUserId !== userId ? storefront.ownerUserId : null;
  if (!referrerUserId && owner && (await affiliate.isCommissionEligible(owner))) {
    referrerUserId = owner;
  }
  // Phiên mất nhưng còn "chạm" giới thiệu trong hạn → fallback.
  if (!referrerUserId || !storefront) {
    const touch = await affiliate.getActiveTouch(userId);
    if (touch) {
      if (!referrerUserId && (await affiliate.isCommissionEligible(touch.referrerUserId))) referrerUserId = touch.referrerUserId;
      // chỉ lấy slug từ touch kind=ctv (brand không gắn storefrontSlug — tránh ô nhiễm analytics)
      if (!storefront && touch.kind === 'ctv') storefront = await resolvePublishedStorefront(prisma, visibility, touch.storefrontSlug);
    }
  }
  return { referrerUserId, storefront };
}
