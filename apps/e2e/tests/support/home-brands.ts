import type { MockApi } from './mock-api';

/** Khối cuối Trang chủ (khối `suggest`, w34-02): "Khám phá theo Thương hiệu", mỗi thương hiệu một mục kèm 4 món bán chạy 30 ngày. */
export const BRAND_SHOWCASE = 'Khám phá theo Thương hiệu';

/** Hàng chip dưới lưới Danh mục: mỗi chip một thương hiệu, chạm thì cuộn tới mục của nhãn đó ở khối cuối. */
export const BRAND_BAR = 'Thương hiệu';

/**
 * Khung chờ lưới của Trang chủ trừ khối "Khám phá theo Thương hiệu": nhãn ở khối đó chỉ tải (và vẽ khung chờ) khi khách cuộn tới gần, không thuộc lúc
 * Trang chủ "xong", nên spec chờ Trang chủ "xong" đếm khung chờ ở các khối khác.
 */
export const LOADING_GRID_OUTSIDE_BRANDS = '[data-testid="catalog-grid-skeleton"]:not([data-home-block="suggest"] *)';

/** Một nhãn đủ để khối cuối Trang chủ hiện. Món của nhãn là trả lời của mock `/products` mà spec đã khai (mock không lọc theo `brand`). */
export const HOME_BRANDS = [{ brand: 'Tubu Tree', count: 12 }];

/**
 * Hàng chip Thương hiệu và khối cuối Trang chủ đọc `GET /brands` ở mọi lần mở Trang chủ (Mini lấy từ khối gộp `/home` khi API có khối đó).
 * `mockSession` mặc định trả danh sách rỗng, khi đó khối cuối ẩn. Spec cần thấy khối thì gọi hàm này SAU `mockSession` (đăng ký sau thắng).
 */
export function mockHomeBrands(api: MockApi, brands: readonly { brand: string; count: number }[] = HOME_BRANDS): MockApi {
  api.get('/brands', [...brands]);
  return api;
}
