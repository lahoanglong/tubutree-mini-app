import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { STAFF_PERMISSIONS_KEY } from '../../common/staff-permissions';
import { GoodwillCreditController, GoodwillCreditDto } from './goodwill-credit.controller';
import type { GoodwillCreditService } from './goodwill-credit.service';

const valid = { kind: 'WALLET', amount: 50_000, reason: 'Giao trễ 3 ngày, xin lỗi khách' };
const errorsOf = (body: object) => validateSync(plainToInstance(GoodwillCreditDto, body));

describe('GoodwillCreditController — tặng thiện chí (w51-01)', () => {
  it('chỉ ADMIN: lớp khai @Roles(ADMIN), không handler nào mở @AllowStaff', () => {
    expect(Reflect.getMetadata(ROLES_KEY, GoodwillCreditController)).toEqual(['ADMIN']);
    for (const h of [GoodwillCreditController.prototype.grant, GoodwillCreditController.prototype.list]) {
      expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, h)).toBeUndefined();
    }
    expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, GoodwillCreditController)).toBeUndefined();
  });

  it('thiếu hay sai Idempotency-Key: 400, không gọi service', () => {
    const svc = { grant: jest.fn() };
    const ctrl = new GoodwillCreditController(svc as unknown as GoodwillCreditService);
    expect(() => ctrl.grant('a1', 'u1', valid as GoodwillCreditDto, undefined)).toThrow(BadRequestException);
    expect(() => ctrl.grant('a1', 'u1', valid as GoodwillCreditDto, 'ngan')).toThrow(BadRequestException);
    expect(svc.grant).not.toHaveBeenCalled();
  });

  it('chuyển đúng người tặng, khách, nội dung và khoá sang service', async () => {
    const svc = { grant: jest.fn().mockResolvedValue({ id: 'log1' }) };
    const ctrl = new GoodwillCreditController(svc as unknown as GoodwillCreditService);
    await ctrl.grant('a1', 'u1', valid as GoodwillCreditDto, 'key-12345678');
    expect(svc.grant).toHaveBeenCalledWith('a1', 'u1', valid, 'key-12345678');
  });

  it('DTO hợp lệ', () => {
    expect(errorsOf(valid)).toEqual([]);
    expect(errorsOf({ ...valid, kind: 'POINTS', orderCode: 'TB2611AB12' })).toEqual([]);
  });

  it.each([
    ['loại lạ', { ...valid, kind: 'COUPON' }],
    ['số 0', { ...valid, amount: 0 }],
    ['số âm', { ...valid, amount: -1 }],
    ['số lẻ', { ...valid, amount: 1.5 }],
    ['quá trần một lần', { ...valid, amount: 200_001 }],
    ['số dạng chuỗi', { ...valid, amount: '50000' }],
    ['thiếu lý do', { kind: 'WALLET', amount: 1_000 }],
    ['lý do dưới 10 ký tự', { ...valid, reason: 'xin lỗi' }],
    ['lý do chỉ khoảng trắng', { ...valid, reason: '            ' }],
    ['lý do quá 500 ký tự', { ...valid, reason: 'x'.repeat(501) }],
    ['mã đơn có ký tự lạ', { ...valid, orderCode: 'TB 1;DROP' }],
    ['mã đơn quá dài', { ...valid, orderCode: 'A'.repeat(41) }],
  ])('DTO từ chối: %s', (_label, body) => {
    expect(errorsOf(body).length).toBeGreaterThan(0);
  });
});
