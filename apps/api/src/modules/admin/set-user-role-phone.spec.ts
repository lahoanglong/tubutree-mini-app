import 'reflect-metadata';
import { createValidationPipe } from '../../common/validation-pipe';
import { SetUserRoleDto } from './admin.controller';

describe('SetUserRoleDto.phone (ô SĐT form Cấp / đổi vai trò)', () => {
  const pipe = createValidationPipe();
  const run = (phone: string) =>
    pipe.transform({ phone, role: 'STAFF', reason: 'Nhân viên mới' }, { type: 'body', metatype: SetUserRoleDto, data: undefined });

  it('SĐT dán dạng +84 có khoảng trắng hoặc dấu chấm vẫn hợp lệ (server chuẩn hoá bằng searchPhone)', async () => {
    await expect(run('+84 912 345 678')).resolves.toBeDefined();
    await expect(run('0912.345.678')).resolves.toBeDefined();
  });

  it.each(['', '   ', '\u200b\u200b\u200b', '\ufeff\u2060'])('SĐT %p (rỗng sau khi bỏ ký tự vô hình) → 400 tiếng Việt', async (phone) => {
    await expect(run(phone)).rejects.toMatchObject({ response: { message: ['Số điện thoại không hợp lệ: ô đang trống.'] } });
  });

  it('chuỗi quá 20 ký tự → 400 tiếng Việt', async () => {
    await expect(run('0'.repeat(21))).rejects.toMatchObject({ response: { message: ['Số điện thoại không được dài quá 20 ký tự.'] } });
  });
});
