import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { createUser, deleteItData, warmPool } from './helpers';
import { cleanupWaste, createWastePoint } from './fixtures/waste-fixtures';

/** GET /auth/me: cờ hasDeskPoint cho nhân viên điểm đối tác (vai CUSTOMER) đọc đúng từ Postgres thật. */
describe('auth /me hasDeskPoint (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let controller: AuthController;
  const userIds: string[] = [];
  const pointIds: string[] = [];

  const me = (id: string) => controller.me({ sub: id } as never) as Promise<{ hasDeskPoint?: boolean; ownsBrand: boolean }>;
  const staffAt = async (o: { pointStatus?: 'ACTIVE' | 'PAUSED' | 'PENDING'; isActive?: boolean }) => {
    const user = await createUser(prisma, {});
    userIds.push(user.id);
    const point = await createWastePoint(prisma, { kind: 'PARTNER' });
    pointIds.push(point.id);
    if (o.pointStatus) await prisma.wastePoint.update({ where: { id: point.id }, data: { status: o.pointStatus } });
    await prisma.wastePointStaff.create({ data: { pointId: point.id, userId: user.id, role: 'STAFF', isActive: o.isActive ?? true } });
    return user;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    const auth = { toAuthUser: (u: { id: string }) => ({ id: u.id }) };
    controller = new AuthController(auth as never, prisma, { get: () => 30 } as never);
  });

  afterAll(async () => {
    await cleanupWaste(prisma, { pointIds });
    await deleteItData(prisma, { userIds });
    await moduleRef?.close();
  });

  it('active staff row at an ACTIVE point: true', async () => {
    const u = await staffAt({});
    expect((await me(u.id)).hasDeskPoint).toBe(true);
  });

  it('a customer who is not staff anywhere: false', async () => {
    const u = await createUser(prisma, {});
    userIds.push(u.id);
    expect((await me(u.id)).hasDeskPoint).toBe(false);
  });

  it('the point is PAUSED: false', async () => {
    const u = await staffAt({ pointStatus: 'PAUSED' });
    expect((await me(u.id)).hasDeskPoint).toBe(false);
  });

  it('the point is still PENDING: false', async () => {
    const u = await staffAt({ pointStatus: 'PENDING' });
    expect((await me(u.id)).hasDeskPoint).toBe(false);
  });

  it('the staff row is switched off: false', async () => {
    const u = await staffAt({ isActive: false });
    expect((await me(u.id)).hasDeskPoint).toBe(false);
  });
});
