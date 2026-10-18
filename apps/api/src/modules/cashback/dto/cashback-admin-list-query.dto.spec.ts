import { ValidationPipe } from '@nestjs/common';
import { CashbackStatus } from '@prisma/client';
import { CashbackAdminListQuery } from './cashback-admin-list-query.dto';
import { CashbackAdminController } from '../cashback-admin.controller';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const as = (value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'query', metatype: CashbackAdminListQuery, data: undefined });

describe('GET /admin/cashback/transactions: validate query', () => {
  it('mọi giá trị của enum CashbackStatus trong schema đều được nhận', async () => {
    for (const status of Object.values(CashbackStatus)) {
      await expect(as({ status, take: '50' })).resolves.toMatchObject({ status, take: '50' });
    }
    await expect(as({})).resolves.toEqual({});
  });

  it('status rỗng coi như không lọc (controller cũ dùng `status ?`)', async () => {
    expect(((await as({ status: '' })) as CashbackAdminListQuery).status).toBeUndefined();
  });

  it('status ngoài enum, sai hoa/thường hoặc mảng → 400 (trước đây 500)', async () => {
    for (const status of ['FOO', 'pending', ['PENDING', 'PAID'], { a: 'b' }]) {
      await expect(as({ status })).rejects.toThrow();
    }
  });

  it('take không phải số hoặc mảng → 400', async () => {
    for (const take of ['abc', ['1', '2']]) await expect(as({ take })).rejects.toThrow();
  });

  it('query lạ vẫn bị 400', async () => {
    await expect(as({ foo: 'x' })).rejects.toThrow();
  });

  it('controller khai báo query bằng DTO và vẫn chuyển status/take cho service', () => {
    const types = Reflect.getMetadata('design:paramtypes', CashbackAdminController.prototype, 'list') as unknown[];
    expect(types).toContain(CashbackAdminListQuery);
    const cashback = { adminListTransactions: jest.fn() };
    const c = new CashbackAdminController(cashback as never);
    c.list({ status: 'PENDING', take: '30' }, 'ADMIN');
    expect(cashback.adminListTransactions).toHaveBeenCalledWith('PENDING', 30, { maskPhones: false });
    c.list({}, 'STAFF');
    expect(cashback.adminListTransactions).toHaveBeenLastCalledWith(undefined, undefined, { maskPhones: true });
  });
});
