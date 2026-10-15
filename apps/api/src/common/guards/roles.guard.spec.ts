import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { UserRole } from '@tubutree/shared-types';
import { RolesGuard } from './roles.guard';
import { STAFF_PERMISSIONS_KEY } from '../staff-permissions';

function makeCtx(user: { role: UserRole; staffPermissions?: string[] } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function makeGuard(required: UserRole[] | undefined, staffPerms?: string[]) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => (key === STAFF_PERMISSIONS_KEY ? staffPerms : required)),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('route không khai báo @Roles → cho qua', () => {
    expect(makeGuard(undefined).canActivate(makeCtx({ role: 'CUSTOMER' }))).toBe(true);
  });

  it('@Roles rỗng → cho qua', () => {
    expect(makeGuard([]).canActivate(makeCtx({ role: 'CUSTOMER' }))).toBe(true);
  });

  it('ADMIN vào route @Roles(ADMIN) → cho qua', () => {
    expect(makeGuard(['ADMIN']).canActivate(makeCtx({ role: 'ADMIN' }))).toBe(true);
  });

  it('CUSTOMER vào route @Roles(ADMIN) → Forbidden', () => {
    expect(() => makeGuard(['ADMIN']).canActivate(makeCtx({ role: 'CUSTOMER' }))).toThrow(ForbiddenException);
  });

  it('STAFF vào route @Roles(STAFF, ADMIN) → cho qua', () => {
    expect(makeGuard(['STAFF', 'ADMIN']).canActivate(makeCtx({ role: 'STAFF' }))).toBe(true);
  });

  it('DEALER vào route @Roles(STAFF, ADMIN) → Forbidden', () => {
    expect(() => makeGuard(['STAFF', 'ADMIN']).canActivate(makeCtx({ role: 'DEALER' }))).toThrow(
      ForbiddenException,
    );
  });

  it('không có user (chưa xác thực) vào route có @Roles → Forbidden', () => {
    expect(() => makeGuard(['ADMIN']).canActivate(makeCtx(undefined))).toThrow(ForbiddenException);
  });

  describe('nhóm việc STAFF (ADMINOPS-10)', () => {
    it('STAFF có nhóm CSKH vào route @Roles(ADMIN) mở cho CSKH → cho qua', () => {
      expect(makeGuard(['ADMIN'], ['CSKH', 'KHO']).canActivate(makeCtx({ role: 'STAFF', staffPermissions: ['CSKH'] }))).toBe(true);
    });

    it('STAFF chỉ có nhóm KHO vào route chỉ mở cho CSKH → Forbidden', () => {
      expect(() =>
        makeGuard(['ADMIN'], ['CSKH']).canActivate(makeCtx({ role: 'STAFF', staffPermissions: ['KHO'] })),
      ).toThrow(ForbiddenException);
    });

    it('STAFF không có nhóm nào vào route ADMIN → Forbidden (giữ hành vi cũ)', () => {
      expect(() => makeGuard(['ADMIN'], ['CSKH']).canActivate(makeCtx({ role: 'STAFF' }))).toThrow(ForbiddenException);
    });

    it('route ADMIN không mở cho nhóm nào (cấu hình, lương, rút tiền) → STAFF có đủ nhóm vẫn Forbidden', () => {
      expect(() =>
        makeGuard(['ADMIN'], undefined).canActivate(makeCtx({ role: 'STAFF', staffPermissions: ['CSKH', 'KHO'] })),
      ).toThrow(ForbiddenException);
    });

    it('khách mang mảng nhóm việc (dữ liệu lạ) vẫn không vào được — chỉ áp cho role STAFF', () => {
      expect(() =>
        makeGuard(['ADMIN'], ['CSKH']).canActivate(makeCtx({ role: 'CUSTOMER', staffPermissions: ['CSKH'] })),
      ).toThrow(ForbiddenException);
    });
  });
});
