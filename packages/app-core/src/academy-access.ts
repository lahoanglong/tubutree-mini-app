/** Vai trò mà API Học viện (`@Roles` ở academy.controller.ts) cho vào; khách thường và khách chưa đăng nhập thì không. */
const ACADEMY_ROLES: readonly string[] = ['AFFILIATE', 'DEALER', 'STAFF', 'ADMIN'];

export function canUseAcademy(role: string | null | undefined): boolean {
  return !!role && ACADEMY_ROLES.includes(role);
}
