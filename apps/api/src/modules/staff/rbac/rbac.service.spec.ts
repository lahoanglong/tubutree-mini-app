import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { RbacService } from './rbac.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { MerchantFulfilmentService } from '../../merchant/merchant-fulfilment.service';
import type { User } from '@prisma/client';

const fulfilment = () =>
  ({
    settlementConfig: jest.fn().mockResolvedValue({}),
    clearPartnerOnRoleLoss: jest.fn().mockResolvedValue(undefined),
  }) as unknown as MerchantFulfilmentService & { clearPartnerOnRoleLoss: jest.Mock };

const mkUser = (over: Partial<User> = {}): User =>
  ({ id: 'u1', phone: '0900000001', role: 'CUSTOMER', ...over }) as unknown as User;

function makePrisma(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    roleGrant: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    commission: { findFirst: jest.fn().mockResolvedValue(null) }, storefront: { findFirst: jest.fn().mockResolvedValue(null) },
    dealerApplication: { findFirst: jest.fn().mockResolvedValue(null) },
    userAdminEvent: { create: jest.fn().mockResolvedValue({}) },
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const merged: Record<string, unknown> = { ...base, ...over, roleGrant: { ...(base.roleGrant as object), ...((over.roleGrant as object | undefined) ?? {}) } };
  // addGrant/revokeGrant chạy trong $transaction(tx => ...) — mock tx = chính client này để
  // dùng lại các jest.fn() (roleGrant/user/dealerApplication) đã override ở trên.
  merged.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(merged));
  return merged as unknown as PrismaService;
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
      expect.objectContaining({ where: { id: 'u1' }, data: { role: 'STAFF', staffPermissions: [] } }),
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

describe('RbacService.applyGrants: khoá dòng người dùng rồi đọc lại (L1-02)', () => {
  it('có grant cao hơn: mở giao dịch, khoá role_grants rồi users FOR NO KEY UPDATE, sau đó mới đọc lại grant và nâng', async () => {
    const order: string[] = [];
    const prisma = makePrisma({
      roleGrant: {
        findMany: jest.fn(async () => {
          order.push('grants');
          return [{ role: 'ADMIN' }];
        }),
      },
      user: {
        update: jest.fn(async () => {
          order.push('update');
          return mkUser({ role: 'ADMIN' });
        }),
      },
      $queryRaw: jest.fn(async (s: TemplateStringsArray) => {
        const sql = s.join('?');
        order.push(/FOR NO KEY UPDATE/.test(sql) ? (/role_grants/.test(sql) ? 'lock-grants' : 'lock-users') : 'raw');
        return [{ role: 'CUSTOMER', staffPermissions: [] }];
      }),
    });
    const out = await new RbacService(prisma).applyGrants(mkUser());
    expect(out.role).toBe('ADMIN');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Thứ tự khoá thống nhất: role_grants trước, users sau, rồi mới đọc lại grant và ghi.
    expect(order).toEqual(['grants', 'lock-grants', 'lock-users', 'grants', 'update']);
  });

  it('grant bị thu hồi trong lúc chờ khoá (đọc lại không còn) → không nâng, trả nguyên user', async () => {
    const findMany = jest.fn().mockResolvedValueOnce([{ role: 'ADMIN' }]).mockResolvedValueOnce([]);
    const prisma = makePrisma({
      roleGrant: { findMany },
      user: { update: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ role: 'CUSTOMER', staffPermissions: [] }]),
    });
    const out = await new RbacService(prisma).applyGrants(mkUser());
    expect(out.role).toBe('CUSTOMER');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('bản user cũ nói CUSTOMER nhưng DB đã ADMIN (đọc lại sau khoá) → không ghi đè, không ghi sổ', async () => {
    const prisma = makePrisma({
      roleGrant: { findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }]) },
      user: { update: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ role: 'ADMIN', staffPermissions: [] }]),
    });
    const out = await new RbacService(prisma).applyGrants(mkUser());
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(out.role).toBe('ADMIN');
  });

  it('không có grant nào cao hơn thì không mở giao dịch (đường đăng nhập thường không tốn thêm round-trip)', async () => {
    const prisma = makePrisma({ roleGrant: { findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }]) } });
    await new RbacService(prisma).applyGrants(mkUser({ role: 'ADMIN' }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('revokeGrantsAbove dùng client truyền vào (tx của setUserRole) thay cho client gốc', async () => {
    const prisma = makePrisma();
    const txUpdate = jest.fn().mockResolvedValue({ count: 2 });
    const tx = { roleGrant: { updateMany: txUpdate } } as never;
    const count = await new RbacService(prisma).revokeGrantsAbove('0900000001', 'CUSTOMER', tx);
    expect(count).toBe(2);
    expect(txUpdate).toHaveBeenCalled();
    expect(prisma.roleGrant.updateMany as jest.Mock).not.toHaveBeenCalled();
  });
});

describe('RbacService: lý do của admin vào lịch sử vai trò (L1-08)', () => {
  it('applyGrants có lý do → dòng ROLE mang lý do đó và người làm; không lý do (đăng nhập) giữ chữ cũ', async () => {
    const mk = () =>
      makePrisma({
        roleGrant: { findMany: jest.fn().mockResolvedValue([{ role: 'STAFF', staffPermissions: [] }]) },
        user: { update: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })) },
      });
    const a = mk();
    await new RbacService(a).applyGrants(mkUser(), a, 'admin1', 'Nhân viên kho mới');
    expect(a.userAdminEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'ROLE', reason: 'Cấp quyền theo SĐT: Nhân viên kho mới', actorId: 'admin1' }),
    });
    const b = mk();
    await new RbacService(b).applyGrants(mkUser());
    expect(b.userAdminEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'ROLE', reason: 'Áp quyền cấp theo SĐT' }) });
  });
});

describe('RbacService.applyGrants: nhóm việc của lời mời', () => {
  it('lời mời STAFF có nhóm → user đăng nhập lần đầu nhận đúng nhóm và có dòng sổ', async () => {
    const prisma = makePrisma({
      roleGrant: { findMany: jest.fn().mockResolvedValue([{ role: 'STAFF', staffPermissions: ['KHO', 'CSKH'] }]) },
      user: { update: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })) },
    });
    await new RbacService(prisma).applyGrants(mkUser());
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { role: 'STAFF', staffPermissions: ['CSKH', 'KHO'] } }),
    );
    expect(prisma.userAdminEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', kind: 'STAFF_PERMISSIONS', fromValue: '', toValue: 'CSKH,KHO' }),
    });
  });

  it('lời mời STAFF không có nhóm → nâng lên STAFF với nhóm rỗng', async () => {
    const prisma = makePrisma({
      roleGrant: { findMany: jest.fn().mockResolvedValue([{ role: 'STAFF', staffPermissions: [] }]) },
      user: { update: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })) },
    });
    await new RbacService(prisma).applyGrants(mkUser());
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'STAFF', staffPermissions: [] } }));
  });

  it('nâng CUSTOMER còn sót nhóm lên STAFF, lời mời không ghi nhóm → nhóm bị xoá và có dòng sổ', async () => {
    const prisma = makePrisma({
      roleGrant: { findMany: jest.fn().mockResolvedValue([{ role: 'STAFF', staffPermissions: [] }]) },
      user: { update: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })) },
    });
    await new RbacService(prisma).applyGrants(mkUser({ staffPermissions: ['KE_TOAN'] } as Partial<User>));
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'STAFF', staffPermissions: [] } }),
    );
    expect(prisma.userAdminEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'STAFF_PERMISSIONS', fromValue: 'KE_TOAN', toValue: '' }),
    });
  });

  it('nâng CUSTOMER không có nhóm cũ, lời mời không ghi nhóm → đặt [] nhưng không ghi dòng sổ nhóm', async () => {
    const prisma = makePrisma({
      roleGrant: { findMany: jest.fn().mockResolvedValue([{ role: 'STAFF', staffPermissions: [] }]) },
      user: { update: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })) },
    });
    await new RbacService(prisma).applyGrants(mkUser());
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'STAFF', staffPermissions: [] } }),
    );
    expect(prisma.userAdminEvent.create).toHaveBeenCalledTimes(1);
  });

  it('lời mời ADMIN (dù có ghi nhóm) → nâng ADMIN, không chép nhóm', async () => {
    const prisma = makePrisma({
      roleGrant: { findMany: jest.fn().mockResolvedValue([{ role: 'ADMIN', staffPermissions: ['KHO'] }]) },
      user: { update: jest.fn().mockResolvedValue(mkUser({ role: 'ADMIN' })) },
    });
    await new RbacService(prisma).applyGrants(mkUser());
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'ADMIN' } }));
  });
});

describe('RbacService: lời mời quyền theo SĐT hết hạn (L1-05)', () => {
  const DAY = 864e5;
  const cfg = (days?: unknown) => ({ get: jest.fn(async (_k: string, fb: unknown) => (days === undefined ? fb : days)) }) as never;
  const inviteDb = (over: Record<string, unknown> = {}) =>
    makePrisma({
      roleGrant: { findFirst: jest.fn().mockResolvedValue(null), createMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
      ...over,
    });
  const expiryOf = (prisma: PrismaService) => (prisma.roleGrant.createMany as jest.Mock).mock.calls[0][0].data[0].expiresAt as Date | null | undefined;

  it('mời ADMIN cho SĐT chưa có tài khoản → 400, không tạo grant', async () => {
    const prisma = inviteDb();
    await expect(new RbacService(prisma).addGrant('admin1', '0900000002', 'ADMIN')).rejects.toThrow(
      'Chỉ cấp quyền quản trị cho số điện thoại đã có tài khoản. Nhờ người đó đăng nhập Tubu Tree một lần trước.',
    );
    await expect(new RbacService(inviteDb()).addGrant('admin1', '0900000002', 'ADMIN')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.roleGrant.createMany).not.toHaveBeenCalled();
  });

  it('mời STAFF cho SĐT chưa có tài khoản → hạn mặc định 7 ngày', async () => {
    const prisma = inviteDb();
    const before = Date.now();
    await new RbacService(prisma).addGrant('admin1', '0900000002', 'STAFF');
    const at = expiryOf(prisma)!.getTime();
    expect(at).toBeGreaterThanOrEqual(before + 7 * DAY - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 7 * DAY + 1000);
  });

  it('hạn theo cấu hình staff.grant_invite_ttl_days; giá trị sai quay về 7 ngày', async () => {
    const prisma = inviteDb();
    const svc = new RbacService(prisma, undefined, cfg(3));
    await svc.addGrant('admin1', '0900000002', 'STAFF');
    expect(expiryOf(prisma)!.getTime()).toBeLessThan(Date.now() + 3 * DAY + 1000);
    const bad = inviteDb();
    await new RbacService(bad, undefined, cfg('abc')).addGrant('admin1', '0900000002', 'STAFF');
    expect(expiryOf(bad)!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
  });

  it('SĐT đã có tài khoản → grant áp ngay, không có hạn', async () => {
    const prisma = inviteDb({
      roleGrant: { findFirst: jest.fn().mockResolvedValue(null), createMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }]), updateMany: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue(mkUser()), update: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })) },
    });
    await new RbacService(prisma).addGrant('admin1', '0900000001', 'STAFF');
    expect(expiryOf(prisma) ?? null).toBeNull();
  });

  it('mời lại lời mời đang chờ → gia hạn thêm một kỳ', async () => {
    const update = jest.fn();
    const prisma = inviteDb({
      roleGrant: { findFirst: jest.fn().mockResolvedValue({ id: 'g1', staffPermissions: [] }), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update },
    });
    await new RbacService(prisma).addGrant('admin1', '0900000002', 'STAFF');
    expect(update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { expiresAt: expect.any(Date) } });
    expect(prisma.roleGrant.createMany).not.toHaveBeenCalled();
  });

  it('applyGrants chỉ tính grant chưa hết hạn (expiresAt rỗng hoặc còn sau bây giờ)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = makePrisma({ roleGrant: { findMany } });
    await new RbacService(prisma).applyGrants(mkUser());
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      phone: '0900000001',
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
    });
  });

  it('nâng quyền xong thì bỏ hạn của các grant đã áp (expiresAt = null)', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({
      roleGrant: { findMany: jest.fn().mockResolvedValue([{ id: 'g1', role: 'STAFF', staffPermissions: [], expiresAt: new Date(Date.now() + DAY) }]), updateMany },
      user: { update: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })) },
    });
    await new RbacService(prisma).applyGrants(mkUser());
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: ['g1'] }, expiresAt: { not: null } }, data: { expiresAt: null } });
  });

  // M1: lời mời ADMIN quá hạn không được sống lại khi một lần cấp khác chạm vào người đó.
  it('grant quá hạn gặp ở lần nâng quyền thì bị thu hồi, không được xoá hạn và không được dùng để nâng', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({
      roleGrant: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'gA', role: 'ADMIN', staffPermissions: [], expiresAt: new Date(Date.now() - DAY) },
          { id: 'gS', role: 'STAFF', staffPermissions: [], expiresAt: new Date(Date.now() + DAY) },
        ]),
        updateMany,
      },
      user: { update: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })) },
    });
    await new RbacService(prisma).applyGrants(mkUser());
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'STAFF' }) }));
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: ['gA'] }, revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: ['gS'] }, expiresAt: { not: null } }, data: { expiresAt: null } });
    expect(updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: expect.arrayContaining(['gA']) }, expiresAt: { not: null } }) }));
  });

  it('listStaff: chỉ lấy lời mời chưa hết hạn và trả kèm hạn', async () => {
    const findMany = jest.fn().mockResolvedValue([{ phone: '0911', role: 'STAFF', staffPermissions: [], createdAt: new Date(), expiresAt: new Date(Date.now() + DAY) }]);
    const prisma = makePrisma({ user: { findMany: jest.fn().mockResolvedValue([]) }, roleGrant: { findMany } });
    const out = await new RbacService(prisma).listStaff();
    expect(findMany.mock.calls[0][0].where).toMatchObject({ revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] });
    expect(findMany.mock.calls[0][0].select.expiresAt).toBe(true);
    expect(out.pendingInvites[0]).toHaveProperty('expiresAt');
  });
});

describe('RbacService: lý do nằm lại ở grant và lịch sử (m2)', () => {
  it('tạo lời mời ghi note = lý do; mời lại lời mời đang chờ gia hạn và cập nhật note', async () => {
    const create = jest.fn().mockResolvedValue({ count: 1 });
    const a = makePrisma({ roleGrant: { findFirst: jest.fn().mockResolvedValue(null), createMany: create }, user: { findUnique: jest.fn().mockResolvedValue(null) } });
    await new RbacService(a).addGrant('admin1', '0900000009', 'STAFF', undefined, 'nhân viên kho mới');
    expect(create.mock.calls[0][0].data[0].note).toBe('nhân viên kho mới');
    const update = jest.fn().mockResolvedValue({});
    const b = makePrisma({ roleGrant: { findFirst: jest.fn().mockResolvedValue({ id: 'g1', staffPermissions: [] }), update }, user: { findUnique: jest.fn().mockResolvedValue(null) } });
    await new RbacService(b).addGrant('admin1', '0900000009', 'STAFF', undefined, 'gia hạn vì chưa kịp mở app');
    expect(update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { expiresAt: expect.any(Date), note: 'gia hạn vì chưa kịp mở app' } });
  });

  it('mời người đã có đủ quyền: vẫn ghi một dòng ROLE kèm lý do', async () => {
    const prisma = makePrisma({
      roleGrant: { findFirst: jest.fn().mockResolvedValue({ id: 'g1', staffPermissions: [] }), findMany: jest.fn().mockResolvedValue([{ id: 'g1', role: 'STAFF', staffPermissions: [], expiresAt: null }]) },
      user: { findUnique: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' } as Partial<User>)) },
    });
    const out = await new RbacService(prisma).addGrant('admin1', '0900000001', 'STAFF', undefined, 'xác nhận lại');
    expect(out).toEqual({ granted: 'STAFF', applied: false, permissionsChanged: false });
    expect(prisma.userAdminEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', kind: 'ROLE', fromValue: 'STAFF', toValue: 'STAFF', actorId: 'admin1', reason: expect.stringContaining('xác nhận lại') }),
    });
  });

  it('thu hồi có lý do: nối lý do vào ghi chú của các grant vừa thu hồi', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const prisma = makePrisma({ $executeRaw: executeRaw, user: { findUnique: jest.fn().mockResolvedValue(null) }, roleGrant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } });
    await new RbacService(prisma, fulfilment()).revokeGrant('admin1', '0900000009', 'nhập nhầm số');
    const noteCall = executeRaw.mock.calls.find((c) => (c[0] as string[]).join('?').includes('"note"'));
    expect(noteCall).toBeDefined();
    expect(noteCall!.slice(1)).toEqual(expect.arrayContaining(['Thu hồi: nhập nhầm số', ' | Thu hồi: nhập nhầm số']));
  });
});

describe('RbacService.addGrant: lời mời cũ quá hạn (M2)', () => {
  it('thu hồi dòng quá hạn cùng giao dịch trước khi tìm dòng đang mở', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = makePrisma({
      roleGrant: { updateMany, findFirst, createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await new RbacService(prisma).addGrant('admin1', '0900000009', 'STAFF');
    expect(updateMany).toHaveBeenCalledWith({
      where: { phone: '0900000009', role: 'STAFF', revokedAt: null, expiresAt: { lte: expect.any(Date) } },
      data: { revokedAt: expect.any(Date) },
    });
    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(findFirst.mock.invocationCallOrder[0]!);
  });
});

describe('RbacService.addGrant', () => {
  it('tạo grant + áp ngay nếu user đã tồn tại (role thấp hơn)', async () => {
    const prisma = makePrisma({
      roleGrant: {
        findFirst: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(mkUser()),
        update: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })),
      },
    });
    const out = await new RbacService(prisma).addGrant('admin1', ' 0900000001 ', 'STAFF');
    expect(prisma.roleGrant.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ phone: '0900000001', role: 'STAFF', grantedBy: 'admin1' })],
      }),
    );
    expect(out.applied).toBe(true);
  });

  it('grant đã tồn tại (active, cùng role) → không tạo trùng', async () => {
    const prisma = makePrisma({
      roleGrant: {
        findFirst: jest.fn().mockResolvedValue({ id: 'g1', role: 'STAFF' }),
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }]),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await new RbacService(prisma).addGrant('admin1', '0900000001', 'STAFF');
    expect(prisma.roleGrant.createMany).not.toHaveBeenCalled();
  });

  it('user chưa tồn tại → chỉ tạo grant, applied=false', async () => {
    const prisma = makePrisma({
      roleGrant: {
        findFirst: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const out = await new RbacService(prisma).addGrant('admin1', '0900000002', 'STAFF');
    expect(out.applied).toBe(false);
  });

  // Hai addGrant đồng thời cùng phone+role: bản thua gặp ON CONFLICT DO NOTHING (count 0), không ném lỗi trong tx
  // nên bước applyGrants ngay sau vẫn chạy được (bắt P2002 trong tx gây 25P02).
  it('RC-05: createMany không chèn dòng nào (bản kia đã cấp) → vẫn áp role cho user, không throw', async () => {
    const prisma = makePrisma({
      roleGrant: {
        findFirst: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([{ role: 'STAFF' }]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(mkUser()),
        update: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })),
      },
    });
    const out = await new RbacService(prisma).addGrant('admin1', '0900000001', 'STAFF');
    expect(out.applied).toBe(true);
    expect(prisma.roleGrant.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it('RC-05: request thua đọc lại user sau createMany, bên thắng đã nâng STAFF → không nâng/ghi sổ lần hai, áp nhóm của mình', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(mkUser())
      .mockResolvedValueOnce(mkUser({ role: 'STAFF', staffPermissions: ['KHO'] } as Partial<User>));
    const prisma = makePrisma({
      roleGrant: {
        findFirst: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([{ role: 'STAFF', staffPermissions: ['KHO'] }]),
      },
      user: { findUnique, update: jest.fn().mockResolvedValue({}) },
    });
    const out = await new RbacService(prisma).addGrant('admin1', '0900000001', 'STAFF', ['CSKH']);
    expect(out.applied).toBe(false);
    expect(out.permissionsChanged).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { staffPermissions: ['CSKH'] } });
    const kinds = (prisma.userAdminEvent.create as jest.Mock).mock.calls.map((c) => c[0].data.kind);
    expect(kinds).toEqual(['STAFF_PERMISSIONS']);
  });

  it('lỗi hạ tầng khi tạo grant → vẫn throw (không nuốt lỗi hạ tầng khác)', async () => {
    const prisma = makePrisma({
      roleGrant: {
        findFirst: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockRejectedValue(new Error('DB down')),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(new RbacService(prisma).addGrant('admin1', '0900000001', 'STAFF')).rejects.toThrow('DB down');
  });
});

describe('RbacService.revokeGrant', () => {
  it.each([
    ['còn hoa hồng', { commission: true, storefront: false }],
    ['còn gian hàng CTV', { commission: false, storefront: true }],
    ['chưa từng bán', { commission: false, storefront: false }],
  ])('nhân viên về CUSTOMER %s → không đụng dấu thu hồi (không đặt, không xoá)', async (_label, traces) => {
    const prisma = makePrisma({
      roleGrant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: { findUnique: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })), update: jest.fn().mockResolvedValue(mkUser({ role: 'CUSTOMER' })) },
      commission: { findFirst: jest.fn().mockResolvedValue(traces.commission ? { id: 'c' } : null) },
      storefront: { findFirst: jest.fn().mockResolvedValue(traces.storefront ? { id: 's' } : null) },
      dealerApplication: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await new RbacService(prisma, fulfilment()).revokeGrant('admin1', '0900000001');
    expect((prisma.user.update as jest.Mock).mock.calls[0][0].data).not.toHaveProperty('affiliateRevokedAt');
  });

  it('thu hồi grant + hạ user STAFF về CUSTOMER (không có đơn đại lý)', async () => {
    const prisma = makePrisma({
      roleGrant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: {
        findUnique: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF' })),
        update: jest.fn().mockResolvedValue(mkUser({ role: 'CUSTOMER' })),
      },
      commission: { findFirst: jest.fn().mockResolvedValue(null) }, storefront: { findFirst: jest.fn().mockResolvedValue(null) },
      dealerApplication: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const out = await new RbacService(prisma, fulfilment()).revokeGrant('admin1', '0900000001');
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
      commission: { findFirst: jest.fn().mockResolvedValue(null) }, storefront: { findFirst: jest.fn().mockResolvedValue(null) },
      dealerApplication: { findFirst: jest.fn().mockResolvedValue({ id: 'app1' }) },
    });
    const out = await new RbacService(prisma, fulfilment()).revokeGrant('admin1', '0900000001');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'DEALER' } }),
    );
    expect(out.downgraded).toBe(true);
  });

  it('người đã bị đặt dấu thu hồi CTV: thu hồi nhân viên về DEALER (đơn đại lý còn APPROVED) KHÔNG xoá dấu', async () => {
    const prisma = makePrisma({
      roleGrant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: {
        findUnique: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF', affiliateRevokedAt: new Date() })),
        update: jest.fn().mockResolvedValue(mkUser({ role: 'DEALER' })),
      },
      commission: { findFirst: jest.fn().mockResolvedValue(null) }, storefront: { findFirst: jest.fn().mockResolvedValue(null) },
      dealerApplication: { findFirst: jest.fn().mockResolvedValue({ id: 'app1' }) },
    });
    await new RbacService(prisma, fulfilment()).revokeGrant('admin1', '0900000001');
    const data = (prisma.user.update as jest.Mock).mock.calls[0][0].data as { affiliateRevokedAt?: Date | null };
    expect(data).not.toHaveProperty('affiliateRevokedAt');
  });

  it('user đang DEALER → thu hồi grant nhưng KHÔNG hạ (không phải STAFF/ADMIN)', async () => {
    const prisma = makePrisma({
      roleGrant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: { findUnique: jest.fn().mockResolvedValue(mkUser({ role: 'DEALER' })), update: jest.fn() },
    });
    const out = await new RbacService(prisma, fulfilment()).revokeGrant('admin1', '0900000001');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(out.downgraded).toBe(false);
  });
});

describe('RbacService.revokeGrantsAbove', () => {
  // P0-3 (docs/2026-09-08-review-progress.md): admin.setUserRole hạ quyền qua User.role trực
  // tiếp, KHÔNG đụng RoleGrant — lần refresh token tiếp theo, applyGrants (chỉ nâng không hạ)
  // đọc thấy grant ADMIN còn active rồi tự phục hồi. setUserRole phải gọi hàm này để thu hồi
  // MỌI grant xếp hạng CAO HƠN role admin vừa gán, nếu không cứ hạ xong lại tự nâng lại.
  it('hạ role thấp hơn grant đang có → thu hồi grant xếp hạng cao hơn role mới', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({ roleGrant: { updateMany, findMany: jest.fn() } });
    const count = await new RbacService(prisma).revokeGrantsAbove('0900000001', 'CUSTOMER');
    expect(updateMany).toHaveBeenCalledWith({
      where: { phone: '0900000001', revokedAt: null, role: { in: ['STAFF', 'ADMIN'] } },
      data: { revokedAt: expect.any(Date) },
    });
    expect(count).toBe(1);
  });

  it('gán role ADMIN (cao nhất) → không có grant nào xếp hạng cao hơn, KHÔNG gọi updateMany', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = makePrisma({ roleGrant: { updateMany } });
    const count = await new RbacService(prisma).revokeGrantsAbove('0900000001', 'ADMIN');
    expect(updateMany).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('gán DEALER (thấp hơn cả STAFF lẫn ADMIN) → thu hồi CẢ 2 loại grant', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({ roleGrant: { updateMany } });
    await new RbacService(prisma).revokeGrantsAbove('0900000001', 'DEALER');
    expect(updateMany).toHaveBeenCalledWith({
      where: { phone: '0900000001', revokedAt: null, role: { in: ['STAFF', 'ADMIN'] } },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('gán STAFF → chỉ thu hồi grant ADMIN (cao hơn STAFF), giữ nguyên grant STAFF cùng cấp', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = makePrisma({ roleGrant: { updateMany } });
    await new RbacService(prisma).revokeGrantsAbove('0900000001', 'STAFF');
    expect(updateMany).toHaveBeenCalledWith({
      where: { phone: '0900000001', revokedAt: null, role: { in: ['ADMIN'] } },
      data: { revokedAt: expect.any(Date) },
    });
  });
});

describe('RbacService.revokeGrant — không tự khoá tổ chức ra ngoài', () => {
  function txWith(user: Record<string, unknown> | null, otherActiveAdmins = 3) {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
      roleGrant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(otherActiveAdmins),
      },
      commission: { findFirst: jest.fn().mockResolvedValue(null) }, storefront: { findFirst: jest.fn().mockResolvedValue(null) },
      dealerApplication: { findFirst: jest.fn().mockResolvedValue(null) },
      userAdminEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    return { prisma, tx };
  }

  it('admin bấm Thu hồi trên dòng CHÍNH MÌNH → từ chối, không hạ role', async () => {
    const { prisma, tx } = txWith({ id: 'admin1', role: 'ADMIN' });
    await expect(new RbacService(prisma, fulfilment()).revokeGrant('admin1', '0899625240')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('thu hồi ADMIN CUỐI CÙNG → từ chối', async () => {
    const { prisma, tx } = txWith({ id: 'u2', role: 'ADMIN' }, 0);
    await expect(new RbacService(prisma, fulfilment()).revokeGrant('admin1', '0899625240')).rejects.toThrow(/quản trị viên cuối cùng/);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.user.count).toHaveBeenCalledWith({ where: { role: 'ADMIN', isBlocked: false, id: { not: 'u2' } } });
  });

  // R4-ADMIN-6: hai admin cuối cùng thu hồi nhau cùng lúc — khoá chung trước khi đọc vai trò và đếm.
  it('lấy khoá advisory chung trước mọi lần đọc/ghi trong transaction', async () => {
    const { prisma, tx } = txWith({ id: 'u2', role: 'ADMIN' }, 1);
    await new RbacService(prisma, fulfilment()).revokeGrant('admin1', '0899625240');
    const lockAt = tx.$executeRaw.mock.invocationCallOrder[0]!;
    expect(lockAt).toBeLessThan(tx.roleGrant.updateMany.mock.invocationCallOrder[0]!);
    expect(lockAt).toBeLessThan(tx.user.findUnique.mock.invocationCallOrder[0]!);
  });

  it('khoá dòng users (sau khi khoá grant) trước khi đọc role', async () => {
    const { prisma, tx } = txWith({ id: 'u2', role: 'STAFF' }, 3);
    await new RbacService(prisma, fulfilment()).revokeGrant('admin1', '0899625240', 'nghỉ việc');
    const userLock = tx.$queryRaw.mock.calls.findIndex((c: unknown[]) => /FROM "users"[\s\S]*FOR NO KEY UPDATE/.test((c[0] as string[]).join('?')));
    expect(userLock).toBeGreaterThanOrEqual(0);
    expect(tx.roleGrant.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[userLock]!);
    expect(tx.$queryRaw.mock.invocationCallOrder[userLock]!).toBeLessThan(tx.user.findUnique.mock.invocationCallOrder[0]!);
  });

  it('thu hồi một ADMIN khi còn admin khác → vẫn hạ role như cũ', async () => {
    const { prisma, tx } = txWith({ id: 'u2', role: 'ADMIN' }, 1);
    const out = await new RbacService(prisma, fulfilment()).revokeGrant('admin1', '0899625240');
    expect(tx.user.update).toHaveBeenCalled();
    expect(out.downgraded).toBe(true);
  });
});

describe('RbacService.revokeGrant — gian hàng đối tác của chủ (luật B)', () => {
  function txFor(role: string, base: 'CUSTOMER' | 'DEALER') {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
      roleGrant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: { findUnique: jest.fn().mockResolvedValue(mkUser({ role: role as User['role'] })), update: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(2) },
      commission: { findFirst: jest.fn().mockResolvedValue(null) }, storefront: { findFirst: jest.fn().mockResolvedValue(null) },
      dealerApplication: { findFirst: jest.fn().mockResolvedValue(base === 'DEALER' ? { id: 'app' } : null) },
      userAdminEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)) } as unknown as PrismaService;
    return { prisma, tx };
  }

  it('STAFF → CUSTOMER: xử lý gian hàng đối tác TRƯỚC khi ghi users', async () => {
    const { prisma, tx } = txFor('STAFF', 'CUSTOMER');
    const f = fulfilment();
    await new RbacService(prisma, f).revokeGrant('admin1', '0900000001');
    expect(f.clearPartnerOnRoleLoss).toHaveBeenCalledWith(tx, 'u1', 'admin1', {}, 'STAFF');
    expect(f.clearPartnerOnRoleLoss.mock.invocationCallOrder[0]!).toBeLessThan(tx.user.update.mock.invocationCallOrder[0]!);
  });

  it('về DEALER (hồ sơ APPROVED): không đụng gian hàng', async () => {
    const { prisma } = txFor('STAFF', 'DEALER');
    const f = fulfilment();
    await new RbacService(prisma, f).revokeGrant('admin1', '0900000001');
    expect(f.clearPartnerOnRoleLoss).not.toHaveBeenCalled();
  });

  it('gian hàng còn vướng (409) → vẫn gỡ quyền nhân viên về CUSTOMER, không nâng DEALER, storeBlocked=true', async () => {
    const { prisma, tx } = txFor('STAFF', 'CUSTOMER');
    const f = fulfilment();
    f.clearPartnerOnRoleLoss.mockRejectedValueOnce(new ConflictException('vướng'));
    await expect(new RbacService(prisma, f).revokeGrant('admin1', '0900000001')).resolves.toMatchObject({
      downgraded: true,
      role: 'CUSTOMER',
      storeBlocked: true,
    });
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'CUSTOMER' } }));
  });

  it('lỗi khác 409 từ xử lý gian hàng → ném lên, không hạ role', async () => {
    const { prisma, tx } = txFor('STAFF', 'CUSTOMER');
    const f = fulfilment();
    f.clearPartnerOnRoleLoss.mockRejectedValueOnce(new Error('db'));
    await expect(new RbacService(prisma, f).revokeGrant('admin1', '0900000001')).rejects.toThrow('db');
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('bậc đại lý trong metadata (đại lý cấp qua setUserRole, không có đơn) KHÔNG đủ để về DEALER → CUSTOMER, xử lý gian hàng', async () => {
    const { prisma, tx } = txFor('STAFF', 'CUSTOMER');
    tx.user.findUnique.mockResolvedValue(mkUser({ role: 'STAFF', metadata: { dealerTierId: 't1' } } as Partial<User>));
    const f = fulfilment();
    await expect(new RbacService(prisma, f).revokeGrant('admin1', '0900000001')).resolves.toMatchObject({ role: 'CUSTOMER' });
    expect(f.clearPartnerOnRoleLoss).toHaveBeenCalled();
  });

  it('giao dịch có maxWait/timeout rộng như setUserRole (kiểm vướng mắc nặng khi đang giữ khoá danh sách admin)', async () => {
    const { prisma } = txFor('STAFF', 'CUSTOMER');
    await new RbacService(prisma, fulfilment()).revokeGrant('admin1', '0900000001');
    expect((prisma.$transaction as jest.Mock).mock.calls[0][1]).toEqual({ maxWait: 15_000, timeout: 60_000 });
  });

  it('deadlock / hết hạn chờ khoá → 503', async () => {
    const prisma = { $transaction: jest.fn().mockRejectedValue(new Error('deadlock detected (40P01)')) } as unknown as PrismaService;
    await expect(new RbacService(prisma, fulfilment()).revokeGrant('admin1', '0900000001')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

// ADMINOPS-1: admin vừa bị hạ quyền dùng access token cũ tự cấp lại ADMIN cho SĐT của chính mình.
describe('RbacService.addGrant — không tự cấp quyền cho chính mình', () => {
  it('SĐT của chính admin đang thao tác → từ chối, không tạo grant, không nâng role', async () => {
    const prisma = makePrisma({
      roleGrant: { findFirst: jest.fn().mockResolvedValue(null), createMany: jest.fn(), findMany: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue(mkUser({ id: 'u_admin2', phone: '0900000098' })), update: jest.fn() },
    });
    await expect(new RbacService(prisma).addGrant('u_admin2', ' 0900000098 ', 'ADMIN')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.roleGrant.createMany).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('RbacService.addGrant: nhóm việc', () => {
  const noUser = { findUnique: jest.fn().mockResolvedValue(null) };

  it('lưu nhóm trên lời mời theo thứ tự chuẩn, bỏ trùng', async () => {
    const create = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({ roleGrant: { findFirst: jest.fn().mockResolvedValue(null), createMany: create }, user: noUser });
    await new RbacService(prisma).addGrant('admin1', '0900000001', 'STAFF', ['KHO', 'CSKH', 'KHO']);
    expect(create).toHaveBeenCalledWith({
      data: [{ phone: '0900000001', role: 'STAFF', grantedBy: 'admin1', staffPermissions: ['CSKH', 'KHO'], expiresAt: expect.any(Date), note: null }],
      skipDuplicates: true,
    });
  });

  it('không truyền nhóm → lời mời lưu danh sách rỗng như cũ', async () => {
    const create = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({ roleGrant: { findFirst: jest.fn().mockResolvedValue(null), createMany: create }, user: noUser });
    await new RbacService(prisma).addGrant('admin1', '0900000001', 'STAFF');
    expect(create).toHaveBeenCalledWith({
      data: [{ phone: '0900000001', role: 'STAFF', grantedBy: 'admin1', staffPermissions: [], expiresAt: expect.any(Date), note: null }],
      skipDuplicates: true,
    });
  });

  it('lời mời ADMIN không lưu nhóm (quản trị đã có mọi quyền), người đã có tài khoản nên grant không có hạn', async () => {
    const create = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({
      roleGrant: { findFirst: jest.fn().mockResolvedValue(null), createMany: create, findMany: jest.fn().mockResolvedValue([{ role: 'ADMIN' }]) },
      user: { findUnique: jest.fn().mockResolvedValue(mkUser()), update: jest.fn().mockResolvedValue(mkUser({ role: 'ADMIN' })) },
    });
    await new RbacService(prisma).addGrant('admin1', '0900000001', 'ADMIN', ['KHO']);
    expect(create).toHaveBeenCalledWith({ data: [{ phone: '0900000001', role: 'ADMIN', grantedBy: 'admin1', staffPermissions: [], expiresAt: null, note: null }], skipDuplicates: true });
  });

  it('nhóm không hợp lệ → 400, không tạo gì', async () => {
    const create = jest.fn();
    const prisma = makePrisma({ roleGrant: { findFirst: jest.fn(), createMany: create }, user: noUser });
    await expect(new RbacService(prisma).addGrant('admin1', '0900000001', 'STAFF', ['KHO', 'ROOT'])).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('lời mời STAFF đã có, gửi lại với nhóm khác → cập nhật nhóm của lời mời, không tạo trùng', async () => {
    const update = jest.fn().mockResolvedValue({});
    const create = jest.fn();
    const prisma = makePrisma({
      roleGrant: { findFirst: jest.fn().mockResolvedValue({ id: 'g1', staffPermissions: ['KHO'] }), createMany: create, update },
      user: noUser,
    });
    await new RbacService(prisma).addGrant('admin1', '0900000001', 'STAFF', ['KE_TOAN']);
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { staffPermissions: ['KE_TOAN'] } });
  });

  it('lời mời đã có, gửi lại không kèm nhóm → giữ nguyên nhóm đã lưu', async () => {
    const update = jest.fn();
    const prisma = makePrisma({
      roleGrant: { findFirst: jest.fn().mockResolvedValue({ id: 'g1', staffPermissions: ['KHO'] }), createMany: jest.fn(), update },
      user: noUser,
    });
    await new RbacService(prisma).addGrant('admin1', '0900000001', 'STAFF');
    expect(update.mock.calls.filter((c) => 'staffPermissions' in c[0].data)).toEqual([]);
  });

  it('người này đã là STAFF, admin chọn nhóm → nhóm áp ngay và có dòng sổ', async () => {
    const userUpdate = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({
      roleGrant: {
        findFirst: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ role: 'STAFF', staffPermissions: ['CSKH'] }]),
      },
      user: { findUnique: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF', staffPermissions: ['KHO'] } as Partial<User>)), update: userUpdate },
    });
    const out = await new RbacService(prisma).addGrant('admin1', '0900000001', 'STAFF', ['CSKH']);
    // Vai trò không đổi (applied=false) nhưng nhóm đã đổi ngay: app dựa vào cờ này để không báo "sẽ áp khi họ mở app".
    expect(out).toEqual({ granted: 'STAFF', applied: false, permissionsChanged: true });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { staffPermissions: ['CSKH'] } });
    expect(prisma.userAdminEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', kind: 'STAFF_PERMISSIONS', fromValue: 'KHO', toValue: 'CSKH', actorId: 'admin1' }),
    });
  });

  it('người này đã là STAFF, admin không chọn nhóm → nhóm hiện có không bị xoá', async () => {
    const userUpdate = jest.fn();
    const prisma = makePrisma({
      roleGrant: {
        findFirst: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ role: 'STAFF', staffPermissions: [] }]),
      },
      user: { findUnique: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF', staffPermissions: ['KHO'] } as Partial<User>)), update: userUpdate },
    });
    const out = await new RbacService(prisma).addGrant('admin1', '0900000001', 'STAFF', []);
    expect(userUpdate).not.toHaveBeenCalled();
    expect(out.permissionsChanged).toBe(false);
  });

  it('người này đã là STAFF, admin chọn đúng nhóm họ đang có → không ghi, permissionsChanged=false', async () => {
    const userUpdate = jest.fn();
    const prisma = makePrisma({
      roleGrant: {
        findFirst: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ role: 'STAFF', staffPermissions: ['KHO'] }]),
      },
      user: { findUnique: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF', staffPermissions: ['KHO'] } as Partial<User>)), update: userUpdate },
    });
    const out = await new RbacService(prisma).addGrant('admin1', '0900000001', 'STAFF', ['KHO']);
    expect(userUpdate).not.toHaveBeenCalled();
    expect(out.permissionsChanged).toBe(false);
  });

  it('người chưa có tài khoản hoặc vừa được nâng vai trò → permissionsChanged=false (đã có applied cho trường hợp nâng)', async () => {
    const noUserPrisma = makePrisma({ roleGrant: { findFirst: jest.fn().mockResolvedValue(null), createMany: jest.fn().mockResolvedValue({ count: 1 }) }, user: noUser });
    expect(await new RbacService(noUserPrisma).addGrant('admin1', '0900000001', 'STAFF', ['KHO'])).toEqual({ granted: 'STAFF', applied: false, permissionsChanged: false });
    const promoted = makePrisma({
      roleGrant: {
        findFirst: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ role: 'STAFF', staffPermissions: ['KHO'] }]),
      },
      user: { findUnique: jest.fn().mockResolvedValue(mkUser()), update: jest.fn().mockResolvedValue(mkUser({ role: 'STAFF', staffPermissions: ['KHO'] } as Partial<User>)) },
    });
    expect(await new RbacService(promoted).addGrant('admin1', '0900000001', 'STAFF', ['KHO'])).toEqual({ granted: 'STAFF', applied: true, permissionsChanged: false });
  });
});

describe('RbacService.listStaff', () => {
  it('lời mời chờ kèm nhóm việc đã chọn', async () => {
    const grantsFindMany = jest.fn().mockResolvedValue([{ phone: '0900000009', role: 'STAFF', staffPermissions: ['KHO'], createdAt: new Date('2026-01-01') }]);
    const prisma = makePrisma({
      roleGrant: { findMany: grantsFindMany },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const out = await new RbacService(prisma).listStaff();
    expect(grantsFindMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ staffPermissions: true }) }));
    expect(out.pendingInvites).toEqual([expect.objectContaining({ phone: '0900000009', staffPermissions: ['KHO'] })]);
  });
});
