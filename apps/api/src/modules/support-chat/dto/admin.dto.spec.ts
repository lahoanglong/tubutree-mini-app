import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AdminReplyDto } from './admin.dto';

const check = (body: unknown) => {
  const dto = plainToInstance(AdminReplyDto, { body });
  return { errors: validateSync(dto), dto };
};

describe('AdminReplyDto', () => {
  it('chỉ có khoảng trắng: 400', () => {
    expect(check('   \n ').errors).not.toHaveLength(0);
  });
  it('cắt khoảng trắng hai đầu rồi mới kiểm độ dài', () => {
    const r = check(` ${'a'.repeat(1000)} `);
    expect(r.errors).toHaveLength(0);
    expect(r.dto.body).toBe('a'.repeat(1000));
    expect(check('a'.repeat(1001)).errors).not.toHaveLength(0);
  });
});
