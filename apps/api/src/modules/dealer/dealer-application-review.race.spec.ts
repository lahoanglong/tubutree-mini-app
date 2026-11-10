import { HttpException, Logger } from '@nestjs/common';
import { AffiliateService } from '../affiliate/affiliate.service';
import type { RbacService } from '../staff/rbac/rbac.service';
import { UsersService } from '../users/users.service';
import { delay, dealerRaceSetup, httpStatus, messageOf, pendingApp } from '../../../test/fakes/w103a-helpers';

/**
 * Admin duyệt / từ chối hồ sơ đại lý và cấp bậc chạy đồng thời (Postgres READ COMMITTED, xem test/fakes/race-db.fake.ts).
 * Dùng AdminService THẬT (reviewDealerApplication, setUserRole); chỉ giả SQL thô (khoá danh sách admin, gian hàng, dòng users), thông báo, rbac và
 * MerchantFulfilmentService. Vai trò DEALER và bậc chỉ được cấp một lần, hồ sơ chốt đúng một kết quả, thông báo kết quả đi đúng một lần.
 *
 * Lượt "chặn tài khoản / ẩn danh" ở test cuối là DỰNG LẠI phần ghi của AccountDeletionService.anonymize (khoá dòng users FOR UPDATE rồi chặn tài khoản,
 * xoá SĐT/zaloId, ẩn danh hồ sơ), KHÔNG phải dịch vụ thật; bản dịch vụ thật chạy ở test/integration-race/d2-dealer-revoke-partner.race-spec.ts (Postgres).
 * Hai describe cuối dùng UsersService.completeOnboarding và AffiliateService.register THẬT (chỉ giả SQL thô): đó là hai lượt ghi users của chính khách có thể chen vào lúc duyệt.
 * Không kiểm được trên DB giả: KEY SHARE của khoá ngoại, deadlock 40P01, hết hạn giao dịch, thứ tự khoá chỉ-để-tránh-deadlock.
 */
const SKEWS = Array.from({ length: 21 }, (_, i) => i - 10);
const LOST = 'Đơn đã được xử lý.';
const seedUser = { id: 'u1', role: 'CUSTOMER', phone: '0911111111', zaloId: 'z1', isBlocked: false, metadata: { segments: ['da-dau'] }, staffPermissions: [], affiliateRevokedAt: null };
const stores = [
  { id: 's1', ownerUserId: 'u1', type: 'CTV', isPartner: false },
  { id: 's2', ownerUserId: 'u1', type: 'BRAND', isPartner: false },
];
const TIER_NAME: Record<string, string> = { SILVER: 'Bạc', GOLD: 'Vàng' };
const lag = (n: number) => Math.max(0, n);

const fresh = () => dealerRaceSetup({ users: [], applications: [pendingApp('a1')], storefronts: stores });
type Setup = ReturnType<typeof fresh>;
// dealerRaceSetup đã seed u1 trống; thay bằng người nộp có metadata và gian hàng để kiểm việc gộp metadata.
const withApplicant = (): Setup => {
  const s = fresh();
  s.db.seed('user', [{ ...seedUser }]);
  return s;
};

const events = (s: Setup, kind: string) => s.db.rows('userAdminEvent').filter((e) => e.kind === kind);
const approvedNotes = (s: Setup) => s.notify.mock.calls.filter((c) => c[1] === 'DEALER_APPLICATION_APPROVED');
const rejectedNotes = (s: Setup) => s.notify.mock.calls.filter((c) => c[1] === 'DEALER_APPLICATION_REJECTED');

/** Bất biến mọi kết cục phải giữ: DEALER ⇔ hồ sơ APPROVED; bậc chỉ có khi được duyệt; gian hàng đối tác chỉ bật khi được duyệt. */
function expectConsistent(s: Setup, label: string) {
  const user = s.db.row('user', 'u1')!;
  const app = s.db.row('dealerApplication', 'a1')!;
  expect({ label, dealerIffApproved: (user.role === 'DEALER') === (app.status === 'APPROVED') }).toEqual({ label, dealerIffApproved: true });
  expect({ label, segments: (user.metadata as any)?.segments }).toEqual({ label, segments: ['da-dau'] });
  if (app.status !== 'APPROVED') {
    expect({ label, tier: (user.metadata as any)?.dealerTierId }).toEqual({ label, tier: undefined });
    expect({ label, partner: s.db.row('storefront', 's1')!.isPartner }).toEqual({ label, partner: false });
  }
}

describe('AdminService.reviewDealerApplication — race', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  it('hai admin duyệt cùng hồ sơ với hai bậc khác nhau (quét lệch): đúng một người thắng; vai trò, bậc, gian hàng đối tác, sổ việc admin và thông báo đều chỉ ghi một lần theo bậc của người thắng', async () => {
    let waited = 0;
    for (const skew of SKEWS) {
      const s = withApplicant();
      const approve = async (n: number, adminId: string, tierId: string) => (await delay(n), s.admin.reviewDealerApplication(adminId, 'a1', true, tierId));
      const settled = await Promise.allSettled([approve(lag(-skew), 'admin1', 'SILVER'), approve(lag(skew), 'admin2', 'GOLD')]);
      const label = `skew ${skew}`;
      expect({ label, ok: settled.filter((r) => r.status === 'fulfilled').length }).toEqual({ label, ok: 1 });
      const lost = settled.find((r) => r.status === 'rejected')!;
      expect({ label, status: httpStatus(lost), message: messageOf(lost) }).toEqual({ label, status: 400, message: LOST });
      const app = s.db.row('dealerApplication', 'a1')!;
      const winnerTier = app.reviewedBy === 'admin1' ? 'SILVER' : 'GOLD';
      expect(app).toMatchObject({ status: 'APPROVED' });
      const user = s.db.row('user', 'u1')!;
      expect(user.role).toBe('DEALER');
      expect(user.metadata).toEqual({ segments: ['da-dau'], dealerTierId: winnerTier });
      expect(s.db.row('storefront', 's1')).toMatchObject({ isPartner: true });
      expect(s.db.row('storefront', 's2')).toMatchObject({ isPartner: false });
      expect(events(s, 'STOREFRONT_PARTNER').map((e) => [e.reason, e.actorId])).toEqual([['s1', app.reviewedBy]]);
      expect(approvedNotes(s)).toHaveLength(1);
      expect(approvedNotes(s)[0]).toEqual(['u1', 'DEALER_APPLICATION_APPROVED', expect.objectContaining({ tier: TIER_NAME[winnerTier] })]);
      expect(rejectedNotes(s)).toHaveLength(0);
      expectConsistent(s, label);
      waited += s.db.stats.lockWaits;
    }
    expect(waited).toBeGreaterThan(0);
  });

  it('ba lượt duyệt cùng bậc từ cùng một admin (bấm đúp / thử lại): một lượt thắng, hai lượt còn lại nhận câu "đã được xử lý", thông báo đi một lần', async () => {
    const s = withApplicant();
    const settled = await Promise.allSettled([0, 1, 2].map(async (i) => (await delay(i), s.admin.reviewDealerApplication('admin1', 'a1', true, 'GOLD'))));
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const lost of settled.filter((r) => r.status === 'rejected')) expect([httpStatus(lost), messageOf(lost)]).toEqual([400, LOST]);
    expect(approvedNotes(s)).toHaveLength(1);
    expect(events(s, 'STOREFRONT_PARTNER')).toHaveLength(1);
    expect(s.db.row('user', 'u1')!.metadata).toEqual({ segments: ['da-dau'], dealerTierId: 'GOLD' });
  });

  it('duyệt chen từ chối (quét lệch): đúng một kết quả cuối; duyệt thắng thì có vai trò + bậc và không có lý do từ chối, từ chối thắng thì không cấp gì; thông báo đúng một loại', async () => {
    const seen = { approved: 0, rejected: 0 };
    for (const skew of SKEWS) {
      const s = withApplicant();
      const settled = await Promise.allSettled([
        (async () => (await delay(lag(-skew)), s.admin.reviewDealerApplication('admin1', 'a1', true, 'GOLD')))(),
        (async () => (await delay(lag(skew)), s.admin.reviewDealerApplication('admin2', 'a1', false, undefined, 'Thiếu giấy phép')))(),
      ]);
      const label = `skew ${skew}`;
      expect({ label, ok: settled.filter((r) => r.status === 'fulfilled').length }).toEqual({ label, ok: 1 });
      const lost = settled.find((r) => r.status === 'rejected')!;
      expect({ label, status: httpStatus(lost), message: messageOf(lost) }).toEqual({ label, status: 400, message: LOST });
      const app = s.db.row('dealerApplication', 'a1')!;
      expectConsistent(s, label);
      if (app.status === 'APPROVED') {
        seen.approved += 1;
        expect(app).toMatchObject({ reviewedBy: 'admin1', rejectionReason: null });
        expect(s.db.row('user', 'u1')).toMatchObject({ role: 'DEALER', metadata: { segments: ['da-dau'], dealerTierId: 'GOLD' } });
        expect([approvedNotes(s).length, rejectedNotes(s).length]).toEqual([1, 0]);
      } else {
        seen.rejected += 1;
        expect(app).toMatchObject({ status: 'REJECTED', reviewedBy: 'admin2', rejectionReason: 'Thiếu giấy phép' });
        expect(s.db.row('user', 'u1')).toMatchObject({ role: 'CUSTOMER' });
        expect(events(s, 'STOREFRONT_PARTNER')).toHaveLength(0);
        expect([approvedNotes(s).length, rejectedNotes(s).length]).toEqual([0, 1]);
        expect(rejectedNotes(s)[0]![2]).toMatchObject({ reason: 'Thiếu giấy phép' });
      }
    }
    // Quét đủ hai thứ tự, nếu không test chỉ chứng minh một chiều.
    expect(seen.approved).toBeGreaterThan(0);
    expect(seen.rejected).toBeGreaterThan(0);
  });

  it('hai admin từ chối cùng hồ sơ với hai lý do: một người thắng, lý do lưu và thông báo là của người thắng, đi đúng một lần', async () => {
    for (const skew of SKEWS) {
      const s = withApplicant();
      const reject = async (n: number, adminId: string, reason: string) => (await delay(n), s.admin.reviewDealerApplication(adminId, 'a1', false, undefined, reason));
      const settled = await Promise.allSettled([reject(lag(-skew), 'admin1', 'Ảnh mờ'), reject(lag(skew), 'admin2', 'Sai địa chỉ')]);
      const label = `skew ${skew}`;
      expect({ label, ok: settled.filter((r) => r.status === 'fulfilled').length }).toEqual({ label, ok: 1 });
      expect(messageOf(settled.find((r) => r.status === 'rejected')!)).toBe(LOST);
      const app = s.db.row('dealerApplication', 'a1')!;
      const reason = app.reviewedBy === 'admin1' ? 'Ảnh mờ' : 'Sai địa chỉ';
      expect(app).toMatchObject({ status: 'REJECTED', rejectionReason: reason });
      expect(rejectedNotes(s)).toHaveLength(1);
      expect(rejectedNotes(s)[0]![2]).toMatchObject({ reason });
      expectConsistent(s, label);
    }
  });

  it('duyệt chen cấp vai trò đại lý theo SĐT với bậc khác: cả hai thành công, vai trò DEALER cấp một lần (một dòng ROLE hoặc không), bậc cuối là của lượt ghi sau, metadata cũ còn nguyên', async () => {
    const seen = { approveLast: 0, setRoleLast: 0 };
    for (const skew of SKEWS) {
      const s = withApplicant();
      const settled = await Promise.allSettled([
        (async () => (await delay(lag(-skew)), s.admin.reviewDealerApplication('admin1', 'a1', true, 'SILVER')))(),
        (async () => (await delay(lag(skew)), s.admin.setUserRole('admin2', '0911111111', 'DEALER', 'GOLD')))(),
      ]);
      const label = `skew ${skew}`;
      expect({ label, statuses: settled.map((r) => r.status) }).toEqual({ label, statuses: ['fulfilled', 'fulfilled'] });
      const user = s.db.row('user', 'u1')!;
      expect(user.role).toBe('DEALER');
      expect((user.metadata as any).segments).toEqual(['da-dau']);
      expect(s.db.row('dealerApplication', 'a1')).toMatchObject({ status: 'APPROVED' });
      const roleEvents = events(s, 'ROLE');
      expect(roleEvents.length).toBeLessThanOrEqual(1);
      // Dòng ROLE chỉ có khi setUserRole chạy TRƯỚC (lúc đó người này còn CUSTOMER) nên duyệt là lượt ghi bậc sau cùng; không có dòng ROLE thì ngược lại.
      if (roleEvents.length === 1) {
        seen.approveLast += 1;
        expect([roleEvents[0]!.fromValue, roleEvents[0]!.toValue]).toEqual(['CUSTOMER', 'DEALER']);
        expect((user.metadata as any).dealerTierId).toBe('SILVER');
      } else {
        seen.setRoleLast += 1;
        expect((user.metadata as any).dealerTierId).toBe('GOLD');
      }
    }
    expect(seen.approveLast).toBeGreaterThan(0);
    expect(seen.setRoleLast).toBeGreaterThan(0);
  });

  it('duyệt chen chặn / ẩn danh tài khoản người nộp (dựng lại phần ghi của xoá tài khoản): hoặc duyệt xong rồi mới ẩn danh, hoặc bị từ chối bằng câu tiếng Việt và hồ sơ còn PENDING, vai trò không đổi', async () => {
    const seen = { approved: 0, refused: 0 };
    for (const skew of SKEWS) {
      const s = withApplicant();
      const deletion = async () => {
        await delay(lag(skew));
        await s.db.client.$transaction(async (tx: any) => {
          await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${'u1'} FOR UPDATE`;
          await tx.user.update({ where: { id: 'u1' }, data: { isBlocked: true, phone: null, zaloId: null, fullName: 'Người dùng đã xoá' } });
          await tx.dealerApplication.updateMany({ where: { userId: 'u1' }, data: { ownerName: 'Người dùng đã xoá', phone: '', address: '' } });
        });
      };
      const settled = await Promise.allSettled([
        (async () => (await delay(lag(-skew)), s.admin.reviewDealerApplication('admin1', 'a1', true, 'GOLD')))(),
        deletion(),
      ]);
      const label = `skew ${skew}`;
      expect({ label, deletion: settled[1]!.status }).toEqual({ label, deletion: 'fulfilled' });
      const app = s.db.row('dealerApplication', 'a1')!;
      const user = s.db.row('user', 'u1')!;
      expect({ label, anonymized: [user.isBlocked, app.ownerName, app.address] }).toEqual({ label, anonymized: [true, 'Người dùng đã xoá', ''] });
      if (settled[0]!.status === 'fulfilled') {
        seen.approved += 1;
        expect(app.status).toBe('APPROVED');
        expect(user.role).toBe('DEALER');
      } else {
        seen.refused += 1;
        expect(httpStatus(settled[0]!)).toBe(400);
        expect(messageOf(settled[0]!)).toMatch(/đã bị khoá hoặc đã xoá/);
        expect(app.status).toBe('PENDING');
        expect(user.role).toBe('CUSTOMER');
        expect(events(s, 'STOREFRONT_PARTNER')).toHaveLength(0);
        expect(s.db.row('storefront', 's1')!.isPartner).toBe(false);
        expect(approvedNotes(s)).toHaveLength(0);
      }
    }
    expect(seen.approved).toBeGreaterThan(0);
    expect(seen.refused).toBeGreaterThan(0);
  });

  it('lỗi nghiệp vụ của luồng duyệt đều là tiếng Việt: thiếu bậc, bậc không tồn tại, hồ sơ không có, đã xử lý', async () => {
    const s = withApplicant();
    const msg = async (work: () => Promise<unknown>) => {
      const err = await work().catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      return (err as HttpException).message;
    };
    expect(await msg(() => s.admin.reviewDealerApplication('admin1', 'a1', true))).toBe('Cần chọn bậc đại lý khi duyệt.');
    expect(await msg(() => s.admin.reviewDealerApplication('admin1', 'a1', true, 'KHONG_CO'))).toBe('Bậc đại lý không tồn tại.');
    expect(await msg(() => s.admin.reviewDealerApplication('admin1', 'nope', true, 'GOLD'))).toBe('Không tìm thấy đơn đăng ký.');
    await s.admin.reviewDealerApplication('admin1', 'a1', false, undefined, 'Ảnh mờ');
    expect(await msg(() => s.admin.reviewDealerApplication('admin1', 'a1', true, 'GOLD'))).toBe(LOST);
    expect(await msg(() => s.admin.reviewDealerApplication('admin1', 'a1', false, undefined, 'Ảnh mờ'))).toBe(LOST);
  });
});

// Thu hồi grant ở lượt duyệt chạy SAU commit và nuốt lỗi (khác setUserRole, thu hồi trong transaction và không nuốt). Test dưới chỉ chứng minh trường hợp revoke chạy ngay
// sau commit (nhịp thật của mã); revoke bị trễ hoặc ném lỗi thì người nộp bị applyGrants nâng lại STAFF: chưa sửa, ghi ở báo cáo wave (cần chạy thử trên Postgres vì đổi thứ tự khoá).
describe('AdminService.reviewDealerApplication — người nộp đang có quyền nhân viên cấp theo SĐT (RoleGrant, RbacService thật)', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  const staffApplicant = () => {
    const s = dealerRaceSetup({
      users: [{ ...seedUser, role: 'STAFF', staffPermissions: ['CSKH'] }],
      applications: [pendingApp('a1')],
      storefronts: stores,
      grants: [{ id: 'g1', phone: '0911111111', role: 'STAFF', staffPermissions: ['CSKH'], revokedAt: null, expiresAt: null }],
      realRbac: true,
    });
    s.db.seed('user', [{ ...seedUser, role: 'STAFF', staffPermissions: ['CSKH'] }]);
    return s;
  };
  const rbacOf = (s: Setup) => s.rbac as RbacService;

  it('tuần tự: duyệt hạ người nộp về DEALER, thu hồi grant STAFF, các lần làm mới token sau đó không nâng lại', async () => {
    const s = staffApplicant();
    await s.admin.reviewDealerApplication('admin1', 'a1', true, 'GOLD');
    expect(s.db.row('user', 'u1')).toMatchObject({ role: 'DEALER', staffPermissions: [] });
    expect(s.db.row('roleGrant', 'g1')!.revokedAt).toBeInstanceOf(Date);
    await rbacOf(s).applyGrants(s.db.row('user', 'u1') as never);
    expect(s.db.row('user', 'u1')!.role).toBe('DEALER');
  });

  it('duyệt chen làm mới token của chính người nộp (quét lệch, revoke chạy ngay sau commit): vai trò cuối luôn là DEALER và grant đã thu hồi', async () => {
    const outcomes: Record<string, number> = {};
    for (const skew of Array.from({ length: 41 }, (_, i) => i - 20)) {
      const s = staffApplicant();
      const snapshot = s.db.row('user', 'u1')!;
      const settled = await Promise.allSettled([
        (async () => (await delay(lag(-skew)), s.admin.reviewDealerApplication('admin1', 'a1', true, 'GOLD')))(),
        (async () => (await delay(lag(skew)), rbacOf(s).applyGrants(snapshot as never)))(),
      ]);
      const label = `skew ${skew}`;
      expect({ label, statuses: settled.map((r) => r.status) }).toEqual({ label, statuses: ['fulfilled', 'fulfilled'] });
      const user = s.db.row('user', 'u1')!;
      const grantRevoked = s.db.row('roleGrant', 'g1')!.revokedAt != null;
      outcomes[`${user.role}/grantRevoked=${grantRevoked}`] = (outcomes[`${user.role}/grantRevoked=${grantRevoked}`] ?? 0) + 1;
      expect({ label, role: user.role, grantRevoked }).toEqual({ label, role: 'DEALER', grantRevoked: true });
    }
    expect(outcomes).toEqual({ 'DEALER/grantRevoked=true': 41 });
  });
});

describe('AdminService.reviewDealerApplication — chen với các lượt ghi users của chính khách (dịch vụ thật)', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  const customer = {
    ...seedUser,
    metadata: null,
    referralCode: 'R1',
    pointsBalance: 0,
    pointsConvertedBalance: 0,
    walletBalance: 0,
    cashbackPending: 0,
    tierId: null,
    email: null,
    fullName: 'Nguyễn Văn An',
    avatarUrl: null,
  };
  const SKEWS_WIDE = Array.from({ length: 41 }, (_, i) => i - 20);
  const setup = (): Setup => {
    const s = fresh();
    s.db.seed('user', [{ ...customer }]);
    return s;
  };

  it('khách làm xong onboarding đúng lúc admin duyệt (quét lệch): bậc đại lý vừa cấp không bị ghi đè bằng metadata cũ, segments và onboardedAt còn đủ', async () => {
    for (const skew of SKEWS_WIDE) {
      const s = setup();
      const users = new UsersService(s.db.client);
      const settled = await Promise.allSettled([
        (async () => (await delay(lag(-skew)), s.admin.reviewDealerApplication('admin1', 'a1', true, 'GOLD')))(),
        (async () => (await delay(lag(skew)), users.completeOnboarding('u1', ['da-dau'])))(),
      ]);
      const label = `skew ${skew}`;
      expect({ label, statuses: settled.map((r) => r.status) }).toEqual({ label, statuses: ['fulfilled', 'fulfilled'] });
      const user = s.db.row('user', 'u1')!;
      expect({ label, role: user.role, tier: (user.metadata as any).dealerTierId, segments: (user.metadata as any).segments }).toEqual({
        label,
        role: 'DEALER',
        tier: 'GOLD',
        segments: ['da-dau'],
      });
      expect(typeof (user.metadata as any).onboardedAt).toBe('string');
    }
  });

  it('khách đăng ký CTV đúng lúc admin duyệt đại lý (quét lệch): vai trò DEALER và bậc vừa cấp không bị ghi đè thành AFFILIATE; đăng ký sau khi duyệt bị từ chối bằng câu tiếng Việt', async () => {
    const seen = { registered: 0, refused: 0 };
    for (const skew of SKEWS_WIDE) {
      const s = setup();
      const none = {} as never;
      const affiliate = new AffiliateService(s.db.client, { get: async (_k: string, f: unknown) => f } as never, none, none, none, none);
      const settled = await Promise.allSettled([
        (async () => (await delay(lag(-skew)), s.admin.reviewDealerApplication('admin1', 'a1', true, 'GOLD')))(),
        (async () => (await delay(lag(skew)), affiliate.register('u1', 'v1')))(),
      ]);
      const label = `skew ${skew}`;
      expect({ label, review: settled[0]!.status }).toEqual({ label, review: 'fulfilled' });
      const user = s.db.row('user', 'u1')!;
      expect({ label, role: user.role, tier: (user.metadata as any).dealerTierId }).toEqual({ label, role: 'DEALER', tier: 'GOLD' });
      expect(s.db.row('dealerApplication', 'a1')).toMatchObject({ status: 'APPROVED' });
      if (settled[1]!.status === 'fulfilled') {
        seen.registered += 1;
        // đăng ký xong TRƯỚC khi duyệt: điều khoản đồng ý đã commit nên duyệt gộp metadata từ dòng đã khoá và giữ nó
        expect((user.metadata as any).affiliateTerms).toMatchObject({ version: 'v1' });
      } else {
        seen.refused += 1;
        expect([httpStatus(settled[1]!), messageOf(settled[1]!)]).toEqual([400, 'Tài khoản này không thể đăng ký CTV.']);
      }
    }
    expect(seen.registered).toBeGreaterThan(0);
    expect(seen.refused).toBeGreaterThan(0);
  });
});

describe('Cấp bậc đại lý chen với lượt ghi khác trên dòng users và gian hàng của người nộp (dựng lại / dịch vụ thật)', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  const customer = { ...seedUser, metadata: null, referralCode: 'R1', pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0, cashbackPending: 0, tierId: null, email: null, fullName: 'Nguyễn Văn An', avatarUrl: null };
  const SKEWS_WIDE = Array.from({ length: 41 }, (_, i) => i - 20);

  it('admin cấp vai trò đại lý theo SĐT (setUserRole) chen với khách làm xong onboarding (UsersService thật): bậc, segments, onboardedAt đều còn', async () => {
    for (const skew of SKEWS_WIDE) {
      const s = fresh();
      s.db.seed('user', [{ ...customer }]);
      const users = new UsersService(s.db.client);
      const settled = await Promise.allSettled([
        (async () => (await delay(lag(-skew)), s.admin.setUserRole('admin1', '0911111111', 'DEALER', 'GOLD')))(),
        (async () => (await delay(lag(skew)), users.completeOnboarding('u1', ['da-dau'])))(),
      ]);
      const label = `skew ${skew}`;
      expect({ label, statuses: settled.map((r) => r.status) }).toEqual({ label, statuses: ['fulfilled', 'fulfilled'] });
      const user = s.db.row('user', 'u1')!;
      expect({ label, role: user.role, tier: (user.metadata as any).dealerTierId, segments: (user.metadata as any).segments }).toEqual({ label, role: 'DEALER', tier: 'GOLD', segments: ['da-dau'] });
      expect(typeof (user.metadata as any).onboardedAt).toBe('string');
    }
  });

  it('duyệt chen admin bật cờ đối tác của chính gian hàng đó (dựng lại phần ghi của setStorePartner): cờ bật, sổ việc admin chỉ có MỘT dòng false → true cho gian hàng, hồ sơ được duyệt', async () => {
    for (const skew of SKEWS_WIDE) {
      const s = withApplicant();
      const toggle = async () => {
        await delay(lag(skew));
        await s.db.client.$transaction(async (tx: any) => {
          const [store] = await tx.$queryRaw`SELECT "id", "type"::text AS "type", "isPartner" FROM "storefronts" WHERE "ownerUserId" = ${'u1'} ORDER BY "id" FOR UPDATE`;
          if (store.isPartner) return;
          await tx.storefront.update({ where: { id: store.id }, data: { isPartner: true } });
          await tx.userAdminEvent.create({ data: { userId: 'u1', kind: 'STOREFRONT_PARTNER', fromValue: 'false', toValue: 'true', reason: `${store.id}:ADMIN_TOGGLE`, actorId: 'admin2' } });
        });
      };
      const settled = await Promise.allSettled([
        (async () => (await delay(lag(-skew)), s.admin.reviewDealerApplication('admin1', 'a1', true, 'GOLD')))(),
        toggle(),
      ]);
      const label = `skew ${skew}`;
      expect({ label, statuses: settled.map((r) => r.status) }).toEqual({ label, statuses: ['fulfilled', 'fulfilled'] });
      expect(s.db.row('storefront', 's1')!.isPartner).toBe(true);
      expect({ label, events: events(s, 'STOREFRONT_PARTNER').filter((e) => String(e.reason).startsWith('s1')).length }).toEqual({ label, events: 1 });
      expect(s.db.row('user', 'u1')).toMatchObject({ role: 'DEALER' });
    }
  });
});
