import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { CATEGORY_APPLY_EVENT_KIND, CategorySuggestionService } from '../../src/modules/catalog/category-suggestion.service';
import type { HomeService } from '../../src/modules/catalog/home.service';
import { PancakeSyncService } from '../../src/modules/integrations/pancake/pancake-sync.service';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import type { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { randCode, warmPool } from './helpers';

/**
 * "Gán danh mục hàng loạt" trên Postgres thật: hai lượt áp dụng cùng lúc thì đúng một lượt thắng, lượt kia 409 và không ghi gì;
 * đồng bộ Pancake chạy sau không xoá danh mục đã gán.
 */
describe('Gán danh mục theo gợi ý (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: CategorySuggestionService;
  let leafA: string;
  let leafB: string;
  const tag = randCode(6).toLowerCase();
  const mineCat = { slug: { startsWith: `it-sug-${tag}` } };
  const mineProduct = { slug: { startsWith: `it-sug-${tag}` } };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    const home = { invalidateStatic: jest.fn() } as unknown as HomeService;
    svc = new CategorySuggestionService(prisma, new CatalogService(prisma), home);
    // Hai danh mục lá riêng của spec (tạo thẳng, không qua trần 8 gốc của màn admin); xoá ở afterAll.
    leafA = (await prisma.category.create({ data: { name: `IT sug ${tag} A`, slug: `it-sug-${tag}-a`, sortOrder: 900 } })).id;
    leafB = (await prisma.category.create({ data: { name: `IT sug ${tag} B`, slug: `it-sug-${tag}-b`, sortOrder: 901 } })).id;
  });

  afterAll(async () => {
    const ids = (await prisma.product.findMany({ where: mineProduct, select: { id: true } })).map((p) => p.id);
    await prisma.userAdminEvent.deleteMany({ where: { kind: CATEGORY_APPLY_EVENT_KIND, reason: { in: ids.map((id) => `product:${id}`) } } });
    await prisma.product.deleteMany({ where: mineProduct });
    await prisma.category.deleteMany({ where: mineCat });
    await moduleRef?.close();
  });

  const product = (suffix: string, name = `Nước rửa chén Fuwa3e IT ${tag} ${suffix}`) =>
    prisma.product.create({ data: { pancakeId: `it-sug-p-${tag}-${suffix}`, brand: 'Tubu Tree', slug: `it-sug-${tag}-p-${suffix}`, name, description: 'IT', basePrice: 100_000 } });
  const row = (id: string) => prisma.product.findUniqueOrThrow({ where: { id }, select: { categoryIds: true, updatedAt: true } });
  const eventsOf = (id: string) => prisma.userAdminEvent.count({ where: { kind: CATEGORY_APPLY_EVENT_KIND, reason: `product:${id}` } });

  it('danh sách đọc sản phẩm chưa có danh mục kèm gợi ý và mốc updatedAt thật; áp dụng xong thì rời danh sách', async () => {
    const p = await product('list');
    const list = await svc.list();
    const mine = list.items.find((i) => i.id === p.id);
    expect(mine).toBeDefined();
    expect(mine!.updatedAt).toBe(p.updatedAt.toISOString());
    expect(mine!.brand).toBe('Fuwa3e');
    // Danh mục seed "cat-cleaning" có thể vắng ở DB IT: gợi ý chỉ chứa danh mục lá đang có.
    const leafIds = new Set(list.categories.map((c) => c.id));
    expect(mine!.suggestion.categoryIds.every((id) => leafIds.has(id))).toBe(true);

    await svc.apply('it-admin', [{ productId: p.id, categoryIds: [leafA], expectedUpdatedAt: mine!.updatedAt }]);
    expect((await row(p.id)).categoryIds).toEqual([leafA]);
    expect(await eventsOf(p.id)).toBe(1);
    expect((await svc.list()).items.some((i) => i.id === p.id)).toBe(false);
  });

  it('hai lượt áp dụng cùng lúc cho cùng sản phẩm: đúng một lượt thắng, lượt kia 409, danh mục là của lượt thắng', async () => {
    for (let round = 0; round < 5; round++) {
      const p = await product(`race-${round}`);
      const expectedUpdatedAt = p.updatedAt.toISOString();
      const [x, y] = await Promise.allSettled([
        svc.apply('it-admin-1', [{ productId: p.id, categoryIds: [leafA], expectedUpdatedAt }]),
        svc.apply('it-admin-2', [{ productId: p.id, categoryIds: [leafB], expectedUpdatedAt }]),
      ]);
      const won = [x, y].filter((r) => r.status === 'fulfilled');
      const lost = [x, y].filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0]!.reason).toBeInstanceOf(ConflictException);
      expect((lost[0]!.reason as ConflictException).getResponse()).toMatchObject({ code: 'CATEGORY_APPLY_STALE', conflicts: [{ productId: p.id, reason: 'categorized' }] });
      expect((await row(p.id)).categoryIds).toEqual([x.status === 'fulfilled' ? leafA : leafB]);
      expect(await eventsOf(p.id)).toBe(1);
    }
  });

  it('hai lô chồng nhau cùng lúc: lô thua không ghi sản phẩm nào của nó (cả lô hoặc không gì)', async () => {
    const [p1, p2, p3] = await Promise.all([product('lo-1'), product('lo-2'), product('lo-3')]);
    const entry = (p: { id: string; updatedAt: Date }, cat: string) => ({ productId: p.id, categoryIds: [cat], expectedUpdatedAt: p.updatedAt.toISOString() });
    const [x, y] = await Promise.allSettled([svc.apply('it-admin-1', [entry(p1, leafA), entry(p2, leafA)]), svc.apply('it-admin-2', [entry(p2, leafB), entry(p3, leafB)])]);
    expect([x, y].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    if (x.status === 'fulfilled') {
      expect((await row(p3.id)).categoryIds).toEqual([]);
      expect(await eventsOf(p3.id)).toBe(0);
    } else {
      expect((await row(p1.id)).categoryIds).toEqual([]);
      expect(await eventsOf(p1.id)).toBe(0);
    }
  });

  it('sản phẩm bị sửa sau khi admin mở danh sách (updatedAt đổi, vẫn chưa danh mục): 409 "changed", không ghi', async () => {
    const p = await product('stale');
    const seen = p.updatedAt.toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await prisma.product.update({ where: { id: p.id }, data: { name: `${p.name} (đổi tên)` } });
    const err = await svc.apply('it-admin', [{ productId: p.id, categoryIds: [leafA], expectedUpdatedAt: seen }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ conflicts: [{ productId: p.id, reason: 'changed' }] });
    expect((await row(p.id)).categoryIds).toEqual([]);
  });

  it('đồng bộ Pancake chạy sau khi áp dụng (bản đồ nhóm hàng trỏ danh mục khác) không xoá, không đè danh mục đã gán', async () => {
    const p = await product('pancake', `IT sug ${tag} pancake`);
    await svc.apply('it-admin', [{ productId: p.id, categoryIds: [leafA], expectedUpdatedAt: p.updatedAt.toISOString() }]);
    const client = {
      isConfigured: () => true,
      fetchProducts: jest
        .fn()
        .mockResolvedValueOnce({
          success: true,
          total_pages: 1,
          total_entries: 1,
          data: [{ id: p.pancakeId, name: p.name, category_ids: [11], variations: [{ id: `${p.pancakeId}-v`, sku: `ITSUG-${tag}`, retail_price: 100_000, remain_quantity: 3, fields: {} }] }],
        })
        .mockResolvedValue({ success: true, data: [], total_pages: 1, total_entries: 1 }),
    } as unknown as PancakeClient;
    const lifecycle = { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } as unknown as LifecycleService;
    const config = { get: async () => ({ '11': leafB }) } as unknown as SystemConfigService;
    await new PancakeSyncService(prisma, client, lifecycle, undefined, config).syncProducts(new Date(Date.now() - 60_000).toISOString());
    expect(client.fetchProducts).toHaveBeenCalled();
    expect((await row(p.id)).categoryIds).toEqual([leafA]);
  });
});
