import { MINI_BASKET_PICK } from '@tubutree/shared-types';

/** Logic thuần của bàn Giỏ Đúng Việc (G5): chọn đúng `MINI_BASKET_PICK` trong 6 sản phẩm, đổi ý được tới lúc bấm Xong. */

/**
 * Chạm một sản phẩm: đang chọn thì bỏ chọn; chưa chọn thì chọn nếu còn chỗ. Đã đủ món mà chạm món thứ tư, hoặc slug không thuộc đề, thì trả
 * lại đúng mảng cũ (nơi gọi so sánh để báo "đã đủ").
 */
export function basketToggle(picked: readonly string[], slug: string, allowed: readonly string[], max: number = MINI_BASKET_PICK): readonly string[] {
  if (!allowed.includes(slug)) return picked;
  if (picked.includes(slug)) return picked.filter((s) => s !== slug);
  if (picked.length >= max) return picked;
  return [...picked, slug];
}

export const basketReady = (picked: readonly string[], max: number = MINI_BASKET_PICK) => picked.length === max;
export const basketFull = (picked: readonly string[], max: number = MINI_BASKET_PICK) => picked.length >= max;
