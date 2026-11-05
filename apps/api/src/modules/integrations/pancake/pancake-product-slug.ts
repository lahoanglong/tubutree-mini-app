import { CAMPAIGN_ENTITY_SLUG_MAX } from '@tubutree/shared-types';

const SUFFIX_LENGTH = 6;

/**
 * Slug sản phẩm Pancake: tên không dấu + `-` + 6 ký tự cuối của mã Pancake. Tên Pancake không có trần nên phần tên bị cắt để cả slug vừa
 * CAMPAIGN_ENTITY_SLUG_MAX (chiến dịch gắn sản phẩm theo slug); hậu tố giữ nguyên để vẫn duy nhất. Chỉ dùng khi tạo sản phẩm mới: sản phẩm đã có giữ slug đã lưu.
 */
export function pancakeProductSlug(name: string, suffix: string): string {
  const tail = suffix.slice(-SUFFIX_LENGTH).toLowerCase();
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // bỏ dấu tiếng Việt
    .replace(/[đ]/g, 'd') // đ → d
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const room = CAMPAIGN_ENTITY_SLUG_MAX - 1 - tail.length;
  return `${base.slice(0, room).replace(/-+$/, '')}-${tail}`;
}
