import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../../common/validation-pipe';
import { GrantRoleDto } from './grant-role.dto';

const pipe = createValidationPipe();
const run = (value: unknown) => pipe.transform(value, { type: 'body', metatype: GrantRoleDto }) as Promise<GrantRoleDto>;

describe('GrantRoleDto: nhóm việc', () => {
  const base = { phone: '0900000001', role: 'STAFF' };

  it('không có permissions vẫn hợp lệ (như trước)', async () => {
    await expect(run(base)).resolves.toMatchObject(base);
  });

  it('nhận các nhóm hợp lệ', async () => {
    await expect(run({ ...base, permissions: ['CSKH', 'KHO', 'MARKETING', 'KE_TOAN'] })).resolves.toBeDefined();
    await expect(run({ ...base, permissions: [] })).resolves.toBeDefined();
  });

  it('từ chối nhóm lạ, kiểu sai, hoặc quá dài', async () => {
    await expect(run({ ...base, permissions: ['ROOT'] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run({ ...base, permissions: 'KHO' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run({ ...base, permissions: [1] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run({ ...base, permissions: ['KHO', 'KHO', 'KHO', 'KHO', 'KHO'] })).rejects.toBeInstanceOf(BadRequestException);
  });
});
