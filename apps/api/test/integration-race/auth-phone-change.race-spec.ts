import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import { createUser, deleteItData, randCode, warmPool } from './helpers';

/**
 * Đổi SĐT theo Zalo (chatpts N4) không được thành đường nâng quyền: tài khoản đã có số mà Zalo trả số khác không bao giờ lên STAFF/ADMIN
 * nhờ grant của số mới, và hai tài khoản đua nhận cùng một số thì không ai lỗi 500.
 */
describe('Auth: đổi SĐT theo Zalo trên Postgres thật', () => {
  let prisma: PrismaService;
  let auth: AuthService;
  const userIds: string[] = [];
  const grantIds: string[] = [];
  let zaloPhone: string | null = null;

  const phone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  async function mkUser(over: Parameters<typeof createUser>[1] = {}) {
    const u = await createUser(prisma, { phone: phone(), zaloId: `zalo_${randCode(10)}`, ...over });
    userIds.push(u.id);
    return u;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const config = { get: (k: string) => ({ JWT_ACCESS_SECRET: 'it-secret', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30 } as Record<string, unknown>)[k] };
    const zalo = {
      getUserInfo: async (accessToken: string) => ({ zaloId: accessToken, name: 'IT' }),
      resolvePhoneNumber: async () => zaloPhone,
    };
    auth = new AuthService(prisma, new JwtService(), config as never, zalo as never, new RbacService(prisma));
  });
  afterAll(async () => {
    await prisma.roleGrant.deleteMany({ where: { id: { in: grantIds } } });
    await deleteItData(prisma, { userIds });
    await prisma?.$disconnect();
  });

  const login = (u: { zaloId: string | null }) => auth.loginWithZaloMiniApp('code', u.zaloId!, 'phone-token');
  const fresh = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });

  it('số mới đang có grant STAFF: hai tài khoản CUSTOMER đua nhận số đó, không ai đổi số, không ai lên quyền, không lỗi', async () => {
    const P = phone();
    grantIds.push((await prisma.roleGrant.create({ data: { phone: P, role: 'STAFF', grantedBy: 'it' } })).id);
    const a = await mkUser();
    const b = await mkUser();
    zaloPhone = P;
    await Promise.all([login(a), login(b)]);
    for (const u of [a, b]) {
      const after = await fresh(u.id);
      expect(after.role).toBe('CUSTOMER');
      expect(after.phone).toBe(u.phone);
    }
  });

  it('số mới tự do: hai tài khoản đua nhận cùng một số, đúng một người nhận được, người kia giữ số cũ, không ai lỗi', async () => {
    const P = phone();
    const a = await mkUser();
    const b = await mkUser();
    zaloPhone = P;
    await Promise.all([login(a), login(b)]);
    const phones = [(await fresh(a.id)).phone, (await fresh(b.id)).phone];
    expect(phones.filter((p) => p === P)).toHaveLength(1);
  });

  it('tài khoản STAFF đang có số: Zalo trả số khác thì không đổi số, không đổi mốc xác minh', async () => {
    const staff = await mkUser({ role: 'STAFF', phoneVerifiedAt: new Date('2026-01-01') });
    zaloPhone = phone();
    await login(staff);
    const after = await fresh(staff.id);
    expect(after.phone).toBe(staff.phone);
    expect(after.phoneVerifiedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('số cũ còn grant hiệu lực: không đổi số dù tài khoản đang là CUSTOMER', async () => {
    const oldPhone = phone();
    grantIds.push((await prisma.roleGrant.create({ data: { phone: oldPhone, role: 'STAFF', grantedBy: 'it' } })).id);
    const u = await mkUser({ phone: oldPhone });
    zaloPhone = phone();
    await login(u);
    expect((await fresh(u.id)).phone).toBe(oldPhone);
  });

  it('CUSTOMER đổi số bình thường sang số tự do: đổi và đặt mốc xác minh mới (đối chứng)', async () => {
    const u = await mkUser();
    const P = phone();
    zaloPhone = P;
    await login(u);
    const after = await fresh(u.id);
    expect(after.phone).toBe(P);
    expect(after.phoneVerifiedAt!.getTime()).toBeGreaterThan(Date.now() - 10_000);
  });
});
