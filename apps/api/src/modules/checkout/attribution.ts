import type { PrismaService } from '../../prisma/prisma.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import { resolvePublishedStorefront, type ResolvedStorefront } from '../storefront/resolve-storefront';

/**
 * Ghi công của một lần mua: người giới thiệu và gian hàng đang được ghi công (quyết định combo). Đặt đơn, báo giá, xem trước mã và
 * trang giỏ dùng chung để cùng một khách luôn ra cùng gian hàng, nên cùng combo và cùng số tiền.
 *
 * Mã giới thiệu: slug gian hàng CTV mở trong Zalo là referralCode viết THƯỜNG còn User.referralCode luôn lưu HOA, Postgres so khớp
 * phân biệt hoa/thường — chuẩn hoá HOA trước khi tra (mirror auth.service.ts:resolveReferrerId()).
 */
export async function resolveAttribution(
  prisma: PrismaService,
  affiliate: Pick<AffiliateService, 'getActiveTouch'>,
  userId: string,
  input: { referralCode?: string; storefrontSlug?: string | null },
): Promise<{ referrerUserId: string | null; storefront: ResolvedStorefront | null }> {
  let referrerUserId: string | null = null;
  if (input.referralCode) {
    const ref = await prisma.user.findUnique({ where: { referralCode: input.referralCode.toUpperCase() } });
    if (ref && ref.id !== userId) referrerUserId = ref.id;
  }
  let storefront = await resolvePublishedStorefront(prisma, input.storefrontSlug);
  // Khách đang mua trong gian hàng CTV mà mã giới thiệu phiên không khớp ai (web suy mã từ subdomain, SELLER-4): chủ gian
  // hàng là người giới thiệu — trước khi rơi về "chạm" cũ có thể của CTV khác.
  if (!referrerUserId && storefront?.type === 'CTV' && storefront.ownerUserId && storefront.ownerUserId !== userId) {
    referrerUserId = storefront.ownerUserId;
  }
  // Phiên mất nhưng còn "chạm" giới thiệu trong hạn → fallback.
  if (!referrerUserId || !storefront) {
    const touch = await affiliate.getActiveTouch(userId);
    if (touch) {
      if (!referrerUserId) referrerUserId = touch.referrerUserId;
      // chỉ lấy slug từ touch kind=ctv (brand không gắn storefrontSlug — tránh ô nhiễm analytics)
      if (!storefront && touch.kind === 'ctv') storefront = await resolvePublishedStorefront(prisma, touch.storefrontSlug);
    }
  }
  return { referrerUserId, storefront };
}
