import path from 'path';
import { seedDatabaseUrl, seedShopScreens } from './a11y-db';
import { CAMPAIGN_CODE, CAMPAIGN_SLUG, CAMPAIGN_TITLE } from './campaign-mocks';
import { solidPng } from './noise-png';
import { writableTempDb } from './waste-db';

const DAY = 86_400_000;

/** Hai worker cùng seed: upsert của Prisma không nguyên tử, bên thua gặp P2002 thì bản ghi đã có, chạy lại một lần là thành cập nhật. */
async function retryOnDuplicate<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (e) {
    if ((e as { code?: string }).code !== 'P2002') throw e;
    return write();
  }
}

/**
 * Chiến dịch công khai do máy chủ web đọc từ API thật (SSR/ISR) nên mock trình duyệt không chạm tới: không có dòng này `/chien-dich/<slug>` là trang 404
 * và tour chụp lại trang 404 thay vì màn chiến dịch. Chỉ ghi vào DB tạm (writableTempDb). Ảnh là PNG: API chỉ phục vụ ảnh raster, SVG bị bỏ khỏi JSON công khai.
 */
async function seedTourCampaign(): Promise<void> {
  const url = seedDatabaseUrl();
  if (!writableTempDb(url)) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PrismaClient } = require(path.resolve(__dirname, '../../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const now = Date.now();
    const image = `data:image/png;base64,${solidPng(150, 60, [47, 107, 79]).toString('base64')}`;
    const products = await prisma.product.findMany({ where: { isActive: true, approvalStatus: 'APPROVED' }, take: 3, orderBy: { id: 'asc' }, select: { id: true } });
    const coupon = { type: 'PERCENT', value: 10, minOrder: 100_000, maxDiscount: 30_000, startAt: new Date(now - DAY), endAt: new Date(now + 5 * DAY), isActive: true, scope: 'PUBLIC', perUserLimit: 1 };
    await retryOnDuplicate(() => prisma.coupon.upsert({ where: { code: CAMPAIGN_CODE }, create: { code: CAMPAIGN_CODE, ...coupon }, update: coupon }));
    const couponRow = await prisma.coupon.findUniqueOrThrow({ where: { code: CAMPAIGN_CODE }, select: { id: true } });
    const campaign = {
      title: CAMPAIGN_TITLE,
      subtitle: 'Giảm sâu mùa trăng',
      placement: 'HOME_TOP',
      image,
      startAt: new Date(now - DAY),
      endAt: new Date(now + 10 * DAY),
      isActive: true,
    };
    const row = await retryOnDuplicate<{ id: string }>(() => prisma.campaign.upsert({ where: { slug: CAMPAIGN_SLUG }, create: { slug: CAMPAIGN_SLUG, ...campaign }, update: campaign, select: { id: true } }));
    await prisma.campaignCoupon.createMany({ data: [{ campaignId: row.id, couponId: couponRow.id }], skipDuplicates: true });
    await prisma.campaignProduct.createMany({ data: products.map((p: { id: string }, i: number) => ({ campaignId: row.id, productId: p.id, sortOrder: i })), skipDuplicates: true });
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Thương hiệu, gian hàng và chiến dịch công khai do máy chủ web đọc từ API thật (SSR) nên mock trình duyệt không chạm tới; seed không có các thứ này.
 * Thương hiệu và gian hàng dùng chung hàm của axe smoke (a11y-db.ts) để hai spec luôn thấy cùng một dữ liệu, cùng một rào ghi (writableTempDb: DB tạm của web-gate.sh hoặc DB của job CI).
 */
export async function seedTourPublicData(): Promise<void> {
  await seedShopScreens();
  await seedTourCampaign();
}
