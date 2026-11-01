import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { CampaignsService } from '../../src/modules/campaigns/campaigns.service';
import { CampaignsAdminService } from '../../src/modules/campaigns/campaigns-admin.service';
import { randCode, warmPool } from './helpers';

/**
 * Chiến dịch (P11) trên Postgres thật: đọc công khai theo lịch/vị trí/đối tượng, và hai nhân viên cùng sửa một chiến dịch.
 */
describe('Campaigns (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let admin: CampaignsAdminService;
  let pub: CampaignsService;
  const DAY = 86_400_000;
  const tag = randCode(6).toLowerCase();
  const IMAGE = 'https://example.test/banner.jpg';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    admin = new CampaignsAdminService(prisma);
    pub = new CampaignsService(prisma, new CatalogService(prisma));
  });

  afterAll(async () => {
    await prisma.campaign.deleteMany({ where: { slug: { startsWith: `it-cmp-${tag}` } } });
    await prisma.coupon.deleteMany({ where: { code: { startsWith: `ITCMP${tag.toUpperCase()}` } } });
    await prisma.product.deleteMany({ where: { slug: { startsWith: `it-cmp-${tag}` } } });
    await moduleRef?.close();
  });

  async function product(name: string, suffix: string) {
    const code = `${tag}-${suffix}`;
    const p = await prisma.product.create({
      data: { pancakeId: `it-cmp-p-${code}`, brand: 'IT', slug: `it-cmp-${code}`, name, description: 'IT', basePrice: 100_000 },
    });
    await prisma.variation.create({
      data: { pancakeId: `it-cmp-v-${code}`, productId: p.id, sku: `CMP-${code}`, name: 'Chai', attributes: {}, retailPrice: 100_000, salePrice: 80_000, stock: 5 },
    });
    return p;
  }

  const base = (slug: string, over: Record<string, unknown> = {}) => ({
    title: `Chiến dịch ${slug}`,
    slug: `it-cmp-${tag}-${slug}`,
    placement: 'HOME_TOP' as const,
    image: IMAGE,
    startAt: new Date(Date.now() - DAY).toISOString(),
    endAt: new Date(Date.now() + DAY).toISOString(),
    ...over,
  });

  it('hai lệnh tạo cùng slug cùng lúc: một lệnh được, lệnh kia báo trùng slug (409), trong DB chỉ có một dòng', async () => {
    const dto = base('trung');
    const results = await Promise.allSettled([admin.create(dto), admin.create(dto)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
    expect(failed.reason).toBeInstanceOf(ConflictException);
    expect(await prisma.campaign.count({ where: { slug: dto.slug } })).toBe(1);
  });

  it('hai nhân viên cùng thay danh sách sản phẩm: kết quả là đúng một trong hai danh sách, không trộn', async () => {
    const created = await admin.create(base('sp'));
    const [a, b, c, d] = await Promise.all([product('A', 'a'), product('B', 'b'), product('C', 'c'), product('D', 'd')]);
    await Promise.allSettled([admin.setProducts(created.id, [a.id, b.id]), admin.setProducts(created.id, [c.id, d.id])]);
    const left = (await prisma.campaignProduct.findMany({ where: { campaignId: created.id }, orderBy: { sortOrder: 'asc' } })).map((r) => r.productId);
    expect([[a.id, b.id], [c.id, d.id]]).toContainEqual(left);
  });

  it('đọc công khai: chỉ chiến dịch đang chạy đúng vị trí và đối tượng; hết hạn hay tắt thì 404; sản phẩm đúng thứ tự gửi lên', async () => {
    const live = await admin.create(base('live', { audience: 'NEW' }));
    await admin.create(base('old', { endAt: new Date(Date.now() - 1000).toISOString(), startAt: new Date(Date.now() - DAY).toISOString() }));
    await admin.create(base('off', { isActive: false }));
    await admin.create(base('offers', { placement: 'OFFERS_TOP' }));
    await admin.create(base('cu', { audience: 'RETURNING' }));

    const forNew = (await pub.listPublic('HOME_TOP', 'NEW')).map((b) => b.slug).filter((s) => s.startsWith(`it-cmp-${tag}`));
    expect(forNew).toContain(`it-cmp-${tag}-live`);
    expect(forNew).not.toContain(`it-cmp-${tag}-old`);
    expect(forNew).not.toContain(`it-cmp-${tag}-off`);
    expect(forNew).not.toContain(`it-cmp-${tag}-offers`);
    expect(forNew).not.toContain(`it-cmp-${tag}-cu`);

    await expect(pub.getPublic(`it-cmp-${tag}-old`)).rejects.toBeInstanceOf(NotFoundException);
    await expect(pub.getPublic(`it-cmp-${tag}-off`)).rejects.toBeInstanceOf(NotFoundException);
    expect((await pub.getPublic(`it-cmp-${tag}-live`)).productCount).toBe(0);

    const [p1, p2, p3] = await Promise.all([product('Một', 'p1'), product('Hai', 'p2'), product('Ba', 'p3')]);
    await admin.setProducts(live.id, [p3.id, p1.id, p2.id]);
    const page = await pub.getProducts(`it-cmp-${tag}-live`, 1, 2);
    expect(page.data.map((x) => x.id)).toEqual([p3.id, p1.id]);
    expect(page.meta.total).toBe(3);
    expect((await pub.getPublic(`it-cmp-${tag}-live`)).productCount).toBe(3);
  });

  it('mã gắn kèm: chỉ hiện mã công khai còn hạn; mã đã hết lượt hay hết hạn bị ẩn khỏi trang', async () => {
    const c = await admin.create(base('coupon'));
    const mk = (suffix: string, over: Record<string, unknown> = {}) =>
      prisma.coupon.create({
        data: {
          code: `ITCMP${tag.toUpperCase()}${suffix}`,
          type: 'PERCENT',
          value: 10,
          scope: 'PUBLIC',
          startAt: new Date(Date.now() - DAY),
          endAt: new Date(Date.now() + DAY),
          ...over,
        },
      });
    const ok = await mk('OK');
    const full = await mk('FULL', { usageLimit: 1, usedCount: 1 });
    const expired = await mk('OLD', { endAt: new Date(Date.now() - 1000) });
    await admin.setCoupons(c.id, [ok.code, full.code, expired.code]);
    const detail = await pub.getPublic(`it-cmp-${tag}-coupon`);
    expect(detail.coupons.map((x) => x.code)).toEqual([ok.code]);
  });
});
