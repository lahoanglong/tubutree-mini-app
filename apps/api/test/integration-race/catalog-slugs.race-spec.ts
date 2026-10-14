import type { ProductApprovalStatus } from '@prisma/client';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { randCode, warmPool } from './helpers';

/**
 * R4-BUYER-5 trên Postgres thật: dải "Đã xem gần đây" hỏi giá hiện hành theo slug (GET /products?slugs=a,b). Chỉ sản phẩm công
 * khai (đang bán, đã duyệt) được trả về, trần 20 slug, và slug rỗng không rơi về cả catalog.
 */
describe('Catalog: lọc theo slugs (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let catalog: CatalogService;
  const brand = `ITSLUG ${randCode(6)}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [CatalogService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    catalog = moduleRef.get(CatalogService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function product(over: { isActive?: boolean; approvalStatus?: ProductApprovalStatus; basePrice?: number } = {}) {
    const tag = randCode(8);
    return prisma.product.create({
      data: {
        pancakeId: `itsl-p-${tag}`,
        brand,
        slug: `itsl-${tag.toLowerCase()}`,
        name: `SP slug ${tag}`,
        description: 'IT',
        basePrice: over.basePrice ?? 100_000,
        isActive: over.isActive ?? true,
        approvalStatus: over.approvalStatus ?? 'APPROVED',
      },
    });
  }

  const slugsOf = async (slugs: string) => (await catalog.list({ page: 1, limit: 50, slugs })).data.map((c) => c.slug).sort();

  it('trả đúng các sản phẩm công khai theo slug, kèm giá hiện hành; ẩn/chưa duyệt/không tồn tại thì vắng mặt', async () => {
    const [a, b, hidden, pending] = await Promise.all([
      product({ basePrice: 45_000 }),
      product(),
      product({ isActive: false }),
      product({ approvalStatus: 'PENDING_REVIEW' }),
    ]);
    const res = await catalog.list({ page: 1, limit: 50, slugs: [a.slug, b.slug, hidden.slug, pending.slug, 'khong-ton-tai'].join(',') });

    expect(res.data.map((c) => c.slug).sort()).toEqual([a.slug, b.slug].sort());
    expect(res.data.find((c) => c.slug === a.slug)?.basePrice).toBe(45_000);
  });

  it('khoảng trắng quanh slug được bỏ; slug rỗng không trả gì thay vì cả catalog', async () => {
    const a = await product();
    expect(await slugsOf(` ${a.slug} , `)).toEqual([a.slug]);
    expect(await slugsOf('')).toEqual([]);
    expect(await slugsOf(' , ')).toEqual([]);
  });

  it('quá 20 slug: chỉ 20 slug đầu được xét', async () => {
    const made = await Promise.all(Array.from({ length: 22 }, () => product()));
    const slugs = made.map((p) => p.slug);
    const got = await slugsOf(slugs.join(','));
    expect(got).toHaveLength(20);
    expect(got).toEqual(slugs.slice(0, 20).sort());
  });
});
