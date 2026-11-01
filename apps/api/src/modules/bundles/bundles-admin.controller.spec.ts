import { BundlesAdminController } from './bundles-admin.controller';

describe('BundlesAdminController: người thao tác', () => {
  const svc = {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue({ ok: true }),
  };
  const ctrl = new BundlesAdminController(svc as never);
  const admin = { sub: 'u-admin', role: 'ADMIN' } as never;
  const staff = { sub: 'u-staff', role: 'STAFF' } as never;

  it('quản trị viên không bị tính là nhân viên; nhân viên bị tính (để áp trần và quyền sở hữu)', async () => {
    await ctrl.create(admin, { kind: 'ADDON' } as never);
    expect(svc.create).toHaveBeenLastCalledWith({ kind: 'ADDON' }, { id: 'u-admin', staff: false });
    await ctrl.update(staff, 'b1', { title: 'A' } as never);
    expect(svc.update).toHaveBeenLastCalledWith('b1', { title: 'A' }, { id: 'u-staff', staff: true });
    await ctrl.remove(staff, 'b1');
    expect(svc.remove).toHaveBeenLastCalledWith('b1', { id: 'u-staff', staff: true });
  });

  it('danh sách lọc theo trạng thái', async () => {
    await ctrl.list({ status: 'live' });
    expect(svc.list).toHaveBeenLastCalledWith('live');
  });
});
