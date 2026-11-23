import { NotFoundException } from '@nestjs/common';
import { brandCatalogHealth, CATALOG_HEALTH_LIST_MAX, type CatalogHealthProduct } from './brand-catalog-health';
import { BrandService } from './brand.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { RefillPairsService } from '../catalog/refill/refill-pairs.service';

const brandConfig = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;

const product = (id: string, ingredients: unknown, variations: CatalogHealthProduct['variations']): CatalogHealthProduct => ({
  id,
  name: `SP ${id}`,
  ingredients,
  variations,
});

describe('brandCatalogHealth', () => {
  it('đếm SKU đang bật, SKU hết hàng (tồn ≤ 0), SKU có cặp Refill, sản phẩm thiếu INCI theo luật ingredientNames', () => {
    const view = brandCatalogHealth(
      [
        product('p1', [{ name: 'Aqua' }], [{ sku: 'P1-500', name: '500ml', stock: 3 }, { sku: 'P1-1L', name: '1L', stock: 0 }]),
        product('p2', null, [{ sku: 'P2', name: 'Mặc định', stock: -2 }]),
        product('p3', '[object Object]', [{ sku: 'P3', name: 'Mặc định', stock: 9 }]),
        product('p4', 'Glycerin, Aqua', []),
      ],
      new Set(['p1', 'p9']),
    );
    expect(view).toEqual({
      totalProducts: 4,
      totalSkus: 4,
      outOfStockSkus: 2,
      refillPairedSkus: 2,
      missingInciProducts: 2,
      missingInci: [
        { productId: 'p2', name: 'SP p2', skuCount: 1 },
        { productId: 'p3', name: 'SP p3', skuCount: 1 },
      ],
      outOfStock: [
        { productId: 'p1', productName: 'SP p1', sku: 'P1-1L', name: '1L' },
        { productId: 'p2', productName: 'SP p2', sku: 'P2', name: 'Mặc định' },
      ],
      listMax: CATALOG_HEALTH_LIST_MAX,
    });
  });

  it('không đọc được bảng cặp Refill: refillPairedSkus null, các số còn lại vẫn đủ', () => {
    const view = brandCatalogHealth([product('p1', [{ name: 'Aqua' }], [{ sku: 'A', name: 'A', stock: 1 }])], null);
    expect(view.refillPairedSkus).toBeNull();
    expect(view.totalSkus).toBe(1);
  });

  it('danh sách cắt ở CATALOG_HEALTH_LIST_MAX dòng, con số tổng vẫn đếm đủ', () => {
    const many = Array.from({ length: CATALOG_HEALTH_LIST_MAX + 7 }, (_, i) => product(`p${i}`, [], [{ sku: `S${i}`, name: 'x', stock: 0 }]));
    const view = brandCatalogHealth(many, new Set());
    expect(view.missingInciProducts).toBe(CATALOG_HEALTH_LIST_MAX + 7);
    expect(view.missingInci).toHaveLength(CATALOG_HEALTH_LIST_MAX);
    expect(view.outOfStockSkus).toBe(CATALOG_HEALTH_LIST_MAX + 7);
    expect(view.outOfStock).toHaveLength(CATALOG_HEALTH_LIST_MAX);
    expect(view.refillPairedSkus).toBe(0);
  });
});

describe('BrandService.getOwnedCatalogHealth: chỉ nhãn của chính người gọi (IDOR)', () => {
  function setup(brands: Record<string, { id: string }>, pairs: () => Promise<Map<string, string>> = async () => new Map()) {
    const prisma = {
      brand: { findFirst: jest.fn(async ({ where }: { where: { ownerUserId: string } }) => brands[where.ownerUserId] ?? null) },
      product: {
        findMany: jest.fn(async ({ where }: { where: { brandId: string } }) =>
          where.brandId === 'brand-a'
            ? [{ id: 'pa', name: 'SP A', ingredients: null, variations: [{ sku: 'A-1', name: 'A', stock: 0 }] }]
            : [{ id: 'pb', name: 'SP B', ingredients: [{ name: 'Aqua' }], variations: [{ sku: 'B-1', name: 'B', stock: 5 }] }],
        ),
      },
    };
    const refill = { pairs: jest.fn(pairs) } as unknown as RefillPairsService;
    return { prisma, svc: new BrandService(prisma as never, brandConfig, refill) };
  }

  it('nhãn lấy theo ownerUserId của người gọi, sản phẩm lọc theo đúng brandId đó và chỉ hàng đang bật', async () => {
    const { prisma, svc } = setup({ 'owner-a': { id: 'brand-a' }, 'owner-b': { id: 'brand-b' } }, async () => new Map([['pa', 'pa-refill']]));
    const a = await svc.getOwnedCatalogHealth('owner-a');
    expect(prisma.brand.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerUserId: 'owner-a' } }));
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
    const args = prisma.product.findMany.mock.calls[0]![0] as unknown as { where: unknown; select: { variations: { where: unknown } } };
    expect(args.where).toEqual({ brandId: 'brand-a', isActive: true });
    expect(args.select.variations.where).toEqual({ isActive: true });
    expect(a.outOfStock.map((v) => v.sku)).toEqual(['A-1']);
    expect(a.missingInci.map((p) => p.productId)).toEqual(['pa']);
    expect(a.refillPairedSkus).toBe(1);
    expect(JSON.stringify(a)).not.toContain('B-1');

    const b = await svc.getOwnedCatalogHealth('owner-b');
    expect((prisma.product.findMany.mock.calls[1]![0] as unknown as { where: { brandId: string } }).where.brandId).toBe('brand-b');
    expect(JSON.stringify(b)).not.toContain('A-1');
    expect(b.refillPairedSkus).toBe(0);
  });

  it('tài khoản không sở hữu nhãn nào: 404, không đọc sản phẩm', async () => {
    const { prisma, svc } = setup({ 'owner-a': { id: 'brand-a' } });
    await expect(svc.getOwnedCatalogHealth('stranger')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('bảng cặp Refill lỗi: vẫn trả số liệu, refillPairedSkus = null', async () => {
    const { svc } = setup({ 'owner-a': { id: 'brand-a' } }, async () => {
      throw new Error('refill down');
    });
    const a = await svc.getOwnedCatalogHealth('owner-a');
    expect(a.refillPairedSkus).toBeNull();
    expect(a.totalSkus).toBe(1);
  });
});
