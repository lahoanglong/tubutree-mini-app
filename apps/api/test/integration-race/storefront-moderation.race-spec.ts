import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { StorefrontType, UserRole } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { MerchantService } from '../../src/modules/merchant/merchant.service';
import { StorefrontAdminService } from '../../src/modules/storefront/storefront-admin.service';
import { assertIdentifierAvailable } from '../../src/modules/storefront/identifier-validation';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { ComboService } from '../../src/modules/storefront/combo.service';
import { resolveAttribution } from '../../src/modules/checkout/attribution';
import { createUser as createUserRow, randCode, setConfig, summarize, warmPool } from './helpers';

/**
 * Kiểm duyệt gian hàng (D3-02) trên Postgres thật: bộ lọc khách-thấy-được (khoá tài khoản, CTV bị hạ vai trò, gỡ đăng, cờ duyệt),
 * và các lệnh admin có điều kiện trạng thái trong WHERE (hai admin cùng bấm, chủ đăng chen giữa lúc admin gỡ).
 */
describe('Kiểm duyệt gian hàng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let config: SystemConfigService;
  let svc: StorefrontService;
  let admin: StorefrontAdminService;
  let notify: jest.Mock;
  const KEYS = ['storefront.require_approval', 'storefront.subdomain_enabled', 'affiliate.commission_eligible_roles'];
  let saved: { key: string; value: unknown }[] = [];
  const created = { userIds: [] as string[], storefrontIds: [] as string[], brandIds: [] as string[], productIds: [] as string[] };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    config = moduleRef.get(SystemConfigService);
    await warmPool(prisma);
    saved = await prisma.systemConfig.findMany({ where: { key: { in: KEYS } } });
    notify = jest.fn().mockResolvedValue(undefined);
    rebuild();
  });

  /** SystemConfigService cache 60 giây: sau khi đổi khoá phải dựng service mới để đọc lại. */
  function rebuild() {
    config = new SystemConfigService(prisma);
    const affiliate = {
      getPublicTier: async () => null,
      commissionEligibleRoles: async () => {
        const v = await config.get<string[]>('affiliate.commission_eligible_roles', ['AFFILIATE', 'DEALER']);
        return new Set(v as UserRole[]);
      },
    };
    svc = new StorefrontService(prisma, config, affiliate as never);
    admin = new StorefrontAdminService(prisma, config, affiliate as never, { notify } as never);
  }

  beforeEach(async () => {
    notify.mockClear();
    await prisma.systemConfig.deleteMany({ where: { key: { in: KEYS } } });
    rebuild();
  });

  afterAll(async () => {
    if (prisma) {
      const { userIds, storefrontIds, brandIds, productIds } = created;
      await prisma.$transaction([
        prisma.referralTouch.deleteMany({ where: { userId: { in: userIds } } }),
        prisma.storefrontItem.deleteMany({ where: { collection: { storefrontId: { in: storefrontIds } } } }),
        prisma.storefrontCollection.deleteMany({ where: { storefrontId: { in: storefrontIds } } }),
        prisma.storefront.deleteMany({ where: { id: { in: storefrontIds } } }),
        prisma.brand.deleteMany({ where: { id: { in: brandIds } } }),
        prisma.variation.deleteMany({ where: { productId: { in: productIds } } }),
        prisma.product.deleteMany({ where: { id: { in: productIds } } }),
        prisma.user.deleteMany({ where: { id: { in: userIds } } }),
        prisma.systemConfig.deleteMany({ where: { key: { in: KEYS } } }),
      ]);
      for (const c of saved) await setConfig(prisma, c.key, c.value as never);
    }
    await moduleRef?.close();
  });

  async function user(role: UserRole, extra: Record<string, unknown> = {}) {
    const u = await createUserRow(prisma, { role, ...extra });
    created.userIds.push(u.id);
    return u;
  }

  async function store(owner: { id: string; referralCode: string } | null, over: Record<string, unknown> = {}) {
    const slug = `it-sm-${randCode(8).toLowerCase()}`;
    const sf = await prisma.storefront.create({
      data: {
        type: 'CTV' as StorefrontType,
        slug,
        title: `Shop ${slug}`,
        ownerUserId: owner?.id ?? null,
        isPublished: true,
        publishedAt: new Date(),
        ...over,
      },
    });
    created.storefrontIds.push(sf.id);
    return sf;
  }

  async function addItem(storefrontId: string) {
    const p = await prisma.product.create({
      data: {
        isActive: true, brand: 'IT', slug: `it-sm-p-${randCode(8).toLowerCase()}`, name: 'SP IT', description: 'IT', basePrice: 1000,
        variations: { create: [{ sku: `ITSM-${randCode(8)}`, pancakeId: `itsm-${randCode(8)}`, name: 'v', attributes: {}, retailPrice: 1000, stock: 5 }] },
      },
    });
    created.productIds.push(p.id);
    const col = await prisma.storefrontCollection.create({ data: { storefrontId, title: 'Nổi bật' } });
    await prisma.storefrontItem.create({ data: { collectionId: col.id, productId: p.id } });
  }

  const visible = (slug: string) => svc.getPublicBySlug(slug).then(() => true, (e) => (e instanceof NotFoundException ? false : Promise.reject(e)));

  describe('khách thấy gian hàng nào', () => {
    it('CTV hợp lệ hiện; CTV bị hạ về khách thường ẩn; MERCHANT của cùng chủ hạ vai trò vẫn hiện', async () => {
      const ctv = await user('AFFILIATE');
      const demoted = await user('CUSTOMER');
      const merchantOwner = await user('CUSTOMER');
      const a = await store(ctv);
      const b = await store(demoted);
      const m = await store(merchantOwner, { type: 'MERCHANT', isPartner: true });
      expect(await visible(a.slug)).toBe(true);
      expect(await visible(b.slug)).toBe(false);
      expect(await visible(m.slug)).toBe(true);
    });

    it('đổi khoá affiliate.commission_eligible_roles: bớt DEALER thì gian hàng CTV của đại lý ẩn', async () => {
      const dealer = await user('DEALER');
      const s = await store(dealer);
      expect(await visible(s.slug)).toBe(true);
      await setConfig(prisma, 'affiliate.commission_eligible_roles', ['AFFILIATE']);
      rebuild();
      expect(await visible(s.slug)).toBe(false);
    });

    it('chủ bị khoá thì ẩn, mở khoá thì hiện lại; gian hàng không chủ (nhãn hàng) không bị ảnh hưởng', async () => {
      const owner = await user('AFFILIATE');
      const s = await store(owner);
      const brand = await store(null, { type: 'BRAND' });
      await prisma.user.update({ where: { id: owner.id }, data: { isBlocked: true } });
      expect(await visible(s.slug)).toBe(false);
      expect(await visible(brand.slug)).toBe(true);
      await prisma.user.update({ where: { id: owner.id }, data: { isBlocked: false } });
      expect(await visible(s.slug)).toBe(true);
    });

    it('gian hàng CTV của ADMIN vẫn hiện, không có lý do ẩn, và ghi công gian hàng nhưng không ghi công hoa hồng cho ADMIN', async () => {
      const adminOwner = await user('ADMIN');
      const buyer = await user('CUSTOMER');
      const s = await store(adminOwner);
      expect(await visible(s.slug)).toBe(true);
      expect((await svc.getMine(adminOwner.id)).publicHiddenReason).toBeNull();
      expect((await svc.getPublicList()).map((r) => r.slug)).toContain(s.slug);
      const affiliate = Object.assign(Object.create(AffiliateService.prototype), { prisma, config }) as AffiliateService;
      expect(await resolveAttribution(prisma, affiliate, buyer.id, { storefrontSlug: s.slug })).toMatchObject({ referrerUserId: null, storefront: { id: s.id } });
    });

    it('cờ storefront.require_approval: bật thì CTV chưa duyệt ẩn, đã duyệt hiện, đối tác luôn hiện; tắt thì hiện hết', async () => {
      const owner = await user('AFFILIATE');
      const owner2 = await user('AFFILIATE');
      const dealer = await user('DEALER');
      const unapproved = await store(owner);
      const approved = await store(owner2, { approvedAt: new Date() });
      const partner = await store(dealer, { type: 'MERCHANT', isPartner: true });
      expect(await visible(unapproved.slug)).toBe(true);
      await setConfig(prisma, 'storefront.require_approval', true);
      rebuild();
      expect(await visible(unapproved.slug)).toBe(false);
      expect(await visible(approved.slug)).toBe(true);
      expect(await visible(partner.slug)).toBe(true);
    });

    it('sitemap không liệt kê gian hàng ẩn', async () => {
      const ok = await store(await user('AFFILIATE'));
      const demoted = await store(await user('CUSTOMER'));
      const down = await store(await user('AFFILIATE'), { takenDownAt: new Date(), isPublished: false });
      const slugs = (await svc.getPublicList()).map((r) => r.slug);
      expect(slugs).toContain(ok.slug);
      expect(slugs).not.toContain(demoted.slug);
      expect(slugs).not.toContain(down.slug);
    });
  });

  describe('giỏ và checkout không dùng gian hàng đang ẩn (D3-02)', () => {
    async function addCombo(storefrontId: string) {
      const productIds: string[] = [];
      const col = await prisma.storefrontCollection.create({ data: { storefrontId, title: 'Combo', kind: 'COMBO', comboDiscountPct: 10 } });
      for (let i = 0; i < 2; i++) {
        const p = await prisma.product.create({
          data: {
            isActive: true, brand: 'IT', slug: `it-sm-c-${randCode(8).toLowerCase()}`, name: 'SP combo IT', description: 'IT', basePrice: 1000,
            variations: { create: [{ sku: `ITSMC-${randCode(8)}`, pancakeId: `itsmc-${randCode(8)}`, name: 'v', attributes: {}, retailPrice: 1000, stock: 5 }] },
          },
        });
        created.productIds.push(p.id);
        await prisma.storefrontItem.create({ data: { collectionId: col.id, productId: p.id } });
        productIds.push(p.id);
      }
      return productIds;
    }

    const realAffiliate = () => Object.assign(Object.create(AffiliateService.prototype), { prisma, config }) as AffiliateService;
    const comboFor = (slug: string, productIds: string[]) =>
      new ComboService(prisma, config).computeForStorefront(slug, productIds.map((productId, i) => ({ variationId: `v${i}`, productId, total: 1000 })));

    it('gian hàng hiện: có combo, ghi công gian hàng và chủ gian hàng', async () => {
      const owner = await user('AFFILIATE');
      const buyer = await user('CUSTOMER');
      const sf = await store(owner);
      const products = await addCombo(sf.id);
      expect((await comboFor(sf.slug, products)).total).toBe(200);
      const out = await resolveAttribution(prisma, realAffiliate(), buyer.id, { storefrontSlug: sf.slug });
      expect(out.storefront?.id).toBe(sf.id);
      expect(out.referrerUserId).toBe(owner.id);
    });

    it.each([
      ['chủ bị khoá', async () => store(await user('AFFILIATE', { isBlocked: true }))],
      ['chủ bị hạ về khách thường', async () => store(await user('CUSTOMER'))],
      ['admin đã gỡ', async () => store(await user('AFFILIATE'), { takenDownAt: new Date(), isPublished: false })],
      [
        'CTV chưa duyệt khi cờ duyệt bật',
        async () => {
          await setConfig(prisma, 'storefront.require_approval', true);
          rebuild();
          return store(await user('AFFILIATE'));
        },
      ],
    ])('%s → không combo, không ghi công gian hàng, không ghi công chủ gian hàng', async (_name, make) => {
      const buyer = await user('CUSTOMER');
      const sf = await make();
      const products = await addCombo(sf.id);
      expect(await comboFor(sf.slug, products)).toEqual({ total: 0, perLine: {} });
      const bySlug = await resolveAttribution(prisma, realAffiliate(), buyer.id, { storefrontSlug: sf.slug });
      expect(bySlug).toEqual({ referrerUserId: null, storefront: null });
      await prisma.referralTouch.create({ data: { userId: buyer.id, referrerUserId: sf.ownerUserId!, storefrontSlug: sf.slug, kind: 'ctv', expiresAt: new Date(Date.now() + 86_400_000) } });
      const byTouch = await resolveAttribution(prisma, realAffiliate(), buyer.id, {});
      expect(byTouch.storefront).toBeNull();
    });

    it('người giới thiệu bị khoá không được ghi công đơn mới, mở khoá thì ghi công lại', async () => {
      const ctv = await user('AFFILIATE');
      const buyer = await user('CUSTOMER');
      const affiliate = realAffiliate();
      expect((await resolveAttribution(prisma, affiliate, buyer.id, { referralCode: ctv.referralCode })).referrerUserId).toBe(ctv.id);
      await prisma.user.update({ where: { id: ctv.id }, data: { isBlocked: true } });
      expect((await resolveAttribution(prisma, affiliate, buyer.id, { referralCode: ctv.referralCode })).referrerUserId).toBeNull();
      await prisma.user.update({ where: { id: ctv.id }, data: { isBlocked: false } });
      expect((await resolveAttribution(prisma, affiliate, buyer.id, { referralCode: ctv.referralCode })).referrerUserId).toBe(ctv.id);
    });
  });

  describe('lệnh admin', () => {
    it('gỡ đăng ẩn gian hàng khỏi trang công khai, đăng lại hiện lại; chủ không tự đăng lại được khi đang bị gỡ', async () => {
      const owner = await user('AFFILIATE');
      const s = await store(owner);
      await addItem(s.id);
      const adminUser = await user('ADMIN');
      await admin.takeDown(adminUser.id, s.id, 'Ảnh vi phạm');
      expect(await visible(s.slug)).toBe(false);
      await expect(svc.publishMine(owner.id, true)).rejects.toBeInstanceOf(ForbiddenException);
      const mine = await svc.getMine(owner.id);
      expect(mine.publicHiddenReason).toContain('Ảnh vi phạm');
      await admin.reinstate(adminUser.id, s.id);
      expect(await visible(s.slug)).toBe(true);
      expect(notify.mock.calls.map((c) => c[1])).toEqual(['STOREFRONT_TAKEN_DOWN', 'STOREFRONT_REINSTATED']);
    });

    it('gian hàng nháp bị gỡ rồi đăng lại vẫn là nháp', async () => {
      const owner = await user('AFFILIATE');
      const s = await store(owner, { isPublished: false, publishedAt: null });
      const adminUser = await user('ADMIN');
      await admin.takeDown(adminUser.id, s.id, 'x');
      await admin.reinstate(adminUser.id, s.id);
      const after = await prisma.storefront.findUniqueOrThrow({ where: { id: s.id } });
      expect(after).toMatchObject({ isPublished: false, takenDownAt: null, takenDownReason: null });
    });

    it('5 admin cùng gỡ một gian hàng: chỉ một lệnh thắng, một tin báo chủ, lý do của người thắng được giữ', async () => {
      const owner = await user('AFFILIATE');
      const s = await store(owner);
      const ids = await Promise.all([1, 2, 3, 4, 5].map(() => user('ADMIN').then((u) => u.id)));
      const results = await Promise.allSettled(ids.map((id, i) => admin.takeDown(id, s.id, `Lý do ${i}`)));
      const sum = summarize(results);
      expect(sum.errors).toEqual([]);
      expect(sum.fulfilled).toHaveLength(5);
      expect(notify.mock.calls.filter((c) => c[1] === 'STOREFRONT_TAKEN_DOWN')).toHaveLength(1);
      const after = await prisma.storefront.findUniqueOrThrow({ where: { id: s.id } });
      expect(ids).toContain(after.takenDownById);
      expect(after.takenDownReason).toBe(`Lý do ${ids.indexOf(after.takenDownById!)}`);
    });

    it('chủ đăng chen giữa lúc admin gỡ: không bao giờ kết thúc ở trạng thái vừa đăng vừa bị gỡ', async () => {
      for (let round = 0; round < 6; round++) {
        const owner = await user('AFFILIATE');
        const s = await store(owner, { isPublished: false, publishedAt: null });
        await addItem(s.id);
        const adminUser = await user('ADMIN');
        await Promise.allSettled([svc.publishMine(owner.id, true), admin.takeDown(adminUser.id, s.id, 'Vi phạm')]);
        const after = await prisma.storefront.findUniqueOrThrow({ where: { id: s.id } });
        expect(after.takenDownAt).not.toBeNull();
        expect(after.isPublished).toBe(false);
      }
    });

    it('duyệt: hai lần bấm đồng thời chỉ báo chủ một lần và giữ mốc duyệt đầu; bỏ duyệt xoá mốc', async () => {
      const owner = await user('AFFILIATE');
      const s = await store(owner);
      const a1 = await user('ADMIN');
      const a2 = await user('ADMIN');
      await Promise.all([admin.setApproved(a1.id, s.id, true), admin.setApproved(a2.id, s.id, true)]);
      expect(notify.mock.calls.filter((c) => c[1] === 'STOREFRONT_APPROVED')).toHaveLength(1);
      const approved = await prisma.storefront.findUniqueOrThrow({ where: { id: s.id } });
      expect(approved.approvedAt).not.toBeNull();
      await admin.setApproved(a1.id, s.id, false);
      expect((await prisma.storefront.findUniqueOrThrow({ where: { id: s.id } })).approvedAt).toBeNull();
    });

    it('chỉ gian hàng CTV được duyệt: MERCHANT bị từ chối 400, không ghi mốc duyệt, không báo "CTV tuyển chọn"', async () => {
      const adminUser = await user('ADMIN');
      const m = await store(await user('CUSTOMER'), { type: 'MERCHANT', isPartner: true });
      await expect(admin.setApproved(adminUser.id, m.id, true)).rejects.toBeInstanceOf(BadRequestException);
      expect((await prisma.storefront.findUniqueOrThrow({ where: { id: m.id } })).approvedAt).toBeNull();
      expect(notify).not.toHaveBeenCalled();
    });

    it('đăng lại gian hàng khi chủ đang bị khoá: bỏ dấu gỡ nhưng không báo "hiển thị lại với khách"; mở khoá rồi gỡ và đăng lại thì báo', async () => {
      const adminUser = await user('ADMIN');
      const owner = await user('AFFILIATE', { isBlocked: true });
      const s = await store(owner, { takenDownAt: new Date(), isPublished: false, takenDownReason: 'x' });
      const out = await admin.reinstate(adminUser.id, s.id);
      expect(out).toMatchObject({ takenDownAt: null, publicVisible: false });
      expect(notify).not.toHaveBeenCalled();
      await prisma.user.update({ where: { id: owner.id }, data: { isBlocked: false } });
      await admin.takeDown(adminUser.id, s.id, 'lần hai');
      notify.mockClear();
      expect(await admin.reinstate(adminUser.id, s.id)).toMatchObject({ publicVisible: true });
      expect(notify.mock.calls.map((c) => c[1])).toEqual(['STOREFRONT_REINSTATED']);
    });

    it('danh sách lọc theo trạng thái và tìm theo SĐT chủ', async () => {
      const phone = `09${randCode(8).replace(/\D/g, '0').slice(0, 8)}`;
      const owner = await user('AFFILIATE', { phone });
      const s = await store(owner);
      const adminUser = await user('ADMIN');
      const pending = await admin.list({ page: 1, limit: 50, status: 'PENDING_APPROVAL', q: phone });
      expect(pending.data.map((r) => r.id)).toEqual([s.id]);
      expect(pending.data[0]).toMatchObject({ approved: false, publicVisible: true, owner: { phone } });
      await admin.takeDown(adminUser.id, s.id, 'x');
      expect((await admin.list({ page: 1, limit: 50, status: 'PENDING_APPROVAL', q: phone })).data).toHaveLength(0);
      const down = await admin.list({ page: 1, limit: 50, status: 'TAKEN_DOWN', q: phone });
      expect(down.data[0]).toMatchObject({ id: s.id, publicVisible: false });
      expect(down.data[0]!.hiddenReason).toContain('gỡ');
    });
  });

  describe('từ dành riêng', () => {
    it('subdomain trùng tên nhãn hàng bị chặn; nhãn gắn với chính gian hàng thì được dùng', async () => {
      const brandSlug = `it-sm-brand-${randCode(6).toLowerCase()}`;
      const brand = await prisma.brand.create({ data: { slug: brandSlug, name: `IT Brand ${randCode(6)}` } });
      created.brandIds.push(brand.id);
      const other = await store(await user('AFFILIATE'));
      await expect(assertIdentifierAvailable(prisma, brandSlug, other.id)).rejects.toThrow('nhãn hàng');
      await expect(assertIdentifierAvailable(prisma, brand.name.toUpperCase(), other.id)).rejects.toThrow('nhãn hàng');
      const brandStore = await store(null, { type: 'BRAND', brandId: brand.id });
      await expect(assertIdentifierAvailable(prisma, brandSlug, brandStore.id)).resolves.toBeUndefined();
    });
  });

  describe('gian hàng đối tác tự tạo và cờ subdomain (D3-08, D3-11)', () => {
    it('gian hàng tạo từ cổng đối tác là nháp: không hiện với khách, không vào danh sách sitemap; đăng được khi có sản phẩm', async () => {
      const dealer = await user('DEALER');
      const portal = new MerchantService(prisma, {} as never, undefined, config);
      const sf = await portal.getOrCreateStore(dealer.id);
      created.storefrontIds.push(sf.id);
      expect(sf).toMatchObject({ isPublished: false, publishedAt: null });
      expect(await visible(sf.slug)).toBe(false);
      expect((await svc.getPublicList()).map((r) => r.slug)).not.toContain(sf.slug);
      await expect(portal.publishStore(dealer.id, true)).rejects.toThrow('ít nhất 1 sản phẩm');
      await addItem(sf.id);
      await expect(portal.publishStore(dealer.id, true)).resolves.toMatchObject({ isPublished: true });
      expect(await visible(sf.slug)).toBe(true);
      expect((await svc.getPublicList()).map((r) => r.slug)).toContain(sf.slug);
    });

    it('gian hàng cũ đang đăng mà 0 sản phẩm: /merchant đổi tên vẫn lưu được (luôn gửi isPublished) và giữ mốc đăng', async () => {
      const dealer = await user('DEALER');
      const publishedAt = new Date('2026-09-01T00:00:00Z');
      const sf = await store(dealer, { type: 'MERCHANT', isPartner: true, publishedAt });
      const portal = new MerchantService(prisma, {} as never, undefined, config);
      const saved = await portal.updateStore(dealer.id, { title: 'Tên mới', isPublished: true });
      expect(saved).toMatchObject({ id: sf.id, title: 'Tên mới', isPublished: true });
      expect((await prisma.storefront.findUniqueOrThrow({ where: { id: sf.id } })).publishedAt).toEqual(publishedAt);
    });

    it('lưu lại subdomain đang có (thuộc từ khoá cấm, gian hàng cũ) không bị kiểm lại ở cả /merchant lẫn trình dựng; đổi sang từ cấm thì bị chặn', async () => {
      const dealer = await user('DEALER');
      const sf = await store(dealer, { type: 'MERCHANT', isPartner: true, subdomain: 'admin' });
      const portal = new MerchantService(prisma, {} as never, undefined, config);
      expect(await portal.updateStore(dealer.id, { subdomain: 'admin', title: 'Tên mới' })).toMatchObject({ id: sf.id, title: 'Tên mới', subdomain: 'admin' });
      const ctv = await user('AFFILIATE');
      const own = await store(ctv, { subdomain: 'api' });
      expect(await svc.updateMine(ctv.id, { subdomain: 'API', title: 'Shop mới' })).toMatchObject({ id: own.id, title: 'Shop mới', subdomain: 'api' });
      await expect(svc.updateMine(ctv.id, { subdomain: 'www' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(portal.updateStore(dealer.id, { subdomain: 'cdn' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cờ subdomain tắt: trang công khai, builder và cổng đối tác không lộ subdomain; bật cờ thì lộ', async () => {
      const owner = await user('AFFILIATE');
      const sf = await store(owner, { subdomain: `it-sd-${randCode(6).toLowerCase()}`, customDomain: `it-${randCode(6).toLowerCase()}.example.vn` });
      const portal = new MerchantService(prisma, {} as never, undefined, config);
      expect(await svc.getPublicBySlug(sf.slug)).toMatchObject({ subdomain: null, customDomain: null, subdomainEnabled: false });
      expect(await svc.getMine(owner.id)).toMatchObject({ subdomain: null, customDomain: null, subdomainEnabled: false });
      expect(await portal.presentStore(sf)).toMatchObject({ subdomain: null, subdomainEnabled: false });
      await setConfig(prisma, 'storefront.subdomain_enabled', true);
      rebuild();
      const portalOn = new MerchantService(prisma, {} as never, undefined, config);
      expect(await svc.getPublicBySlug(sf.slug)).toMatchObject({ subdomain: sf.subdomain, customDomain: sf.customDomain, subdomainEnabled: true });
      expect(await svc.getMine(owner.id)).toMatchObject({ subdomain: sf.subdomain, subdomainEnabled: true });
      expect(await portalOn.presentStore(sf)).toMatchObject({ subdomain: sf.subdomain, subdomainEnabled: true });
    });
  });

  describe('ảnh base64 của gian hàng (D3-10)', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    it('JSON công khai không chứa base64; endpoint ảnh trả đúng byte; gỡ đăng thì ảnh cũng 404', async () => {
      const owner = await user('AFFILIATE');
      const adminUser = await user('ADMIN');
      const sf = await store(owner, { avatarUrl: PNG, coverUrl: 'https://cdn.example/c.jpg' });
      const pub = await svc.getPublicBySlug(sf.slug);
      expect(JSON.stringify(pub)).not.toContain('base64');
      expect(pub.coverUrl).toBe('https://cdn.example/c.jpg');
      const version = pub.avatarUrl!.split('v=')[1];
      const img = await svc.getPublicImage(sf.id, 'avatar', version);
      expect(img).toMatchObject({ mime: 'image/png', versionOk: true });
      expect(img.data.equals(Buffer.from(PNG.split(',')[1]!, 'base64'))).toBe(true);
      await expect(svc.getPublicImage(sf.id, 'cover', 'x')).rejects.toBeInstanceOf(NotFoundException);
      await admin.takeDown(adminUser.id, sf.id, 'x');
      await expect(svc.getPublicImage(sf.id, 'avatar', version)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
