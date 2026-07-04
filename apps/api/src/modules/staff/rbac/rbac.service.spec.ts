import { RbacService } from './rbac.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { User } from '@prisma/client';

const mkUser = (over: Partial<User> = {}): User =>
  ({ id: 'u1', phone: '0900000001', role: 'CUSTOMER', ...over }) as unknown as User;

function makePrisma(over: Record<string, unknown> = {}) {
  const base = {
    roleGrant: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    dealerApplication: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  return { ...base, ...over } as unknown as PrismaService;
}

describe('RbacService.applyGrants', () => {
  it('không có phone → trả nguyên user, không query grant', async () => {
    const prisma = makePrisma();
    const svc = new RbacService(prisma);
    const user = mkUser({ phone: null });
    const out = await svc.applyGrants(user);
    expect(out).toBe(user);
    expect(prisma.roleGrant.findMany as jest.Mock).not.toHaveBeenCalled();
  });

  it('không có grant → giữ nguyên role', async () => {
    const prisma = makePrisma();
    const out = await new RbacService(prisma).applyGrants(mkUser());
    expect(out.role).toBe('CUSTOMER');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('grant STAFF cho khách → nâng lên STAFF', async () => {
    const prisma = makePrisma({
      roleGrant: { findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }]) },
      user: { update: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })) },
    });
    const out = await new RbacService(prisma).applyGrants(mkUser());
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { role: 'STAFF' } }),
    );
    expect(out.role).toBe('STAFF');
  });

  it('có cả STAFF và ADMIN → chọn ADMIN (cao nhất)', async () => {
    const prisma = makePrisma({
      roleGrant: { findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }, { role: 'ADMIN' }]) },
      user: { update: jest.fn().mockResolvedValue(mkUser({ role: 'ADMIN' })) },
    });
    const out = await new RbacService(prisma).applyGrants(mkUser());
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'ADMIN' } }),
    );
    expect(out.role).toBe('ADMIN');
  });

  it('user đã ADMIN, grant STAFF → KHÔNG hạ (giữ ADMIN, không update)', async () => {
    const prisma = makePrisma({
      roleGrant: { findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }]) },
    });
    const out = await new RbacService(prisma).applyGrants(mkUser({ role: 'ADMIN' }));
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(out.role).toBe('ADMIN');
  });

  it('user đang DEALER, grant STAFF → nâng STAFF (STAFF > DEALER)', async () => {
    const prisma = makePrisma({
      roleGrant: { findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }]) },
      user: { update: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })) },
    });
    const out = await new RbacService(prisma).applyGrants(mkUser({ role: 'DEALER' }));
    expect(out.role).toBe('STAFF');
  });
});

describe('RbacService.addGrant', () => {
  it('tạo grant + áp ngay nếu user đã tồn tại (role thấp hơn)', async () => {
    const prisma = makePrisma({
      roleGrant: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'g1', role: 'STAFF' }),
        findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(mkUser()),
        update: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })),
      },
    });
    const out = await new RbacService(prisma).addGrant('admin1', ' 0900000001 ', 'STAFF');
    expect(prisma.roleGrant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phone: '0900000001', role: 'STAFF', grantedBy: 'admin1' }),
      }),
    );
    expect(out.applied).toBe(true);
  });

  it('grant đã tồn tại (active, cùng role) → không tạo trùng', async () => {
    const prisma = makePrisma({
      roleGrant: {
        findFirst: jest.fn().mockResolvedValue({ id: 'g1', role: 'STAFF' }),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }]),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await new RbacService(prisma).addGrant('admin1', '0900000001', 'STAFF');
    expect(prisma.roleGrant.create).not.toHaveBeenCalled();
  });

  it('user chưa tồn tại → chỉ tạo grant, applied=false', async () => {
    const prisma = makePrisma({
      roleGrant: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'g1' }),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const out = await new RbacService(prisma).addGrant('admin1', '0900000002', 'STAFF');
    expect(out.applied).toBe(false);
  });
});

describe('RbacService.revokeGrant', () => {
  it('thu hồi grant + hạ user STAFF về CUSTOMER (không có đơn đại lý)', async () => {
    const prisma = makePrisma({
      roleGrant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: {
        findUnique: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })),
        update: jest.fn().mockResolvedValue(mkUser({ role: 'CUSTOMER' })),
      },
      dealerApplication: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const out = await new RbacService(prisma).revokeGrant('admin1', '0900000001');
    expect(prisma.roleGrant.updateMany).toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'CUSTOMER' } }),
    );
    expect(out.downgraded).toBe(true);
  });

  it('đại lý được nâng lên STAFF, thu hồi → khôi phục DEALER (không mất quyền đại lý)', async () => {
    const prisma = makePrisma({
      roleGrant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: {
        findUnique: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })),
        update: jest.fn().mockResolvedValue(mkUser({ role: 'DEALER' })),
      },
      dealerApplication: { findFirst: jest.fn().mockResolvedValue({ id: 'app1' }) },
    });
    const out = await new RbacService(prisma).revokeGrant('admin1', '0900000001');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'DEALER' } }),
    );
    expect(out.downgraded).toBe(true);
  });

  it('user đang DEALER → thu hồi grant nhưng KHÔNG hạ (không phải STAFF/ADMIN)', async () => {
    const prisma = makePrisma({
      roleGrant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: { findUnique: jest.fn().mockResolvedValue(mkUser({ role: 'DEALER' })), update: jest.fn() },
    });
    const out = await new RbacService(prisma).revokeGrant('admin1', '0900000001');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(out.downgraded).toBe(false);
  });
});
