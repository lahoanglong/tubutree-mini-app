import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CatalogService } from './catalog.service';
import { CATEGORY_APPLY_EVENT_KIND, CategorySuggestionService } from './category-suggestion.service';
import type { HomeService } from './home.service';

const CATS = [
  { id: 'cat-skincare', name: 'Mỹ phẩm thiên nhiên', parentId: null },
  { id: 'cat-cleaning', name: 'Tẩy rửa sinh học', parentId: null },
  { id: 'cat-baby', name: 'Cho bé', parentId: null },
  { id: 'cat-personal', name: 'Chăm sóc cá nhân', parentId: null },
  { id: 'cat-food', name: 'Nông sản & Thực phẩm', parentId: null },
  { id: 'cat-food-hat', name: 'Hạt', parentId: 'cat-food' },
];
const T0 = new Date('2026-11-16T10:00:00.000Z');
const product = (over: Record<string, unknown>) => ({
  slug: 'x',
  brand: 'Tubu Tree',
  thumbnail: null,
  isActive: true,
  approvalStatus: 'APPROVED',
  updatedAt: T0,
  ...over,
});

function setup(opts: { products?: unknown[]; updateCounts?: number[]; afterRows?: unknown[]; covers?: Array<{ id: string; cover: string | null }> } = {}) {
  const counts = [...(opts.updateCounts ?? [])];
  const updateMany = jest.fn().mockImplementation(async () => ({ count: counts.length ? counts.shift()! : 1 }));
  const createMany = jest.fn().mockResolvedValue({ count: 0 });
  const executeRaw = jest.fn().mockResolvedValue(1);
  const tx = {
    $executeRaw: executeRaw,
    category: { findMany: jest.fn().mockResolvedValue(CATS) },
    product: { updateMany, findMany: jest.fn().mockResolvedValue(opts.afterRows ?? []) },
    userAdminEvent: { createMany },
  };
  const prisma = {
    category: { findMany: jest.fn().mockResolvedValue(CATS) },
    product: { findMany: jest.fn().mockResolvedValue(opts.products ?? []) },
    $queryRaw: jest.fn().mockResolvedValue(opts.covers ?? []),
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;
  const catalog = { invalidateCategoryCache: jest.fn() } as unknown as CatalogService;
  const home = { invalidateStatic: jest.fn() } as unknown as HomeService;
  return { svc: new CategorySuggestionService(prisma, catalog, home), prisma, tx, updateMany, createMany, executeRaw, catalog, home };
}

describe('CategorySuggestionService.list', () => {
  it('chỉ đọc sản phẩm chưa có danh mục, gợi ý chỉ trong danh mục lá, kèm mốc updatedAt và số đếm', async () => {
    const { svc, prisma } = setup({
      products: [
        product({ id: 'p1', name: 'Nước rửa chén Fuwa3e 500ml', thumbnail: 'https://x/1.jpg' }),
        product({ id: 'p2', name: 'Bánh mầm hạt yến mạch BH.NONG', isActive: false }),
        product({ id: 'p3', name: 'Dầu bơ tươi PƠ LANG 30ml', approvalStatus: 'PENDING_REVIEW' }),
        product({ id: 'p4', name: 'Quà tặng bí ẩn' }),
      ],
      // p2 chưa có ảnh đại diện nhưng có ảnh trong mảng: chỉ ảnh đầu được đọc.
      covers: [{ id: 'p2', cover: 'https://x/2.jpg' }],
    });
    const r = await svc.list();
    const args = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ categoryIds: { isEmpty: true } });
    expect(args.select).not.toHaveProperty('images');
    // cat-food có mục con nên không phải lá: không gợi ý vào đó.
    expect(r.categories.map((c) => c.id)).toEqual(['cat-skincare', 'cat-cleaning', 'cat-baby', 'cat-personal', 'cat-food-hat']);
    const byId = Object.fromEntries(r.items.map((i) => [i.id, i]));
    expect(byId.p1).toMatchObject({ brand: 'Fuwa3e', hasImage: true, onSale: true, updatedAt: '2026-11-16T10:00:00.000Z' });
    expect(byId.p1!.suggestion.categoryIds).toEqual(['cat-cleaning']);
    expect(byId.p2!.suggestion.categoryIds).toEqual([]);
    expect(byId.p2!.onSale).toBe(false);
    expect(byId.p2).toMatchObject({ hasImage: true, thumbnail: 'https://x/2.jpg' });
    expect(byId.p4).toMatchObject({ hasImage: false, thumbnail: null });
    expect(byId.p3!.onSale).toBe(false);
    expect(byId.p3!.brand).toBe('Pơ Lang');
    expect(r.summary).toEqual({ total: 4, onSale: 2, autoReady: 1, needsReview: 3, autoReadyOnSale: 1, needsReviewOnSale: 1 });
    expect(r.autoMin).toBe(0.9);
    expect(r.truncated).toBe(false);
  });
});

describe('CategorySuggestionService.apply', () => {
  const item = (productId: string, categoryIds: string[], expectedUpdatedAt = T0.toISOString()) => ({ productId, categoryIds, expectedUpdatedAt });

  it('ghi có điều kiện (đúng updatedAt và vẫn chưa có danh mục), giữ khoá cây danh mục, ghi sổ admin, xoá bộ nhớ danh mục', async () => {
    const { svc, updateMany, createMany, executeRaw, catalog, home } = setup();
    const r = await svc.apply('admin-1', [item('p1', ['cat-cleaning']), item('p2', ['cat-baby', 'cat-personal', 'cat-baby'])]);
    expect(r).toEqual({ applied: 2, items: [{ productId: 'p1', categoryIds: ['cat-cleaning'] }, { productId: 'p2', categoryIds: ['cat-baby', 'cat-personal'] }] });
    expect(String((executeRaw.mock.calls[0][0] as string[]).join('?'))).toContain('pg_advisory_xact_lock');
    expect(updateMany).toHaveBeenCalledTimes(2);
    const first = updateMany.mock.calls[0][0];
    expect(first.where).toEqual({ id: 'p1', updatedAt: T0, categoryIds: { isEmpty: true } });
    expect(first.data.categoryIds).toEqual(['cat-cleaning']);
    expect(first.data.updatedAt).toBeInstanceOf(Date);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { userId: 'admin-1', kind: CATEGORY_APPLY_EVENT_KIND, fromValue: '', toValue: 'cat-cleaning', reason: 'product:p1', actorId: 'admin-1' },
        { userId: 'admin-1', kind: CATEGORY_APPLY_EVENT_KIND, fromValue: '', toValue: 'cat-baby,cat-personal', reason: 'product:p2', actorId: 'admin-1' },
      ],
    });
    expect(catalog.invalidateCategoryCache).toHaveBeenCalledTimes(1);
    expect(home.invalidateStatic).toHaveBeenCalledTimes(1);
  });

  it('một sản phẩm lệch → 409 kèm lý do từng sản phẩm, không ghi sổ, không xoá bộ nhớ (giao dịch huỷ cả lô)', async () => {
    const { svc, createMany, catalog } = setup({
      updateCounts: [1, 0, 0, 0],
      afterRows: [
        { id: 'p2', name: 'Đã gán', categoryIds: ['cat-food-hat'] },
        { id: 'p3', name: 'Vừa sửa', categoryIds: [] },
      ],
    });
    const err = await svc.apply('admin-1', [item('p1', ['cat-cleaning']), item('p2', ['cat-baby']), item('p3', ['cat-baby']), item('p4', ['cat-baby'])]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    const body = (err as ConflictException).getResponse() as { code: string; conflicts: unknown[] };
    expect(body.code).toBe('CATEGORY_APPLY_STALE');
    expect(body.conflicts).toEqual([
      { productId: 'p2', name: 'Đã gán', reason: 'categorized' },
      { productId: 'p3', name: 'Vừa sửa', reason: 'changed' },
      { productId: 'p4', name: null, reason: 'missing' },
    ]);
    expect(createMany).not.toHaveBeenCalled();
    expect(catalog.invalidateCategoryCache).not.toHaveBeenCalled();
  });

  it('danh mục không phải lá hoặc không tồn tại → 400, không ghi sản phẩm nào', async () => {
    const { svc, updateMany } = setup();
    await expect(svc.apply('a', [item('p1', ['cat-food'])])).rejects.toThrow(/Nông sản & Thực phẩm/);
    await expect(svc.apply('a', [item('p1', ['cat-khong-co'])])).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('kiểm đầu vào trước khi mở giao dịch: lô rỗng, trùng sản phẩm, danh mục rỗng, mốc hỏng', async () => {
    const { svc, prisma } = setup();
    await expect(svc.apply('a', [])).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.apply('a', [item('p1', ['cat-baby']), item('p1', ['cat-food-hat'])])).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.apply('a', [item('p1', [])])).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.apply('a', [item('p1', ['cat-baby'], 'không-phải-ngày')])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
