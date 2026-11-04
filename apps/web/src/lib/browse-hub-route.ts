import { SEARCH_PARAM_KEYS } from './search-state';

/**
 * Đường dẫn nội bộ của bản tĩnh (ISR) hub /san-pham. Middleware viết lại /san-pham không tham số lọc sang đây: trang /san-pham đọc
 * searchParams nên Next dựng nó mỗi lượt, còn hub thì giống nhau cho mọi khách. Truy cập thẳng bị chuyển về /san-pham.
 */
export const HUB = '/hub-san-pham';

/**
 * Không có khoá nào đổi nội dung trang (bộ lọc, từ khoá, số trang): utm, ref, fbclid vẫn dùng bản tĩnh. `focus` thì không: bản tĩnh dựng
 * với searchParams rỗng (ô tìm đóng) nên trình duyệt hydrate với ô tìm đang mở sẽ lệch HTML.
 */
export function isHubQuery(params: URLSearchParams): boolean {
  return !params.has('page') && !params.has('focus') && !SEARCH_PARAM_KEYS.some((key) => params.has(key));
}
