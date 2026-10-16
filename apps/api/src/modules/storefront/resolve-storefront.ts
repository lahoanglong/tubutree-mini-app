import type { PrismaService } from '../../prisma/prisma.service';

/** Gian hàng ghi công resolve phía server (SELLER-4/5). */
export interface ResolvedStorefront {
  id: string;
  slug: string;
  type: string;
  ownerUserId: string | null;
}

/**
 * Gian hàng đang được ghi công: slug, subdomain hoặc tên miền riêng → gian hàng (đang xuất bản). Đơn lưu slug CHUẨN và id
 * gian hàng, không lưu chuỗi khách gửi (SELLER-5) — subdomain đổi chủ được, slug thì không. Checkout và giỏ hàng dùng chung
 * để cùng một chuỗi khách gửi cho ra cùng một gian hàng (và cùng combo).
 */
export async function resolvePublishedStorefront(
  prisma: Pick<PrismaService, 'storefront'>,
  identifier: string | null | undefined,
): Promise<ResolvedStorefront | null> {
  const value = identifier?.trim().toLowerCase();
  if (!value) return null;
  return prisma.storefront.findFirst({
    where: { isPublished: true, OR: [{ slug: value }, { subdomain: value }, { customDomain: value }] },
    select: { id: true, slug: true, type: true, ownerUserId: true },
  });
}
