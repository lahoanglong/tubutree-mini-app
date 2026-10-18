import { UserRole } from '@prisma/client';

/**
 * Vai trò được ghi công đơn hàng và hưởng hoa hồng CTV. Khách thường chia sẻ link (`?ref=<mã khách>` ở nút chia sẻ sản phẩm,
 * mua chung) chỉ nhận thưởng "giới thiệu bạn bè" bằng điểm, đi theo `User.referredById` lúc tạo tài khoản, không qua đơn.
 * Chủ dự án muốn khách thường cũng hưởng hoa hồng thì thêm "CUSTOMER" vào khoá này.
 */
export const COMMISSION_ELIGIBLE_ROLES_KEY = 'affiliate.commission_eligible_roles';
export const DEFAULT_COMMISSION_ELIGIBLE_ROLES: readonly UserRole[] = [UserRole.AFFILIATE, UserRole.DEALER];

const ALL_ROLES = new Set<string>(Object.values(UserRole));

/** Lỗi của giá trị khoá (luật ghi ở SystemConfigService), null = hợp lệ. */
export function eligibleRolesProblem(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return `phải là mảng vai trò không rỗng, vd ["AFFILIATE","DEALER"] (vai trò có: ${[...ALL_ROLES].join(', ')})`;
  }
  const bad = value.find((r) => typeof r !== 'string' || !ALL_ROLES.has(r));
  return bad === undefined ? null : `vai trò ${JSON.stringify(bad)} không tồn tại (vai trò có: ${[...ALL_ROLES].join(', ')})`;
}

/** Giá trị đọc từ cấu hình; hỏng thì dùng mặc định thay vì mở cho mọi vai trò hay chặn hết hoa hồng. */
export function sanitizeEligibleRoles(value: unknown): ReadonlySet<UserRole> {
  return new Set(eligibleRolesProblem(value) ? DEFAULT_COMMISSION_ELIGIBLE_ROLES : (value as UserRole[]));
}
