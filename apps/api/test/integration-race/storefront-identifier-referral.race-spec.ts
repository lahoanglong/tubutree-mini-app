import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { MerchantService } from '../../src/modules/merchant/merchant.service';
import { resolvePublishedStorefront } from '../../src/modules/storefront/resolve-storefront';
import { createUser, randCode, setConfig, summarize, warmPool } from './helpers';

/**
 * DLSF-01: subdomain/slug gian hàng không được trùng mã giới thiệu của người khác, và link /s/<mã> luôn về đúng chủ mã dù dữ liệu cũ đã trùng.
 */
describe('Định danh gian hàng và mã giới thiệu (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let storefront: StorefrontService;
  let merchant: MerchantService;
  const userIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    await setConfig(prisma, 'storefront.require_approval', false);
    const config = new SystemConfigService(prisma);
    const affiliate = { getPublicTier: async () => null, commissionEligibleRoles: async () => new Set(['AFFILIATE', 'DEALER']) };
    storefront = new StorefrontService(prisma, config, affiliate as never);
    merchant = new MerchantService(prisma, {} as never, undefined, config);
  });

  afterAll(async () => {
    if (prisma) {
      const stores = await prisma.storefront.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
      await prisma.releasedStorefrontIdentifier.deleteMany({ where: { storefrontId: { in: stores.map((x) => x.id) } } });
      await prisma.storefrontCollection.deleteMany({ where: { storefront: { ownerUserId: { in: userIds } } } });
      await prisma.storefront.deleteMany({ where: { ownerUserId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await moduleRef?.close();
  });

  async function ctv() {
    const u = await createUser(prisma, { role: 'AFFILIATE' });
    userIds.push(u.id);
    return u;
  }

  it('CTV đặt subdomain bằng mã giới thiệu của người khác → bị chặn; đặt mã của chính mình thì được', async () => {
    const victim = await ctv();
    const attacker = await ctv();
    await storefront.getOrCreateMine(attacker.id);
    await expect(storefront.updateMine(attacker.id, { subdomain: victim.referralCode.toLowerCase() })).rejects.toBeInstanceOf(BadRequestException);
    await expect(storefront.updateMine(attacker.id, { subdomain: victim.referralCode })).rejects.toBeInstanceOf(BadRequestException);
    const own = await storefront.updateMine(attacker.id, { subdomain: attacker.referralCode.toLowerCase() });
    expect(own.subdomain).toBe(attacker.referralCode.toLowerCase());
  });

  it('cổng người bán: đổi subdomain sang mã người khác bị chặn', async () => {
    const victim = await ctv();
    const attacker = await ctv();
    await merchant.getOrCreateStore(attacker.id);
    await expect(merchant.updateStore(attacker.id, { subdomain: victim.referralCode.toLowerCase() } as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hồi quy: hai CTV song song cùng đặt một subdomain, đúng một người được (cột subdomain @unique giữ, không do mã mới)', async () => {
    const a = await ctv();
    const b = await ctv();
    await Promise.all([storefront.getOrCreateMine(a.id), storefront.getOrCreateMine(b.id)]);
    const name = `it-${randCode(8).toLowerCase()}`;
    const res = await Promise.allSettled([storefront.updateMine(a.id, { subdomain: name }), storefront.updateMine(b.id, { subdomain: name })]);
    const out = summarize(res);
    expect(out.fulfilled).toHaveLength(1);
    expect(out.rejected).toHaveLength(1);
    expect(await prisma.storefront.count({ where: { subdomain: name } })).toBe(1);
  });

  it('createStore: subdomain khởi tạo không lấy mã người khác đã chiếm sẵn, slug vẫn là mã của chủ', async () => {
    const victim = await ctv();
    const squatter = await ctv();
    await storefront.getOrCreateMine(squatter.id);
    // Dữ liệu cũ đã trùng: kẻ chiếm giữ subdomain = mã nạn nhân.
    await prisma.storefront.update({ where: { ownerUserId: squatter.id } as never, data: { subdomain: victim.referralCode.toLowerCase() } }).catch(async () => {
      await prisma.storefront.updateMany({ where: { ownerUserId: squatter.id }, data: { subdomain: victim.referralCode.toLowerCase() } });
    });
    const mine = await merchant.getOrCreateStore(victim.id);
    expect(mine.slug).toBe(victim.referralCode.toLowerCase());
    expect(mine.subdomain).not.toBe(victim.referralCode.toLowerCase());
  });

  it('createStore: hậu tố đầu tiên trùng mã giới thiệu của người khác thì nhảy sang hậu tố kế', async () => {
    const victim = await ctv();
    const code = victim.referralCode.toLowerCase();
    const squatter = await ctv();
    await storefront.getOrCreateMine(squatter.id);
    await prisma.storefront.updateMany({ where: { ownerUserId: squatter.id }, data: { subdomain: code } });
    const other = await createUser(prisma, { role: 'AFFILIATE', referralCode: `${code}-1`.toUpperCase() });
    userIds.push(other.id);
    const mine = await merchant.getOrCreateStore(victim.id);
    expect(mine.slug).toBe(code);
    expect(mine.subdomain).toBe(`${code}-2`);
  });

  it('createStore: hậu tố trùng slug của gian hàng khác hoặc đang trong thời gian chờ nhả thì nhảy sang hậu tố kế', async () => {
    const victim = await ctv();
    const code = victim.referralCode.toLowerCase();
    const squatter = await ctv();
    const sq = await storefront.getOrCreateMine(squatter.id);
    await prisma.storefront.update({ where: { id: sq.id }, data: { subdomain: code } });
    const holder = await ctv();
    const held = await storefront.getOrCreateMine(holder.id);
    await prisma.storefront.update({ where: { id: held.id }, data: { subdomain: `${code}-1` } });
    await prisma.releasedStorefrontIdentifier.create({ data: { value: `${code}-2`, storefrontId: sq.id, releasedAt: new Date() } });
    const mine = await merchant.getOrCreateStore(victim.id);
    expect(mine.subdomain).toBe(`${code}-3`);
  });

  it('tên miền riêng khớp trước nhãn đầu: subdomain của CTV khác trùng nhãn đầu không chiếm được trang tên miền riêng', async () => {
    const owner = await ctv();
    const other = await ctv();
    const label = `dm${randCode(6).toLowerCase()}`;
    const a = await storefront.getOrCreateMine(owner.id);
    await prisma.storefront.update({ where: { id: a.id }, data: { customDomain: `${label}.vn`, isPublished: true, publishedAt: new Date() } });
    const b = await storefront.getOrCreateMine(other.id);
    await prisma.storefront.update({ where: { id: b.id }, data: { subdomain: label, isPublished: true, publishedAt: new Date() } });
    const page = await storefront.getPublicByHost(`${label}.vn`);
    expect(page.id).toBe(a.id);
  });

  it('ký tự đại diện của ILIKE không khớp gian hàng nào', async () => {
    const owner = await ctv();
    const s = await storefront.getOrCreateMine(owner.id);
    await prisma.storefront.update({ where: { id: s.id }, data: { isPublished: true, publishedAt: new Date() } });
    const vis = { eligibleRoles: ['AFFILIATE', 'DEALER'], requireApproval: false } as const;
    for (const wild of ['%', '_', 'a%', '%%%']) {
      expect(await resolvePublishedStorefront(prisma, vis, wild)).toBeNull();
    }
  });

  it('dữ liệu cũ đã trùng: /s/<mã> và checkout về đúng chủ mã (slug thắng subdomain)', async () => {
    const victim = await ctv();
    const squatter = await ctv();
    const code = victim.referralCode.toLowerCase();
    const squat = await storefront.getOrCreateMine(squatter.id);
    await prisma.storefront.update({ where: { id: squat.id }, data: { subdomain: code, isPublished: true, publishedAt: new Date() } });
    const own = await storefront.getOrCreateMine(victim.id);
    await prisma.storefront.update({ where: { id: own.id }, data: { isPublished: true, publishedAt: new Date() } });
    const page = await storefront.getPublicBySlug(code);
    expect(page.id).toBe(own.id);
    expect(page.referralCode).toBe(victim.referralCode);
    const resolved = await resolvePublishedStorefront(prisma, { eligibleRoles: ['AFFILIATE', 'DEALER'], requireApproval: false }, code);
    expect(resolved?.id).toBe(own.id);
    const byHost = await storefront.getPublicByHost(`${code}.tubutree.com`);
    expect(byHost.id).toBe(own.id);
  });

  async function squatCode(victimCode: string) {
    const squatter = await ctv();
    const squat = await storefront.getOrCreateMine(squatter.id);
    await prisma.storefront.update({ where: { id: squat.id }, data: { subdomain: victimCode, isPublished: true, publishedAt: new Date() } });
    return squat;
  }

  it('dữ liệu cũ đã trùng, gian hàng của chủ mã đang bị gỡ: /s/<mã> và checkout không rơi về kẻ chiếm', async () => {
    const victim = await ctv();
    const code = victim.referralCode.toLowerCase();
    const squat = await squatCode(code);
    const own = await storefront.getOrCreateMine(victim.id);
    await prisma.storefront.update({ where: { id: own.id }, data: { isPublished: true, publishedAt: new Date(), takenDownAt: new Date() } });
    await expect(storefront.getPublicBySlug(code)).rejects.toMatchObject({ status: 404 });
    await expect(storefront.getPublicByHost(`${code}.tubutree.com`)).rejects.toMatchObject({ status: 404 });
    expect(await resolvePublishedStorefront(prisma, { eligibleRoles: ['AFFILIATE', 'DEALER'], requireApproval: false }, code)).toBeNull();
    expect(squat.id).not.toBe(own.id);
  });

  it('dữ liệu cũ đã trùng, chủ mã chưa mở gian hàng: /s/<mã> và checkout không ra trang của kẻ chiếm', async () => {
    const victim = await ctv();
    const code = victim.referralCode.toLowerCase();
    await squatCode(code);
    await expect(storefront.getPublicBySlug(code)).rejects.toMatchObject({ status: 404 });
    await expect(storefront.getPublicByHost(`${code}.tubutree.com`)).rejects.toMatchObject({ status: 404 });
    expect(await resolvePublishedStorefront(prisma, { eligibleRoles: ['AFFILIATE', 'DEALER'], requireApproval: false }, code)).toBeNull();
  });

  it('slug cũ viết hoa vẫn thắng subdomain chữ thường của kẻ chiếm ở bước checkout', async () => {
    const victim = await ctv();
    const code = victim.referralCode.toLowerCase();
    await squatCode(code);
    const own = await storefront.getOrCreateMine(victim.id);
    await prisma.storefront.update({ where: { id: own.id }, data: { slug: code.toUpperCase(), isPublished: true, publishedAt: new Date() } });
    const resolved = await resolvePublishedStorefront(prisma, { eligibleRoles: ['AFFILIATE', 'DEALER'], requireApproval: false }, code);
    expect(resolved?.id).toBe(own.id);
  });
});
