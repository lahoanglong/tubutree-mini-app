import type { Prisma } from '@prisma/client';
import type { SystemConfigService } from '../system-config/system-config.service';

/**
 * Gian hàng CTV mới phải được admin duyệt lần đầu mới hiện trên trang công khai. Mặc định bật. Tắt: gian hàng đã
 * đăng hiện ngay, chỉ gian hàng đã duyệt mới có tick xanh và nhãn "CTV tuyển chọn".
 */
export const STOREFRONT_REQUIRE_APPROVAL_KEY = 'storefront.require_approval';
export const DEFAULT_STOREFRONT_REQUIRE_APPROVAL = true;
/** Gian hàng CTV đã đăng đang chờ duyệt lần đầu: dùng chung cho bộ lọc tab Gian hàng và số ở hộp việc. */
export const STOREFRONT_PENDING_APPROVAL_WHERE = { isPublished: true, takenDownAt: null, type: 'CTV', isPartner: false, approvedAt: null } satisfies Prisma.StorefrontWhereInput;

/**
 * Cho CTV/đối tác dùng link `<tên>.tubutree.com`. Tắt cho tới khi DNS wildcard và chứng chỉ xong (D6-02): mọi nơi chỉ hiện và
 * chia sẻ `/s/<slug>`.
 */
export const STOREFRONT_SUBDOMAIN_ENABLED_KEY = 'storefront.subdomain_enabled';
export const DEFAULT_STOREFRONT_SUBDOMAIN_ENABLED = false;

type ConfigReader = Pick<SystemConfigService, 'get'>;

/** Chỉ đúng boolean `true` mới bật: giá trị lạ (chuỗi "false") không vô tình mở cờ. */
export async function isStorefrontApprovalRequired(config: ConfigReader): Promise<boolean> {
  return (await config.get<unknown>(STOREFRONT_REQUIRE_APPROVAL_KEY, DEFAULT_STOREFRONT_REQUIRE_APPROVAL)) === true;
}

export async function isStorefrontSubdomainEnabled(config: ConfigReader): Promise<boolean> {
  return (await config.get<unknown>(STOREFRONT_SUBDOMAIN_ENABLED_KEY, DEFAULT_STOREFRONT_SUBDOMAIN_ENABLED)) === true;
}

/**
 * Cờ tắt thì mọi phản hồi gian hàng (công khai, builder, cổng đối tác) không mang subdomain và tên miền riêng: giao diện nào
 * cũng chỉ còn `/s/<slug>` để hiện và chia sẻ, kể cả giao diện chưa kịp sửa. Giá trị vẫn nằm trong DB nên bật cờ lại là hiện lại.
 */
export function withSubdomainFlag<T extends { subdomain?: string | null; customDomain?: string | null }>(sf: T, enabled: boolean) {
  return {
    ...sf,
    subdomain: enabled ? (sf.subdomain ?? null) : null,
    customDomain: enabled ? (sf.customDomain ?? null) : null,
    subdomainEnabled: enabled,
  };
}
