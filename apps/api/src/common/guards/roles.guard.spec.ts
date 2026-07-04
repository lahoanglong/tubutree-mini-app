import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { UserRole } from '@tubutree/shared-types';
import { RolesGuard } from './roles.guard';

function makeCtx(user: { role: UserRole } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function makeGuard(required: UserRole[] | undefined) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
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
});
