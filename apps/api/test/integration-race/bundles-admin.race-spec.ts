import { Test, type TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { BundlesAdminService } from '../../src/modules/bundles/bundles-admin.service';
import { loadLiveBundles } from '../../src/modules/bundles/bundle-read';
import { createRealUser, createUser, pinConfig, randCode, warmPool } from './helpers';

/**
 * Quản trị bundle trên Postgres thật: ghi lồng nhau, khoá hàng khi thay danh sách món, CHECK của migration, cascade khi xoá,
 * trần nhân viên đọc từ cấu hình thật, và thứ admin ghi thì đường tính tiền (`loadLiveBundles`) đọc lại đúng.
 */
describe('Quản trị bundle (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let admin: BundlesAdminService;
  const bundleIds: string[] = [];
  const restores: (() => Promise<void>)[] = [];
  const NOW = new Date();
  const START = new Date(NOW.getTime() - 3_600_000).toISOString();
  const END = new Date(NOW.getTime() + 86_400_000).toISOString();
  const ADMIN = { id: 'it-admin', staff: false };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService, BundlesAdminService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    admin = moduleRef.get(BundlesAdminService);
    restores.push(await pinConfig(prisma, 'bundle.max_pct', 50));
  });

  afterAll(async () => {
    if (bundleIds.length) await prisma.bundle.deleteMany({ where: { id: { in: bundleIds } } });
    for (const r of restores.reverse()) await r();
    await moduleRef?.close();
  });

  async function product(price = 100_000, storefrontId: string | null = null) {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: {
        pancakeId: storefrontId ? null : `itba-p-${tag}`,
        storefrontId,
        fulfilment: storefrontId ? 'MERCHANT' : 'TUBU',
        brand: 'IT',
        slug: `itba-${tag.toLowerCase()}`,
        name: `SP ${tag}`,
        description: 'IT',
        basePrice: price,
        variations: { create: { pancakeId: storefrontId ? null : `itba-v-${tag}`, sku: `ITBA-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: price, stock: 20 } },
      },
      include: { variations: true },
    });
    return { id: p.id, variationId: p.variations[0]!.id };
  }

  const pctBundle = (a: string, b: string, o: Record<string, unknown> = {}) => ({
    kind: 'BUNDLE_PCT' as const,
    title: `IT ${randCode(6)}`,
    pct: 10,
    startAt: START,
    endAt: END,
    items: [{ productId: a }, { productId: b }],
    ...o,
  });

  async function create(dto: ReturnType<typeof pctBundle> | Record<string, unknown>, actor = ADMIN) {
    const out = await admin.create(dto as never, actor);
    bundleIds.push(out.id);
    return out;
  }

  it('tạo bộ: lưu bộ + món + người tạo, và đường tính tiền đọc lại đúng thứ vừa ghi', async () => {
    const [a, b] = [await product(), await product()];
    const out = await create(pctBundle(a.id, b.id, { items: [{ productId: a.id, maxQty: 2 }, { productId: b.id, variationId: b.variationId }] }));
    expect(out).toMatchObject({ kind: 'BUNDLE_PCT', pct: 10, status: 'live', createdById: 'it-admin' });
    expect(out.items.map((i) => [i.productId, i.maxQty, i.variationId])).toEqual([[a.id, 2, null], [b.id, 1, b.variationId]]);
    const live = await loadLiveBundles(prisma, NOW, [a.id]);
    const mine = live.find((x) => x.id === out.id)!;
    expect(mine.items).toEqual([
      { productId: a.id, variationId: null, addonPrice: null, maxQty: 2 },
      { productId: b.id, variationId: b.variationId, addonPrice: null, maxQty: 1 },
    ]);
  });

  it('tắt bộ rồi bộ không còn vào đường tính tiền; bật lại thì vào', async () => {
    const [a, b] = [await product(), await product()];
    const { id } = await create(pctBundle(a.id, b.id));
    await admin.update(id, { isActive: false } as never, ADMIN);
    expect((await loadLiveBundles(prisma, NOW, [a.id])).some((x) => x.id === id)).toBe(false);
    await admin.update(id, { isActive: true } as never, ADMIN);
    expect((await loadLiveBundles(prisma, NOW, [a.id])).some((x) => x.id === id)).toBe(true);
  });

  it('thay danh sách món: món cũ biến mất, món mới vào, sản phẩm chính ADDON đổi được', async () => {
    const [a, b, c] = [await product(), await product(), await product()];
    const addon = await create({ kind: 'ADDON', title: `IT ${randCode(6)}`, anchorProductId: a.id, startAt: START, endAt: END, items: [{ productId: b.id, addonPrice: 0 }] });
    expect(addon.items[0]).toMatchObject({ productId: b.id, addonPrice: 0 });
    const next = await admin.update(addon.id, { anchorProductId: c.id, items: [{ productId: a.id, addonPrice: 50_000 }] } as never, ADMIN);
    expect(next.anchorProductId).toBe(c.id);
    expect(next.items.map((i) => [i.productId, i.addonPrice])).toEqual([[a.id, 50_000]]);
    expect(await prisma.bundleItem.count({ where: { bundleId: addon.id } })).toBe(1);
  });

  it('hai người thay danh sách món cùng lúc: bộ giữ đúng danh sách của MỘT bên, không lẫn cả hai', async () => {
    const ps = await Promise.all([product(), product(), product(), product()]);
    const { id } = await create(pctBundle(ps[0]!.id, ps[1]!.id));
    const setA = [{ productId: ps[0]!.id }, { productId: ps[2]!.id }];
    const setB = [{ productId: ps[1]!.id }, { productId: ps[3]!.id }];
    const results = await Promise.allSettled([admin.update(id, { items: setA } as never, ADMIN), admin.update(id, { items: setB } as never, ADMIN)]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const final = (await prisma.bundleItem.findMany({ where: { bundleId: id }, select: { productId: true } })).map((i) => i.productId).sort();
    const want = (s: { productId: string }[]) => s.map((i) => i.productId).sort();
    expect([want(setA), want(setB)]).toContainEqual(final);
  });

  it('xoá bộ đang chạy: món xoá theo (cascade), sản phẩm còn nguyên', async () => {
    const [a, b] = [await product(), await product()];
    const { id } = await create(pctBundle(a.id, b.id));
    await admin.remove(id, ADMIN);
    expect(await prisma.bundleItem.count({ where: { bundleId: id } })).toBe(0);
    expect(await prisma.product.count({ where: { id: { in: [a.id, b.id] } } })).toBe(2);
  });

  it('sản phẩm chính bị xoá: ADDON mất sản phẩm chính nên không vào đường tính tiền', async () => {
    const [a, b] = [await product(), await product()];
    const addon = await create({ kind: 'ADDON', title: `IT ${randCode(6)}`, anchorProductId: a.id, startAt: START, endAt: END, items: [{ productId: b.id, addonPrice: 10_000 }] });
    await prisma.bundle.update({ where: { id: addon.id }, data: { anchorProductId: null } });
    expect((await loadLiveBundles(prisma, NOW, [b.id])).some((x) => x.id === addon.id)).toBe(false);
  });

  it('hàng đối tác không vào bộ (400 từ dịch vụ), không ghi gì', async () => {
    const owner = await createUser(prisma, { role: 'AFFILIATE' });
    const sf = await prisma.storefront.create({
      data: { type: 'CTV', slug: `itba-${randCode(8).toLowerCase()}`, title: 'Gian hàng IT', ownerUserId: owner.id, isPublished: true, approvedAt: new Date() },
    });
    const [a, partner] = [await product(), await product(100_000, sf.id)];
    const before = await prisma.bundle.count();
    await expect(admin.create(pctBundle(a.id, partner.id) as never, ADMIN)).rejects.toMatchObject({ status: 400 });
    expect(await prisma.bundle.count()).toBe(before);
  });

  describe('CHECK của migration chặn dữ liệu ghi thẳng DB', () => {
    async function raw(data: Record<string, unknown>) {
      const [a, b] = [await product(), await product()];
      const created = await prisma.bundle.create({
        data: {
          kind: 'BUNDLE_PCT',
          title: 'IT raw',
          pct: 10,
          startAt: new Date(START),
          endAt: new Date(END),
          items: { create: [{ productId: a.id }, { productId: b.id }] },
          ...data,
        } as never,
      });
      bundleIds.push(created.id);
      return { created, a };
    }

    it.each([
      ['pct 0', { pct: 0 }],
      ['pct 101', { pct: 101 }],
      ['endAt bằng startAt', { endAt: new Date(START) }],
    ])('bộ: %s bị từ chối', async (_n, data) => {
      await expect(raw(data)).rejects.toBeDefined();
    });

    it('món: addonPrice âm và maxQty ngoài 1..10 bị từ chối', async () => {
      const { created, a } = await raw({});
      const extra = await product();
      await expect(prisma.bundleItem.create({ data: { bundleId: created.id, productId: extra.id, addonPrice: -1 } })).rejects.toBeDefined();
      await expect(prisma.bundleItem.create({ data: { bundleId: created.id, productId: extra.id, maxQty: 11 } })).rejects.toBeDefined();
      await expect(prisma.bundleItem.update({ where: { bundleId_productId: { bundleId: created.id, productId: a.id } }, data: { maxQty: 0 } })).rejects.toBeDefined();
      await expect(prisma.bundleItem.create({ data: { bundleId: created.id, productId: extra.id, addonPrice: 0 } })).resolves.toBeDefined();
    });
  });

  describe('trần nhân viên đọc từ cấu hình thật', () => {
    it('pct vượt coupon.staff_max_percent → 403, không ghi; nhân viên chỉ sửa bộ của nhân viên', async () => {
      restores.push(await pinConfig(prisma, 'coupon.staff_max_percent', 20));
      restores.push(await pinConfig(prisma, 'coupon.staff_max_amount_vnd', 1_000_000));
      const staffUser = await createRealUser(prisma, { role: 'STAFF' });
      const staff = { id: staffUser.id, staff: true };
      const [a, b] = [await product(), await product()];
      const before = await prisma.bundle.count();
      await expect(admin.create(pctBundle(a.id, b.id, { pct: 30 }) as never, staff)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await prisma.bundle.count()).toBe(before);

      const mine = await create(pctBundle(a.id, b.id, { pct: 20 }), staff);
      expect(mine.createdByStaff).toBe(true);
      await expect(admin.update(mine.id, { pct: 21 } as never, staff)).rejects.toBeInstanceOf(ForbiddenException);
      const adminOwned = await create(pctBundle(a.id, b.id));
      expect(adminOwned.createdByStaff).toBe(false);
      await expect(admin.update(adminOwned.id, { title: 'X' } as never, staff)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(admin.remove(adminOwned.id, staff)).rejects.toBeInstanceOf(ForbiddenException);
      await admin.remove(mine.id, staff);
      await prisma.user.deleteMany({ where: { id: staffUser.id } });
    });
  });
});
