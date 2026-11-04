import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetUserRoleDto } from './admin.controller';
import { StaffPermissionsDto, UnblockUserDto } from './admin-users.controller';
import { GrantRoleDto } from '../staff/dto/grant-role.dto';
import { RevokeRoleDto } from '../staff/dto/revoke-role.dto';

// L1-08: mọi thay đổi vai trò, nhóm việc, mở khoá, cấp/thu hồi quyền phải có lý do để lịch sử hỏi được "vì sao".
const CASES = [
  ['SetUserRoleDto', SetUserRoleDto, { phone: '0900000001', role: 'STAFF' }],
  ['StaffPermissionsDto', StaffPermissionsDto, { permissions: ['KHO'] }],
  ['UnblockUserDto', UnblockUserDto, {}],
  ['GrantRoleDto', GrantRoleDto, { phone: '0900000001', role: 'STAFF' }],
  ['RevokeRoleDto', RevokeRoleDto, { phone: '0900000001' }],
] as const;

describe.each(CASES)('%s.reason', (_name, Cls, base) => {
  const check = async (reason: unknown) => (await validate(plainToInstance(Cls as never, { ...base, ...(reason === undefined ? {} : { reason }) }))).map((e) => e.property);

  it.each([[undefined], [''], ['  a '], ['ab'], [123], ['x'.repeat(501)]])('từ chối %p', async (reason) => {
    expect(await check(reason)).toEqual(['reason']);
  });

  it('nhận lý do hợp lệ và cắt khoảng trắng hai đầu', async () => {
    expect(await check('  Nhân viên nghỉ việc ')).toEqual([]);
    expect((plainToInstance(Cls as never, { ...base, reason: '  Nhân viên nghỉ việc ' }) as { reason: string }).reason).toBe('Nhân viên nghỉ việc');
  });
});
