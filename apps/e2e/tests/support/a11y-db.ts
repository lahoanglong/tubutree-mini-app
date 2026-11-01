import path from 'path';
import type { APIRequestContext } from '@playwright/test';
import { DEMO_BRAND_CONTENT } from './demo-brand';
import { parseEnvFile } from './env-file';
import { writableTempDb } from './waste-db';

/**
 * Dữ liệu thật cho axe smoke web (a11y-shop.web.spec.ts): chi tiết sản phẩm, gian hàng CTV và thương hiệu do máy chủ web dựng từ API thật (SSR/ISR)
 * nên mock trình duyệt không chạm tới. Sản phẩm và nhãn có sẵn từ migration (cả DB của web-gate.sh lẫn DB của job CI, chỉ chạy `migrate deploy`), nhưng nhãn chưa công khai
 * và chưa có gian hàng nào: hàm này bật công khai nhãn Visante, gắn sản phẩm Visante vào nhãn và tạo gian hàng CTV mẫu. Chỉ ghi vào DB tạm (writableTempDb), không bao giờ vào
 * DB khác. Chạy lặp và chạy song song hai worker đều an toàn (bỏ qua lỗi trùng khoá). Cũng là nguồn dữ liệu của visual-tour.web.spec.ts (tour-db.ts gọi hàm này).
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

const API_ENV_FILE = path.resolve(__dirname, '../../../api/.env');

/**
 * Chuỗi kết nối của DB mà API e2e đang dùng: DATABASE_URL của process, rơi về apps/api/.env (cùng thứ tự với global-setup.ts). Job CI không export DATABASE_URL cho
 * Playwright (nó nằm trong apps/api/.env do bước "Prepare API env"), nên chỉ đọc process.env thì seed lặng lẽ không ghi và ba màn dựng từ API thật bị bỏ qua.
 */
export function seedDatabaseUrl(env: NodeJS.ProcessEnv = process.env, apiEnvFile: string = API_ENV_FILE): string {
  return env.DATABASE_URL ?? parseEnvFile(apiEnvFile)['DATABASE_URL'] ?? '';
}

/** Trên GitHub Actions DB luôn là DB tạm đã migrate: không seed được nghĩa là cấu hình hỏng, phải đỏ chứ không được bỏ qua màn nào. */
export function assertSeededOnCi(seeded: boolean, env: NodeJS.ProcessEnv = process.env): void {
  if (env.GITHUB_ACTIONS === 'true' && !seeded) {
    throw new Error('seedShopScreens không ghi được dữ liệu mẫu trên CI (DATABASE_URL không phải DB của job CI?): gian hàng và thương hiệu sẽ 404 và bị bỏ qua');
  }
}

/**
 * Slug nhãn công khai đầu tiên của API thật, hoặc null khi chưa có. `/api/brands` có bộ nhớ đệm 60 giây trong tiến trình API (CatalogService.brandsCache), nên ngay sau seed
 * nó có thể chưa thấy nhãn mẫu và ca dựa vào đó bị bỏ qua tuỳ thời điểm: khi danh sách không có slug thì hỏi thẳng trang công khai của nhãn đã seed (không qua bộ nhớ đệm).
 */
export async function firstPublicBrandSlug(request: APIRequestContext, apiOrigin: string): Promise<string | null> {
  const list = await request.get(`${apiOrigin}/api/brands`).catch(() => null);
  const listed = list?.ok() ? ((await list.json()) as { slug?: string | null }[]).find((b) => b.slug)?.slug : undefined;
  if (listed) return listed;
  const direct = await request.get(`${apiOrigin}/api/brand/public/${A11Y_BRAND_SLUG}`).catch(() => null);
  return direct?.ok() ? A11Y_BRAND_SLUG : null;
}

/** `true` khi đã bảo đảm có thương hiệu và gian hàng công khai; `false` khi DB không phải DB tạm (không ghi gì, spec bỏ qua kèm lý do; trên CI thì `assertSeededOnCi` làm đỏ). */
export async function seedShopScreens(): Promise<boolean> {
  const url = seedDatabaseUrl();
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
