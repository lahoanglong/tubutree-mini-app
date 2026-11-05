import { createHash } from 'crypto';
import { CAMPAIGN_ENTITY_SLUG_MAX } from '@tubutree/shared-types';

const SUFFIX_LENGTH = 6;
/** Tên toàn ký hiệu hoặc khoảng trắng: phần tên rỗng sẽ làm slug bắt đầu bằng "-", không khớp CAMPAIGN_ENTITY_SLUG_RE. */
const EMPTY_NAME = 'san-pham';

/**
 * Slug sản phẩm Pancake: tên không dấu + `-` + 6 ký tự cuối của mã Pancake. Tên Pancake không có trần nên phần tên bị cắt để cả slug vừa
 * CAMPAIGN_ENTITY_SLUG_MAX (chiến dịch gắn sản phẩm theo slug); hậu tố giữ nguyên để vẫn duy nhất. Chỉ dùng khi tạo sản phẩm mới: sản phẩm đã có giữ slug đã lưu.
 */
export function pancakeProductSlug(name: string, suffix: string): string {
  const raw = suffix.slice(-SUFFIX_LENGTH).toLowerCase();
  // Mã có ký tự lạ (hoặc rỗng) thì 6 ký tự cuối không dùng được trong slug: thay bằng băm của cả mã, vẫn ổn định và gần như duy nhất.
  const tail = /^[a-z0-9_-]{1,6}$/.test(raw) ? raw : createHash('sha1').update(suffix).digest('hex').slice(0, SUFFIX_LENGTH);
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // bỏ dấu tiếng Việt
    .replace(/[đ]/g, 'd') // đ → d
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const room = CAMPAIGN_ENTITY_SLUG_MAX - 1 - tail.length;
  const head = base.slice(0, room).replace(/-+$/, '') || EMPTY_NAME;
  return `${head}-${tail}`;
}
