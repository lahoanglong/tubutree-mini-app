import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtPayload, UserRole } from '@tubutree/shared-types';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { STAFF_PERMISSIONS_KEY, type StaffPermission } from '../staff-permissions';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, targets);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;
    if (user && required.includes(user.role)) return true;
    // STAFF có nhóm việc được route mở cho (@AllowStaff) — nhóm đọc từ DB mỗi request (JwtStrategy), không từ token.
    if (user?.role === 'STAFF') {
      const allowed = this.reflector.getAllAndOverride<StaffPermission[] | undefined>(STAFF_PERMISSIONS_KEY, targets);
      if (allowed?.some((p) => user.staffPermissions?.includes(p))) return true;
    }
    throw new ForbiddenException('Bạn không có quyền truy cập tài nguyên này.');
  }
}
