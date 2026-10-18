import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { STAFF_PERMISSIONS_KEY } from '../../common/staff-permissions';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  CreateDealerTierDto,
  DealerAccountsAdminController,
  DealerTierAdminController,
  ListDealerAccountsQuery,
  UpdateDealerTierDto,
} from './dealer-accounts-admin.controller';

const CONTROLLERS = [DealerAccountsAdminController, DealerTierAdminController] as const;
const methodsOf = (c: (typeof CONTROLLERS)[number]) =>
  Object.getOwnPropertyNames(c.prototype).filter((m) => m !== 'constructor' && Reflect.getMetadata(METHOD_METADATA, (c.prototype as unknown as Record<string, object>)[m]!) !== undefined);

describe('Phân quyền: đại lý & bậc đại lý chỉ ADMIN (tham số tiền)', () => {
  it('cả hai controller chỉ @Roles(ADMIN), không route nào mở @AllowStaff', () => {
    for (const c of CONTROLLERS) {
      expect(Reflect.getMetadata(ROLES_KEY, c)).toEqual(['ADMIN']);
      for (const m of methodsOf(c)) {
        const h = (c.prototype as unknown as Record<string, object>)[m]!;
        expect(Reflect.getMetadata(ROLES_KEY, h)).toBeUndefined();
        expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, h)).toBeUndefined();
      }
    }
  });

  it('RolesGuard thật: ADMIN qua; khách, CTV, đại lý, nhân viên CSKH/KHO nhận 403 ở MỌI route (kể cả tạo và sửa bậc)', () => {
    const guard = new RolesGuard(new Reflector());
    const ctx = (c: (typeof CONTROLLERS)[number], m: string, user: object) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
        getHandler: () => (c.prototype as unknown as Record<string, object>)[m],
        getClass: () => c,
      }) as unknown as ExecutionContext;
    expect(methodsOf(DealerTierAdminController)).toEqual(expect.arrayContaining(['manage', 'create', 'update', 'history']));
    expect(methodsOf(DealerAccountsAdminController)).toEqual(['accounts']);
    for (const c of CONTROLLERS) {
      for (const m of methodsOf(c)) {
        expect(guard.canActivate(ctx(c, m, { role: 'ADMIN' }))).toBe(true);
        for (const user of [{ role: 'CUSTOMER' }, { role: 'AFFILIATE' }, { role: 'DEALER' }, { role: 'STAFF', staffPermissions: ['CSKH', 'KHO'] }, undefined]) {
          expect(() => guard.canActivate(ctx(c, m, user as object))).toThrow(ForbiddenException);
        }
      }
    }
  });

  it('đường dẫn: GET admin/dealers/accounts; POST admin/dealer-tiers; PUT admin/dealer-tiers/:id; GET manage, history', () => {
    const path = (c: (typeof CONTROLLERS)[number], m: string) => {
      const h = (c.prototype as unknown as Record<string, object>)[m]!;
      return `${Reflect.getMetadata(METHOD_METADATA, h)} ${Reflect.getMetadata(PATH_METADATA, c)}/${Reflect.getMetadata(PATH_METADATA, h)}`;
    };
    expect(path(DealerAccountsAdminController, 'accounts')).toBe('0 admin/dealers/accounts');
    expect(path(DealerTierAdminController, 'update')).toBe('2 admin/dealer-tiers/:id');
    expect(path(DealerTierAdminController, 'manage')).toBe('0 admin/dealer-tiers/manage');
    expect(path(DealerTierAdminController, 'history')).toBe('0 admin/dealer-tiers/history');
  });
});

describe('DTO — sửa / tạo bậc đại lý', () => {
  const opts = { whitelist: true, forbidNonWhitelisted: true };
  const body = { name: 'Đại lý Cấp 1', minOrderVolume: 10_000_000, discountPct: 20, creditLimit: 0, paymentTerms: 'PREPAID' };

  it('nhận bậc hợp lệ; điều kiện thanh toán bỏ trống hoặc null được', () => {
    expect(validateSync(plainToInstance(UpdateDealerTierDto, { ...body, expected: body }), opts)).toEqual([]);
    expect(validateSync(plainToInstance(UpdateDealerTierDto, { ...body, paymentTerms: null, expected: body }), opts)).toEqual([]);
    const { paymentTerms: _t, ...noTerms } = body;
    expect(validateSync(plainToInstance(UpdateDealerTierDto, { ...noTerms, expected: noTerms }), opts)).toEqual([]);
  });

  it.each([
    ['thiếu chiết khấu', { discountPct: undefined }],
    ['chiết khấu là chuỗi', { discountPct: '20' }],
    ['hạn mức lẻ', { creditLimit: 10.5 }],
    ['doanh số chuỗi', { minOrderVolume: '1' }],
    ['tên không phải chuỗi', { name: 5 }],
    ['trường lạ (discountRules)', { discountRules: { default: 0.9 } }],
  ])('từ chối: %s', (_l, patch) => {
    expect(validateSync(plainToInstance(UpdateDealerTierDto, { ...body, expected: body, ...patch }), opts).length).toBeGreaterThan(0);
  });

  it('tạo bậc cần mã dạng DEALER_1: chữ hoa, số, gạch dưới; không đổi được sau khi tạo (UpdateDealerTierDto không nhận id)', () => {
    expect(validateSync(plainToInstance(CreateDealerTierDto, { ...body, id: 'DEALER_1' }), opts)).toEqual([]);
    for (const id of ['dealer_1', '1DEALER', 'D', 'A B', 'A'.repeat(33), '']) {
      expect(validateSync(plainToInstance(CreateDealerTierDto, { ...body, id }), opts).length).toBeGreaterThan(0);
    }
    expect(validateSync(plainToInstance(UpdateDealerTierDto, { ...body, expected: body, id: 'X_Y' }), opts).length).toBeGreaterThan(0);
  });
});

describe('ListDealerAccountsQuery', () => {
  const opts = { whitelist: true, forbidNonWhitelisted: true };
  it('nhận search, tierId, debtOnly (1/true) và phân trang', () => {
    const q = plainToInstance(ListDealerAccountsQuery, { page: '2', limit: '10', search: 'Hoa', tierId: 'DEALER_1', debtOnly: '1' });
    expect(validateSync(q, opts)).toEqual([]);
    expect(q.debtOnly).toBe(true);
    expect(plainToInstance(ListDealerAccountsQuery, { debtOnly: 'false' }).debtOnly).toBe(false);
  });
  it('từ chối giá trị lạ và trường lạ', () => {
    expect(validateSync(plainToInstance(ListDealerAccountsQuery, { debtOnly: 'maybe' }), opts).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(ListDealerAccountsQuery, { sort: 'debt' }), opts).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(ListDealerAccountsQuery, { search: 'a'.repeat(101) }), opts).length).toBeGreaterThan(0);
  });
});

describe('DealerTierAdminController — chuyển tham số xuống service', () => {
  it('create/update lấy id admin từ token, update lấy id bậc từ đường dẫn', async () => {
    const svc = { createTier: jest.fn().mockResolvedValue({ id: 'D1' }), updateTier: jest.fn().mockResolvedValue({ id: 'D1' }), listTiers: jest.fn(), tierHistory: jest.fn() };
    const ctl = new DealerTierAdminController(svc as never);
    const dto = { name: 'A', minOrderVolume: 0, discountPct: 10, creditLimit: 0 };
    await ctl.create('admin-9', Object.assign(new CreateDealerTierDto(), { id: 'D1', ...dto }));
    expect(svc.createTier).toHaveBeenCalledWith('admin-9', expect.objectContaining({ id: 'D1', discountPct: 10 }));
    await ctl.update('admin-9', 'D1', Object.assign(new UpdateDealerTierDto(), { ...dto, expected: dto }));
    expect(svc.updateTier).toHaveBeenCalledWith('admin-9', 'D1', expect.objectContaining({ discountPct: 10 }), expect.objectContaining({ discountPct: 10 }));
  });
});

describe('UpdateDealerTierDto — phải kèm phiên bản bậc admin đã thấy (chống ghi đè im lặng)', () => {
  const opts = { whitelist: true, forbidNonWhitelisted: true } as const;
  const body = { name: 'A', minOrderVolume: 0, discountPct: 10, creditLimit: 0, paymentTerms: 'NET 30' };
  it('có expected hợp lệ → qua; thiếu, sai kiểu hoặc trường lạ → lỗi', () => {
    expect(validateSync(plainToInstance(UpdateDealerTierDto, { ...body, expected: { ...body } }), opts)).toEqual([]);
    expect(validateSync(plainToInstance(UpdateDealerTierDto, { ...body, expected: { ...body, paymentTerms: null } }), opts)).toEqual([]);
    expect(validateSync(plainToInstance(UpdateDealerTierDto, body), opts).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(UpdateDealerTierDto, { ...body, expected: { ...body, creditLimit: 'x' } }), opts).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(UpdateDealerTierDto, { ...body, expected: { ...body, id: 'D1' } }), opts).length).toBeGreaterThan(0);
  });
  it('tạo bậc không nhận expected', () => {
    expect(validateSync(plainToInstance(CreateDealerTierDto, { id: 'D1', ...body, expected: body }), opts).length).toBeGreaterThan(0);
  });
});
