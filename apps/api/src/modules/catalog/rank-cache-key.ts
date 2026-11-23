import { createHash } from 'node:crypto';

/** Khoá dài hơn mức này được băm. Khoá ngắn giữ nguyên chuỗi JSON để dễ đọc khi gỡ lỗi. */
export const RANK_KEY_RAW_MAX_CHARS = 2000;
/** Đổi cách dựng chuỗi gốc của khoá thì tăng số phiên bản, để khoá cũ và khoá mới không trùng nhau. */
export const RANK_KEY_HASH_PREFIX = 'sha256:v1:';

/**
 * Khoá của `rankCache`. Bộ lọc `id IN [...]` (Đang ưu đãi, Có bản Refill, `slugs`) có thể vượt 2.000 ký tự khi danh sách quá khoảng 70 id.
 * Trước đây khoá dài bị bỏ qua và mọi lượt tải quét lại cả danh mục. Nay khoá dài được băm SHA-256 nên chính khoá chỉ dài 74 ký tự. Giá
 * trị nhớ vẫn là mảng id dài bằng kết quả lọc, tối đa `RANK_MAX_KEYS` mảng (vài MB với danh mục hiện tại). Chuỗi gốc là JSON và luôn bắt
 * đầu bằng `{`, nên không trùng tiền tố băm.
 */
export function rankCacheKey(raw: string): string {
  return raw.length <= RANK_KEY_RAW_MAX_CHARS ? raw : `${RANK_KEY_HASH_PREFIX}${createHash('sha256').update(raw).digest('hex')}`;
}
