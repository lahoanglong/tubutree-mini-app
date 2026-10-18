import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { CATEGORY_ASSIGN_MAX_PRODUCTS, ProductCategoryAdminService } from './product-category-admin.service';

function make(over: { category?: unknown; found?: number; changed?: number } = {}) {
  const prisma = {
    category: { findUnique: jest.fn().mockResolvedValue('category' in over ? over.category : { id: 'c1', name: 'Nhà bếp' }) },
    product: {
      count: jest.fn().mockResolvedValue(over.found ?? 2),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $executeRaw: jest.fn().mockResolvedValue(over.changed ?? 2),
  };
  return { prisma, svc: new ProductCategoryAdminService(prisma as unknown as PrismaService) };
}

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
    expect(missing.prisma.$executeRaw).not.toHaveBeenCalled();
    await expect(make().svc.assign('a', [], 'c1', 'REMOVE')).rejects.toBeInstanceOf(BadRequestException);
    const many = Array.from({ length: CATEGORY_ASSIGN_MAX_PRODUCTS + 1 }, (_, i) => `p${i}`);
    await expect(make().svc.assign('a', many, 'c1', 'ADD')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ProductCategoryAdminService.listProducts', () => {
  it('lọc chưa có danh mục + hàng Pancake thật (bỏ seed-)', async () => {
    const { svc, prisma } = make();
    await svc.listProducts({ uncategorized: true, source: 'pancake', take: 50 });
    const where = prisma.product.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"isEmpty":true');
    expect(JSON.stringify(where)).toContain('"startsWith":"seed-"');
  });
});
