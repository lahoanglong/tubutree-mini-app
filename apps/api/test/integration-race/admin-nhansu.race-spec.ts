import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { StorefrontAdminService } from '../../src/modules/storefront/storefront-admin.service';
import { createUser, randCode, setConfig, summarize, warmPool } from './helpers';

/**
 * Nhân sự trên Mini (nhóm việc của lời mời) và gian hàng đổi nội dung sau duyệt, trên Postgres thật: hai cột mới
 * (role_grants.staffPermissions, storefronts.contentChangedAt) chạy qua migration thật, và cấp quyền đồng thời cùng SĐT.
 */
describe('Nhóm việc của lời mời + gian hàng đổi sau duyệt (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let rbac: RbacService;
  let storefronts: StorefrontService;
  let admin: StorefrontAdminService;
  const phones: string[] = [];
  const created = { userIds: [] as string[], storefrontIds: [] as string[] };
  let savedApproval: { key: string; value: unknown }[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    savedApproval = await prisma.systemConfig.findMany({ where: { key: 'storefront.require_approval' } });
    await setConfig(prisma, 'storefront.require_approval', true);
    const config = new SystemConfigService(prisma);
    const affiliate = { getPublicTier: async () => null, commissionEligibleRoles: async () => new Set(['AFFILIATE', 'DEALER']) };
    rbac = new RbacService(prisma);
    storefronts = new StorefrontService(prisma, config, affiliate as never);
    admin = new StorefrontAdminService(prisma, config, affiliate as never, { notify: jest.fn().mockResolvedValue(undefined) } as never);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$transaction([
        prisma.roleGrant.deleteMany({ where: { phone: { in: phones } } }),
        prisma.userAdminEvent.deleteMany({ where: { userId: { in: created.userIds } } }),
        prisma.storefront.deleteMany({ where: { id: { in: created.storefrontIds } } }),
        prisma.user.deleteMany({ where: { id: { in: created.userIds } } }),
        prisma.systemConfig.deleteMany({ where: { key: 'storefront.require_approval' } }),
      ]);
      for (const c of savedApproval) await setConfig(prisma, c.key, c.value as never);
    }
    await moduleRef?.close();
  });

  const newPhone = () => {
    const p = `09${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    phones.push(p);
    return p;
  };
  async function user(data: Parameters<typeof createUser>[1] = {}) {
    const u = await createUser(prisma, data);
    created.userIds.push(u.id);
    return u;
  }

  describe('lời mời nhân viên mang theo nhóm việc', () => {
    it('lời mời chưa mở app: lưu nhóm; người đó đăng nhập (applyGrants) thì nhận đúng nhóm, có dòng sổ', async () => {
      const adminUser = await user({ role: 'ADMIN' });
      const phone = newPhone();
      expect(await rbac.addGrant(adminUser.id, phone, 'STAFF', ['KHO', 'CSKH'])).toEqual({ granted: 'STAFF', applied: false });
      const stored = await prisma.roleGrant.findFirstOrThrow({ where: { phone, revokedAt: null } });
      expect(stored.staffPermissions).toEqual(['CSKH', 'KHO']);
      const { pendingInvites } = await rbac.listStaff();
      expect(pendingInvites.find((p) => p.phone === phone)?.staffPermissions).toEqual(['CSKH', 'KHO']);

      const invitee = await user({ phone });
      const after = await rbac.applyGrants(invitee);
      expect(after.role).toBe('STAFF');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: invitee.id } })).staffPermissions).toEqual(['CSKH', 'KHO']);
      const event = await prisma.userAdminEvent.findFirstOrThrow({ where: { userId: invitee.id, kind: 'STAFF_PERMISSIONS' } });
      expect([event.fromValue, event.toValue]).toEqual(['', 'CSKH,KHO']);
    });

    it('không truyền nhóm: như cũ (nhân viên không nhóm); lời mời cũ không có cột nhóm đọc ra danh sách rỗng', async () => {
      const adminUser = await user({ role: 'ADMIN' });
      const phone = newPhone();
      await rbac.addGrant(adminUser.id, phone, 'STAFF');
      expect((await prisma.roleGrant.findFirstOrThrow({ where: { phone } })).staffPermissions).toEqual([]);
      const invitee = await user({ phone });
      await rbac.applyGrants(invitee);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: invitee.id } })).staffPermissions).toEqual([]);
      // Dòng role_grants được chèn thẳng không có cột nhóm (như dữ liệu trước migration) lấy giá trị mặc định rỗng.
      const legacyPhone = newPhone();
      await prisma.$executeRaw`INSERT INTO "role_grants" ("id","phone","role","grantedBy") VALUES (${`legacy_${randCode(6)}`}, ${legacyPhone}, 'STAFF', 'seed')`;
      expect((await prisma.roleGrant.findFirstOrThrow({ where: { phone: legacyPhone } })).staffPermissions).toEqual([]);
    });

    it('gửi lại lời mời đang chờ với nhóm khác: cập nhật đúng một dòng, không tạo lời mời thứ hai', async () => {
      const adminUser = await user({ role: 'ADMIN' });
      const phone = newPhone();
      await rbac.addGrant(adminUser.id, phone, 'STAFF', ['KHO']);
      await rbac.addGrant(adminUser.id, phone, 'STAFF', ['KE_TOAN', 'MARKETING']);
      const rows = await prisma.roleGrant.findMany({ where: { phone, revokedAt: null } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.staffPermissions).toEqual(['MARKETING', 'KE_TOAN']);
    });

    it('người đã là STAFF: chọn nhóm khi thêm thì áp luôn; danh sách rỗng không xoá nhóm đang có', async () => {
      const adminUser = await user({ role: 'ADMIN' });
      const phone = newPhone();
      const staff = await user({ phone, role: 'STAFF', staffPermissions: ['KHO'] });
      await rbac.addGrant(adminUser.id, phone, 'STAFF', ['CSKH']);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: staff.id } })).staffPermissions).toEqual(['CSKH']);
      await rbac.addGrant(adminUser.id, phone, 'STAFF', []);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: staff.id } })).staffPermissions).toEqual(['CSKH']);
    });

    it('hai quản trị cấp cùng một SĐT đồng thời: một lời mời còn hiệu lực, không lỗi', async () => {
      const a1 = await user({ role: 'ADMIN' });
      const a2 = await user({ role: 'ADMIN' });
      const phone = newPhone();
      const results = await Promise.allSettled([
        rbac.addGrant(a1.id, phone, 'STAFF', ['KHO']),
        rbac.addGrant(a2.id, phone, 'STAFF', ['CSKH']),
        rbac.addGrant(a1.id, phone, 'STAFF', ['KHO']),
      ]);
      expect(summarize(results).errors).toEqual([]);
      expect(await prisma.roleGrant.count({ where: { phone, revokedAt: null } })).toBe(1);
    });
  });

  describe('gian hàng đã duyệt đổi nội dung', () => {
    async function store(approved: boolean) {
      const owner = await user({ role: 'AFFILIATE' });
      const slug = `it-an-${randCode(8).toLowerCase()}`;
      const sf = await prisma.storefront.create({
        data: { type: 'CTV', slug, title: 'Shop IT', ownerUserId: owner.id, isPublished: true, publishedAt: new Date(), ...(approved ? { approvedAt: new Date() } : {}) },
      });
      created.storefrontIds.push(sf.id);
      return { owner, sf };
    }

    it('đã duyệt đổi tên → có dấu, admin lọc thấy và đếm được; "Đã xem" bỏ dấu; không đụng duyệt/đăng', async () => {
      const { owner, sf } = await store(true);
      await storefronts.updateMine(owner.id, { title: 'Shop IT đổi tên', theme: 'leaf-orange' });
      const flagged = await prisma.storefront.findUniqueOrThrow({ where: { id: sf.id } });
      expect(flagged.contentChangedAt).toBeInstanceOf(Date);
      expect(flagged.approvedAt).not.toBeNull();

      const listed = await admin.list({ page: 1, limit: 100, changedAfterApproval: true });
      expect(listed.data.map((r) => r.id)).toContain(sf.id);
      expect(listed.changedAfterApproval).toBeGreaterThanOrEqual(1);

      await admin.markContentSeen('admin-it', sf.id);
      const seen = await prisma.storefront.findUniqueOrThrow({ where: { id: sf.id } });
      expect(seen.contentChangedAt).toBeNull();
      expect(seen.approvedAt).not.toBeNull();
      expect(seen.isPublished).toBe(true);
      expect((await admin.list({ page: 1, limit: 100, changedAfterApproval: true })).data.map((r) => r.id)).not.toContain(sf.id);
    });

    it('chưa duyệt đổi tên → không có dấu; gửi lại đúng tên cũ sau khi duyệt → không có dấu', async () => {
      const { owner, sf } = await store(false);
      await storefronts.updateMine(owner.id, { title: 'Tên khác khi chưa duyệt' });
      expect((await prisma.storefront.findUniqueOrThrow({ where: { id: sf.id } })).contentChangedAt).toBeNull();
      await admin.setApproved('admin-it', sf.id, true);
      await storefronts.updateMine(owner.id, { title: 'Tên khác khi chưa duyệt', headerNote: '' });
      expect((await prisma.storefront.findUniqueOrThrow({ where: { id: sf.id } })).contentChangedAt).toBeNull();
    });

    it('duyệt lại thì dấu cũ bị xoá; bỏ duyệt rồi thì không còn nằm trong bộ lọc dù dấu còn', async () => {
      const { owner, sf } = await store(true);
      await storefronts.updateMine(owner.id, { headerNote: 'Giảm giá hôm nay' });
      await admin.setApproved('admin-it', sf.id, false);
      expect((await admin.list({ page: 1, limit: 100, changedAfterApproval: true })).data.map((r) => r.id)).not.toContain(sf.id);
      await admin.setApproved('admin-it', sf.id, true);
      expect((await prisma.storefront.findUniqueOrThrow({ where: { id: sf.id } })).contentChangedAt).toBeNull();
    });

    it('hai admin cùng bấm "Đã xem": cả hai thành công, dấu xoá đúng một lần', async () => {
      const { owner, sf } = await store(true);
      await storefronts.updateMine(owner.id, { title: 'Đổi tên lần nữa' });
      const results = await Promise.allSettled([admin.markContentSeen('a1', sf.id), admin.markContentSeen('a2', sf.id)]);
      expect(summarize(results).errors).toEqual([]);
      expect((await prisma.storefront.findUniqueOrThrow({ where: { id: sf.id } })).contentChangedAt).toBeNull();
    });
  });
});
