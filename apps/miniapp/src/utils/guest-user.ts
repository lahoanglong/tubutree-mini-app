import type { AuthUser } from '@tubutree/shared-types';

/** Cùng luật "khách thật" của máy chủ (common/real-user.ts): có SĐT, hoặc zaloId Zalo thật (không phải guest_). */
export function isGuestUser(u: Pick<AuthUser, 'phone' | 'zaloId'>): boolean {
  if (u.phone) return false;
  return !u.zaloId || u.zaloId.startsWith('guest_');
}
