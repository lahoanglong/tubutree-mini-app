import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { createOrder, createUser, deleteItData, randCode, warmPool } from './helpers';

/** L3-19: recomputeSoldCounts chạy song song với đơn giao mới và với chính nó; sau lượt kế tiếp số cuối phải đúng. */
describe('CatalogService.recomputeSoldCounts đồng thời (real Postgres)', () => {
  let prisma: PrismaService;
  let catalog: CatalogService;
  const userIds: string[] = [];
  const productIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    catalog = new CatalogService(prisma);
  });

  afterAll(async () => {
    await deleteItData(prisma, { userIds, productIds });
    await prisma?.$disconnect();
  });

  async function product() {
    const t = randCode(8);
    const p = await prisma.product.create({
      data: { pancakeId: `rsc-p-${t}`, brand: 'RSC', slug: `rsc-${t.toLowerCase()}`, name: `SP ${t}`, description: 'IT', basePrice: 100_000 },
    });
    productIds.push(p.id);
    const v = await prisma.variation.create({
      data: { pancakeId: `rsc-v-${t}`, productId: p.id, sku: `RSC-${t}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, stock: 5 },
    });
    return { p, v };
  }

  const deliver = (userId: string, variationId: string, quantity: number) =>
    createOrder(prisma, {
      userId, status: 'DELIVERED', deliveredAt: new Date(),
      total: quantity * 100_000,
      items: { create: [{ variationId, productName: 'x', variationName: 'x', unitPrice: 100_000, quantity, total: quantity * 100_000 }] },
    });

  const sold = (id: string) => prisma.product.findUniqueOrThrow({ where: { id }, select: { soldApp: true, soldApp30d: true, updatedAt: true } });

  it('chạy song song với một đơn DELIVERED mới: không lỗi, soldApp ≥ soldApp30d, và sau lượt kế tiếp số cuối đúng', async () => {
    const user = await createUser(prisma);
    userIds.push(user.id);
    const mine = await Promise.all(Array.from({ length: 12 }, () => product()));
    for (const { v } of mine) await deliver(user.id, v.id, 2);

    const [, , , fresh] = await Promise.all([
      catalog.recomputeSoldCounts(),
      catalog.recomputeSoldCounts(),
      catalog.recomputeSoldCounts(),
      deliver(user.id, mine[0]!.v.id, 5),
    ]);
    expect(fresh.status).toBe('DELIVERED');
    for (const { p } of mine) {
      const s = await sold(p.id);
      expect(s.soldApp).toBeGreaterThanOrEqual(s.soldApp30d);
    }

    await catalog.recomputeSoldCounts();
    expect(await sold(mine[0]!.p.id)).toMatchObject({ soldApp: 7, soldApp30d: 7 });
    for (const { p } of mine.slice(1)) expect(await sold(p.id)).toMatchObject({ soldApp: 2, soldApp30d: 2 });
  });

  it('dòng đã đúng số không bị ghi lại (updatedAt giữ nguyên), dòng lệch được sửa', async () => {
    const user = await createUser(prisma);
    userIds.push(user.id);
    const a = await product();
    const b = await product();
    await deliver(user.id, a.v.id, 3);
    await deliver(user.id, b.v.id, 4);
    await catalog.recomputeSoldCounts();
    const before = { a: await sold(a.p.id), b: await sold(b.p.id) };
    expect(before.a).toMatchObject({ soldApp: 3, soldApp30d: 3 });

    await prisma.product.update({ where: { id: b.p.id }, data: { soldApp: 99 } });
    const bumped = await sold(b.p.id);
    await new Promise((r) => setTimeout(r, 15));
    await catalog.recomputeSoldCounts();

    expect((await sold(a.p.id)).updatedAt).toEqual(before.a.updatedAt);
    expect(await sold(b.p.id)).toMatchObject({ soldApp: 4, soldApp30d: 4 });
    expect((await sold(b.p.id)).updatedAt.getTime()).toBeGreaterThan(bumped.updatedAt.getTime());
  });
});
