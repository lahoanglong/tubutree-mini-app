import 'reflect-metadata';
import { ForbiddenException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SetStorePartnerDto, StorefrontPartnerAdminController } from './merchant-admin.controller';

function contextFor(role: string, staffPermissions: string[] = []): ExecutionContext {
  return {
    getHandler: () => StorefrontPartnerAdminController.prototype.setPartner,
    getClass: () => StorefrontPartnerAdminController,
    switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u1', role, staffPermissions } }) }),
  } as unknown as ExecutionContext;
}

describe('POST /admin/storefronts/:id/partner', () => {
  it('route POST admin/storefronts/:id/partner, chỉ ADMIN: nhân viên (cả CSKH/KHO), đại lý, khách bị 403', () => {
    expect(Reflect.getMetadata(PATH_METADATA, StorefrontPartnerAdminController)).toBe('admin/storefronts');
    expect(Reflect.getMetadata(PATH_METADATA, StorefrontPartnerAdminController.prototype.setPartner)).toBe(':id/partner');
    expect(Reflect.getMetadata(METHOD_METADATA, StorefrontPartnerAdminController.prototype.setPartner)).toBe(RequestMethod.POST);
    const guard = new RolesGuard(new Reflector());
    expect(guard.canActivate(contextFor('ADMIN'))).toBe(true);
    expect(() => guard.canActivate(contextFor('STAFF', ['CSKH', 'KHO']))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor('DEALER'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor('CUSTOMER'))).toThrow(ForbiddenException);
  });

  it('body bắt buộc isPartner kiểu boolean', () => {
    const errs = (b: unknown) => validateSync(plainToInstance(SetStorePartnerDto, b as object)).length;
    expect(errs({ isPartner: false })).toBe(0);
    expect(errs({ isPartner: true })).toBe(0);
    expect(errs({})).toBeGreaterThan(0);
    expect(errs({ isPartner: 'false' })).toBeGreaterThan(0);
  });

  it('controller chuyển adminId, id gian hàng và giá trị cờ xuống service', async () => {
    const fulfilment = { setStorePartner: jest.fn().mockResolvedValue({ id: 's1', isPartner: false }) };
    const ctrl = new StorefrontPartnerAdminController(fulfilment as never);
    await expect(ctrl.setPartner('admin-1', 's1', { isPartner: false })).resolves.toEqual({ id: 's1', isPartner: false });
    expect(fulfilment.setStorePartner).toHaveBeenCalledWith('admin-1', 's1', false);
  });
});
