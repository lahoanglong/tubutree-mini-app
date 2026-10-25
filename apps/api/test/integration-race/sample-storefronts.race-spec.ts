import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { removeSampleStorefronts, seedSampleStorefronts, type SampleStorefrontDef } from '../../src/modules/storefront/sample-storefronts';
import { createOrder, randCode, warmPool } from './helpers';

/** Seed + gỡ gian hàng mẫu trên Postgres thật, và nhãn công khai của gian hàng mẫu. */
describe('sample storefronts (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: StorefrontService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = new StorefrontService(prisma, moduleRef.get(SystemConfigService), { getPublicTier: async () => ({ name: 'Bạc', emoji: 'x' }), commissionEligibleRoles: async () => ['AFFILIATE', 'DEALER'] } as never);
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  async function setup(over: Partial<SampleStorefrontDef> = {}) {
    const key = randCode(6).toLowerCase();
    const slug = `itsample${key}`;
    const product = await prisma.product.create({ data: { name: `SP mẫu ${key}`, slug: `sp-mau-${key}`, basePrice: 10_000, brand: 'IT', description: 'IT', isActive: true } });
    const def: SampleStorefrontDef = {
      slug, title: 'Mẫu IT', headerNote: 'x', themeColor: '#16a34a', type: 'MERCHANT', ownerRole: 'DEALER', ownerName: 'Chủ mẫu IT', isPartner: true,
      collections: [{ title: 'Bộ', items: [{ productSlug: product.slug }] }],
      ...over,
    };
    return { def, slug, product };
  }

  async function cleanup(slug: string, productId: string) {
    await removeSampleStorefronts(prisma);
    await prisma.order.deleteMany({ where: { user: { metadata: { path: ['sampleStorefront'], equals: true } } } });
    await prisma.user.deleteMany({ where: { metadata: { path: ['sampleStorefront'], equals: true } } }).catch(() => undefined);
    await prisma.storefrontItem.deleteMany({ where: { productId } });
    await prisma.product.delete({ where: { id: productId } }).catch(() => undefined);
    await prisma.storefront.deleteMany({ where: { slug } });
  }

  it('seed idempotent; công khai không mang nhãn duyệt, đối tác, bậc, kho; gỡ sạch', async () => {
    const { def, slug, product } = await setup();
    try {
      const first = await seedSampleStorefronts(prisma, [def]);
      expect(first[0]).toMatchObject({ action: 'created', items: 1 });
      const second = await seedSampleStorefronts(prisma, [def]);
      expect(second[0]).toMatchObject({ action: 'updated' });
      expect(await prisma.storefront.count({ where: { slug } })).toBe(1);

      const pub = await svc.getPublicBySlug(slug);
      expect(pub.isSample).toBe(true);
      expect(pub.approved).toBe(false);
      expect(pub.isPartner).toBe(false);
      expect(pub.ownerTier).toBeNull();
      expect(pub).not.toHaveProperty('warehouseAddress');
      expect((await svc.getPublicList()).some((r: { slug: string }) => r.slug === slug)).toBe(false);

      const removed = await removeSampleStorefronts(prisma);
      expect(removed.storefronts).toBeGreaterThanOrEqual(1);
      expect(await prisma.storefront.count({ where: { slug } })).toBe(0);
      expect(await prisma.user.count({ where: { referralCode: slug.toUpperCase() } })).toBe(0);
      expect((await removeSampleStorefronts(prisma)).storefronts).toBe(0);
    } finally {
      await cleanup(slug, product.id);
    }
  });

  it('chủ mẫu không xoá được (còn dữ liệu): hạ về CUSTOMER và đổi mã giới thiệu', async () => {
    const { def, slug, product } = await setup({ type: 'CTV', ownerRole: 'AFFILIATE', isPartner: false });
    try {
      await seedSampleStorefronts(prisma, [def]);
      const owner = await prisma.user.findUniqueOrThrow({ where: { referralCode: slug.toUpperCase() }, select: { id: true } });
      await createOrder(prisma, { userId: owner.id, status: 'CANCELLED' });
      const r = await removeSampleStorefronts(prisma);
      const after = await prisma.user.findUnique({ where: { id: owner.id }, select: { role: true, referralCode: true } });
      expect(after?.role).toBe('CUSTOMER');
      expect(after?.referralCode).not.toBe(slug.toUpperCase());
      expect(r.keptOwners).toContain(owner.id);
      expect(await prisma.storefront.count({ where: { slug } })).toBe(0);
    } finally {
      await cleanup(slug, product.id);
    }
  });
});
