import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import type { HomeService } from '../../src/modules/catalog/home.service';
import { CategoryAdminService } from '../../src/modules/catalog/category-admin.service';
import { CATEGORY_MAX_CHILDREN, CATEGORY_MAX_ROOTS, CATEGORY_MSG, CATEGORY_TREE_LOCK } from '../../src/modules/catalog/category-tree';
import { ProductCategoryAdminService } from '../../src/modules/catalog/product-category-admin.service';
import { randCode, warmPool } from './helpers';

/**
 * Cây danh mục hai tầng trên Postgres thật (P16): trần 8 giữ được khi nhiều admin ghi cùng lúc, thứ tự không trùng,
 * danh sách của admin thấy thay đổi ngay.
 */
describe('Cây danh mục hai tầng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: CategoryAdminService;
  let products: ProductCategoryAdminService;
  let capParent: string;
  let orderParent: string;
  let listParent: string;
  const tag = randCode(6).toLowerCase();
  const name = (s: string) => `IT cat ${tag} ${s}`;
  const mine = { slug: { startsWith: `it-cat-${tag}` } };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    const catalog = new CatalogService(prisma);
    const home = { invalidateStatic: jest.fn() } as unknown as HomeService;
    svc = new CategoryAdminService(prisma, catalog, home);
    products = new ProductCategoryAdminService(prisma, catalog, home);
    // Ba cha cho ba ca đầu: ưu tiên gốc sẵn có chưa có con (DB IT đã có danh mục seed, hết chỗ cho gốc mới), thiếu mới tự tạo.
    const hosts = (await prisma.category.findMany({ where: { parentId: null, children: { none: {} } }, orderBy: { id: 'asc' }, take: 3 })).map((r) => r.id);
    while (hosts.length < 3) hosts.push((await svc.create('it', { name: name(`cha-${hosts.length}`) })).id);
    [capParent, orderParent, listParent] = hosts as [string, string, string];
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: mine });
    await prisma.category.deleteMany({ where: { ...mine, parentId: { not: null } } });
    await prisma.category.deleteMany({ where: mine });
    await moduleRef?.close();
  });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const product = (suffix: string) =>
    prisma.product.create({ data: { pancakeId: `it-cat-p-${tag}-${suffix}`, brand: 'IT', slug: `it-cat-${tag}-p-${suffix}`, name: `IT cat ${tag} ${suffix}`, description: 'IT', basePrice: 100_000 } });
  const categoriesOf = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id }, select: { categoryIds: true } })).categoryIds;

  const rootCount = () => prisma.category.count({ where: { parentId: null } });
  const childrenOf = (parentId: string) => prisma.category.findMany({ where: { parentId }, orderBy: { sortOrder: 'asc' } });

  it('5 lệnh thêm mục con song song vào cha còn 2 chỗ: đúng 2 thành công, 3 bị 400, cha có đúng 8 con', async () => {
    for (let i = 0; i < CATEGORY_MAX_CHILDREN - 2; i++) await svc.create('it', { name: name(`con-${i}`), parentId: capParent });

    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => svc.create('it', { name: name(`tranh-${i}`), parentId: capParent })));

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(3);
    rejected.forEach((r) => expect(r.reason).toBeInstanceOf(BadRequestException));
    expect(await childrenOf(capParent)).toHaveLength(CATEGORY_MAX_CHILDREN);
  });

  it('hai lệnh sắp xếp song song với hai thứ tự khác nhau: kết quả đúng một trong hai, sortOrder không trùng', async () => {
    const [a, b, c] = [
      await svc.create('it', { name: name('x-a'), parentId: orderParent }),
      await svc.create('it', { name: name('x-b'), parentId: orderParent }),
      await svc.create('it', { name: name('x-c'), parentId: orderParent }),
    ];
    const forward = [a.id, b.id, c.id];
    const backward = [c.id, b.id, a.id];

    await Promise.all([svc.reorder('it', orderParent, forward), svc.reorder('it', orderParent, backward)]);

    const after = await childrenOf(orderParent);
    expect(new Set(after.map((r) => r.sortOrder)).size).toBe(3);
    expect([forward, backward]).toContainEqual(after.map((r) => r.id));
  });

  it('danh sách của admin thấy mục vừa tạo ngay (không qua cache 60s của /categories)', async () => {
    const made = await svc.create('it', { name: name('thay-ngay'), parentId: listParent });
    const list = await svc.list();
    expect(list.items.find((i) => i.id === made.id)).toMatchObject({ parentId: listParent, productCount: 0 });
  });

  it('hai lệnh gán cùng 3 sản phẩm vào cùng danh mục lá song song: mỗi sản phẩm mang id đúng một lần', async () => {
    const leaf = await svc.create('it', { name: name('la-gan'), parentId: orderParent });
    const ps = [await product('g1'), await product('g2'), await product('g3')];
    const ids = ps.map((p) => p.id);

    const [a, b] = await Promise.all([products.assign('it', ids, leaf.id, 'ADD'), products.assign('it', ids, leaf.id, 'ADD')]);

    expect(a.changed + b.changed).toBe(3);
    for (const id of ids) expect((await categoriesOf(id)).filter((c) => c === leaf.id)).toHaveLength(1);
  });

  it('sản phẩm tạo không ghi categoryIds vẫn nằm trong lọc "chưa có danh mục, đang bán" (mặc định mảng rỗng, không NULL)', async () => {
    const p = await product('mac-dinh');
    const page = await products.listProducts({ uncategorized: true, onSale: true, q: `it cat ${tag} mac-dinh`, take: 10 });
    expect(page.items.map((i) => i.id)).toEqual([p.id]);
  });

  it('hàng cũ mang categoryIds NULL vẫn gán được (câu gán không bỏ sót vì NULL)', async () => {
    const leaf = await svc.create('it', { name: name('la-null'), parentId: orderParent });
    const p = await product('null');
    await prisma.$executeRaw`UPDATE "products" SET "categoryIds" = NULL WHERE "id" = ${p.id}`;

    const r = await products.assign('it', [p.id], leaf.id, 'ADD');

    expect(r.changed).toBe(1);
    expect(await categoriesOf(p.id)).toEqual([leaf.id]);
  });

  it('gán ADD chờ khoá cây: mục con đang tạo dở thì lệnh gán thấy mục con, bị 400 và không ghi', async () => {
    const root = (await prisma.category.findFirst({ where: { parentId: null, children: { none: {} } }, orderBy: { id: 'desc' } }))!;
    expect(root).toBeTruthy();
    const p = await product('khoa');
    let assigning: Promise<unknown> = Promise.resolve();
    let finishedWhileLocked = true;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CATEGORY_TREE_LOCK}))`;
      await tx.category.create({ data: { name: name('con-dang-tao'), slug: `it-cat-${tag}-con-dang-tao`, parentId: root.id, sortOrder: 0 } });
      assigning = products.assign('it', [p.id], root.id, 'ADD').then(() => 'ok', (e: unknown) => e);
      finishedWhileLocked = await Promise.race([assigning.then(() => true), sleep(400).then(() => false)]);
    });

    expect(finishedWhileLocked).toBe(false);
    const outcome = await assigning;
    expect(outcome).toBeInstanceOf(BadRequestException);
    expect((outcome as BadRequestException).message).toBe(CATEGORY_MSG.notLeaf(root.name));
    expect(await categoriesOf(p.id)).not.toContain(root.id);
  });

  it('3 lệnh thêm gốc song song khi chỉ còn 1 chỗ: đúng 1 thành công, tổng gốc không vượt 8', async () => {
    const existing = await rootCount();
    expect(existing).toBeLessThanOrEqual(CATEGORY_MAX_ROOTS - 1);
    for (let i = existing; i < CATEGORY_MAX_ROOTS - 1; i++) await svc.create('it', { name: name(`goc-${i}`) });
    expect(await rootCount()).toBe(CATEGORY_MAX_ROOTS - 1);

    const results = await Promise.allSettled([1, 2, 3].map((i) => svc.create('it', { name: name(`goc-tranh-${i}`) })));

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await rootCount()).toBe(CATEGORY_MAX_ROOTS);
  });
});
