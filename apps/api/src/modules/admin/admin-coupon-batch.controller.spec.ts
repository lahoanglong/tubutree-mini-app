import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AdminCouponBatchController, CreateCouponBatchDto, SetCouponBatchActiveDto } from './admin-coupon-batch.controller';
import type { AdminCouponBatchService } from './admin-coupon-batch.service';

const VALID = {
  prefix: ' shopee11 ',
  quantity: 500,
  type: 'AMOUNT',
  value: 30000,
  minOrder: 99000,
  startAt: '2026-11-01T00:00:00.000Z',
  endAt: '2026-12-31T16:59:59.000Z',
  newCustomerOnly: true,
};

const errors = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(CreateCouponBatchDto, body), { whitelist: true, forbidNonWhitelisted: true });

describe('AdminCouponBatchController (D2-03: lô mã thẻ hộp hàng)', () => {
  it('chỉ ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminCouponBatchController)).toEqual(['ADMIN']);
  });

  it('nhận lô hợp lệ, tiền tố về chữ HOA bỏ khoảng trắng', () => {
    expect(errors(VALID)).toEqual([]);
    expect(plainToInstance(CreateCouponBatchDto, VALID).prefix).toBe('SHOPEE11');
  });

  it.each([
    ['tiền tố có dấu/ký tự lạ', { prefix: 'SHÔPEE' }],
    ['tiền tố có gạch (gạch dành cho phần ngẫu nhiên)', { prefix: 'SHOP-EE' }],
    ['tiền tố quá ngắn', { prefix: 'S' }],
    ['số lượng 0', { quantity: 0 }],
    ['số lượng vượt trần một lô', { quantity: 2001 }],
    ['% trên 100', { type: 'PERCENT', value: 150 }],
    ['giảm tiền vượt trần (gõ thừa số 0)', { value: 50_000_000 }],
    ['đơn tối thiểu âm', { minOrder: -1 }],
    ['ngày sai định dạng', { endAt: '31/12/2026' }],
    ['tự đặt tổng lượt (lô luôn 1 lượt mỗi mã)', { usageLimit: 100 }],
  ])('từ chối: %s', (_label, over) => {
    expect(errors({ ...VALID, ...over }).length).toBeGreaterThan(0);
  });

  it('tắt/bật lô: isActive bắt buộc là boolean', () => {
    expect(validateSync(plainToInstance(SetCouponBatchActiveDto, { isActive: 'false' })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(SetCouponBatchActiveDto, { isActive: false }))).toEqual([]);
  });

  it('chuyển đúng tham số xuống service', async () => {
    const svc = {
      create: jest.fn().mockResolvedValue('c'),
      list: jest.fn().mockResolvedValue('l'),
      codes: jest.fn().mockResolvedValue('k'),
      setActive: jest.fn().mockResolvedValue('s'),
    };
    const ctrl = new AdminCouponBatchController(svc as unknown as AdminCouponBatchService);
    const dto = plainToInstance(CreateCouponBatchDto, VALID);
    await expect(ctrl.create('s1', 'STAFF', dto)).resolves.toBe('c');
    expect(svc.create).toHaveBeenCalledWith(dto, { id: 's1', staff: true });
    await expect(ctrl.list()).resolves.toBe('l');
    await expect(ctrl.codes('SHOPEE11')).resolves.toBe('k');
    expect(svc.codes).toHaveBeenCalledWith('SHOPEE11');
    await expect(ctrl.setActive('SHOPEE11', { isActive: false })).resolves.toBe('s');
    expect(svc.setActive).toHaveBeenCalledWith('SHOPEE11', false);
  });
});
