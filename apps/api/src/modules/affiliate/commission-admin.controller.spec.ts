import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { STAFF_PERMISSIONS_KEY } from '../../common/staff-permissions';
import {
  CommissionAdminController,
  ImportCommissionRatesDto,
  ListCommissionRatesQuery,
  SetCommissionRateDto,
} from './commission-admin.controller';
import type { CommissionAdminService } from './commission-admin.service';

const errors = <T extends object>(cls: new () => T, body: object) =>
  validateSync(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true });

describe('CommissionAdminController — % hoa hồng CTV và người giới thiệu của đơn', () => {
  it('chỉ ADMIN — không route nào mở cho nhân viên (chạm tiền CTV)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CommissionAdminController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, CommissionAdminController)).toBeUndefined();
    const proto = CommissionAdminController.prototype as unknown as Record<string, object>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, proto[name]!)).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, proto[name]!)).toBeUndefined();
    }
  });

  it.each([
    ['thiếu rate', {}],
    ['rate là chuỗi', { rate: '10' }],
    ['rate NaN', { rate: Number.NaN }],
    ['trường lạ', { rate: 10, productId: 'x' }],
  ])('SetCommissionRateDto từ chối: %s', (_l, body) => {
    expect(errors(SetCommissionRateDto, body).length).toBeGreaterThan(0);
  });

  it('SetCommissionRateDto nhận số (trần và luật số nguyên kiểm ở service, kèm gợi ý tiếng Việt)', () => {
    expect(errors(SetCommissionRateDto, { rate: 10 })).toEqual([]);
  });

  it('ImportCommissionRatesDto: csv bắt buộc, không rỗng, giới hạn độ dài', () => {
    expect(errors(ImportCommissionRatesDto, {}).length).toBeGreaterThan(0);
    expect(errors(ImportCommissionRatesDto, { csv: '' }).length).toBeGreaterThan(0);
    expect(errors(ImportCommissionRatesDto, { csv: 'x'.repeat(300_001) }).length).toBeGreaterThan(0);
    expect(errors(ImportCommissionRatesDto, { csv: 'A1,10' })).toEqual([]);
  });

  it('ListCommissionRatesQuery: missing=1/true → true, 0 → false, giá trị lạ → lỗi; take phải là số', () => {
    expect(plainToInstance(ListCommissionRatesQuery, { missing: '1' }).missing).toBe(true);
    expect(plainToInstance(ListCommissionRatesQuery, { missing: 'true' }).missing).toBe(true);
    expect(plainToInstance(ListCommissionRatesQuery, { missing: '0' }).missing).toBe(false);
    expect(errors(ListCommissionRatesQuery, { missing: 'yes' }).length).toBeGreaterThan(0);
    expect(errors(ListCommissionRatesQuery, { take: 'abc' }).length).toBeGreaterThan(0);
    expect(errors(ListCommissionRatesQuery, { q: 'x'.repeat(65) }).length).toBeGreaterThan(0);
  });

  it('kẹp take vào 1–50 và chuyển id admin xuống service', async () => {
    const svc = {
      listProducts: jest.fn().mockResolvedValue({}),
      setVariationRate: jest.fn().mockResolvedValue({}),
      applyImport: jest.fn().mockResolvedValue({}),
    };
    const ctl = new CommissionAdminController(svc as unknown as CommissionAdminService);
    await ctl.list(plainToInstance(ListCommissionRatesQuery, { take: '500', missing: '1' }));
    expect(svc.listProducts).toHaveBeenCalledWith({ q: undefined, missing: true, cursor: undefined, take: 50 });
    await ctl.setVariation('admin-1', 'v1', { rate: 10 });
    expect(svc.setVariationRate).toHaveBeenCalledWith('admin-1', 'v1', 10);
    await ctl.applyImport('admin-1', { csv: 'A1,10' });
    expect(svc.applyImport).toHaveBeenCalledWith('admin-1', 'A1,10');
  });
});
