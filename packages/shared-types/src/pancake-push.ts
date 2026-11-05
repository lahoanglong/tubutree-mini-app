/**
 * Tiền tố lời lỗi đẩy đơn khi Pancake trả 401/403 cho RIÊNG một đơn (đơn đã được thử lại sau khi khoá đẩy được đơn khác, loại lỗi
 * REJECTED). API ghi tiền tố này vào `pancakeSyncError`, admin web nhận biết bằng `isPancakeForbiddenError` thay vì dò chuỗi tự do.
 */
export const PANCAKE_FORBIDDEN_ERROR_PREFIX = 'Từ chối quyền (401/403): ';

export const isPancakeForbiddenError = (syncError: string | null | undefined): boolean =>
  typeof syncError === 'string' && syncError.startsWith(PANCAKE_FORBIDDEN_ERROR_PREFIX);
