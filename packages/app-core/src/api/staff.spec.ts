import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { grantStaff } from './staff';

describe('staff — cấp quyền theo SĐT', () => {
  it('không truyền nhóm việc: body như cũ, không có khoá permissions', async () => {
    const { http, calls } = fakeHttp();
    await grantStaff(http, '0900000001', 'STAFF');
    expect(calls).toEqual([{ method: 'post', path: '/admin/staff/grant', body: { phone: '0900000001', role: 'STAFF' } }]);
  });

  it('truyền nhóm việc: gửi kèm permissions (danh sách rỗng vẫn gửi để xoá nhóm của lời mời)', async () => {
    const { http, calls } = fakeHttp();
    await grantStaff(http, '0900000001', 'STAFF', ['KHO', 'CSKH']);
    await grantStaff(http, '0900000002', 'STAFF', []);
    expect(calls.map((c) => c.body)).toEqual([
      { phone: '0900000001', role: 'STAFF', permissions: ['KHO', 'CSKH'] },
      { phone: '0900000002', role: 'STAFF', permissions: [] },
    ]);
  });
});
