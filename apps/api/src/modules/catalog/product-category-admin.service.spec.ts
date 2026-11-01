import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CatalogService } from './catalog.service';
import type { HomeService } from './home.service';
import { CATEGORY_MSG } from './category-tree';
import { CATEGORY_ASSIGN_MAX_PRODUCTS, ProductCategoryAdminService } from './product-category-admin.service';

function make(over: { category?: unknown; found?: number; changed?: number; children?: number } = {}) {
  const self: { current: unknown } = { current: null };
  const prisma = {
    category: {
      findUnique: jest.fn().mockResolvedValue('category' in over ? over.category : { id: 'c1', name: 'Nhà bếp' }),
      count: jest.fn().mockResolvedValue(over.children ?? 0),
    },
    product: {
      count: jest.fn().mockResolvedValue(over.found ?? 2),
      findMany: jest.fn().mockResolvedValue([]),
    },
    // Câu khoá advisory và câu UPDATE đều đi qua $executeRaw: phân biệt bằng nội dung câu.
    $executeRaw: jest.fn(async (strings: TemplateStringsArray) => (strings.join('').includes('pg_advisory') ? 1 : (over.changed ?? 2))),
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(self.current)),
  };
  self.current = prisma;
  const catalog = { invalidateCategoryCache: jest.fn() };
  const home = { invalidateStatic: jest.fn() };
  const svc = new ProductCategoryAdminService(prisma as unknown as PrismaService, catalog as unknown as CatalogService, home as unknown as HomeService);
  return { prisma, svc, catalog, home };
}

const updates = (prisma: ReturnType<typeof make>['prisma']) =>
  prisma.$executeRaw.mock.calls.filter(([s]) => !s.join('').includes('pg_advisory'));

describe('ProductCategoryAdminService.assign', () => {
  it('gán: khử trùng id, trả số đổi/không đổi', async () => {
    const { svc, prisma } = make({ changed: 1 });
    const r = await svc.assign('admin', ['p1', 'p2', 'p1'], 'c1', 'ADD');
    expect(prisma.product.count).toHaveBeenCalledWith({ where: { id: { in: ['p1', 'p2'] } } });
    expect(r).toMatchObject({ requested: 2, changed: 1, unchanged: 1, category: { id: 'c1' } });
  });

  it('từ chối danh mục không tồn tại, sản phẩm không tồn tại, danh sách rỗng hoặc quá lớn — và không ghi', async () => {
    await expect(make({ category: null }).svc.assign('a', ['p1'], 'zz', 'ADD')).rejects.toBeInstanceOf(NotFoundException);
    const missing = make({ found: 1 });
    await expect(missing.svc.assign('a', ['p1', 'p2'], 'c1', 'ADD')).rejects.toBeInstanceOf(BadRequestException);
    expect(updates(missing.prisma)).toHaveLength(0);
    await expect(make().svc.assign('a', [], 'c1', 'REMOVE')).rejects.toBeInstanceOf(BadRequestException);
    const many = Array.from({ length: CATEGORY_ASSIGN_MAX_PRODUCTS + 1 }, (_, i) => `p${i}`);
    await expect(make().svc.assign('a', many, 'c1', 'ADD')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('chỉ gán vào danh mục lá: danh mục có con bị 400 nêu tên, không ghi và không làm mới cache', async () => {
    const { svc, prisma, catalog } = make({ children: 3 });
    await expect(svc.assign('a', ['p1', 'p2'], 'c1', 'ADD')).rejects.toThrow(CATEGORY_MSG.notLeaf('Nhà bếp'));
    expect(updates(prisma)).toHaveLength(0);
    expect(catalog.invalidateCategoryCache).not.toHaveBeenCalled();
  });

  it('gán ADD giữ khoá cây trước khi kiểm lá và ghi (thao tác tạo con xen giữa phải chờ)', async () => {
    const { svc, prisma } = make();
    await svc.assign('a', ['p1', 'p2'], 'c1', 'ADD');
    const kinds = prisma.$executeRaw.mock.calls.map(([s]) => (s.join('').includes('pg_advisory') ? 'lock' : 'write'));
    expect(kinds).toEqual(['lock', 'write']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('gán lại cùng danh sách không nhân đôi: lần hai báo 0 đổi, n không đổi', async () => {
    const first = make({ changed: 2 });
    expect(await first.svc.assign('a', ['p1', 'p2'], 'c1', 'ADD')).toMatchObject({ changed: 2, unchanged: 0 });
    const again = make({ changed: 0 });
    expect(await again.svc.assign('a', ['p1', 'p2'], 'c1', 'ADD')).toMatchObject({ requested: 2, changed: 0, unchanged: 2 });
    // Câu UPDATE chỉ chạm sản phẩm chưa có id này: gán lại không thể thêm lần hai.
    expect(updates(again.prisma)[0]![0].join('')).toContain('NOT (');
  });

  it('gỡ khỏi danh mục có con vẫn được (dọn dữ liệu gán vào cha từ trước)', async () => {
    const { svc, prisma } = make({ children: 3, changed: 1, found: 1 });
    await expect(svc.assign('a', ['p1'], 'c1', 'REMOVE')).resolves.toMatchObject({ changed: 1 });
    expect(prisma.category.count).not.toHaveBeenCalled();
  });

  it('làm mới cache danh mục khi có sản phẩm đổi, không làm khi không đổi gì', async () => {
    const changed = make({ changed: 2 });
    await changed.svc.assign('a', ['p1', 'p2'], 'c1', 'ADD');
    expect(changed.catalog.invalidateCategoryCache).toHaveBeenCalledTimes(1);
    expect(changed.home.invalidateStatic).toHaveBeenCalledTimes(1);
    const same = make({ changed: 0 });
    await same.svc.assign('a', ['p1', 'p2'], 'c1', 'ADD');
    expect(same.catalog.invalidateCategoryCache).not.toHaveBeenCalled();
  });
});

describe('ProductCategoryAdminService.listProducts', () => {
  const whereOf = (prisma: ReturnType<typeof make>['prisma']) => JSON.stringify(prisma.product.findMany.mock.calls[0][0].where);

  it('lọc chưa có danh mục + hàng Pancake thật (bỏ seed-)', async () => {
    const { svc, prisma } = make();
    await svc.listProducts({ uncategorized: true, source: 'pancake', take: 50 });
    const where = whereOf(prisma);
    expect(where).toContain('"isEmpty":true');
    expect(where).toContain('"startsWith":"seed-"');
  });

  it('tìm theo thương hiệu: q khớp thêm brand không phân biệt hoa thường', async () => {
    const { svc, prisma } = make();
    await svc.listProducts({ q: 'tubu', take: 50 });
    expect(whereOf(prisma)).toContain('"brand":{"contains":"tubu","mode":"insensitive"}');
  });

  it('onSale chỉ lấy sản phẩm đang bán thật (bật và đã duyệt), cùng điều kiện với hộp việc', async () => {
    const { svc, prisma } = make();
    await svc.listProducts({ uncategorized: true, onSale: true, take: 50 });
    const where = whereOf(prisma);
    expect(where).toContain('"isActive":true');
    expect(where).toContain('"approvalStatus":"APPROVED"');
    const { svc: off, prisma: offPrisma } = make();
    await off.listProducts({ uncategorized: true, take: 50 });
    expect(whereOf(offPrisma)).not.toContain('approvalStatus');
  });
});
