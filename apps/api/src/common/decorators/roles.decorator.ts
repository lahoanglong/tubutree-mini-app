import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@tubutree/shared-types';

export const ROLES_KEY = 'roles';

/** Giới hạn route theo role. VD: @Roles('ADMIN', 'STAFF') */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
