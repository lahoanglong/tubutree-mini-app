import { ForbiddenException } from '@nestjs/common';
import { RefillPairsAdminController } from './refill-pairs-admin.controller';

describe('RefillPairsAdminController', () => {
  const build = () => {
    const svc = { adminOverview: jest.fn(async () => ({ rows: [] })), adminSave: jest.fn(async () => ({ rows: [] })) };
    return { svc, ctl: new RefillPairsAdminController(svc as never) };
  };

  it('nhân viên MARKETING sửa cặp được, ghi đúng người sửa', async () => {
    const { svc, ctl } = build();
    await ctl.save({ sub: 'staff-1', role: 'STAFF' } as never, { block: ['a'] });
    expect(svc.adminSave).toHaveBeenCalledWith({ block: ['a'] }, 'staff-1');
  });

  it('bật/tắt cả tính năng chỉ ADMIN', async () => {
    const { svc, ctl } = build();
    expect(() => ctl.save({ sub: 'staff-1', role: 'STAFF' } as never, { enabled: true })).toThrow(ForbiddenException);
    expect(svc.adminSave).not.toHaveBeenCalled();
    await ctl.save({ sub: 'admin-1', role: 'ADMIN' } as never, { enabled: false });
    expect(svc.adminSave).toHaveBeenCalledWith({ enabled: false }, 'admin-1');
  });
});
