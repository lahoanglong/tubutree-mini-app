import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../common/validation-pipe';
import { ExternalClaimsAdminController } from './external-claims-admin.controller';

describe('ExternalClaimsAdminController.approve: body qua ValidationPipe thật', () => {
  const metatype = (Reflect.getMetadata('design:paramtypes', ExternalClaimsAdminController.prototype, 'approve') as unknown[])[1] as new () => object;
  const run = (body: unknown) => createValidationPipe().transform(body, { type: 'body', metatype: metatype as never });

  it('metadata kiểu của body là lớp DTO (không phải Object, nếu không pipe bỏ qua kiểm tra)', () => {
    expect(metatype).not.toBe(Object);
  });

  it.each([
    ['note là số', { note: 123 }],
    ['note là mảng', { note: ['a'] }],
    ['note 301 ký tự', { note: 'a'.repeat(301) }],
  ])('%s: 400', async (_n, body) => {
    await expect(run(body)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('body rỗng và ghi chú hợp lệ đi qua', async () => {
    await expect(run({})).resolves.toBeDefined();
    await expect(run({ note: 'Đã gọi khách' })).resolves.toMatchObject({ note: 'Đã gọi khách' });
  });
});
