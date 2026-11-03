import type { Prisma } from '@prisma/client';
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
 * Một chuỗi khớp được nhiều cột (slug, subdomain, tên miền riêng) thì slug thắng: slug chính là mã giới thiệu của chủ, link
 * /s/<mã> không được rơi vào gian hàng khác chỉ vì họ đặt subdomain trùng. Có dòng mang slug đó (không phân biệt hoa thường) mà
 * đang ẩn với khách thì trả null, không rơi xuống subdomain của người khác. Chuỗi trùng mã giới thiệu của một tài khoản thì
 * subdomain/tên miền chỉ tính khi thuộc đúng chủ mã (dữ liệu cũ đã trùng và chủ mã chưa mở gian hàng). Chạy tuần tự từng cột để
 * không phụ thuộc thứ tự dòng Postgres tự chọn.
 */
export async function findByIdentifierPriority<T>(
  prisma: Pick<PrismaService, 'storefront' | 'user'>,
  value: string,
  find: (columnWhere: Prisma.StorefrontWhereInput) => Promise<T | null>,
): Promise<T | null> {
  const eq = { equals: value, mode: 'insensitive' } as const;
  const bySlug = await find({ slug: eq });
  if (bySlug) return bySlug;
  if (await prisma.storefront.findFirst({ where: { slug: eq }, select: { id: true } })) return null;
  const codeOwner = await prisma.user.findFirst({ where: { referralCode: eq }, select: { id: true } });
  const ownerGuard: Prisma.StorefrontWhereInput = codeOwner ? { ownerUserId: codeOwner.id } : {};
  for (const column of ['subdomain', 'customDomain'] as const) {
    const found = await find({ [column]: eq, ...ownerGuard });
    if (found) return found;
  }
  return null;
}

/**
 * Gian hàng đang được ghi công: slug, subdomain hoặc tên miền riêng → gian hàng khách đang thấy được (cùng bộ lọc với trang công
 * khai, `publicStorefrontWhere`: đã đăng, không bị gỡ, chủ không bị khoá và còn vai trò CTV, đã duyệt khi cờ bật) và không phải gian hàng mẫu, nên gian hàng
 * bị ẩn không còn gắn đơn hay combo qua giỏ và checkout. Đơn lưu slug CHUẨN và id
 * gian hàng, không lưu chuỗi khách gửi (SELLER-5) — subdomain đổi chủ được, slug thì không. Checkout và giỏ hàng dùng chung
 * để cùng một chuỗi khách gửi cho ra cùng một gian hàng (và cùng combo).
 */
export async function resolvePublishedStorefront(
  prisma: Pick<PrismaService, 'storefront' | 'user'>,
  visibility: PublicVisibilityOptions,
  identifier: string | null | undefined,
): Promise<ResolvedStorefront | null> {
  const value = identifier?.trim().toLowerCase();
  if (!value) return null;
  return findByIdentifierPriority(prisma, value, (columnWhere) =>
    prisma.storefront.findFirst({
      where: { ...publicStorefrontWhere(visibility), isSample: false, ...columnWhere },
      select: { id: true, slug: true, type: true, ownerUserId: true },
    }),
  );
}
