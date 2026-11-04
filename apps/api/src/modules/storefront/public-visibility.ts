import type { SystemConfigService } from '../system-config/system-config.service';
import { COMMISSION_ELIGIBLE_ROLES_KEY, DEFAULT_COMMISSION_ELIGIBLE_ROLES, sanitizeEligibleRoles } from '../affiliate/commission-eligibility';
import { STOREFRONT_REQUIRE_APPROVAL_KEY, isStorefrontApprovalRequired } from './storefront-config';
import type { PublicVisibilityOptions } from './storefront-visibility';

/** Khoá cấu hình mà `loadPublicVisibility` đọc: đổi một khoá trong số này thì tập gian hàng công khai, và danh sách ảnh /img được đổi cỡ, đổi theo. */
export const PUBLIC_VISIBILITY_CONFIG_KEYS: readonly string[] = [COMMISSION_ELIGIBLE_ROLES_KEY, STOREFRONT_REQUIRE_APPROVAL_KEY];

/** Đọc từ cấu hình hiện hành hai điều kiện đổi được của bộ lọc `publicStorefrontWhere`: vai trò hưởng hoa hồng và cờ bắt duyệt. */
export async function loadPublicVisibility(config: Pick<SystemConfigService, 'get'>): Promise<PublicVisibilityOptions> {
  const [roles, requireApproval] = await Promise.all([
    config.get<unknown>(COMMISSION_ELIGIBLE_ROLES_KEY, DEFAULT_COMMISSION_ELIGIBLE_ROLES),
    isStorefrontApprovalRequired(config),
  ]);
  return { eligibleRoles: [...sanitizeEligibleRoles(roles)], requireApproval };
}
