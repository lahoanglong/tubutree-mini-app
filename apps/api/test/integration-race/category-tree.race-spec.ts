import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import type { HomeService } from '../../src/modules/catalog/home.service';
import { CategoryAdminService } from '../../src/modules/catalog/category-admin.service';
import { CATEGORY_MAX_CHILDREN, CATEGORY_MAX_ROOTS } from '../../src/modules/catalog/category-tree';
import { randCode, warmPool } from './helpers';

/**
 * Cây danh mục hai tầng trên Postgres thật (P16): trần 8 giữ được khi nhiều admin ghi cùng lúc, thứ tự không trùng,
 * danh sách của admin thấy thay đổi ngay.
 */
describe('Cây danh mục hai tầng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: CategoryAdminService;
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
    svc = new CategoryAdminService(prisma, new CatalogService(prisma), { invalidateStatic: jest.fn() } as unknown as HomeService);
    // Ba cha cho ba ca đầu: ưu tiên gốc sẵn có chưa có con (DB IT đã có danh mục seed, hết chỗ cho gốc mới), thiếu mới tự tạo.
    const hosts = (await prisma.category.findMany({ where: { parentId: null, children: { none: {} } }, orderBy: { id: 'asc' }, take: 3 })).map((r) => r.id);
    while (hosts.length < 3) hosts.push((await svc.create('it', { name: name(`cha-${hosts.length}`) })).id);
    [capParent, orderParent, listParent] = hosts as [string, string, string];
  });

  afterAll(async () => {
    await prisma.category.deleteMany({ where: { ...mine, parentId: { not: null } } });
    await prisma.category.deleteMany({ where: mine });
    await moduleRef?.close();
  });

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
