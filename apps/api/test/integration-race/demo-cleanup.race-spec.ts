import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { PUBLIC_PRODUCT_WHERE } from '../../src/modules/catalog/public-product';
import { assertVariationsSellable, PRODUCT_DISCONTINUED } from '../../src/modules/cart/sellable';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { applyDemoCleanup, hasDemoData, planDemoCleanup, previewDemoCleanup } from '../../src/config/demo-data/cleanup';
import {
  DEMO_BRANDS,
  DEMO_CATEGORIES,
  DEMO_COUPONS,
  DEMO_MIGRATION,
  DEMO_PRODUCTS,
  DEMO_PRODUCT_PANCAKE_IDS,
  DEMO_PRODUCT_WHERE,
  DEMO_VARIATIONS,
  DEMO_VARIATION_PANCAKE_IDS,
  DEMO_VARIATION_WHERE,
} from '../../src/config/demo-data/demo-catalog';
import { collectDbSnapshot } from '../../src/config/go-live/collect';
import { evaluateDemoData } from '../../src/config/go-live/demo-data-checks';
import { createOrder, createUser, deleteItData, randCode, warmPool } from './helpers';
import { readApiSql, splitSqlStatements } from './sql-script';

/**
 * P0 launch review: migration 20260616000000 nạp 44 SP + 48 biến thể demo và 3 mã công khai vào MỌI DB mới (kể cả PROD).
 * `prisma:cleanup-demo` xem trước → tắt (không xoá) trong một transaction, mã chỉ đổi khi có --coupons=expire, chạy lại không
 * lỗi, có đơn/giỏ/đánh giá/gian hàng/giờ vàng trỏ tới hàng demo vẫn chạy được. Sau khi tắt, catalog, tìm kiếm, PDP, danh mục,
 * nhãn, gian hàng, giờ vàng, kiểm "còn đặt được" đều không còn hàng demo; go-live check đổi từ FAIL sang PASS.
 */
describe('Dọn dữ liệu demo của migration demo_catalog (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const tag = randCode(6).toLowerCase();
  const apiDir = join(__dirname, '..', '..');
  const MIGRATION_END_AT = new Date('2026-12-31T17:00:00.000Z');

  const demoProduct = DEMO_PRODUCTS.find((p) => p.id === 'p-visante-serum')!;
  const demoVariation = DEMO_VARIATIONS.find((v) => v.sku === 'VIS-SR-30')!;
  const demoBrandNames = DEMO_BRANDS.map((b) => b.name).join(',');
  let userId = '';
  let saleId = '';
  let storeSlug = '';
  let storefrontId = '';

  const catalog = () => new CatalogService(prisma);
  const flash = () => new FlashSaleService(prisma, {} as never, {} as never, {} as never);
  const storefront = () => new StorefrontService(prisma, {} as never, {} as never);
  const coupons = () => new CouponsService(prisma);
  const demoSlugsShown = async () =>
    (await catalog().list({ page: 1, limit: 100, brand: demoBrandNames } as never)).data.map((p: { slug: string }) => p.slug);
  const goLive = async (env: Record<string, string> = {}) => {
    const snap = await collectDbSnapshot(prisma, []);
    const rows = evaluateDemoData(snap.demoData, env);
    return Object.fromEntries(rows.map((r) => [r.id, r.status]));
  };

  /**
   * Đưa dữ liệu demo về đúng trạng thái sau `migrate deploy` (spec chạy lại trên cùng DB, hoặc sau spec khác): chèn lại dòng
   * thiếu bằng chính các câu INSERT của migration rồi bật lại. Hạn mã giữ như migration, trừ khi đã qua thì lùi ra 30 ngày.
   */
  async function restoreDemoState() {
    const sql = readApiSql(`prisma/migrations/${DEMO_MIGRATION}/migration.sql`);
    for (const stmt of splitSqlStatements(sql).filter((s) => s.startsWith('INSERT INTO'))) await prisma.$executeRawUnsafe(stmt);
    await prisma.product.updateMany({ where: { pancakeId: { in: [...DEMO_PRODUCT_PANCAKE_IDS] } }, data: { isActive: true } });
    await prisma.variation.updateMany({ where: { pancakeId: { in: [...DEMO_VARIATION_PANCAKE_IDS] } }, data: { isActive: true } });
    const endAt = MIGRATION_END_AT > new Date() ? MIGRATION_END_AT : new Date(Date.now() + 30 * 86_400_000);
    for (const c of DEMO_COUPONS) await prisma.coupon.update({ where: { id: c.id }, data: { isActive: true, endAt } });
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    await restoreDemoState();

    const user = await createUser(prisma, { phone: `09${Date.now().toString().slice(-8)}`, zaloId: `itdemo-${tag}` });
    userId = user.id;
    const order = await createOrder(prisma, { userId, status: 'DELIVERED' });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        variationId: demoVariation.id,
        productName: 'Serum dưỡng ẩm Visante',
        variationName: '30ml',
        unitPrice: 100_000,
        quantity: 1,
        total: 100_000,
      },
    });
    const cart = await prisma.cart.create({ data: { userId } });
    await prisma.cartItem.create({ data: { cartId: cart.id, variationId: demoVariation.id, quantity: 1 } });
    await prisma.review.create({ data: { userId, productId: demoProduct.id, orderId: order.id, rating: 5 } });
    await prisma.wishlist.create({ data: { userId, productId: demoProduct.id } });

    storeSlug = `itdemo-${tag}`;
    const store = await prisma.storefront.create({ data: { type: 'BRAND', slug: storeSlug, title: 'IT demo', isPublished: true } });
    storefrontId = store.id;
    const coll = await prisma.storefrontCollection.create({ data: { storefrontId, title: 'IT' } });
    await prisma.storefrontItem.create({ data: { collectionId: coll.id, productId: demoProduct.id } });

    const sale = await prisma.flashSale.create({
      data: { title: `IT demo ${tag}`, startAt: new Date(Date.now() - 3_600_000), endAt: new Date(Date.now() + 3_600_000), createdBy: userId },
    });
    saleId = sale.id;
    await prisma.flashSaleItem.create({ data: { flashSaleId: sale.id, variationId: demoVariation.id, flashPrice: 50_000, quota: 10, perUserLimit: 2 } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.storefront.deleteMany({ where: { id: storefrontId } });
      await prisma.wishlist.deleteMany({ where: { userId } });
      await deleteItData(prisma, { userIds: [userId], flashSaleIds: [saleId] });
      await prisma.$executeRaw`DELETE FROM "flash_sale_items" WHERE "flashSaleId" = ${saleId}`;
      await restoreDemoState();
    }
    await moduleRef?.close();
  });

  it('trước khi dọn: hàng demo hiện và đặt được ở mọi nơi (fixture có nghĩa)', async () => {
    expect((await demoSlugsShown()).length).toBe(44);
    await expect(catalog().getBySlug(demoProduct.slug)).resolves.toMatchObject({ slug: demoProduct.slug });
    expect((await flash().listActive()).map((i) => i.variationId)).toContain(demoVariation.id);
    const page = await storefront().getPublicBySlug(storeSlug);
    expect(page.collections[0]!.items.map((i) => i.product.id)).toEqual([demoProduct.id]);
    await expect(assertVariationsSellable(prisma, [{ variationId: demoVariation.id }])).resolves.toBeUndefined();
    await expect(coupons().validateAndCompute('WELCOME30', userId, 250_000)).resolves.toMatchObject({ code: 'WELCOME30', discount: 30_000 });
    expect(await goLive()).toEqual({ 'db.demo_products': 'FAIL', 'db.demo_coupons': 'FAIL' });
  });

  it('xem trước: đúng số dòng của migration, nêu dòng tham chiếu, không ghi gì', async () => {
    const plan = await previewDemoCleanup(prisma);
    expect(plan.products).toEqual({ expected: 44, found: 44, active: 44, idMismatch: [] });
    expect(plan.variations).toEqual({ expected: 48, found: 48, active: 48, extraActive: 0 });
    const refs = Object.fromEntries(plan.references.map((r) => [r.table, r.rows]));
    expect(refs).toMatchObject({ order_items: 1, cart_items: 1, flash_sale_items: 1, reviews: 1, wishlists: 1, storefront_items: 1 });
    expect(plan.coupons.map((c) => [c.code, c.fromMigration, c.live])).toEqual([
      ['FREESHIP', true, true],
      ['WELCOME30', true, true],
      ['XANH10', true, true],
    ]);
    expect(plan.categories.every((c) => c.exists && c.publicNonDemo === 0)).toBe(true);
    expect(plan.categories.reduce((n, c) => n + c.publicDemo, 0)).toBeGreaterThanOrEqual(44);
    expect(plan.brands.every((b) => b.exists && !b.isPublished)).toBe(true);
    expect(await prisma.product.count({ where: { ...DEMO_PRODUCT_WHERE, isActive: true } })).toBe(44);
  });

  it('--apply (mặc định giữ mã): tắt 44 SP + 48 biến thể, không xoá dòng nào, dòng tham chiếu còn nguyên', async () => {
    const { result } = await applyDemoCleanup(prisma, { coupons: 'keep' });
    expect(result).toEqual({ productsDeactivated: 44, variationsDeactivated: 48, couponsExpired: 0 });

    expect(await prisma.product.count({ where: DEMO_PRODUCT_WHERE })).toBe(44);
    expect(await prisma.product.count({ where: { ...DEMO_PRODUCT_WHERE, isActive: true } })).toBe(0);
    expect(await prisma.variation.count({ where: DEMO_VARIATION_WHERE })).toBe(48);
    expect(await prisma.variation.count({ where: { ...DEMO_VARIATION_WHERE, isActive: true } })).toBe(0);
    expect(await prisma.product.count({ where: { ...DEMO_PRODUCT_WHERE, pancakeHold: { not: null } } })).toBe(0);

    expect(await prisma.orderItem.count({ where: { variationId: demoVariation.id } })).toBe(1);
    expect(await prisma.cartItem.count({ where: { variationId: demoVariation.id } })).toBe(1);
    expect(await prisma.review.count({ where: { productId: demoProduct.id } })).toBe(1);
    expect(await prisma.wishlist.count({ where: { productId: demoProduct.id } })).toBe(1);
    expect(await prisma.storefrontItem.count({ where: { productId: demoProduct.id } })).toBe(1);
    expect(await prisma.flashSaleItem.count({ where: { variationId: demoVariation.id } })).toBe(1);

    const kept = await prisma.coupon.findMany({ where: { id: { in: DEMO_COUPONS.map((c) => c.id) } } });
    expect(kept.every((c) => c.isActive && c.endAt > new Date())).toBe(true);
  });

  it('sau khi tắt: catalog, tìm kiếm, PDP, danh mục, nhãn, gian hàng, giờ vàng, giỏ/checkout đều không còn hàng demo', async () => {
    expect(await prisma.product.count({ where: { ...PUBLIC_PRODUCT_WHERE, ...DEMO_PRODUCT_WHERE } })).toBe(0);
    expect(await demoSlugsShown()).toEqual([]);
    const searched = (await catalog().list({ page: 1, limit: 50, q: 'Visante' } as never)).data.map((p: { slug: string }) => p.slug);
    expect(searched.filter((s: string) => DEMO_PRODUCTS.some((p) => p.slug === s))).toEqual([]);
    expect((await catalog().suggest('Visante')).filter((p) => DEMO_PRODUCTS.some((d) => d.slug === p.slug))).toEqual([]);
    await expect(catalog().getBySlug(demoProduct.slug)).rejects.toBeInstanceOf(NotFoundException);
    const demoCats = (await catalog().categories()).filter((x) => DEMO_CATEGORIES.some((d) => d.id === x.id));
    expect(demoCats).toHaveLength(7);
    for (const c of demoCats) expect(c.productCount).toBe(0);
    const brands = ((await catalog().brands()) as Array<{ brand: string }>).map((b) => b.brand);
    for (const b of DEMO_BRANDS) expect(brands).not.toContain(b.name);
    expect((await storefront().getPublicBySlug(storeSlug)).collections[0]!.items).toEqual([]);
    expect((await flash().listActive()).map((i) => i.variationId)).not.toContain(demoVariation.id);
    await expect(assertVariationsSellable(prisma, [{ variationId: demoVariation.id }])).rejects.toMatchObject({
      response: { code: PRODUCT_DISCONTINUED },
    });
    expect(await goLive()).toEqual({ 'db.demo_products': 'PASS', 'db.demo_coupons': 'FAIL' });
  });

  it('chạy lại: không lỗi, không đổi gì', async () => {
    const { plan, result } = await applyDemoCleanup(prisma, { coupons: 'keep' });
    expect(result).toEqual({ productsDeactivated: 0, variationsDeactivated: 0, couponsExpired: 0 });
    expect(plan.products.active).toBe(0);
  });

  it('--coupons=expire --keep-coupon=WELCOME30: tắt hai mã còn lại, WELCOME30 vẫn dùng được; go-live FAIL tới khi chấp nhận giữ', async () => {
    const { result } = await applyDemoCleanup(prisma, { coupons: 'expire', keepCoupons: ['WELCOME30'] });
    expect(result.couponsExpired).toBe(2);
    const byCode = Object.fromEntries((await prisma.coupon.findMany({ where: { id: { in: DEMO_COUPONS.map((c) => c.id) } } })).map((c) => [c.code, c]));
    expect(byCode.WELCOME30!.isActive).toBe(true);
    expect(byCode.FREESHIP!.isActive).toBe(false);
    expect(byCode.XANH10!.isActive).toBe(false);
    await expect(coupons().validateAndCompute('WELCOME30', userId, 250_000)).resolves.toMatchObject({ discount: 30_000 });
    await expect(coupons().validateAndCompute('XANH10', userId, 300_000)).rejects.toThrow(/ngừng áp dụng/);
    expect(await goLive()).toEqual({ 'db.demo_products': 'PASS', 'db.demo_coupons': 'FAIL' });
    expect(await goLive({ GO_LIVE_ACCEPT_DEMO_COUPONS: 'WELCOME30' })).toEqual({ 'db.demo_products': 'PASS', 'db.demo_coupons': 'WARN' });
    expect((await applyDemoCleanup(prisma, { coupons: 'expire', keepCoupons: ['WELCOME30', 'FREESHIP', 'XANH10'] })).result.couponsExpired).toBe(0);
  });

  it('--coupons=expire: tắt và cắt hạn mã còn lại của migration, khách không dùng được nữa, chạy lại không đổi', async () => {
    const before = new Date();
    const { result } = await applyDemoCleanup(prisma, { coupons: 'expire' });
    expect(result.couponsExpired).toBe(1);
    const rows = await prisma.coupon.findMany({ where: { id: { in: DEMO_COUPONS.map((c) => c.id) } } });
    expect(rows).toHaveLength(3);
    for (const c of rows) {
      expect(c.isActive).toBe(false);
      expect(c.endAt.getTime()).toBeLessThanOrEqual(Date.now());
    }
    expect(rows.find((c) => c.code === 'WELCOME30')!.endAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    await expect(coupons().validateAndCompute('WELCOME30', userId, 250_000)).rejects.toThrow(/ngừng áp dụng/);
    expect(await goLive()).toEqual({ 'db.demo_products': 'PASS', 'db.demo_coupons': 'PASS' });
    expect((await applyDemoCleanup(prisma, { coupons: 'expire' })).result.couponsExpired).toBe(0);
  });

  it('DB không có dòng demo nào: kế hoạch báo không có, hasDemoData=false (điều kiện CLI và --apply dùng để từ chối)', async () => {
    const rollback = new Error('rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`UPDATE "variations" SET "pancakeId" = 'ithide-' || "pancakeId" WHERE "pancakeId" = ANY($1::text[])`, [...DEMO_VARIATION_PANCAKE_IDS]);
        await tx.$executeRawUnsafe(`UPDATE "products" SET "pancakeId" = 'ithide-' || "pancakeId" WHERE "pancakeId" = ANY($1::text[])`, [...DEMO_PRODUCT_PANCAKE_IDS]);
        await tx.$executeRawUnsafe(`UPDATE "coupons" SET "code" = "code" || '_ITHIDE' WHERE "id" = ANY($1::text[])`, DEMO_COUPONS.map((c) => c.id));
        const plan = await planDemoCleanup(tx);
        expect(plan.products.found + plan.variations.found + plan.coupons.length).toBe(0);
        expect(hasDemoData(plan)).toBe(false);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(await prisma.product.count({ where: DEMO_PRODUCT_WHERE })).toBe(44);
  });

  it('CLI: xem trước và --apply qua tsx đều thoát 0 trên DB đã dọn; tham số sai thoát 2', () => {
    const cli = (args: string[]) =>
      spawnSync(join(apiDir, 'node_modules/.bin/tsx'), ['prisma/cleanup-demo-data.ts', ...args], {
        cwd: apiDir,
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
        encoding: 'utf8',
        timeout: 60_000,
      });
    const dry = cli([]);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('XEM TRƯỚC');
    expect(dry.stdout).toContain('tìm thấy 44/44, đang bán 0 → không cần đổi');
    expect(dry.stdout).toMatch(/tubutree_it/);
    const apply = cli(['--', '--apply']);
    expect(apply.status).toBe(0);
    expect(apply.stdout).toContain('Đã tắt 0 sản phẩm, 0 biến thể');
    expect(cli(['--aply']).status).toBe(2);
  });
});
