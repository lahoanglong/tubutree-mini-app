import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { BrandService } from '../../src/modules/brand/brand.service';
import { RefillPairsService } from '../../src/modules/catalog/refill/refill-pairs.service';
import { createUser, deleteItData, randCode, warmPool } from './helpers';

/**
 * GET /brand/owner/me/catalog-health trên Postgres thật: nhãn lấy theo `Brand.ownerUserId` của người gọi, nên chủ nhãn A không thấy SKU,
 * tồn kho hay sản phẩm thiếu thành phần của nhãn B (IDOR); sản phẩm/biến thể đã tắt không tính.
 */
describe('BrandService.getOwnedCatalogHealth (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let brands: BrandService;
  const tag = randCode(6);
  const refillIds = new Set<string>();
  const created = { userIds: [] as string[], productIds: [] as string[], brandIds: [] as string[] };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        BrandService,
        SystemConfigService,
        { provide: RefillPairsService, useValue: { pairs: async () => new Map([...refillIds].map((id) => [id, `${id}-refill`] as [string, string])) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    brands = moduleRef.get(BrandService);
  });

  afterAll(async () => {
    if (prisma) {
      await deleteItData(prisma, created);
      await prisma.brand.deleteMany({ where: { id: { in: created.brandIds } } });
    }
    await moduleRef?.close();
  });

  async function owner() {
    const u = await createUser(prisma);
    created.userIds.push(u.id);
    return u;
  }

  async function brand(ownerUserId: string, label: string) {
    const b = await prisma.brand.create({ data: { slug: `it-ch-${label}-${tag}-${randCode(4)}`.toLowerCase(), name: `IT CH ${label} ${tag}${randCode(4)}`, ownerUserId } });
    created.brandIds.push(b.id);
    return b;
  }

  async function product(brandId: string, name: string, opts: { ingredients?: object | null; isActive?: boolean; variations: Array<{ stock: number; isActive?: boolean }> }) {
    const t = randCode(8);
    const p = await prisma.product.create({
      data: {
        pancakeId: `it-p-${t}`, brand: 'IT Brand', brandId, slug: `it-ch-${t.toLowerCase()}`, name, description: 'IT', basePrice: 100_000,
        isActive: opts.isActive ?? true,
        ...(opts.ingredients ? { ingredients: opts.ingredients } : {}),
      },
    });
    created.productIds.push(p.id);
    const skus: string[] = [];
    for (const [i, v] of opts.variations.entries()) {
      const sku = `IT-CH-${t}-${i}`;
      skus.push(sku);
      await prisma.variation.create({
        data: { pancakeId: `it-v-${t}-${i}`, productId: p.id, sku, name: `Loại ${i}`, attributes: {}, retailPrice: 100_000, stock: v.stock, isActive: v.isActive ?? true },
      });
    }
    return { product: p, skus };
  }

  it('chủ nhãn A chỉ thấy SKU của A; chủ nhãn B chỉ thấy của B; người không sở hữu nhãn nhận 404', async () => {
    const ownerA = await owner();
    const ownerB = await owner();
    const stranger = await owner();
    const brandA = await brand(ownerA.id, 'a');
    const brandB = await brand(ownerB.id, 'b');

    const a1 = await product(brandA.id, `A1 ${tag}`, { ingredients: [{ name: 'Aqua' }], variations: [{ stock: 5 }, { stock: 0 }] });
    const a2 = await product(brandA.id, `A2 ${tag}`, { variations: [{ stock: 3 }, { stock: 0, isActive: false }] });
    await product(brandA.id, `A3 tắt ${tag}`, { isActive: false, variations: [{ stock: 0 }] });
    const b1 = await product(brandB.id, `B1 ${tag}`, { variations: [{ stock: 0 }] });
    refillIds.add(a1.product.id);

    const a = await brands.getOwnedCatalogHealth(ownerA.id);
    expect(a).toMatchObject({ totalProducts: 2, totalSkus: 3, outOfStockSkus: 1, refillPairedSkus: 2, missingInciProducts: 1 });
    expect(a.outOfStock.map((v) => v.sku)).toEqual([a1.skus[1]]);
    expect(a.missingInci).toEqual([{ productId: a2.product.id, name: `A2 ${tag}`, skuCount: 1 }]);
    const aJson = JSON.stringify(a);
    for (const sku of b1.skus) expect(aJson).not.toContain(sku);
    expect(aJson).not.toContain(b1.product.id);
    expect(aJson).not.toContain(a2.skus[1]);

    const b = await brands.getOwnedCatalogHealth(ownerB.id);
    expect(b).toMatchObject({ totalProducts: 1, totalSkus: 1, outOfStockSkus: 1, refillPairedSkus: 0, missingInciProducts: 1 });
    const bJson = JSON.stringify(b);
    for (const sku of [...a1.skus, ...a2.skus]) expect(bJson).not.toContain(sku);

    await expect(brands.getOwnedCatalogHealth(stranger.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
