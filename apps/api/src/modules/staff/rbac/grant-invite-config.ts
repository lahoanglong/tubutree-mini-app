/** Số ngày lời mời quyền theo SĐT (người chưa có tài khoản) còn hiệu lực; quá hạn thì applyGrants bỏ qua. */
export const STAFF_GRANT_INVITE_TTL_DAYS_KEY = 'staff.grant_invite_ttl_days';
export const DEFAULT_GRANT_INVITE_TTL_DAYS = 7;
export const MAX_GRANT_INVITE_TTL_DAYS = 30;

/** Giá trị cấu hình sai (không phải số nguyên 1..30) thì dùng mặc định thay vì để lời mời không bao giờ hết hạn. */
export function grantInviteTtlDays(raw: unknown): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= MAX_GRANT_INVITE_TTL_DAYS ? raw : DEFAULT_GRANT_INVITE_TTL_DAYS;
}
