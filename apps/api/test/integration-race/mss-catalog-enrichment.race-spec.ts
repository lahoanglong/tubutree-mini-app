import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { registrySql } from '../../src/modules/catalog/image-registry-query';
import type { MssClient } from '../../src/modules/integrations/mss/mss.client';
import type { MssFlagsService } from '../../src/modules/integrations/mss/mss-flags';
import type { MssHealthService } from '../../src/modules/integrations/mss/mss-health.service';
import { MssCatalogService, type MssApplyContext, type MssCatalogRunStats } from '../../src/modules/integrations/mss/catalog/mss-catalog.service';
import { deleteItData, randCode, warmPool } from './helpers';

/**
 * Nội dung bổ sung MSS trên Postgres THẬT (wave tubu-mss-catalog-enrichment): câu upsert chặn lùi phiên bản khi hai lượt kéo chạy chồng,
 * lọc/đếm danh mục theo danh mục hiệu lực, đồng bộ Pancake ghi `products` không đụng nội dung bổ sung, danh sách ảnh /img, và cờ tắt thì
 * đầu ra API giống hệt khi chưa có bảng mới. MSS không được gọi (ghép tài liệu trực tiếp bằng applyDocs).
 */
describe('MSS catalog enrichment (real Postgres)', () => {
  let prisma: PrismaService;
  /**
   * Ghép trong một phiên ở múi giờ +07 (như máy chủ Postgres đặt TimeZone địa phương): mốc giờ ghi bằng SQL thô vẫn phải đọc lại đúng
   * qua Prisma. `SET LOCAL` chỉ sống trong transaction nên không lây sang kết nối khác của pool.
   */
  const applyInVn = (docs: unknown[], s: MssCatalogRunStats) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TimeZone = 'Asia/Ho_Chi_Minh'`;
      const [{ tz }] = await tx.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
      expect(tz).toBe('Asia/Ho_Chi_Minh');
      await new MssCatalogService(tx as unknown as PrismaService, noClient, health).applyDocs(docs, s, ctx);
    });
  const HOST = 'mss.example.test';
  const media = (h: string) => `https://${HOST}/api/pub/media/${h}.webp`;
  const tag = randCode(6).toLowerCase();
  const pidA = `itce-a-${tag}`;
  const pidB = `itce-b-${tag}`;
  const productIds: string[] = [];
  let productA: { id: string; slug: string };
  let productB: { id: string; slug: string };
  let catTubu: string;
  let catMss: string;
  const categoryIds: string[] = [];

  const health = { assertCapability: async () => true } as unknown as MssHealthService;
  const noClient = { request: async () => Promise.reject(new Error('không gọi MSS trong spec này')) } as unknown as MssClient;
  const flagsOn = { isEnabled: async () => true } as unknown as MssFlagsService;
  const flagsOff = { isEnabled: async () => false } as unknown as MssFlagsService;
  const stats = (): MssCatalogRunStats => ({ kind: 'ids', pages: 0, received: 0, applied: 0, unchanged: 0, skipped: {}, trimmed: {} });
  let ctx: MssApplyContext;

  const doc = (pid: string, version: number, over: Record<string, unknown> = {}, enrichment: Record<string, unknown> = {}) => ({
    pancake_product_id: pid,
    mss_product_id: `m-${pid}`,
    state: 'published',
    published_version: version,
    updated_at: new Date(Date.UTC(2026, 10, 17, 1, 0, version)).toISOString(),
    enrichment: {
      title: `Tựa MSS v${version}`,
      description_html: `<p>Mô tả v${version}</p>`,
      images: [{ url: media(`cover0000${version}`), alt: null, w: null, h: null, variation_id: null }],
      ...enrichment,
    },
    ...over,
  });

  const row = (productId: string) => prisma.productMssEnrichment.findUnique({ where: { productId } });
  const countsOf = (cs: { id: string; productCount: number }[]) => Object.fromEntries(cs.filter((c) => categoryIds.includes(c.id)).map((c) => [c.id, c.productCount]));

  beforeAll(async () => {
    process.env.MSS_BASE_URL = `https://${HOST}`;
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);

    const [c1, c2] = await Promise.all([
      prisma.category.create({ data: { name: `IT Tubu ${tag}`, slug: `itce-tubu-${tag}` } }),
      prisma.category.create({ data: { name: `IT MSS ${tag}`, slug: `itce-mss-${tag}` } }),
    ]);
    catTubu = c1.id;
    catMss = c2.id;
    categoryIds.push(c1.id, c2.id);
    ctx = { mediaHosts: [HOST], categories: new Map([[c1.slug, c1.id], [c2.slug, c2.id]]) };

    const mk = (pid: string, name: string) =>
      prisma.product.create({
        data: {
          brand: 'IT',
          slug: `itce-${pid}`,
          name,
          description: '<p>Mô tả Tubu</p>',
          basePrice: 100_000,
          pancakeId: pid,
          categoryIds: [catTubu],
          images: ['https://content.pancake.vn/it-a.jpg'],
          variations: { create: { sku: `ITCE-${pid}`, name: 'Hũ', attributes: {}, retailPrice: 100_000, stock: 50 } },
        },
        select: { id: true, slug: true },
      });
    productA = await mk(pidA, `Hàng A ${tag}`);
    productB = await mk(pidB, `Hàng B ${tag}`);
    productIds.push(productA.id, productB.id);
  });

  afterAll(async () => {
    await deleteItData(prisma, { productIds });
    await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    await prisma.$disconnect();
  });

  it('cờ tắt: đầu ra PDP, danh sách và danh mục giống hệt khi không có MssFlagsService (bảng mới có dữ liệu)', async () => {
    await new MssCatalogService(prisma, noClient, health).applyDocs([doc(pidA, 1, {}, { category_slugs: [`itce-mss-${tag}`] })], stats(), ctx);
    const plain = new CatalogService(prisma);
    const off = new CatalogService(prisma, undefined, flagsOff);
    expect(JSON.stringify(await off.getBySlug(productA.slug))).toBe(JSON.stringify(await plain.getBySlug(productA.slug)));
    const q = { page: 1, limit: 50, category: catTubu };
    expect(JSON.stringify(await off.list(q))).toBe(JSON.stringify(await plain.list(q)));
    expect(countsOf(await off.categoriesFlat())).toEqual(countsOf(await plain.categoriesFlat()));
    expect(countsOf(await off.categoriesFlat())).toEqual({ [catTubu]: 2, [catMss]: 0 });
  });

  it('ghi rồi đọc: mốc giờ MSS đọc lại đúng từng ms, kể cả khi phiên kết nối ở múi giờ +07', async () => {
    const utc = (docs: unknown[], s: MssCatalogRunStats) => new MssCatalogService(prisma, noClient, health).applyDocs(docs, s, ctx);
    for (const [i, apply] of [utc, applyInVn].entries()) {
      const d = doc(pidB, 10 + i);
      const s = stats();
      await apply([d], s);
      expect(s.applied).toBe(1);
      const r = await row(productB.id);
      expect(r?.contentVersion).toBe(10 + i);
      expect(r?.mssUpdatedAt.toISOString()).toBe(d.updated_at);
      // Gửi lại đúng tài liệu đó (ở cả hai múi giờ): không ghi lại.
      for (const again of [utc, applyInVn]) {
        const s2 = stats();
        await again([d], s2);
        expect(s2).toMatchObject({ applied: 0, unchanged: 1 });
      }
      // Cùng phiên bản mà updated_at sớm hơn 1 giây: bản cũ, không ghi.
      const older = stats();
      await apply([{ ...d, updated_at: new Date(Date.parse(d.updated_at) - 1000).toISOString(), enrichment: { title: 'cũ' } }], older);
      expect(older.skipped).toEqual({ stale_version: 1 });
    }
  });

  it('hai lượt kéo chạy chồng (v6 và v7, nhiều vòng, hai thứ tự): bản lưu cuối luôn là v7', async () => {
    await prisma.productMssEnrichment.deleteMany({ where: { productId: productA.id } });
    for (let round = 0; round < 8; round++) {
      const a = (d: unknown) => new MssCatalogService(prisma, noClient, health).applyDocs([d], stats(), ctx);
      const b = (d: unknown) => applyInVn([d], stats());
      const v6 = doc(pidA, 6 + round * 2);
      const v7 = doc(pidA, 7 + round * 2);
      await Promise.all(round % 2 === 0 ? [a(v6), b(v7)] : [a(v7), b(v6)]);
      const r = await row(productA.id);
      expect(r?.contentVersion).toBe(7 + round * 2);
      expect(r?.title).toBe(`Tựa MSS v${7 + round * 2}`);
    }
    // Bản cũ đến muộn (sau khi đã lưu bản mới): không ghi đè.
    const late = stats();
    await new MssCatalogService(prisma, noClient, health).applyDocs([doc(pidA, 3)], late, ctx);
    expect(late.skipped).toEqual({ stale_version: 1 });
    expect((await row(productA.id))?.contentVersion).toBe(21);
  });

  it('cờ bật: lọc và đếm theo danh mục hiệu lực (MSS thay danh mục của A, B giữ danh mục Tubu)', async () => {
    await new MssCatalogService(prisma, noClient, health).applyDocs([doc(pidA, 30, {}, { category_slugs: [`itce-mss-${tag}`, 'khong-co-o-tubu'] })], stats(), ctx);
    const on = new CatalogService(prisma, undefined, flagsOn);
    const ids = async (svc: CatalogService, category: string) => ((await svc.list({ page: 1, limit: 50, category })).data as { id: string }[]).map((p) => p.id).sort();
    expect(await ids(on, catMss)).toEqual([productA.id]);
    expect(await ids(on, catTubu)).toEqual([productB.id]);
    expect(countsOf(await on.categoriesFlat())).toEqual({ [catTubu]: 1, [catMss]: 1 });
    const off = new CatalogService(prisma, undefined, flagsOff);
    expect(await ids(off, catTubu)).toEqual([productA.id, productB.id].sort());
    expect(await ids(off, catMss)).toEqual([]);
  });

  it('đồng bộ Pancake ghi đè tên/giá/ảnh ở products: nội dung MSS còn nguyên, giá mới vẫn lên PDP', async () => {
    const before = await row(productA.id);
    await prisma.product.update({ where: { id: productA.id }, data: { name: `Tên Pancake mới ${tag}`, basePrice: 120_000, images: ['https://content.pancake.vn/it-b.jpg'] } });
    await prisma.variation.updateMany({ where: { productId: productA.id }, data: { retailPrice: 120_000, stock: 7 } });
    const after = await row(productA.id);
    expect(after).toEqual(before);
    const pdp = await new CatalogService(prisma, undefined, flagsOn).getBySlug(productA.slug);
    expect(pdp).toMatchObject({ name: 'Tựa MSS v30', basePrice: 120_000, images: [media('cover000030')] });
    expect(pdp.variations[0]).toMatchObject({ retailPrice: 120_000, stock: 7 });
    const off = await new CatalogService(prisma, undefined, flagsOff).getBySlug(productA.slug);
    expect(off).toMatchObject({ name: `Tên Pancake mới ${tag}`, images: ['https://content.pancake.vn/it-b.jpg'] });
  });

  it('danh sách ảnh /img: có ảnh của dòng đã xuất bản, không có ảnh của dòng gỡ xuất bản', async () => {
    const urls = async () => new Set((await prisma.$queryRaw<{ u: string }[]>(registrySql())).map((r) => r.u));
    expect((await urls()).has(media('cover000030'))).toBe(true);
    await new MssCatalogService(prisma, noClient, health).applyDocs([doc(pidA, 31, { state: 'unpublished' })], stats(), ctx);
    const r = await row(productA.id);
    expect(r).toMatchObject({ state: 'unpublished', contentVersion: 31, mediaUrls: [] });
    expect((await urls()).has(media('cover000030'))).toBe(false);
    // Gỡ xuất bản: PDP và thẻ về nội dung Tubu dù cờ bật.
    const pdp = await new CatalogService(prisma, undefined, flagsOn).getBySlug(productA.slug);
    expect(pdp.name).toBe(`Tên Pancake mới ${tag}`);
  });

  it('gỡ xuất bản (không published_version) chạy chồng với bản xuất bản gửi lại: bản gỡ thắng, phiên bản không lùi; xuất bản bản mới thì hiện lại', async () => {
    const at = (s: number) => new Date(Date.UTC(2026, 10, 17, 1, 0, s)).toISOString();
    const a = (d: unknown) => new MssCatalogService(prisma, noClient, health).applyDocs([d], stats(), ctx);
    const b = (d: unknown) => applyInVn([d], stats());
    for (let round = 0; round < 6; round++) {
      const base = 100 + round * 10;
      await a(doc(pidB, base));
      expect(await row(productB.id)).toMatchObject({ state: 'published', contentVersion: base });
      const tomb = doc(pidB, 0, { state: 'unpublished', published_version: null, updated_at: at(base + 5) });
      const resend = doc(pidB, base, { updated_at: at(base + 2) });
      await Promise.all(round % 2 ? [a(tomb), b(resend)] : [a(resend), b(tomb)]);
      expect(await row(productB.id)).toMatchObject({ state: 'unpublished', contentVersion: base, mediaUrls: [], mssUpdatedAt: new Date(at(base + 5)) });
      // Bản xuất bản cũ đến muộn sau lần gỡ: không hồi sinh nội dung đã gỡ.
      const late = stats();
      await new MssCatalogService(prisma, noClient, health).applyDocs([doc(pidB, base, { updated_at: at(base + 1) })], late, ctx);
      expect(late.skipped).toEqual({ stale_version: 1 });
    }
    expect((await new CatalogService(prisma, undefined, flagsOn).getBySlug(productB.slug)).name).toBe(`Hàng B ${tag}`);
    await a(doc(pidB, 300));
    expect(await row(productB.id)).toMatchObject({ state: 'published', contentVersion: 300 });
    expect((await new CatalogService(prisma, undefined, flagsOn).getBySlug(productB.slug)).name).toBe('Tựa MSS v300');
  });

  it('xoá sản phẩm: dòng bổ sung đi theo (CASCADE)', async () => {
    const tmp = await prisma.product.create({
      data: { brand: 'IT', slug: `itce-tmp-${tag}`, name: 'Tạm', description: 'x', basePrice: 1, pancakeId: `itce-t-${tag}` },
      select: { id: true },
    });
    await new MssCatalogService(prisma, noClient, health).applyDocs([doc(`itce-t-${tag}`, 1)], stats(), ctx);
    expect(await row(tmp.id)).not.toBeNull();
    await prisma.product.delete({ where: { id: tmp.id } });
    expect(await row(tmp.id)).toBeNull();
  });
});
