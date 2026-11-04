import type { HttpClient } from '@tubutree/app-core/http';
import type { FlashSaleActiveItem } from '@tubutree/app-core/api/flash-sale';
import type { FlashItem } from '@/lib/flash-price';

/**
 * Đợt Giờ vàng đang chạy cho trang dựng phía web server (ISR). Khác `fetchActiveFlashSales` của app-core ở chỗ KHÔNG đồng bộ đồng hồ: bộ nhớ đệm fetch của Next có thể trả
 * bản cũ tới 60 giây, và `syncServerClock` ghi độ lệch vào biến của tiến trình, nên bản cũ sẽ dịch `serverNow()` của mọi lần dựng sau đó trong tiến trình (thẻ gian hàng,
 * khối thương hiệu). Đồng hồ chỉ đồng bộ ở trình duyệt, nơi mỗi người có điện thoại lệch riêng.
 */
export const fetchActiveFlashSalesNoSync = (http: HttpClient) => http.get<FlashSaleActiveItem[]>('/flash-sales/active', { anonymous: true });

/**
 * Phần của đợt Giờ vàng mà trang chi tiết thật sự cần ở trình duyệt, đưa vào HTML/RSC của trang. Danh sách cả đợt không giới hạn (đợt lớn có hàng trăm suất) và API còn trả tên,
 * ảnh, tên phân loại: bỏ hết, chỉ giữ các trường giá và hạn mà thanh Giờ vàng, giá, nút mua và thẻ sản phẩm liên quan đọc. Giữ suất của CẢ các sản phẩm khác (thẻ gợi ý
 * cùng trang cần giá Giờ vàng của chúng), nên không lọc theo sản phẩm này.
 */
export function toFlashSeed(items: readonly FlashSaleActiveItem[]): FlashItem[] {
  return items.map((it) => ({
    itemId: it.itemId,
    variationId: it.variationId,
    productSlug: it.productSlug,
    flashPrice: it.flashPrice,
    retailPrice: it.retailPrice,
    ...(it.salePrice != null ? { salePrice: it.salePrice } : {}),
    soldCount: it.soldCount,
    quota: it.quota,
    endAt: it.endAt,
    ...(it.perUserLimit != null ? { perUserLimit: it.perUserLimit } : {}),
  }));
}
