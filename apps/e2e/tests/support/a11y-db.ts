import path from 'path';
import { DEMO_BRAND_CONTENT } from './demo-brand';
import { writableTempDb } from './waste-db';

/**
 * Dữ liệu thật cho axe smoke web (a11y-shop.web.spec.ts): chi tiết sản phẩm, gian hàng CTV và thương hiệu do máy chủ web dựng từ API thật (SSR/ISR)
 * nên mock trình duyệt không chạm tới. Sản phẩm và nhãn có sẵn từ migration (cả DB của web-gate.sh lẫn DB của job CI, chỉ chạy `migrate deploy`), nhưng nhãn chưa công khai
 * và chưa có gian hàng nào: hàm này bật công khai nhãn Visante, gắn sản phẩm Visante vào nhãn và tạo gian hàng CTV mẫu. Chỉ ghi vào DB tạm (writableTempDb), không bao giờ vào
 * DB khác. Chạy lặp và chạy song song hai worker đều an toàn (bỏ qua lỗi trùng khoá).
 */
export const A11Y_BRAND_SLUG = 'visante';
export const A11Y_STOREFRONT_SLUG = 'ctv-pilot';

/** Lỗi trùng khoá duy nhất của Prisma (P2002): worker khác vừa tạo cùng bản ghi, kết quả mong muốn đã có. */
async function ignoreDuplicate(write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (e) {
    if ((e as { code?: string }).code !== 'P2002') throw e;
  }
}

/** `true` khi đã bảo đảm có thương hiệu và gian hàng công khai; `false` khi DB không phải DB tạm (không ghi gì, spec bỏ qua kèm lý do). */
export async function seedShopScreens(): Promise<boolean> {
  const url = process.env.DATABASE_URL ?? '';
  if (!writableTempDb(url)) return false;
  // apps/e2e không phụ thuộc @prisma/client: nạp bản của apps/api (đã generate) và chỉ dùng vài lệnh, nên không cần kiểu đầy đủ.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PrismaClient } = require(path.resolve(__dirname, '../../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const data = DEMO_BRAND_CONTENT;
    let brand = await prisma.brand.findUnique({ where: { slug: A11Y_BRAND_SLUG } });
    if (!brand) await ignoreDuplicate(() => prisma.brand.create({ data: { slug: A11Y_BRAND_SLUG, name: 'Visante', ...data } }));
    brand = await prisma.brand.update({ where: { slug: A11Y_BRAND_SLUG }, data });

    await prisma.product.updateMany({ where: { brand: 'Visante' }, data: { brandId: brand.id } });

    if (!(await prisma.storefront.findUnique({ where: { slug: A11Y_STOREFRONT_SLUG } }))) {
      const products = await prisma.product.findMany({ where: { brand: 'Visante' }, take: 4, orderBy: { id: 'asc' } });
      // Gian hàng CTV chỉ hiện với khách khi chủ có vai trò CTV (publicStorefrontWhere), nên cần một chủ.
      const ownerWhere = { zaloId: 'tour-ctv-owner' };
      const owner =
        (await prisma.user.findUnique({ where: ownerWhere })) ??
        (await prisma.user.create({ data: { ...ownerWhere, fullName: 'Nguyễn Văn An', role: 'AFFILIATE', referralCode: 'AN123' } }).catch(async (e: { code?: string }) => {
          if (e.code !== 'P2002') throw e;
          return prisma.user.findUnique({ where: ownerWhere });
        }));
      await ignoreDuplicate(() =>
        prisma.storefront.create({
          data: {
            ownerUserId: owner.id, approvedAt: new Date(), type: 'CTV', slug: A11Y_STOREFRONT_SLUG, title: 'Cửa hàng Xanh của An', headerNote: 'Sản phẩm thiên nhiên chọn lọc', isPublished: true, publishedAt: new Date(),
            collections: { create: [{ title: 'Bán chạy', kind: 'NORMAL', layout: 'GRID', items: { create: products.map((p: { id: string }, i: number) => ({ productId: p.id, sortOrder: i })) } }] },
          },
        }),
      );
    }
    return true;
  } finally {
    await prisma.$disconnect();
  }
}
