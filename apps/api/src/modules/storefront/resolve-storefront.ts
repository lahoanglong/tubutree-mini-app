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
 * Một chuỗi khớp được nhiều cột (slug, subdomain, tên miền riêng) của các gian hàng khác nhau thì slug thắng: slug chính là mã giới
 * thiệu của chủ, link /s/<mã> không được rơi vào gian hàng khác chỉ vì họ đặt subdomain trùng. Chạy tuần tự từng cột, lần lượt
 * slug, subdomain, tên miền riêng, để không bao giờ phụ thuộc thứ tự dòng Postgres tự chọn.
 */
export async function findByIdentifierPriority<T>(
  value: string,
  find: (columnWhere: Prisma.StorefrontWhereInput) => Promise<T | null>,
  insensitive = false,
): Promise<T | null> {
  const eq = (): string | { equals: string; mode: 'insensitive' } => (insensitive ? { equals: value, mode: 'insensitive' } : value);
  for (const column of ['slug', 'subdomain', 'customDomain'] as const) {
    const found = await find({ [column]: eq() });
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
  prisma: Pick<PrismaService, 'storefront'>,
  visibility: PublicVisibilityOptions,
  identifier: string | null | undefined,
): Promise<ResolvedStorefront | null> {
  const value = identifier?.trim().toLowerCase();
  if (!value) return null;
  return findByIdentifierPriority(value, (columnWhere) =>
    prisma.storefront.findFirst({
      where: { ...publicStorefrontWhere(visibility), isSample: false, ...columnWhere },
      select: { id: true, slug: true, type: true, ownerUserId: true },
    }),
  );
}
