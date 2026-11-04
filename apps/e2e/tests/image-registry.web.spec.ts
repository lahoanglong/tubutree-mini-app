import path from 'path';
import { expect, test } from '@playwright/test';
import { seedDatabaseUrl } from './support/a11y-db';
import { writableTempDb } from './support/waste-db';

/**
 * Danh sách URL ảnh mà /img được đổi cỡ (`registrySql` của API), chạy trên Postgres thật của web-gate.sh: banner chiến dịch và ảnh đại diện/bìa gian hàng
 * chỉ vào danh sách khi ở host upload (Cloudinary). Gian hàng do CTV dán được mọi host https, nên ảnh Pancake/host lạ/cloud khác không được thành proxy đổi cỡ.
 * Chỉ ghi vào DB tạm (như a11y-db.ts), tự xoá hàng đã tạo.
 */
const CLOUD = 'https://res.cloudinary.com/tubutree/image/upload/v1';
const rand = Math.random().toString(36).slice(2, 8);
const CAMP_OK = `${CLOUD}/reg-camp-${rand}.jpg`;
const CAMP_PANCAKE = `https://content.pancake.vn/2-26/reg-camp-${rand}.jpg`;
const CAMP_B64 = 'data:image/png;base64,iVBORw0KGgo=';
const SF_COVER_OK = `${CLOUD}/reg-cover-${rand}.jpg`;
const SF_AVATAR_PANCAKE = `https://content.pancake.vn/2-26/reg-avatar-${rand}.jpg`;
const SF_COVER_FOREIGN = `https://evil.example/reg-cover-${rand}.jpg`;
const SF_COVER_DRAFT = `${CLOUD}/reg-draft-${rand}.jpg`;
const SF_COVER_TAKEN_DOWN = `${CLOUD}/reg-down-${rand}.jpg`;
const SF_AVATAR_CLOUD_HTTP = `http://res.cloudinary.com/tubutree/image/upload/v1/reg-http-${rand}.jpg`;

test('registrySql trên Postgres thật: Cloudinary của chiến dịch/gian hàng đang đăng có; Pancake, host lạ, http, base64, gian hàng nháp/bị gỡ không', // eslint-disable-next-line no-empty-pattern
async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer', 'ghi DB chỉ ở một project');
  const url = seedDatabaseUrl();
  test.skip(!writableTempDb(url), 'DB không phải DB tạm');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PrismaClient } = require(path.resolve(__dirname, '../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registrySql } = require(path.resolve(__dirname, '../../api/src/modules/catalog/image-registry-query')) as { registrySql: (hosts?: string[], cloud?: string, vis?: { eligibleRoles: string[]; requireApproval: boolean }) => unknown };
  const { publicStorefrontWhere } = require(path.resolve(__dirname, '../../api/src/modules/storefront/storefront-visibility')) as {
    publicStorefrontWhere: (o: { eligibleRoles: string[]; requireApproval: boolean }) => unknown;
  };
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const now = Date.now();
  const campaign = (slug: string, image: string) => ({
    // Đã tắt và hết hạn: spec khác chạy song song (offers, a11y-shop) không thấy banner này.
    slug: `${slug}-${rand}`, title: slug, placement: 'OFFERS_TOP', image, isActive: false, startAt: new Date(now - 7_200_000), endAt: new Date(now - 3_600_000),
  });
  try {
    await prisma.campaign.createMany({ data: [campaign('reg-ok', CAMP_OK), campaign('reg-pancake', CAMP_PANCAKE), campaign('reg-b64', CAMP_B64)] });
    const published = { isPublished: true, publishedAt: new Date() };
    await prisma.storefront.create({ data: { type: 'MERCHANT', slug: `reg-a-${rand}`, title: 'Reg A', coverUrl: SF_COVER_OK, avatarUrl: SF_AVATAR_PANCAKE, ...published } });
    await prisma.storefront.create({ data: { type: 'MERCHANT', slug: `reg-b-${rand}`, title: 'Reg B', coverUrl: SF_COVER_FOREIGN, avatarUrl: SF_AVATAR_CLOUD_HTTP, ...published } });
    // Cùng ảnh Cloudinary hợp lệ nhưng gian hàng là bản nháp / bị gỡ: không được đăng ký.
    await prisma.storefront.create({ data: { type: 'CTV', slug: `reg-c-${rand}`, title: 'Reg C', coverUrl: SF_COVER_DRAFT } });
    await prisma.storefront.create({ data: { type: 'CTV', slug: `reg-d-${rand}`, title: 'Reg D', coverUrl: SF_COVER_TAKEN_DOWN, ...published, takenDownAt: new Date() } });
    // Khớp với publicStorefrontWhere: chủ bị khoá, CTV đã mất vai trò, CTV chưa duyệt thì khách không thấy nên không được vào danh sách.
    const owner = (tag: string, over: Record<string, unknown>) => prisma.user.create({ data: { zaloId: `reg-${tag}-${rand}`, referralCode: `REG${tag}${rand}`.toUpperCase(), role: 'AFFILIATE', ...over } });
    const [uOk, uBlocked, uDemoted] = [await owner('ok', {}), await owner('blk', { isBlocked: true }), await owner('dem', { role: 'CUSTOMER' })];
    const covers: Record<string, string> = {};
    const withOwner = async (tag: string, ownerUserId: string, over: Record<string, unknown> = {}) => {
      covers[tag] = `${CLOUD}/reg-own-${tag}-${rand}.jpg`;
      await prisma.storefront.create({ data: { type: 'CTV', slug: `reg-o-${tag}-${rand}`, title: tag, coverUrl: covers[tag], ownerUserId, ...published, approvedAt: new Date(), ...over } });
    };
    await withOwner('ok', uOk.id);
    await withOwner('blocked', uBlocked.id);
    await withOwner('demoted', uDemoted.id);
    const uPending = await owner('pen', {});
    await withOwner('pending', uPending.id, { approvedAt: null });
    const uAdmin = await owner('adm', { role: 'ADMIN' });
    const uMerchantBlocked = await owner('mblk', { isBlocked: true });
    await withOwner('admin', uAdmin.id);
    await withOwner('partner-unapproved', (await owner('par', {})).id, { approvedAt: null, isPartner: true });
    await withOwner('merchant-blocked', uMerchantBlocked.id, { type: 'MERCHANT' });
    await withOwner('merchant-demoted', (await owner('mdem', { role: 'CUSTOMER' })).id, { type: 'MERCHANT' });
    covers.ownerless = `${CLOUD}/reg-own-ownerless-${rand}.jpg`;
    await prisma.storefront.create({ data: { type: 'CTV', slug: `reg-o-ownerless-${rand}`, title: 'ownerless', coverUrl: covers.ownerless, ...published, approvedAt: new Date() } });
    for (const vis of [
      { eligibleRoles: ['AFFILIATE', 'DEALER'], requireApproval: true },
      { eligibleRoles: ['AFFILIATE', 'DEALER'], requireApproval: false },
      { eligibleRoles: ['DEALER'], requireApproval: true },
    ]) {
      const visible = (await prisma.storefront.findMany({ where: publicStorefrontWhere(vis), select: { coverUrl: true } })) as { coverUrl: string | null }[];
      const visibleCovers = new Set<string | undefined>(visible.map((r) => r.coverUrl ?? undefined));
      const rowsMirror = (await prisma.$queryRaw(registrySql(undefined, '', vis))) as { u: string }[];
      const registryMirror = new Set(rowsMirror.map((r) => r.u));
      for (const [tag, cover] of Object.entries(covers)) {
        expect(registryMirror.has(cover), `registrySql lệch publicStorefrontWhere ở gian hàng ${tag} với ${JSON.stringify(vis)}`).toBe(visibleCovers.has(cover));
      }
      if (vis.requireApproval && vis.eligibleRoles.length === 2) {
        expect(visibleCovers.has(covers.ok) && visibleCovers.has(covers.admin) && visibleCovers.has(covers['partner-unapproved'])).toBe(true);
        expect(visibleCovers.has(covers.blocked) || visibleCovers.has(covers.demoted) || visibleCovers.has(covers.pending) || visibleCovers.has(covers.ownerless)).toBe(false);
      }
    }
    const rows = (await prisma.$queryRaw(registrySql(undefined, ''))) as { u: string }[];
    const registry = new Set(rows.map((r) => r.u));
    console.log(`registry rows: ${rows.length}; có Cloudinary chiến dịch=${registry.has(CAMP_OK)}, bìa gian hàng=${registry.has(SF_COVER_OK)}`);
    expect(registry.has(CAMP_OK), 'banner Cloudinary phải có').toBe(true);
    expect(registry.has(SF_COVER_OK), 'bìa gian hàng Cloudinary phải có').toBe(true);
    for (const u of [CAMP_PANCAKE, CAMP_B64, SF_AVATAR_PANCAKE, SF_COVER_FOREIGN, SF_AVATAR_CLOUD_HTTP, SF_COVER_DRAFT, SF_COVER_TAKEN_DOWN]) expect(registry.has(u), `không được có: ${u}`).toBe(false);
  } finally {
    await prisma.campaign.deleteMany({ where: { slug: { endsWith: `-${rand}` } } });
    await prisma.storefront.deleteMany({ where: { slug: { endsWith: `-${rand}` } } });
    await prisma.user.deleteMany({ where: { zaloId: { endsWith: `-${rand}` } } });
    await prisma.$disconnect();
  }
});
