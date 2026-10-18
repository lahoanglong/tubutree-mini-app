import type { SystemConfigService } from '../system-config/system-config.service';

/**
 * Gian hàng CTV mới phải được admin duyệt lần đầu mới hiện trên trang công khai. Tắt (mặc định, chủ dự án chưa chốt): gian hàng đã
 * đăng hiện ngay như trước, chỉ gian hàng đã duyệt mới có tick xanh và nhãn "CTV tuyển chọn".
 */
export const STOREFRONT_REQUIRE_APPROVAL_KEY = 'storefront.require_approval';
export const DEFAULT_STOREFRONT_REQUIRE_APPROVAL = false;

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
