import path from 'path';
import { seedDatabaseUrl } from './a11y-db';
import { writableTempDb } from './waste-db';

/** Gian hàng CTV mẫu có đủ ba loại khối để đo bố cục web 1280px của trang công khai (SSR từ API thật): kệ ít món, kệ nhiều món, combo. */
export const LG_SHELVES_SLUG = 'g6-lg-shelves';
export const LG_SHELF_FEW = 4;
export const LG_SHELF_MANY = 8;
export const LG_COMBO_ITEMS = 3;

/**
 * Tạo gian hàng `LG_SHELVES_SLUG` trong DB tạm (writableTempDb, không bao giờ ghi DB khác). `false` khi DB không phải DB tạm. Chạy lặp an toàn:
 * đã có gian hàng thì giữ nguyên. Mỗi chủ chỉ có một gian hàng (unique ownerUserId) nên chủ này riêng, không dùng chung với `seedShopScreens`.
 */
export async function seedLgShelves(): Promise<boolean> {
  const url = seedDatabaseUrl();
  if (!writableTempDb(url)) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PrismaClient } = require(path.resolve(__dirname, '../../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    if (await prisma.storefront.findUnique({ where: { slug: LG_SHELVES_SLUG } })) return true;
    const products: { id: string }[] = await prisma.product.findMany({ where: { isActive: true }, take: LG_SHELF_MANY + LG_COMBO_ITEMS, orderBy: { id: 'asc' } });
    if (products.length < LG_SHELF_MANY + LG_COMBO_ITEMS) return false;
    const ownerWhere = { zaloId: 'g6-lg-owner' };
    const owner =
      (await prisma.user.findUnique({ where: ownerWhere })) ??
      (await prisma.user.create({ data: { ...ownerWhere, fullName: 'Trần Thị Bình', role: 'AFFILIATE', referralCode: 'G6LG01' } }).catch(async (e: { code?: string }) => {
        if (e.code !== 'P2002') throw e;
        return prisma.user.findUnique({ where: ownerWhere });
      }));
    const items = (list: { id: string }[]) => ({ create: list.map((p, i) => ({ productId: p.id, sortOrder: i })) });
    await prisma.storefront
      .create({
        data: {
          ownerUserId: owner.id, approvedAt: new Date(), type: 'CTV', slug: LG_SHELVES_SLUG, title: 'Cửa hàng thử bố cục', headerNote: 'Thử khối trên màn rộng', isPublished: true, publishedAt: new Date(),
          collections: {
            create: [
              { title: 'Kệ ít món', kind: 'NORMAL', layout: 'CAROUSEL', sortOrder: 0, items: items(products.slice(0, LG_SHELF_FEW)) },
              { title: 'Combo thử', kind: 'COMBO', layout: 'GRID', comboDiscountPct: 10, sortOrder: 1, items: items(products.slice(LG_SHELF_FEW, LG_SHELF_FEW + LG_COMBO_ITEMS)) },
              { title: 'Kệ nhiều món', kind: 'NORMAL', layout: 'CAROUSEL', sortOrder: 2, items: items(products.slice(0, LG_SHELF_MANY)) },
            ],
          },
        },
      })
      .catch((e: { code?: string }) => {
        if (e.code !== 'P2002') throw e;
      });
    return true;
  } finally {
    await prisma.$disconnect();
  }
}
