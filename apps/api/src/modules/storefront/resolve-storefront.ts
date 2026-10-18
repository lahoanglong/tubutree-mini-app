import type { PrismaService } from '../../prisma/prisma.service';
import { publicStorefrontWhere, type PublicVisibilityOptions } from './storefront-visibility';

/** Gian hàng ghi công resolve phía server (SELLER-4/5). */
export interface ResolvedStorefront {
  id: string;
  slug: string;
  type: string;
  ownerUserId: string | null;
}

/**
 * Gian hàng đang được ghi công: slug, subdomain hoặc tên miền riêng → gian hàng khách đang thấy được (cùng bộ lọc với trang công
 * khai, `publicStorefrontWhere`: đã đăng, không bị gỡ, chủ không bị khoá và còn vai trò CTV, đã duyệt khi cờ bật), nên gian hàng
 * bị ẩn không còn gắn đơn hay combo qua giỏ và checkout. Đơn lưu slug CHUẨN và id
 * gian hàng, không lưu chuỗi khách gửi (SELLER-5) — subdomain đổi chủ được, slug thì không. Checkout và giỏ hàng dùng chung
 * để cùng một chuỗi khách gửi cho ra cùng một gian hàng (và cùng combo).
 */
export async function resolvePublishedStorefront(
  prisma: Pick<PrismaService, 'storefront'>,
  visibility: PublicVisibilityOptions,
  identifier: string | null | undefined,
): Promise<ResolvedStorefront | null> {
  const value = identifier?.trim().toLowerCase();
  if (!value) return null;
  return prisma.storefront.findFirst({
    where: { ...publicStorefrontWhere(visibility), OR: [{ slug: value }, { subdomain: value }, { customDomain: value }] },
    select: { id: true, slug: true, type: true, ownerUserId: true },
  });
}
