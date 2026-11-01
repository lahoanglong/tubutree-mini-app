import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { CATEGORY_PARENT_HAS_PRODUCTS } from '@tubutree/shared-types';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import type { HomeService } from '../../src/modules/catalog/home.service';
import { CategoryAdminService } from '../../src/modules/catalog/category-admin.service';
import { CATEGORY_MAX_CHILDREN, CATEGORY_MAX_ROOTS, CATEGORY_MSG, CATEGORY_TREE_LOCK } from '../../src/modules/catalog/category-tree';
import { ProductCategoryAdminService } from '../../src/modules/catalog/product-category-admin.service';
import { PancakeSyncService } from '../../src/modules/integrations/pancake/pancake-sync.service';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import type { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
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

  /** Một lượt đồng bộ Pancake chỉ có sản phẩm `pancakeId`, nhóm hàng Pancake `11` ánh xạ tới `target`; `afterRead` chạy ngay sau khi đồng bộ đọc sản phẩm. */
  async function syncOnce(pancakeId: string, target: string, afterRead?: () => Promise<unknown>) {
    let hooked = !afterRead;
    const syncPrisma = new Proxy(prisma, {
      get(t, k, r) {
        if (k !== 'product') return Reflect.get(t, k, r);
        return new Proxy(t.product, {
          get(pt, pk, pr) {
            if (pk !== 'findUnique') return Reflect.get(pt, pk, pr);
            return async (args: never) => {
              const row = await pt.findUnique(args);
              if (!hooked) {
                hooked = true;
                await afterRead!();
              }
              return row;
            };
          },
        });
      },
    });
    const client = {
      isConfigured: () => true,
      fetchProducts: jest
        .fn()
        .mockResolvedValueOnce({
          success: true,
          total_pages: 1,
          total_entries: 1,
          data: [{ id: pancakeId, name: `IT cat ${tag} sync`, category_ids: [11], variations: [{ id: `${pancakeId}-v`, sku: `ITCAT-${tag}`, retail_price: 100_000, remain_quantity: 3, fields: {} }] }],
        })
        .mockResolvedValue({ success: true, data: [], total_pages: 1, total_entries: 1 }),
    } as unknown as PancakeClient;
    const lifecycle = { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } as unknown as LifecycleService;
    const config = { get: async () => ({ '11': target }) } as unknown as SystemConfigService;
    const sync = new PancakeSyncService(syncPrisma as never, client, lifecycle, undefined, config);
    return sync.syncProducts(new Date(Date.now() - 60_000).toISOString());
  }

  const rootCount = () => prisma.category.count({ where: { parentId: null } });
  // Gốc seed của DB IT đang giữ sản phẩm gắn thẳng; các ca dưới đây thử trần/thứ tự chứ không thử luật xác nhận nên đã xác nhận sẵn.
  const under = (parentId: string, label: string) => svc.create('it', { name: name(label), parentId, confirmDirectProducts: true });
  const childrenOf = (parentId: string) => prisma.category.findMany({ where: { parentId }, orderBy: { sortOrder: 'asc' } });

  it('tạo mục con và gán SP vào cùng gốc lá song song: không bao giờ ra gốc vừa có con vừa giữ SP mà chưa ai xác nhận', async () => {
    // Gốc seed đều đang giữ sản phẩm nên cần một gốc mới trống, không sản phẩm.
    if ((await rootCount()) >= CATEGORY_MAX_ROOTS) throw new Error('Ca này cần một chỗ gốc trống trong DB IT.');
    const host = (await svc.create('it', { name: name('goc-chay-dua') })).id;
    const p = await product('chay-dua');
    try {
      const [created, assigned] = await Promise.allSettled([
        svc.create('it', { name: name('con-chay-dua'), parentId: host }),
        products.assign('it', [p.id], host, 'ADD'),
      ]);
      const hasChild = (await childrenOf(host)).length > 0;
      const holdsProduct = (await categoriesOf(p.id)).includes(host);
      expect(hasChild && holdsProduct).toBe(false);
      // Thua cuộc đua thì bị từ chối đúng lý do, không phải lỗi lạ.
      if (created.status === 'rejected') {
        expect(created.reason).toBeInstanceOf(BadRequestException);
        expect((created.reason as BadRequestException).getResponse()).toMatchObject({ code: CATEGORY_PARENT_HAS_PRODUCTS });
      }
      if (assigned.status === 'rejected') expect((assigned.reason as Error).message).toContain('có mục con');
      expect([created.status, assigned.status].filter((x) => x === 'fulfilled')).toHaveLength(1);
    } finally {
      // Trả lại chỗ gốc: ca "đủ 8 gốc" bên dưới đếm số gốc có sẵn.
      await products.assign('it', [p.id], host, 'REMOVE');
      await prisma.category.deleteMany({ where: { parentId: host } });
      await prisma.category.delete({ where: { id: host } });
    }
  });

  it('5 lệnh thêm mục con song song vào cha còn 2 chỗ: đúng 2 thành công, 3 bị 400, cha có đúng 8 con', async () => {
    for (let i = 0; i < CATEGORY_MAX_CHILDREN - 2; i++) await under(capParent, `con-${i}`);

    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => under(capParent, `tranh-${i}`)));

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(3);
    rejected.forEach((r) => expect(r.reason).toBeInstanceOf(BadRequestException));
    expect(await childrenOf(capParent)).toHaveLength(CATEGORY_MAX_CHILDREN);
  });

  it('hai lệnh sắp xếp song song với hai thứ tự khác nhau: kết quả đúng một trong hai, sortOrder không trùng', async () => {
    const [a, b, c] = [
      await under(orderParent, 'x-a'),
      await under(orderParent, 'x-b'),
      await under(orderParent, 'x-c'),
    ];
    const forward = [a.id, b.id, c.id];
    const backward = [c.id, b.id, a.id];

    await Promise.all([svc.reorder('it', orderParent, forward), svc.reorder('it', orderParent, backward)]);

    const after = await childrenOf(orderParent);
    expect(new Set(after.map((r) => r.sortOrder)).size).toBe(3);
    expect([forward, backward]).toContainEqual(after.map((r) => r.id));
  });

  it('danh sách của admin thấy mục vừa tạo ngay (không qua cache 60s của /categories)', async () => {
    const made = await under(listParent, 'thay-ngay');
    const list = await svc.list();
    expect(list.items.find((i) => i.id === made.id)).toMatchObject({ parentId: listParent, productCount: 0 });
  });

  it('hai lệnh gán cùng 3 sản phẩm vào cùng danh mục lá song song: mỗi sản phẩm mang id đúng một lần', async () => {
    const leaf = await under(orderParent, 'la-gan');
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
    const leaf = await under(orderParent, 'la-null');
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

  it('đồng bộ Pancake: sản phẩm chưa có danh mục được điền theo bản đồ, lần sau không đổi', async () => {
    const mapped = await under(orderParent, 'la-ban-do');
    const pancakeId = `it-cat-p-${tag}-sync1`;
    await syncOnce(pancakeId, mapped.id);
    const p = await prisma.product.findUniqueOrThrow({ where: { pancakeId } });
    expect(p.categoryIds).toEqual([mapped.id]);
    await syncOnce(pancakeId, mapped.id);
    expect((await prisma.product.findUniqueOrThrow({ where: { pancakeId } })).categoryIds).toEqual([mapped.id]);
  });

  it('đồng bộ Pancake đọc sản phẩm "chưa có danh mục" rồi admin gán xen giữa: danh mục admin còn nguyên, không bị đè', async () => {
    const adminLeaf = await under(orderParent, 'la-admin');
    const mapped = await under(orderParent, 'la-ban-do-2');
    const pancakeId = `it-cat-p-${tag}-sync2`;
    await prisma.product.create({ data: { pancakeId, brand: 'IT', slug: `it-cat-${tag}-p-sync2`, name: `IT cat ${tag} sync`, description: 'IT', basePrice: 100_000 } });
    const id = (await prisma.product.findUniqueOrThrow({ where: { pancakeId } })).id;

    await syncOnce(pancakeId, mapped.id, () => products.assign('it', [id], adminLeaf.id, 'ADD'));

    expect(await categoriesOf(id)).toEqual([adminLeaf.id]);
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
