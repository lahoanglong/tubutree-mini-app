import 'reflect-metadata';
import { BadRequestException, RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { STAFF_PERMISSIONS_KEY } from '../../common/staff-permissions';
import { createValidationPipe } from '../../common/validation-pipe';
import { ExternalClaimFunnelQueryDto, ExternalClaimsAdminController, StaleBatchDto } from './external-claims-admin.controller';

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

describe('ExternalClaimsAdminController.staleBatchApprove', () => {
  const pipe = (body: unknown) => createValidationPipe().transform(body, { type: 'body', metatype: StaleBatchDto as never });
  const fn = ExternalClaimsAdminController.prototype.staleBatchApprove;

  it('POST stale-phone-batch, 200, ADMIN + CSKH from the class, declared before :id', () => {
    expect(RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn)]).toBe('POST');
    expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe('stale-phone-batch');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, fn)).toBe(200);
    expect(Reflect.getMetadata(ROLES_KEY, fn)).toBeUndefined();
    expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, fn)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, ExternalClaimsAdminController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, ExternalClaimsAdminController)).toEqual(['CSKH']);
    const names = Object.getOwnPropertyNames(ExternalClaimsAdminController.prototype);
    expect(names.indexOf('staleBatchApprove')).toBeLessThan(names.indexOf('detail'));
  });

  it('delegates to the batch service with the caller id', async () => {
    const staleBatch = { run: jest.fn().mockResolvedValue('ok') };
    const c = new ExternalClaimsAdminController({} as never, staleBatch as never);
    await expect(c.staleBatchApprove({ dryRun: false, claimIds: ['c1'] }, { sub: 'u1', role: 'STAFF' } as never)).resolves.toBe('ok');
    expect(staleBatch.run).toHaveBeenCalledWith('u1', { dryRun: false, claimIds: ['c1'] });
  });

  it.each([
    ['dryRun là chuỗi', { dryRun: 'yes' }],
    ['claimIds không phải mảng', { claimIds: 'c1' }],
    ['51 claim', { claimIds: Array.from({ length: 51 }, (_, i) => `c${i}`) }],
    ['mã claim 41 ký tự', { claimIds: ['a'.repeat(41)] }],
  ])('%s: 400', async (_n, body) => {
    await expect(pipe(body)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('body rỗng (xem trước) và danh sách 50 claim đi qua', async () => {
    await expect(pipe({})).resolves.toBeDefined();
    await expect(pipe({ dryRun: false, claimIds: Array.from({ length: 50 }, (_, i) => `c${i}`) })).resolves.toBeDefined();
  });
});

describe('ExternalClaimsAdminController.funnel', () => {
  const fn = ExternalClaimsAdminController.prototype.funnel;
  const query = (q: unknown) => createValidationPipe().transform(q, { type: 'query', metatype: ExternalClaimFunnelQueryDto as never });

  it('GET funnel, ADMIN + CSKH + KE_TOAN, khai báo trước :id để "funnel" không bị hiểu là id', () => {
    expect(RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn)]).toBe('GET');
    expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe('funnel');
    expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, fn)).toEqual(['CSKH', 'KE_TOAN']);
    expect(Reflect.getMetadata(ROLES_KEY, ExternalClaimsAdminController)).toEqual(['ADMIN']);
    const names = Object.getOwnPropertyNames(ExternalClaimsAdminController.prototype);
    expect(names.indexOf('funnel')).toBeGreaterThan(-1);
    expect(names.indexOf('funnel')).toBeLessThan(names.indexOf('detail'));
  });

  it('bỏ trống kỳ thì lấy 30 ngày; có kỳ thì chuyển đúng kỳ', async () => {
    const admin = { funnel: jest.fn().mockResolvedValue('ok') };
    const c = new ExternalClaimsAdminController(admin as never, {} as never);
    await c.funnel({});
    await c.funnel({ period: '7d' });
    expect(admin.funnel.mock.calls).toEqual([['30d'], ['7d']]);
  });

  it.each([['1d'], ['30'], ['all'], [7]])('kỳ %p: 400', async (period) => {
    await expect(query({ period })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([['7d'], ['30d'], ['90d']])('kỳ %s đi qua', async (period) => {
    await expect(query({ period })).resolves.toMatchObject({ period });
  });
});
