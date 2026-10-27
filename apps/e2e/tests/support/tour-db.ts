import { DEMO_BRAND_CONTENT } from './demo-brand';
import path from 'path';

/**
 * Thương hiệu và gian hàng công khai do máy chủ web đọc từ API thật (SSR) nên mock trình duyệt không chạm tới; seed không có hai thứ này.
 * Chỉ ghi vào DB tạm của web-gate.sh (khớp đúng chuỗi kết nối của script), không bao giờ vào DB khác.
 */
const GATE_DB = /^postgresql:\/\/tubu:tubu@127\.0\.0\.1:\d+\/tubutree$/;

export async function seedTourPublicData(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (!GATE_DB.test(url)) return;
  // apps/e2e không phụ thuộc @prisma/client: nạp bản của apps/api (đã generate) và chỉ dùng vài lệnh, nên không cần kiểu đầy đủ.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PrismaClient } = require(path.resolve(__dirname, '../../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const data = DEMO_BRAND_CONTENT;
    // Seed đã có nhãn Visante nhưng chưa công khai; chỉ bật công khai và thêm nội dung giới thiệu.
    const brand = await prisma.brand.upsert({ where: { slug: 'visante' }, update: data, create: { slug: 'visante', name: 'Visante', ...data } });
    await prisma.product.updateMany({ where: { brand: 'Visante' }, data: { brandId: brand.id } });
    const exists = await prisma.storefront.findUnique({ where: { slug: 'ctv-pilot' } });
    if (!exists) {
      const products = await prisma.product.findMany({ where: { brand: 'Visante' }, take: 4, orderBy: { id: 'asc' } });
      // Gian hàng CTV chỉ hiện với khách khi chủ có vai trò CTV (publicStorefrontWhere), nên cần một chủ.
      const owner = await prisma.user.upsert({
        where: { zaloId: 'tour-ctv-owner' },
        update: {},
        create: { zaloId: 'tour-ctv-owner', fullName: 'Nguyễn Văn An', role: 'AFFILIATE', referralCode: 'AN123' },
      });
      await prisma.storefront.create({
        data: {
          ownerUserId: owner.id, approvedAt: new Date(), type: 'CTV', slug: 'ctv-pilot', title: 'Cửa hàng Xanh của An', headerNote: 'Sản phẩm thiên nhiên chọn lọc', isPublished: true, publishedAt: new Date(),
          collections: { create: [{ title: 'Bán chạy', kind: 'NORMAL', layout: 'GRID', items: { create: products.map((p: { id: string }, i: number) => ({ productId: p.id, sortOrder: i })) } }] },
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}
